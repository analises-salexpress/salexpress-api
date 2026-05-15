import { queryBI } from '../db/mysql'

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

function buildInClause(cnpjs: string[]): { placeholders: string; params: string[] } {
  return {
    placeholders: cnpjs.map(() => '?').join(', '),
    params: cnpjs,
  }
}

export async function getDeliveryPerformanceByFilial(
  cnpjs: string[],
  days = 30,
): Promise<FilialPerformance[]> {
  const { placeholders, params } = buildInClause(cnpjs)

  const rows = await queryBI<{
    filial:          string
    cidade:          string | null
    total_entregas:  number
    no_prazo:        number
    fora_prazo:      number
    pendente:        number
    performance_pct: number | null
  }>(`
    SELECT
      db.emissor_resumido                                                                      AS filial,
      MAX(db.cidade)                                                                           AS cidade,
      COUNT(*)                                                                                 AS total_entregas,
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)        AS no_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada > fn.previsao_entrega THEN 1 ELSE 0 END)        AS fora_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada IS NULL
               AND fn.tipo_baixa NOT IN ('CANCELADO') THEN 1 ELSE 0 END)                      AS pendente,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY db.emissor_resumido
    ORDER BY total_entregas DESC
  `, [...params, days])

  return rows.map((r) => ({
    filial:         r.filial,
    cidade:         r.cidade,
    totalEntregas:  Number(r.total_entregas),
    noPrazo:        Number(r.no_prazo),
    foraPrazo:      Number(r.fora_prazo),
    pendente:       Number(r.pendente),
    performancePct: r.performance_pct !== null ? Number(r.performance_pct) : null,
    semaforo:       semaforo(r.performance_pct !== null ? Number(r.performance_pct) : null),
  }))
}

export async function getDeliveryPerformanceWeekly(
  cnpjs: string[],
  weeks = 12,
): Promise<WeeklyPerformance[]> {
  const { placeholders, params } = buildInClause(cnpjs)

  const rows = await queryBI<{
    year:            number
    week:            number
    total_entregas:  number
    no_prazo:        number
    performance_pct: number | null
  }>(`
    SELECT
      YEAR(fn.data_emissao)                                                                    AS year,
      WEEK(fn.data_emissao, 3)                                                                 AS week,
      COUNT(*)                                                                                 AS total_entregas,
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)        AS no_prazo,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? WEEK)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY YEAR(fn.data_emissao), WEEK(fn.data_emissao, 3)
    ORDER BY year, week
  `, [...params, weeks])

  return rows.map((r) => ({
    year:           Number(r.year),
    week:           Number(r.week),
    weekLabel:      `S${String(r.week).padStart(2, '0')}/${r.year}`,
    totalEntregas:  Number(r.total_entregas),
    noPrazo:        Number(r.no_prazo),
    performancePct: r.performance_pct !== null ? Number(r.performance_pct) : null,
    semaforo:       semaforo(r.performance_pct !== null ? Number(r.performance_pct) : null),
  }))
}

export async function getDeliveryPerformanceMonthly(
  cnpjs: string[],
  months = 3,
): Promise<MonthlyPerformance[]> {
  const { placeholders, params } = buildInClause(cnpjs)
  const now = new Date()

  const rows = await queryBI<{
    year:            number
    month:           number
    total_entregas:  number
    no_prazo:        number
    fora_prazo:      number
    pendente:        number
    performance_pct: number | null
  }>(`
    SELECT
      YEAR(fn.data_emissao)                                                                    AS year,
      MONTH(fn.data_emissao)                                                                   AS month,
      COUNT(*)                                                                                 AS total_entregas,
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)        AS no_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada > fn.previsao_entrega THEN 1 ELSE 0 END)        AS fora_prazo,
      SUM(CASE WHEN fn.data_entrega_realizada IS NULL
               AND fn.tipo_baixa NOT IN ('CANCELADO') THEN 1 ELSE 0 END)                      AS pendente,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY YEAR(fn.data_emissao), MONTH(fn.data_emissao)
    ORDER BY year, month
  `, [...params, months])

  return rows.map((r) => {
    const y = Number(r.year)
    const m = Number(r.month)
    return {
      year:           y,
      month:          m,
      monthLabel:     `${MONTH_NAMES[m - 1]}/${y}`,
      totalEntregas:  Number(r.total_entregas),
      noPrazo:        Number(r.no_prazo),
      foraPrazo:      Number(r.fora_prazo),
      pendente:       Number(r.pendente),
      performancePct: r.performance_pct !== null ? Number(r.performance_pct) : null,
      semaforo:       semaforo(r.performance_pct !== null ? Number(r.performance_pct) : null),
      isCurrentMonth: y === now.getFullYear() && m === now.getMonth() + 1,
    }
  })
}

export async function getDeliveryPerformanceBatch(
  cnpjs: string[],
  days = 30,
): Promise<Record<string, { performancePct: number | null; semaforo: FilialPerformance['semaforo'] }>> {
  if (cnpjs.length === 0) return {}

  const placeholders = cnpjs.map(() => '?').join(', ')
  const rows = await queryBI<{
    cnpj:            string
    performance_pct: number | null
  }>(`
    SELECT
      fn.cnpj_pagador                                                                          AS cnpj,
      ROUND(
        SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
                 AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
        * 100, 1
      )                                                                                        AS performance_pct
    FROM bexsal_dw.fato_notas fn
    WHERE fn.cnpj_pagador IN (${placeholders})
      AND fn.previsao_entrega IS NOT NULL
      AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      AND fn.tipo_baixa NOT IN ('CANCELADO')
      AND fn.unidade_emissora != 'MTZ'
    GROUP BY fn.cnpj_pagador
  `, [...cnpjs, days])

  const result: Record<string, { performancePct: number | null; semaforo: FilialPerformance['semaforo'] }> = {}
  for (const r of rows) {
    const pct = r.performance_pct !== null ? Number(r.performance_pct) : null
    result[r.cnpj] = { performancePct: pct, semaforo: semaforo(pct) }
  }
  return result
}
