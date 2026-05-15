import { getClients } from './analyticsService'
import { prisma } from '../db/prisma'

const BASELINE_MONTHS = 5
const DECLINE_THRESHOLD = 0.10
const PARTIAL_COVERAGE_THRESHOLD = 0.03  // < 3% of recent monthly = partially covered
const UNCOVERED_RAMP = 1.0               // 100% of region share (upper estimate)
const PARTIAL_RAMP   = 0.50             // 50% for partial (already there, needs to grow)

// Regions always excluded from expansion potential
const GLOBALLY_EXCLUDED_REGIONS = new Set(['SÃO PAULO'])

// For clients whose origin state matches, also exclude their home region
const STATE_TO_HOME_REGION: Record<string, string> = {
  ES: 'ESPIRITO SANTO',
}

function normalizeRegion(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function excludedRegionsFor(state: string | null): Set<string> {
  const excluded = new Set(GLOBALLY_EXCLUDED_REGIONS)
  if (state && STATE_TO_HOME_REGION[state]) excluded.add(STATE_TO_HOME_REGION[state])
  return excluded
}

export interface OpportunityScore {
  cnpj: string
  clientName: string
  groupedName: string
  city: string | null
  state: string | null
  segment: string | null
  curve: string | null
  baselineBilling: number
  currentBilling: number
  uncoveredRoutesCount: number
  partiallyCoveredRoutesCount: number
  uncoveredRevenueEstimate: number
  totalScore: number
  hasKanbanCard: boolean
  kanbanCard: { id: string; status: string; priority: string; assignedToId: string | null } | null
  manualExpansionPotential: number | null
  expansionRegions: string[]
}

// Churn-specific: uses real calendar months (fills missing months with 0)
// so clients absent for several months don't have inflated baselines
function calcBaselineCalendar(
  months: { year: number; month: number; billing: number }[],
  count = BASELINE_MONTHS,
): number {
  const now = new Date()
  const billingMap = new Map(months.map((m) => [`${m.year}-${m.month}`, m.billing]))
  // Baseline = the `count` calendar months immediately before the last complete month
  let sum = 0
  for (let i = 2; i <= count + 1; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    sum += billingMap.get(`${d.getFullYear()}-${d.getMonth() + 1}`) ?? 0
  }
  return sum / count
}

function lastCompletedMonthCalendar(months: { year: number; month: number; billing: number }[]): number {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const billingMap = new Map(months.map((m) => [`${m.year}-${m.month}`, m.billing]))
  return billingMap.get(`${d.getFullYear()}-${d.getMonth() + 1}`) ?? 0
}

function calcBaseline(months: { year: number; month: number; billing: number }[]): number {
  const now = new Date()
  const completed = months.filter((m) =>
    m.year < now.getFullYear() ||
    (m.year === now.getFullYear() && m.month < now.getMonth() + 1),
  )
  if (completed.length === 0) return 0
  const recent = completed.slice(-BASELINE_MONTHS)
  return recent.reduce((sum, m) => sum + m.billing, 0) / recent.length
}

function lastCompletedMonth(months: { year: number; month: number; billing: number }[]): number {
  const now = new Date()
  const completed = months.filter(
    (m) => m.year < now.getFullYear() || (m.year === now.getFullYear() && m.month < now.getMonth() + 1),
  )
  return completed.at(-1)?.billing ?? 0
}

// Weight = region's total revenue share in the company (volume × ticket)
function buildRegionWeights(allRoutes: { region: string; totalRevenue: number }[]): Map<string, number> {
  const companyTotal = allRoutes.reduce((sum, r) => sum + r.totalRevenue, 0)
  const map = new Map<string, number>()
  for (const r of allRoutes) {
    map.set(r.region, companyTotal > 0 ? r.totalRevenue / companyTotal : 1 / allRoutes.length)
  }
  return map
}

export async function getOpportunities(limit = 50, offset = 0, filterRegion?: string, filterSegment?: string, filterCity?: string, tab: 'new' | 'in_progress' = 'new'): Promise<{
  opportunities: OpportunityScore[]
  total: number
}> {
  const now = new Date()
  const cutoffYear = now.getMonth() >= BASELINE_MONTHS + 2
    ? now.getFullYear()
    : now.getFullYear() - 1
  const cutoffMonth = ((now.getMonth() - (BASELINE_MONTHS + 2) + 12) % 12) + 1

  const [{ clients }, allMonthly, allClientRoutes, allRoutes, existingCards, exclusions] = await Promise.all([
    getClients({ limit: 5000 }),
    prisma.biClientMonthly.findMany({
      where: {
        OR: [
          { year: { gt: cutoffYear } },
          { year: cutoffYear, month: { gte: cutoffMonth } },
        ],
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    }),
    prisma.biClientRoute.findMany({
      select: { clientCnpj: true, region: true, recentMonthlyAvg: true, tripCount: true },
    }),
    prisma.biAllRoute.findMany(),
    prisma.kanbanCard.findMany({
      select: { id: true, clientId: true, status: true, priority: true, assignedToId: true, manualExpansionPotential: true },
    }),
    prisma.opportunityExclusion.findMany({ select: { cnpj: true } }),
  ])

  const excludedSet = new Set(exclusions.map((e) => e.cnpj))

  // "Active" cards = not LOST and not EXPANDED (EXPANDED clients live in the expansion screen)
  const ACTIVE_STATUSES = new Set(['IDENTIFIED', 'CONTACTED', 'NEGOTIATING'])
  const cardByClient = new Map(
    existingCards
      .filter((c) => ACTIVE_STATUSES.has(c.status))
      .map((c) => [c.clientId, c]),
  )
  const manualByClient = new Map(
    existingCards.map((c) => [c.clientId, c.manualExpansionPotential]),
  )

  const regionWeights = buildRegionWeights(allRoutes)

  const monthlyByCnpj = new Map<string, { year: number; month: number; billing: number }[]>()
  for (const row of allMonthly) {
    const list = monthlyByCnpj.get(row.clientCnpj) ?? []
    list.push({ year: row.year, month: row.month, billing: row.billing })
    monthlyByCnpj.set(row.clientCnpj, list)
  }

  // region → { recentMonthlyAvg, tripCount } per client
  const routesByCnpj = new Map<string, Map<string, { avg: number; tripCount: number }>>()
  for (const r of allClientRoutes) {
    const map = routesByCnpj.get(r.clientCnpj) ?? new Map()
    map.set(r.region, { avg: r.recentMonthlyAvg, tripCount: r.tripCount })
    routesByCnpj.set(r.clientCnpj, map)
  }

  const scored: OpportunityScore[] = []

  for (const client of clients) {
    if (excludedSet.has(client.cnpj)) continue

    const months = monthlyByCnpj.get(client.cnpj) ?? []
    // calcBaselineCalendar preenche meses sem faturamento como zero,
    // eliminando clientes inativos nos últimos meses do ranking de oportunidades
    const baselineBilling = calcBaselineCalendar(months)
    if (baselineBilling === 0) continue

    const currentBilling = lastCompletedMonthCalendar(months)
    const clientRouteMap = routesByCnpj.get(client.cnpj) ?? new Map()
    const excluded = excludedRegionsFor(client.state)

    // Recent monthly total (sum of recent_monthly_avg across all active regions)
    const recentTotal = Array.from(clientRouteMap.values()).reduce((s, v) => s + v.avg, 0)

    let uncoveredCount = 0
    let partialCount = 0
    let expansionPotential = 0
    const expansionRegions: string[] = []
    const regionPotentialMap = new Map<string, number>()

    for (const route of allRoutes) {
      if (excluded.has(route.region)) continue
      const weight = regionWeights.get(route.region) ?? 0
      const routeData = clientRouteMap.get(route.region)

      if (!routeData || routeData.tripCount === 0 || routeData.avg === 0) {
        // Never sent, no shipments last month, or zero freight (stale/invalid data)
        uncoveredCount++
        const p = baselineBilling * weight * UNCOVERED_RAMP
        expansionPotential += p
        expansionRegions.push(route.region)
        regionPotentialMap.set(route.region, p)
      } else if (recentTotal > 0 && routeData.avg / recentTotal < PARTIAL_COVERAGE_THRESHOLD) {
        // Sends < 3% of recent monthly there
        partialCount++
        const p = baselineBilling * weight * PARTIAL_RAMP
        expansionPotential += p
        expansionRegions.push(route.region)
        regionPotentialMap.set(route.region, p)
      }
    }

    if (expansionPotential === 0) continue
    if (filterRegion && !expansionRegions.some(r => normalizeRegion(r) === normalizeRegion(filterRegion))) continue
    if (filterSegment && normalizeRegion(client.segment ?? '') !== normalizeRegion(filterSegment)) continue
    if (filterCity && normalizeRegion(client.city ?? '') !== normalizeRegion(filterCity)) continue

    const normalizedFilter = filterRegion ? normalizeRegion(filterRegion) : null
    const displayPotential = normalizedFilter
      ? (Array.from(regionPotentialMap.entries()).find(([r]) => normalizeRegion(r) === normalizedFilter)?.[1] ?? 0)
      : expansionPotential

    const activeCard = cardByClient.get(client.cnpj) ?? null
    const hasActiveCard = activeCard !== null

    // Tab filter: 'new' → no active card; 'in_progress' → has active card
    if (tab === 'new'         && hasActiveCard) continue
    if (tab === 'in_progress' && !hasActiveCard) continue

    const manual     = manualByClient.get(client.cnpj) ?? null
    const totalScore = manual ?? Math.round(displayPotential * 100) / 100

    scored.push({
      cnpj:                        client.cnpj,
      clientName:                  client.name,
      groupedName:                 client.groupedName,
      city:                        client.city,
      state:                       client.state,
      segment:                     client.segment,
      curve:                       client.curve,
      baselineBilling:             Math.round(baselineBilling * 100) / 100,
      currentBilling:              Math.round(currentBilling * 100) / 100,
      uncoveredRoutesCount:        uncoveredCount,
      partiallyCoveredRoutesCount: partialCount,
      uncoveredRevenueEstimate:    Math.round(displayPotential * 100) / 100,
      totalScore,
      hasKanbanCard:               hasActiveCard,
      kanbanCard:                  activeCard ? { id: activeCard.id, status: activeCard.status, priority: activeCard.priority, assignedToId: activeCard.assignedToId } : null,
      manualExpansionPotential:    manual,
      expansionRegions,
    })
  }

  scored.sort((a, b) => b.totalScore - a.totalScore)

  return {
    opportunities: scored.slice(offset, offset + limit),
    total: scored.length,
  }
}

// Starts from Kanban cards (source of truth) and joins BI data
export async function getInProgressOpportunities(limit = 50, offset = 0): Promise<{
  opportunities: OpportunityScore[]
  total: number
}> {
  const ACTIVE_STATUSES = ['IDENTIFIED', 'CONTACTED', 'NEGOTIATING']

  const [cards, allRoutes] = await Promise.all([
    prisma.kanbanCard.findMany({
      where: { status: { in: ACTIVE_STATUSES as any } },
      select: { id: true, clientId: true, clientName: true, status: true, priority: true, assignedToId: true, manualExpansionPotential: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.biAllRoute.findMany(),
  ])

  const regionWeights = buildRegionWeights(allRoutes)
  const cnpjs = cards.map((c) => c.clientId)

  const [biClients, allMonthly, allClientRoutes] = await Promise.all([
    prisma.biClient.findMany({ where: { cnpj: { in: cnpjs } } }),
    prisma.biClientMonthly.findMany({ where: { clientCnpj: { in: cnpjs } }, orderBy: [{ year: 'asc' }, { month: 'asc' }] }),
    prisma.biClientRoute.findMany({ where: { clientCnpj: { in: cnpjs } }, select: { clientCnpj: true, region: true, recentMonthlyAvg: true, tripCount: true } }),
  ])

  const biClientMap = new Map(biClients.map((c) => [c.cnpj, c]))
  const monthlyByCnpj = new Map<string, { year: number; month: number; billing: number }[]>()
  for (const r of allMonthly) {
    const list = monthlyByCnpj.get(r.clientCnpj) ?? []
    list.push({ year: r.year, month: r.month, billing: r.billing })
    monthlyByCnpj.set(r.clientCnpj, list)
  }
  const routesByCnpj = new Map<string, Map<string, { avg: number; tripCount: number }>>()
  for (const r of allClientRoutes) {
    const map = routesByCnpj.get(r.clientCnpj) ?? new Map()
    map.set(r.region, { avg: r.recentMonthlyAvg, tripCount: r.tripCount })
    routesByCnpj.set(r.clientCnpj, map)
  }

  const result: OpportunityScore[] = []

  for (const card of cards) {
    const bi = biClientMap.get(card.clientId)
    const months = monthlyByCnpj.get(card.clientId) ?? []
    const baselineBilling = calcBaseline(months)
    const currentBilling  = lastCompletedMonth(months)
    const clientRouteMap  = routesByCnpj.get(card.clientId) ?? new Map()
    const excluded        = excludedRegionsFor(bi?.state ?? null)
    const recentTotal     = Array.from(clientRouteMap.values()).reduce((s, v) => s + v.avg, 0)

    let uncoveredCount = 0
    let partialCount   = 0
    let expansionPotential = 0
    const expansionRegions: string[] = []

    for (const route of allRoutes) {
      if (excluded.has(route.region)) continue
      const weight    = regionWeights.get(route.region) ?? 0
      const routeData = clientRouteMap.get(route.region)
      if (!routeData || routeData.tripCount === 0 || routeData.avg === 0) {
        uncoveredCount++
        expansionPotential += baselineBilling * weight * UNCOVERED_RAMP
        expansionRegions.push(route.region)
      } else if (recentTotal > 0 && routeData.avg / recentTotal < PARTIAL_COVERAGE_THRESHOLD) {
        partialCount++
        expansionPotential += baselineBilling * weight * PARTIAL_RAMP
        expansionRegions.push(route.region)
      }
    }

    const manual     = card.manualExpansionPotential
    const totalScore = manual ?? Math.round(expansionPotential * 100) / 100

    result.push({
      cnpj:                        card.clientId,
      clientName:                  bi?.name ?? card.clientName,
      groupedName:                 bi?.groupedName ?? card.clientName,
      city:                        bi?.city ?? null,
      state:                       bi?.state ?? null,
      segment:                     bi?.segment ?? null,
      curve:                       bi?.curve ?? null,
      baselineBilling:             Math.round(baselineBilling * 100) / 100,
      currentBilling:              Math.round(currentBilling * 100) / 100,
      uncoveredRoutesCount:        uncoveredCount,
      partiallyCoveredRoutesCount: partialCount,
      uncoveredRevenueEstimate:    Math.round(expansionPotential * 100) / 100,
      totalScore,
      hasKanbanCard:               true,
      kanbanCard:                  { id: card.id, status: card.status, priority: card.priority, assignedToId: card.assignedToId },
      manualExpansionPotential:    manual,
      expansionRegions,
    })
  }

  result.sort((a, b) => b.totalScore - a.totalScore)

  return {
    opportunities: result.slice(offset, offset + limit),
    total: result.length,
  }
}

export async function getClientExpansionDetail(cnpj: string) {
  const [recentMonths, clientRoutes, allRoutes, clientRecord, kanbanCard] = await Promise.all([
    prisma.biClientMonthly.findMany({
      where: { clientCnpj: cnpj },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 18,
    }).then((rows) => rows.reverse()),
    prisma.biClientRoute.findMany({ where: { clientCnpj: cnpj } }),
    prisma.biAllRoute.findMany(),
    prisma.biClient.findUnique({ where: { cnpj }, select: { state: true } }),
    prisma.kanbanCard.findFirst({
      where: { clientId: cnpj },
      select: { id: true, manualExpansionPotential: true },
    }),
  ])

  const excluded = excludedRegionsFor(clientRecord?.state ?? null)
  const regionWeights = buildRegionWeights(allRoutes)
  const months = recentMonths.map((m) => ({ year: m.year, month: m.month, billing: m.billing }))
  const baseline = calcBaseline(months)
  const current = lastCompletedMonth(months)

  const clientRouteMap = new Map(clientRoutes.map((r) => [r.region, r]))

  // Recent total = sum of recent_monthly_avg across all covered regions
  const recentTotal = clientRoutes.reduce((s, r) => s + r.recentMonthlyAvg, 0)

  const coveredRoutes: {
    region: string; tripCount: number; recentMonthlyAvg: number; revenueShare: number
  }[] = []
  const partiallyCoveredRoutes: {
    region: string; tripCount: number; recentMonthlyAvg: number; revenueShare: number; expansionPotential: number
  }[] = []
  const uncoveredRoutes: {
    region: string; tripCount: number; expansionPotential: number
  }[] = []

  let calcExpansionPotential = 0

  for (const route of allRoutes) {
    const cr = clientRouteMap.get(route.region)
    const weight = regionWeights.get(route.region) ?? 0

    if (excluded.has(route.region)) {
      // Show as covered if client sends there, otherwise ignore
      if (cr) {
        coveredRoutes.push({
          region:          cr.region,
          tripCount:       cr.tripCount,
          recentMonthlyAvg: Math.round(cr.recentMonthlyAvg * 100) / 100,
          revenueShare:    recentTotal > 0 ? Math.round((cr.recentMonthlyAvg / recentTotal) * 10000) / 100 : 0,
        })
      }
      continue
    }

    if (!cr || cr.tripCount === 0 || cr.recentMonthlyAvg === 0) {
      const potential = Math.round(baseline * weight * UNCOVERED_RAMP * 100) / 100
      calcExpansionPotential += potential
      uncoveredRoutes.push({ region: route.region, tripCount: cr?.tripCount ?? 0, expansionPotential: potential })
    } else {
      const revenueShare = recentTotal > 0 ? cr.recentMonthlyAvg / recentTotal : 0
      if (revenueShare < PARTIAL_COVERAGE_THRESHOLD) {
        const potential = Math.round(baseline * weight * PARTIAL_RAMP * 100) / 100
        calcExpansionPotential += potential
        partiallyCoveredRoutes.push({
          region:             cr.region,
          tripCount:          cr.tripCount,
          recentMonthlyAvg:   Math.round(cr.recentMonthlyAvg * 100) / 100,
          revenueShare:       Math.round(revenueShare * 10000) / 100,
          expansionPotential: potential,
        })
      } else {
        coveredRoutes.push({
          region:           cr.region,
          tripCount:        cr.tripCount,
          recentMonthlyAvg: Math.round(cr.recentMonthlyAvg * 100) / 100,
          revenueShare:     Math.round(revenueShare * 10000) / 100,
        })
      }
    }
  }

  let declineGap = 0
  if (baseline > 0 && current < baseline) {
    const dropRatio = (baseline - current) / baseline
    if (dropRatio > DECLINE_THRESHOLD) declineGap = baseline - current
  }

  const expansionPotential = kanbanCard?.manualExpansionPotential ?? calcExpansionPotential

  return {
    baseline:                    Math.round(baseline * 100) / 100,
    currentBilling:              Math.round(current * 100) / 100,
    declineGap:                  Math.round(declineGap * 100) / 100,
    uncoveredRoutesCount:        uncoveredRoutes.length,
    partiallyCoveredRoutesCount: partiallyCoveredRoutes.length,
    expansionPotential,
    manualExpansionPotential:    kanbanCard?.manualExpansionPotential ?? null,
    kanbanCardId:                kanbanCard?.id ?? null,
    coveredRoutes:               coveredRoutes.sort((a, b) => b.revenueShare - a.revenueShare),
    partiallyCoveredRoutes:      partiallyCoveredRoutes.sort((a, b) => b.expansionPotential - a.expansionPotential),
    uncoveredRoutes:             uncoveredRoutes.sort((a, b) => b.expansionPotential - a.expansionPotential),
    monthlyHistory:              months,
  }
}

export async function calcNrr(cnpj: string): Promise<number | null> {
  const rows = await prisma.biClientMonthly.findMany({
    where: { clientCnpj: cnpj },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 6,
  }).then((r) => r.reverse())
  if (rows.length < 2) return null

  const now = new Date()
  const completed = rows.filter(
    (m) => m.year < now.getFullYear() || (m.year === now.getFullYear() && m.month < now.getMonth() + 1),
  )
  if (completed.length < 2) return null

  let positiveSum = 0
  let negativeSum = 0
  const base = completed[0].billing

  for (let i = 1; i < completed.length; i++) {
    const delta = completed[i].billing - completed[i - 1].billing
    const ratio = Math.abs(delta) / (completed[i - 1].billing || 1)
    if (ratio <= DECLINE_THRESHOLD) continue
    if (delta > 0) positiveSum += delta
    else negativeSum += Math.abs(delta)
  }

  if (base === 0) return null
  return Math.round(((positiveSum - negativeSum) / base) * 10000) / 100
}

const CHURN_MIN_BASELINE   = 10000  // R$10.000 mínimo de média mensal
const CHURN_ENTRY_THRESHOLD = 0.40  // entra na lista com queda > 40%
const CHURN_PCT_THRESHOLD   = 0.50  // classificado como CHURN com queda > 50%
const CHURN_ABS_THRESHOLD   = 5000  // e queda > R$5.000

export interface ChurnEntry {
  cnpj: string
  clientName: string
  groupedName: string
  city: string | null
  state: string | null
  segment: string | null
  baselineBilling: number
  lastMonthBilling: number
  dropAmount: number
  dropPercent: number
  churnType: 'CHURN' | 'POSSIVEL_CHURN'
  weeklyTrend: number[]  // últimas 10 semanas de faturamento
  hasKanbanCard: boolean
}

export async function getChurnAnalysis(
  limit = 50,
  offset = 0,
  filterSegment?: string,
  filterCity?: string,
  filterType?: 'CHURN' | 'POSSIVEL_CHURN',
): Promise<{ churns: ChurnEntry[]; total: number }> {
  const [{ clients }, allMonthly, allWeekly, existingCards] = await Promise.all([
    getClients({ limit: 5000 }),
    prisma.biClientMonthly.findMany({
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    }),
    prisma.biClientWeekly.findMany({
      orderBy: [{ year: 'asc' }, { week: 'asc' }],
    }),
    prisma.kanbanCard.findMany({ select: { clientId: true } }),
  ])

  const cardSet = new Set(existingCards.map((c) => c.clientId))

  const monthlyByCnpj = new Map<string, { year: number; month: number; billing: number }[]>()
  for (const row of allMonthly) {
    const list = monthlyByCnpj.get(row.clientCnpj) ?? []
    list.push({ year: row.year, month: row.month, billing: row.billing })
    monthlyByCnpj.set(row.clientCnpj, list)
  }

  const weeklyByCnpj = new Map<string, number[]>()
  for (const row of allWeekly) {
    const list = weeklyByCnpj.get(row.clientCnpj) ?? []
    list.push(row.billing)
    weeklyByCnpj.set(row.clientCnpj, list)
  }

  const churns: ChurnEntry[] = []

  for (const client of clients) {
    if (filterSegment && normalizeRegion(client.segment ?? '') !== normalizeRegion(filterSegment)) continue
    if (filterCity    && normalizeRegion(client.city    ?? '') !== normalizeRegion(filterCity))    continue

    const months   = monthlyByCnpj.get(client.cnpj) ?? []
    const baseline = calcBaselineCalendar(months)
    if (baseline < CHURN_MIN_BASELINE) continue

    const lastMonth  = lastCompletedMonthCalendar(months)
    const dropAmount = baseline - lastMonth
    const dropPct    = baseline > 0 ? (dropAmount / baseline) * 100 : 0

    if (lastMonth !== 0 && dropPct < CHURN_ENTRY_THRESHOLD * 100) continue

    const churnType: 'CHURN' | 'POSSIVEL_CHURN' =
      dropPct > CHURN_PCT_THRESHOLD * 100 && dropAmount > CHURN_ABS_THRESHOLD
        ? 'CHURN'
        : 'POSSIVEL_CHURN'

    if (filterType && churnType !== filterType) continue

    const weeklyTrend = weeklyByCnpj.get(client.cnpj) ?? []

    churns.push({
      cnpj:             client.cnpj,
      clientName:       client.name,
      groupedName:      client.groupedName,
      city:             client.city,
      state:            client.state,
      segment:          client.segment,
      baselineBilling:  Math.round(baseline   * 100) / 100,
      lastMonthBilling: Math.round(lastMonth  * 100) / 100,
      dropAmount:       Math.round(dropAmount * 100) / 100,
      dropPercent:      Math.round(dropPct    * 100) / 100,
      churnType,
      weeklyTrend,
      hasKanbanCard:    cardSet.has(client.cnpj),
    })
  }

  churns.sort((a, b) => b.dropAmount - a.dropAmount)

  return {
    churns: churns.slice(offset, offset + limit),
    total:  churns.length,
  }
}
