import { prisma } from '../db/prisma'

export interface ExpansionWeekData {
  year:            number
  week:            number
  weekLabel:       string
  totalNotas:      number
  valorMercadoria: number
  valorFrete:      number
  pctNota:         number | null
}

export interface ExpansionMonthData {
  year:            number
  month:           number
  monthLabel:      string
  totalNotas:      number
  valorMercadoria: number
  valorFrete:      number
  pctNota:         number | null
  isCurrentMonth:  boolean
}

export interface FilialPerformance {
  filial:         string
  cidade:         string | null
  totalEntregas:  number
  noPrazo:        number
  foraPrazo:      number
  pendente:       number
  performancePct: number | null
  semaforo:       'green' | 'yellow' | 'red' | 'critical' | 'no_data'
}

export interface WeeklyPerformance {
  year:           number
  week:           number
  weekLabel:      string
  totalEntregas:  number
  noPrazo:        number
  performancePct: number | null
  semaforo:       'green' | 'yellow' | 'red' | 'critical' | 'no_data'
}

export interface MonthlyPerformance {
  year:           number
  month:          number
  monthLabel:     string
  totalEntregas:  number
  noPrazo:        number
  foraPrazo:      number
  pendente:       number
  performancePct: number | null
  semaforo:       'green' | 'yellow' | 'red' | 'critical' | 'no_data'
  isCurrentMonth: boolean
}

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function semaforo(pct: number | null): FilialPerformance['semaforo'] {
  if (pct === null) return 'no_data'
  if (pct >= 95)   return 'green'
  if (pct >= 90)   return 'yellow'
  if (pct >= 85)   return 'red'
  return 'critical'
}

// Returns the Monday (start) of a given ISO week (WEEK mode 3)
function isoWeekStart(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7  // 1=Mon…7=Sun
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - (dayOfWeek - 1))
  const d = new Date(week1Monday)
  d.setDate(week1Monday.getDate() + (week - 1) * 7)
  return d
}

export async function getDeliveryPerformanceBatch(
  cnpjs: string[],
  _days = 30,
): Promise<Record<string, { performancePct: number | null; semaforo: FilialPerformance['semaforo'] }>> {
  if (cnpjs.length === 0) return {}
  const rows = await prisma.biDeliveryPerf.findMany({
    where: { cnpj: { in: cnpjs } },
  })
  const result: Record<string, { performancePct: number | null; semaforo: FilialPerformance['semaforo'] }> = {}
  for (const r of rows) {
    result[r.cnpj] = { performancePct: r.performancePct, semaforo: semaforo(r.performancePct) }
  }
  return result
}

export async function getDeliveryPerformanceByFilial(
  cnpjs: string[],
  _days = 30,
): Promise<FilialPerformance[]> {
  const rows = await prisma.biDeliveryFilial.findMany({
    where: { cnpj: { in: cnpjs } },
    orderBy: { totalEntregas: 'desc' },
  })
  return rows.map((r) => ({
    filial:         r.filial,
    cidade:         r.cidade,
    totalEntregas:  r.totalEntregas,
    noPrazo:        r.noPrazo,
    foraPrazo:      r.foraPrazo,
    pendente:       r.pendente,
    performancePct: r.performancePct,
    semaforo:       semaforo(r.performancePct),
  }))
}

export async function getDeliveryPerformanceWeekly(
  cnpjs: string[],
  weeks = 12,
): Promise<WeeklyPerformance[]> {
  if (cnpjs.length === 0) return []
  const rows = await prisma.biDeliveryWeekly.findMany({
    where: { cnpj: { in: cnpjs } },
    orderBy: [{ year: 'asc' }, { week: 'asc' }],
  })

  const weekMap = new Map<string, { year: number; week: number; totalEntregas: number; noPrazo: number }>()
  for (const r of rows) {
    const key = `${r.year}-${r.week}`
    const prev = weekMap.get(key)
    if (prev) {
      prev.totalEntregas += r.totalEntregas
      prev.noPrazo += r.noPrazo
    } else {
      weekMap.set(key, { year: r.year, week: r.week, totalEntregas: r.totalEntregas, noPrazo: r.noPrazo })
    }
  }

  const sorted = Array.from(weekMap.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.week - b.week
  )
  const recent = sorted.slice(-weeks)

  return recent.map((w) => {
    const pct = w.totalEntregas > 0
      ? Math.round(w.noPrazo / w.totalEntregas * 1000) / 10
      : null
    return {
      year:           w.year,
      week:           w.week,
      weekLabel:      `S${String(w.week).padStart(2, '0')}/${w.year}`,
      totalEntregas:  w.totalEntregas,
      noPrazo:        w.noPrazo,
      performancePct: pct,
      semaforo:       semaforo(pct),
    }
  })
}

export async function getDeliveryPerformanceMonthly(
  cnpjs: string[],
  months = 3,
): Promise<MonthlyPerformance[]> {
  if (cnpjs.length === 0) return []
  const now = new Date()
  const rows = await prisma.biDeliveryMonthly.findMany({
    where: { cnpj: { in: cnpjs } },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })

  const monthMap = new Map<string, { year: number; month: number; totalEntregas: number; noPrazo: number }>()
  for (const r of rows) {
    const key = `${r.year}-${r.month}`
    const prev = monthMap.get(key)
    if (prev) {
      prev.totalEntregas += r.totalEntregas
      prev.noPrazo += r.noPrazo
    } else {
      monthMap.set(key, { year: r.year, month: r.month, totalEntregas: r.totalEntregas, noPrazo: r.noPrazo })
    }
  }

  const sorted = Array.from(monthMap.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  )
  const recent = sorted.slice(-months)

  return recent.map((m) => {
    const pct = m.totalEntregas > 0
      ? Math.round(m.noPrazo / m.totalEntregas * 1000) / 10
      : null
    return {
      year:           m.year,
      month:          m.month,
      monthLabel:     `${MONTH_NAMES[m.month - 1]}/${m.year}`,
      totalEntregas:  m.totalEntregas,
      noPrazo:        m.noPrazo,
      foraPrazo:      0,
      pendente:       0,
      performancePct: pct,
      semaforo:       semaforo(pct),
      isCurrentMonth: m.year === now.getFullYear() && m.month === now.getMonth() + 1,
    }
  })
}

export async function getExpansionPresentationWeekly(
  cnpjs: string[],
  startDate: Date,
): Promise<ExpansionWeekData[]> {
  if (cnpjs.length === 0) return []
  const rows = await prisma.biDeliveryWeekly.findMany({
    where: { cnpj: { in: cnpjs } },
    orderBy: [{ year: 'asc' }, { week: 'asc' }],
  })

  const weekMap = new Map<string, { year: number; week: number; totalNotas: number; valorMercadoria: number; valorFrete: number }>()
  for (const r of rows) {
    if (isoWeekStart(r.year, r.week) < startDate) continue
    const key = `${r.year}-${r.week}`
    const prev = weekMap.get(key)
    if (prev) {
      prev.totalNotas += r.totalNotas
      prev.valorMercadoria += r.valorMercadoria
      prev.valorFrete += r.valorFrete
    } else {
      weekMap.set(key, { year: r.year, week: r.week, totalNotas: r.totalNotas, valorMercadoria: r.valorMercadoria, valorFrete: r.valorFrete })
    }
  }

  return Array.from(weekMap.values())
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week)
    .map((w) => ({
      year:            w.year,
      week:            w.week,
      weekLabel:       `S${String(w.week).padStart(2, '0')}/${w.year}`,
      totalNotas:      w.totalNotas,
      valorMercadoria: w.valorMercadoria,
      valorFrete:      w.valorFrete,
      pctNota:         w.valorMercadoria > 0
        ? Math.round(w.valorFrete / w.valorMercadoria * 100000) / 1000
        : null,
    }))
}

export async function getExpansionPresentationMonthly(
  cnpjs: string[],
  startDate: Date,
): Promise<ExpansionMonthData[]> {
  if (cnpjs.length === 0) return []
  const now = new Date()
  const startYear = startDate.getFullYear()
  const startMonth = startDate.getMonth() + 1

  const rows = await prisma.biDeliveryMonthly.findMany({
    where: { cnpj: { in: cnpjs } },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })

  const monthMap = new Map<string, { year: number; month: number; totalNotas: number; valorMercadoria: number; valorFrete: number }>()
  for (const r of rows) {
    if (r.year < startYear || (r.year === startYear && r.month < startMonth)) continue
    const key = `${r.year}-${r.month}`
    const prev = monthMap.get(key)
    if (prev) {
      prev.totalNotas += r.totalNotas
      prev.valorMercadoria += r.valorMercadoria
      prev.valorFrete += r.valorFrete
    } else {
      monthMap.set(key, { year: r.year, month: r.month, totalNotas: r.totalNotas, valorMercadoria: r.valorMercadoria, valorFrete: r.valorFrete })
    }
  }

  return Array.from(monthMap.values())
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map((m) => ({
      year:            m.year,
      month:           m.month,
      monthLabel:      `${MONTH_NAMES[m.month - 1]}/${m.year}`,
      totalNotas:      m.totalNotas,
      valorMercadoria: m.valorMercadoria,
      valorFrete:      m.valorFrete,
      pctNota:         m.valorMercadoria > 0
        ? Math.round(m.valorFrete / m.valorMercadoria * 100000) / 1000
        : null,
      isCurrentMonth:  m.year === now.getFullYear() && m.month === now.getMonth() + 1,
    }))
}
