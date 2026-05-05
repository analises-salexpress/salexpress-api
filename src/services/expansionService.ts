import { getClients } from './analyticsService'
import { prisma } from '../db/prisma'

const BASELINE_MONTHS = 3
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
  manualExpansionPotential: number | null
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

export async function getOpportunities(limit = 50, offset = 0): Promise<{
  opportunities: OpportunityScore[]
  total: number
}> {
  const now = new Date()
  const cutoffYear = now.getMonth() >= BASELINE_MONTHS + 2
    ? now.getFullYear()
    : now.getFullYear() - 1
  const cutoffMonth = ((now.getMonth() - (BASELINE_MONTHS + 2) + 12) % 12) + 1

  const [{ clients }, allMonthly, allClientRoutes, allRoutes, existingCards] = await Promise.all([
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
      select: { clientCnpj: true, region: true, recentMonthlyAvg: true },
    }),
    prisma.biAllRoute.findMany(),
    prisma.kanbanCard.findMany({
      select: { clientId: true, manualExpansionPotential: true },
    }),
  ])

  const cardByClient = new Map(existingCards.map((c) => [c.clientId, c.manualExpansionPotential]))
  const regionWeights = buildRegionWeights(allRoutes)

  const monthlyByCnpj = new Map<string, { year: number; month: number; billing: number }[]>()
  for (const row of allMonthly) {
    const list = monthlyByCnpj.get(row.clientCnpj) ?? []
    list.push({ year: row.year, month: row.month, billing: row.billing })
    monthlyByCnpj.set(row.clientCnpj, list)
  }

  // region → recentMonthlyAvg per client
  const routesByCnpj = new Map<string, Map<string, number>>()
  for (const r of allClientRoutes) {
    const map = routesByCnpj.get(r.clientCnpj) ?? new Map()
    map.set(r.region, r.recentMonthlyAvg)
    routesByCnpj.set(r.clientCnpj, map)
  }

  const scored: OpportunityScore[] = []

  for (const client of clients) {
    const months = monthlyByCnpj.get(client.cnpj) ?? []
    const baselineBilling = calcBaseline(months)
    if (baselineBilling === 0) continue

    const currentBilling = lastCompletedMonth(months)
    const clientRouteMap = routesByCnpj.get(client.cnpj) ?? new Map()
    const excluded = excludedRegionsFor(client.state)

    // Recent monthly total (sum of recent_monthly_avg across all regions)
    const recentTotal = Array.from(clientRouteMap.values()).reduce((s, v) => s + v, 0)

    let uncoveredCount = 0
    let partialCount = 0
    let expansionPotential = 0

    for (const route of allRoutes) {
      if (excluded.has(route.region)) continue
      const weight = regionWeights.get(route.region) ?? 0
      const recentAvg = clientRouteMap.get(route.region)

      if (recentAvg === undefined) {
        // Never sent to this region
        uncoveredCount++
        expansionPotential += baselineBilling * weight * UNCOVERED_RAMP
      } else if (recentTotal > 0 && recentAvg / recentTotal < PARTIAL_COVERAGE_THRESHOLD) {
        // Sends < 3% of recent monthly there
        partialCount++
        expansionPotential += baselineBilling * weight * PARTIAL_RAMP
      }
    }

    if (expansionPotential === 0) continue

    const manual = cardByClient.get(client.cnpj) ?? null
    const totalScore = manual ?? Math.round(expansionPotential * 100) / 100

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
      uncoveredRevenueEstimate:    Math.round(expansionPotential * 100) / 100,
      totalScore,
      hasKanbanCard:               cardByClient.has(client.cnpj),
      manualExpansionPotential:    manual,
    })
  }

  scored.sort((a, b) => b.totalScore - a.totalScore)

  return {
    opportunities: scored.slice(offset, offset + limit),
    total: scored.length,
  }
}

export async function getClientExpansionDetail(cnpj: string) {
  const [recentMonths, clientRoutes, allRoutes, clientRecord, kanbanCard] = await Promise.all([
    prisma.biClientMonthly.findMany({
      where: { clientCnpj: cnpj },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      take: 12,
    }),
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
    region: string; expansionPotential: number
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

    if (!cr) {
      const potential = Math.round(baseline * weight * UNCOVERED_RAMP * 100) / 100
      calcExpansionPotential += potential
      uncoveredRoutes.push({ region: route.region, expansionPotential: potential })
    } else {
      const revenueShare = recentTotal > 0 ? cr.recentMonthlyAvg / recentTotal : 0
      if (revenueShare < PARTIAL_COVERAGE_THRESHOLD) {
        const potential = Math.round(baseline * weight * PARTIAL_RAMP * 100) / 100
        calcExpansionPotential += potential
        partiallyCoveredRoutes.push({
          region:           cr.region,
          tripCount:        cr.tripCount,
          recentMonthlyAvg: Math.round(cr.recentMonthlyAvg * 100) / 100,
          revenueShare:     Math.round(revenueShare * 10000) / 100,
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
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
    take: 6,
  })
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
