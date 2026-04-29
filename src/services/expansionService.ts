import { getClientRecentMonths, getUncoveredRoutes, getAllRoutes, getClients, getClientRoutes } from './analyticsService'
import { prisma } from '../db/prisma'

const BASELINE_MONTHS = 3
const DECLINE_THRESHOLD = 0.10 // 10% drop triggers a recovery signal

export interface OpportunityScore {
  cnpj: string
  clientName: string
  groupedName: string
  city: string | null
  state: string | null
  segment: string | null
  curve: string | null
  baselineBilling: number
  currentBilling: number    // last full month
  uncoveredRoutesCount: number
  uncoveredRevenueEstimate: number
  declineGap: number
  totalScore: number
  hasKanbanCard: boolean
}

// Average billing over the last BASELINE_MONTHS full months
function calcBaseline(months: { year: number; month: number; billing: number }[]): number {
  const now = new Date()
  // Current partial month is excluded — only count completed months
  const completedMonths = months.filter((m) => {
    if (m.year < now.getFullYear()) return true
    if (m.year === now.getFullYear() && m.month < now.getMonth() + 1) return true
    return false
  })

  if (completedMonths.length === 0) return 0

  const recent = completedMonths.slice(-BASELINE_MONTHS)
  return recent.reduce((sum, m) => sum + m.billing, 0) / recent.length
}

function lastCompletedMonth(months: { year: number; month: number; billing: number }[]): number {
  const now = new Date()
  const completed = months.filter(
    (m) => m.year < now.getFullYear() || (m.year === now.getFullYear() && m.month < now.getMonth() + 1),
  )
  return completed.at(-1)?.billing ?? 0
}

export async function getOpportunities(limit = 50, offset = 0): Promise<{
  opportunities: OpportunityScore[]
  total: number
}> {
  const [{ clients }, allRoutes, existingCards] = await Promise.all([
    getClients({ limit: 5000 }),
    getAllRoutes(),
    prisma.kanbanCard.findMany({ select: { clientId: true } }),
  ])

  const cardCnpjs = new Set(existingCards.map((c) => c.clientId))
  const totalRoutes = allRoutes.length
  const allRouteRevMap = new Map(
    allRoutes.map((r) => [`${r.deliveryCity}|${r.deliveryState}`, r.avgRevenue]),
  )

  const scored: OpportunityScore[] = []

  await Promise.all(
    clients.map(async (client) => {
      const [recentMonths, uncoveredRoutes] = await Promise.all([
        getClientRecentMonths(client.cnpj, BASELINE_MONTHS + 2),
        getUncoveredRoutes(client.cnpj),
      ])

      const baselineBilling = calcBaseline(recentMonths)
      const currentBilling = lastCompletedMonth(recentMonths)

      // Signal 1: revenue from routes client has never used
      const uncoveredRevenueEstimate = uncoveredRoutes.reduce(
        (sum, r) => sum + (allRouteRevMap.get(`${r.deliveryCity}|${r.deliveryState}`) ?? 0),
        0,
      )

      // Signal 2: billing decline gap (only when drop > threshold)
      let declineGap = 0
      if (baselineBilling > 0 && currentBilling < baselineBilling) {
        const dropRatio = (baselineBilling - currentBilling) / baselineBilling
        if (dropRatio > DECLINE_THRESHOLD) {
          declineGap = baselineBilling - currentBilling
        }
      }

      // Clients with zero baseline (new or inactive) get score 0
      if (baselineBilling === 0) return

      const totalScore = uncoveredRevenueEstimate + declineGap

      scored.push({
        cnpj:                   client.cnpj,
        clientName:             client.name,
        groupedName:            client.groupedName,
        city:                   client.city,
        state:                  client.state,
        segment:                client.segment,
        curve:                  client.curve,
        baselineBilling:        Math.round(baselineBilling * 100) / 100,
        currentBilling:         Math.round(currentBilling * 100) / 100,
        uncoveredRoutesCount:   uncoveredRoutes.length,
        uncoveredRevenueEstimate: Math.round(uncoveredRevenueEstimate * 100) / 100,
        declineGap:             Math.round(declineGap * 100) / 100,
        totalScore:             Math.round(totalScore * 100) / 100,
        hasKanbanCard:          cardCnpjs.has(client.cnpj),
      })
    }),
  )

  scored.sort((a, b) => b.totalScore - a.totalScore)

  return {
    opportunities: scored.slice(offset, offset + limit),
    total: scored.length,
  }
}

export async function getClientExpansionDetail(cnpj: string) {
  const [recentMonths, uncoveredRoutes, clientRoutes] = await Promise.all([
    getClientRecentMonths(cnpj, 12),
    getUncoveredRoutes(cnpj),
    getClientRoutes(cnpj),
  ])

  const baseline = calcBaseline(recentMonths)
  const current  = lastCompletedMonth(recentMonths)

  let declineGap = 0
  if (baseline > 0 && current < baseline) {
    const dropRatio = (baseline - current) / baseline
    if (dropRatio > DECLINE_THRESHOLD) declineGap = baseline - current
  }

  const uncoveredRevenueEstimate = uncoveredRoutes.reduce(
    (sum, r) => sum + r.avgRevenue,
    0,
  )

  return {
    baseline:                 Math.round(baseline * 100) / 100,
    currentBilling:           Math.round(current * 100) / 100,
    declineGap:               Math.round(declineGap * 100) / 100,
    uncoveredRoutesCount:     uncoveredRoutes.length,
    uncoveredRevenueEstimate: Math.round(uncoveredRevenueEstimate * 100) / 100,
    coveredRoutes:            clientRoutes,
    uncoveredRoutes,
    monthlyHistory:           recentMonths,
  }
}

// NRR calculation for a client: used in /metrics endpoints
export async function calcNrr(cnpj: string): Promise<number | null> {
  const months = await getClientRecentMonths(cnpj, 6)
  if (months.length < 2) return null

  const completed = months.filter((m) => {
    const now = new Date()
    return m.year < now.getFullYear() || (m.year === now.getFullYear() && m.month < now.getMonth() + 1)
  })

  if (completed.length < 2) return null

  let positiveSum = 0
  let negativeSum = 0
  const base = completed[0].billing

  for (let i = 1; i < completed.length; i++) {
    const delta = completed[i].billing - completed[i - 1].billing
    const ratio = Math.abs(delta) / (completed[i - 1].billing || 1)
    if (ratio <= DECLINE_THRESHOLD) continue  // ignore ≤10% variations

    if (delta > 0) positiveSum += delta
    else negativeSum += Math.abs(delta)
  }

  if (base === 0) return null
  return Math.round(((positiveSum - negativeSum) / base) * 10000) / 100  // percentage
}
