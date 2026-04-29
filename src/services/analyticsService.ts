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

  const usedKeys = new Set(
    clientRoutes.map((r) => `${r.deliveryCity}|${r.deliveryState}`),
  )

  return allRoutes.filter(
    (r) => !usedKeys.has(`${r.deliveryCity}|${r.deliveryState}`),
  )
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
