import { prisma } from '../db/prisma'

// Returns billing rows for a client sorted oldest → newest
export async function getClientMonthly(clientCnpj: string) {
  return prisma.biClientMonthly.findMany({
    where: { clientCnpj },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })
}

// Returns the last N months of billing for a client (for baseline calculation)
export async function getClientRecentMonths(clientCnpj: string, months: number) {
  const now = new Date()
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1)

  return prisma.biClientMonthly.findMany({
    where: {
      clientCnpj,
      OR: [
        { year: { gt: cutoff.getFullYear() } },
        {
          year: cutoff.getFullYear(),
          month: { gte: cutoff.getMonth() + 1 },
        },
      ],
    },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })
}

// Returns all routes a specific client has used
export async function getClientRoutes(clientCnpj: string) {
  return prisma.biClientRoute.findMany({
    where: { clientCnpj },
    orderBy: { tripCount: 'desc' },
  })
}

// Returns all routes served by Sal Express
export async function getAllRoutes() {
  return prisma.biAllRoute.findMany({
    orderBy: { avgRevenue: 'desc' },
  })
}

// Returns routes served by Sal Express that a given client has NOT used
export async function getUncoveredRoutes(clientCnpj: string) {
  const [clientRoutes, allRoutes] = await Promise.all([
    getClientRoutes(clientCnpj),
    getAllRoutes(),
  ])

  const usedRegions = new Set(clientRoutes.map((r) => r.region))
  return allRoutes.filter((r) => !usedRegions.has(r.region))
}

// Returns all active clients from the BI cache, optionally filtered
export async function getClients(opts: {
  search?: string
  state?: string
  segment?: string
  curve?: string
  limit?: number
  offset?: number
}) {
  const { search, state, segment, curve, limit = 50, offset = 0 } = opts

  const where: any = {}

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { groupedName: { contains: search, mode: 'insensitive' } },
      { cnpj: { contains: search } },
    ]
  }
  if (state)   where.state   = state
  if (segment) where.segment = segment
  if (curve)   where.curve   = curve

  const [clients, total] = await Promise.all([
    prisma.biClient.findMany({ where, take: limit, skip: offset, orderBy: { name: 'asc' } }),
    prisma.biClient.count({ where }),
  ])

  return { clients, total }
}

export async function getClientById(cnpj: string) {
  return prisma.biClient.findUnique({ where: { cnpj } })
}

// ── Multi-CNPJ aggregation helpers ───────────────────────────────────────────

function aggregateByMonth<T extends { year: number; month: number; billing: number }>(
  rows: T[],
): { year: number; month: number; billing: number }[] {
  const map = new Map<string, { year: number; month: number; billing: number }>()
  for (const r of rows) {
    const key = `${r.year}-${r.month}`
    const e = map.get(key)
    if (e) e.billing += r.billing
    else map.set(key, { year: r.year, month: r.month, billing: r.billing })
  }
  return Array.from(map.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  )
}

// Aggregated monthly billing for one or more CNPJs (full history)
export async function aggregateMonthlyHistory(cnpjs: string[]) {
  const rows = await prisma.biClientMonthly.findMany({
    where: { clientCnpj: { in: cnpjs } },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })
  return aggregateByMonth(rows)
}

// Aggregated recent N months for one or more CNPJs (for baseline/avg calculation)
export async function aggregateRecentBilling(cnpjs: string[], months: number) {
  const now = new Date()
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1)
  const rows = await prisma.biClientMonthly.findMany({
    where: {
      clientCnpj: { in: cnpjs },
      OR: [
        { year: { gt: cutoff.getFullYear() } },
        { year: cutoff.getFullYear(), month: { gte: cutoff.getMonth() + 1 } },
      ],
    },
  })
  return aggregateByMonth(rows)
}

// Aggregated current month billing for one or more CNPJs (from bi_client_monthly, standard doc types only)
export async function aggregateCurrentMonth(cnpjs: string[]): Promise<number> {
  const now = new Date()
  const rows = await prisma.biClientMonthly.findMany({
    where: { clientCnpj: { in: cnpjs }, year: now.getFullYear(), month: now.getMonth() + 1 },
  })
  return rows.reduce((s, r) => s + r.billing, 0)
}

// Current month billing summed from bi_client_daily — includes ALL document types (reentregas etc.)
// Used for expanded clients where all freight types must count
export async function aggregateCurrentMonthFromDaily(cnpjs: string[]): Promise<number> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const rows = await prisma.biClientDaily.findMany({
    where: { clientCnpj: { in: cnpjs }, date: { gte: monthStart } },
  })
  return rows.reduce((s, r) => s + r.billing, 0)
}

// Aggregated weekly billing for one or more CNPJs
export async function aggregateWeeklyBilling(cnpjs: string[]) {
  const rows = await prisma.biClientWeekly.findMany({
    where: { clientCnpj: { in: cnpjs } },
    orderBy: [{ year: 'asc' }, { week: 'asc' }],
  })
  const map = new Map<string, { year: number; week: number; billing: number }>()
  for (const r of rows) {
    const key = `${r.year}-${r.week}`
    const e = map.get(key)
    if (e) e.billing += r.billing
    else map.set(key, { year: r.year, week: r.week, billing: r.billing })
  }
  return Array.from(map.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.week - b.week,
  )
}

// All CNPJs for a card (primary + additional)
export async function getCardCnpjs(primaryCnpj: string, cardId: string | null): Promise<string[]> {
  if (!cardId) return [primaryCnpj]
  const additional = await prisma.cardAdditionalCnpj.findMany({
    where: { cardId },
    select: { cnpj: true },
  })
  return [primaryCnpj, ...additional.map((a) => a.cnpj)]
}
