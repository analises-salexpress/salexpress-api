import { prisma } from '../db/prisma'

function cutoff(monthsBack: number) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1)
}

async function buildClientMap() {
  const clients = await prisma.biClient.findMany({
    select: { cnpj: true, name: true, groupedName: true, state: true, segment: true, curve: true, city: true, tipo: true },
  })
  return new Map(clients.map((c) => [c.cnpj, c]))
}

// ── Tool implementations ──────────────────────────────────────────────────────

export async function toolGetOverview({ months_back = 6 }: { months_back?: number }) {
  const cut = cutoff(months_back)
  const now = new Date()

  const [monthlyRows, clientMap, allRoutes] = await Promise.all([
    prisma.biClientMonthly.findMany({
      where: {
        OR: [
          { year: { gt: cut.getFullYear() } },
          { year: cut.getFullYear(), month: { gte: cut.getMonth() + 1 } },
        ],
        NOT: { year: now.getFullYear(), month: now.getMonth() + 1 },
      },
    }),
    buildClientMap(),
    prisma.biAllRoute.findMany({ orderBy: { totalRevenue: 'desc' }, take: 12 }),
  ])

  const trendMap = new Map<string, { billing: number; clients: Set<string>; ctrc: number }>()
  const segMap   = new Map<string, { billing: number; clients: Set<string> }>()
  const stateMap = new Map<string, { billing: number; clients: Set<string> }>()
  const curveMap = new Map<string, { billing: number; clients: Set<string> }>()

  for (const r of monthlyRows) {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`
    if (!trendMap.has(key)) trendMap.set(key, { billing: 0, clients: new Set(), ctrc: 0 })
    const t = trendMap.get(key)!
    t.billing += r.billing; t.clients.add(r.clientCnpj); t.ctrc += r.deliveriesCount

    const c   = clientMap.get(r.clientCnpj)
    const seg  = c?.segment ?? 'Não classificado'
    const st   = c?.state   ?? 'N/A'
    const cv   = c?.curve   ?? 'N/A'

    for (const [map, key2] of [[segMap, seg], [stateMap, st], [curveMap, cv]] as const) {
      if (!map.has(key2)) map.set(key2, { billing: 0, clients: new Set() })
      const e = map.get(key2)!
      e.billing += r.billing; e.clients.add(r.clientCnpj)
    }
  }

  const fmt = (n: number) => Math.round(n * 100) / 100
  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { billing, clients, ctrc }]) => ({
      period,
      totalBilling:  fmt(billing),
      activeClients: clients.size,
      totalCTRC:     ctrc,
      avgTicket:     ctrc > 0 ? fmt(billing / ctrc) : 0,
    }))

  return {
    periodDescription: `Últimos ${months_back} meses fechados (D-1, exclui mês corrente)`,
    totalBilling:      fmt(monthlyRows.reduce((s, r) => s + r.billing, 0)),
    activeClientCount: new Set(monthlyRows.map((r) => r.clientCnpj)).size,
    totalCTRC:         monthlyRows.reduce((s, r) => s + r.deliveriesCount, 0),
    monthlyTrend:      trend,
    bySegment: Array.from(segMap.entries())
      .map(([seg, { billing, clients }]) => ({ segment: seg, totalBilling: fmt(billing), clientCount: clients.size, avgPerClient: fmt(billing / clients.size) }))
      .sort((a, b) => b.totalBilling - a.totalBilling),
    byState: Array.from(stateMap.entries())
      .map(([state, { billing, clients }]) => ({ state, totalBilling: fmt(billing), clientCount: clients.size }))
      .sort((a, b) => b.totalBilling - a.totalBilling),
    byCurve: Array.from(curveMap.entries())
      .map(([curve, { billing, clients }]) => ({ curve, totalBilling: fmt(billing), clientCount: clients.size }))
      .sort((a, b) => b.totalBilling - a.totalBilling),
    topRoutes: allRoutes.map((r) => ({
      region:       r.region,
      totalRevenue: fmt(r.totalRevenue),
      avgTicket:    fmt(r.avgRevenue),
      tripCount:    r.tripCount,
      clientCount:  r.clientCount,
    })),
  }
}

export async function toolGetTopClients({
  limit = 20, months_back = 3, segment, state, curve,
}: { limit?: number; months_back?: number; segment?: string; state?: string; curve?: string }) {
  const cut = cutoff(months_back)
  const now = new Date()

  const rows = await prisma.biClientMonthly.findMany({
    where: {
      OR: [
        { year: { gt: cut.getFullYear() } },
        { year: cut.getFullYear(), month: { gte: cut.getMonth() + 1 } },
      ],
      NOT: { year: now.getFullYear(), month: now.getMonth() + 1 },
    },
  })

  const billingMap = new Map<string, { billing: number; ctrc: number; months: number }>()
  for (const r of rows) {
    if (!billingMap.has(r.clientCnpj)) billingMap.set(r.clientCnpj, { billing: 0, ctrc: 0, months: 0 })
    const e = billingMap.get(r.clientCnpj)!
    e.billing += r.billing; e.ctrc += r.deliveriesCount; e.months++
  }

  const where: any = { cnpj: { in: Array.from(billingMap.keys()) } }
  if (segment) where.segment = { contains: segment, mode: 'insensitive' as const }
  if (state)   where.state   = state
  if (curve)   where.curve   = curve

  const clients = await prisma.biClient.findMany({ where })
  const fmt = (n: number) => Math.round(n * 100) / 100

  return {
    period:  `Últimos ${months_back} meses fechados`,
    clients: clients
      .map((c) => {
        const b = billingMap.get(c.cnpj)!
        return {
          cnpj:               c.cnpj,
          name:               c.name,
          state:              c.state,
          city:               c.city,
          segment:            c.segment,
          curve:              c.curve,
          totalBilling:       fmt(b.billing),
          avgMonthlyBilling:  fmt(b.billing / b.months),
          totalCTRC:          b.ctrc,
          avgTicketPerCTRC:   b.ctrc > 0 ? fmt(b.billing / b.ctrc) : 0,
        }
      })
      .sort((a, b) => b.totalBilling - a.totalBilling)
      .slice(0, limit),
  }
}

export async function toolGetClientDetail({ cnpj, name }: { cnpj?: string; name?: string }) {
  let client = null

  if (cnpj) {
    client = await prisma.biClient.findUnique({ where: { cnpj } })
  } else if (name) {
    const res = await prisma.biClient.findMany({
      where: { name: { contains: name, mode: 'insensitive' } },
      take: 3,
    })
    client = res[0] ?? null
  }

  if (!client) return { error: 'Cliente não encontrado. Tente buscar por nome parcial ou CNPJ exato.' }

  const now = new Date()
  const [monthlyRows, routes, weeklyRows] = await Promise.all([
    prisma.biClientMonthly.findMany({
      where: { clientCnpj: client.cnpj },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    }),
    prisma.biClientRoute.findMany({
      where: { clientCnpj: client.cnpj },
      orderBy: { totalRevenue: 'desc' },
    }),
    prisma.biClientWeekly.findMany({
      where: { clientCnpj: client.cnpj },
      orderBy: [{ year: 'asc' }, { week: 'asc' }],
    }),
  ])

  const fmt = (n: number) => Math.round(n * 100) / 100
  const completed = monthlyRows.filter(
    (r) => !(r.year === now.getFullYear() && r.month === now.getMonth() + 1),
  )
  const recent3 = completed.slice(-3)
  const prev3   = completed.slice(-6, -3)
  const avgRecent = recent3.length ? recent3.reduce((s, r) => s + r.billing, 0) / recent3.length : 0
  const avgPrev   = prev3.length   ? prev3.reduce((s, r) => s + r.billing, 0)   / prev3.length   : 0
  const trendPct  = avgPrev > 0 ? Math.round(((avgRecent - avgPrev) / avgPrev) * 100 * 10) / 10 : null

  return {
    client: {
      cnpj:        client.cnpj,
      name:        client.name,
      groupedName: client.groupedName,
      city:        client.city,
      state:       client.state,
      segment:     client.segment,
      curve:       client.curve,
      tipo:        client.tipo,
    },
    billingHistory: monthlyRows.slice(-14).map((r) => ({
      period:   `${r.year}-${String(r.month).padStart(2, '0')}`,
      billing:  fmt(r.billing),
      ctrc:     r.deliveriesCount,
      volumes:  r.volumesCount,
      weightKg: fmt(r.totalWeightKg),
      avgTicket: r.deliveriesCount > 0 ? fmt(r.billing / r.deliveriesCount) : 0,
    })),
    trend: {
      avgLast3Months: fmt(avgRecent),
      avgPrev3Months: fmt(avgPrev),
      changePercent:  trendPct,
      classification: trendPct === null ? 'sem_dados' : trendPct > 10 ? 'crescimento_forte' : trendPct > 3 ? 'crescimento' : trendPct < -10 ? 'queda_forte' : trendPct < -3 ? 'queda' : 'estável',
    },
    routes: routes.map((r) => ({
      region:          r.region,
      totalRevenue:    fmt(r.totalRevenue),
      recentMonthlyAvg: fmt(r.recentMonthlyAvg),
      tripCountLastMonth: r.tripCount,
      firstSeen:       r.firstSeen,
      lastSeen:        r.lastSeen,
    })),
    recentWeeks: weeklyRows.slice(-10).map((r) => ({
      period:  `${r.year}-S${String(r.week).padStart(2, '0')}`,
      billing: fmt(r.billing),
      ctrc:    r.deliveriesCount,
    })),
  }
}

export async function toolGetChurnRisk({
  threshold_pct = 20, limit = 25,
}: { threshold_pct?: number; limit?: number }) {
  const now = new Date()
  const rows = await prisma.biClientMonthly.findMany({
    where: {
      NOT: { year: now.getFullYear(), month: now.getMonth() + 1 },
    },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })

  const byClient = new Map<string, { year: number; month: number; billing: number }[]>()
  for (const r of rows) {
    if (!byClient.has(r.clientCnpj)) byClient.set(r.clientCnpj, [])
    byClient.get(r.clientCnpj)!.push({ year: r.year, month: r.month, billing: r.billing })
  }

  const candidates: { cnpj: string; avgRecent: number; avgPrev: number; changePct: number }[] = []
  for (const [cnpj, months] of byClient) {
    months.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    const recent3 = months.slice(-3)
    const prev3   = months.slice(-6, -3)
    if (recent3.length < 2 || prev3.length < 2) continue
    const avgRecent = recent3.reduce((s, r) => s + r.billing, 0) / recent3.length
    const avgPrev   = prev3.reduce((s, r) => s + r.billing, 0)   / prev3.length
    if (avgPrev === 0) continue
    const changePct = ((avgRecent - avgPrev) / avgPrev) * 100
    if (changePct <= -threshold_pct) candidates.push({ cnpj, avgRecent, avgPrev, changePct })
  }
  candidates.sort((a, b) => a.changePct - b.changePct)

  const clientMap = await buildClientMap()
  const fmt = (n: number) => Math.round(n * 100) / 100

  return {
    threshold:        `>${threshold_pct}% de queda`,
    totalClientsAtRisk: candidates.length,
    clients: candidates.slice(0, limit).map((c) => ({
      cnpj:              c.cnpj,
      name:              clientMap.get(c.cnpj)?.name ?? c.cnpj,
      state:             clientMap.get(c.cnpj)?.state ?? null,
      segment:           clientMap.get(c.cnpj)?.segment ?? null,
      curve:             clientMap.get(c.cnpj)?.curve ?? null,
      avgLast3Months:    fmt(c.avgRecent),
      avgPrev3Months:    fmt(c.avgPrev),
      changePercent:     Math.round(c.changePct * 10) / 10,
      lossMonthly:       fmt(c.avgPrev - c.avgRecent),
    })),
  }
}

export async function toolGetGrowthClients({ limit = 20 }: { limit?: number }) {
  const now = new Date()
  const rows = await prisma.biClientMonthly.findMany({
    where: { NOT: { year: now.getFullYear(), month: now.getMonth() + 1 } },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })

  const byClient = new Map<string, { year: number; month: number; billing: number }[]>()
  for (const r of rows) {
    if (!byClient.has(r.clientCnpj)) byClient.set(r.clientCnpj, [])
    byClient.get(r.clientCnpj)!.push({ year: r.year, month: r.month, billing: r.billing })
  }

  const candidates: { cnpj: string; avgRecent: number; avgPrev: number; changePct: number; absoluteGrowth: number }[] = []
  for (const [cnpj, months] of byClient) {
    months.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    const recent3 = months.slice(-3)
    const prev3   = months.slice(-6, -3)
    if (recent3.length < 2 || prev3.length < 2) continue
    const avgRecent = recent3.reduce((s, r) => s + r.billing, 0) / recent3.length
    const avgPrev   = prev3.reduce((s, r) => s + r.billing, 0)   / prev3.length
    if (avgPrev === 0) continue
    const changePct = ((avgRecent - avgPrev) / avgPrev) * 100
    if (changePct > 0) candidates.push({ cnpj, avgRecent, avgPrev, changePct, absoluteGrowth: avgRecent - avgPrev })
  }
  candidates.sort((a, b) => b.absoluteGrowth - a.absoluteGrowth)

  const clientMap = await buildClientMap()
  const fmt = (n: number) => Math.round(n * 100) / 100

  return {
    totalGrowingClients: candidates.length,
    clients: candidates.slice(0, limit).map((c) => ({
      cnpj:              c.cnpj,
      name:              clientMap.get(c.cnpj)?.name ?? c.cnpj,
      state:             clientMap.get(c.cnpj)?.state ?? null,
      segment:           clientMap.get(c.cnpj)?.segment ?? null,
      curve:             clientMap.get(c.cnpj)?.curve ?? null,
      avgLast3Months:    fmt(c.avgRecent),
      avgPrev3Months:    fmt(c.avgPrev),
      changePercent:     Math.round(c.changePct * 10) / 10,
      growthMonthly:     fmt(c.absoluteGrowth),
    })),
  }
}

export async function toolGetRouteAnalysis() {
  const [allRoutes, clientRoutes] = await Promise.all([
    prisma.biAllRoute.findMany({ orderBy: { totalRevenue: 'desc' } }),
    prisma.biClientRoute.findMany({ select: { region: true } }),
  ])

  const activeByRoute = new Map<string, number>()
  for (const r of clientRoutes) {
    activeByRoute.set(r.region, (activeByRoute.get(r.region) ?? 0) + 1)
  }

  const fmt = (n: number) => Math.round(n * 100) / 100
  return {
    routes: allRoutes.map((r) => ({
      region:           r.region,
      totalRevenue:     fmt(r.totalRevenue),
      avgTicket:        fmt(r.avgRevenue),
      totalCTRC:        r.tripCount,
      clientCount:      r.clientCount,
      activeClientsNow: activeByRoute.get(r.region) ?? 0,
    })),
  }
}

export async function toolSearchClients({ query, limit = 10 }: { query: string; limit?: number }) {
  const clients = await prisma.biClient.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { groupedName: { contains: query, mode: 'insensitive' } },
        { cnpj: { contains: query } },
      ],
    },
    take: limit,
    select: { cnpj: true, name: true, groupedName: true, city: true, state: true, segment: true, curve: true },
  })
  return { count: clients.length, clients }
}
