import { EXCLUDED_CNPJS, buildExcludedCnpjsClause } from './constants'

const MONTHS_BACK = 18
const RECENT_MONTHS = 3

const excludedCnpjsList = EXCLUDED_CNPJS.map((c) => `'${c}'`).join(', ')

const BASE_FATO_FILTERS = (alias = 'fn') => `
  ${alias}.tipo_documento IN ('NORMAL', 'SUBC FORM CTRC', 'REDESPACHO')
  AND ${alias}.unidade_emissora != 'MTZ'
  AND ${alias}.login != 'maira'
  AND ${alias}.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
  AND ${alias}.cnpj_pagador NOT IN (${excludedCnpjsList})
  AND ${alias}.data_emissao < CURDATE()
`

// Same as BASE_FATO_FILTERS but without the tipo_documento restriction —
// used for daily tracking of expanded clients (reentregas, etc. must count)
const BASE_FATO_FILTERS_ALL = (alias = 'fn') => `
  ${alias}.unidade_emissora != 'MTZ'
  AND ${alias}.login != 'maira'
  AND ${alias}.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
  AND ${alias}.cnpj_pagador NOT IN (${excludedCnpjsList})
  AND ${alias}.data_emissao < CURDATE()
`

export const QUERY_CLIENTS = `
  SELECT
    dc.cnpj,
    dc.nome_cliente                                AS name,
    dc.nome_cliente_agrupado                       AS groupedName,
    dc.cidade                                      AS city,
    dc.uf                                          AS state,
    COALESCE(seg_esp.segment, seg_dim.tipo, 'Não classificado') AS segment,
    dc.curva                                                      AS curve,
    dc.tipo
  FROM bexsal_dw.dim_cliente dc
  INNER JOIN (
    SELECT cnpj, MAX(versao) AS max_versao
    FROM bexsal_dw.dim_cliente
    GROUP BY cnpj
  ) latest ON dc.cnpj = latest.cnpj AND dc.versao = latest.max_versao
  LEFT JOIN (
    SELECT e.cnpj_pagador,
           REGEXP_REPLACE(e.especie, '^[0-9]+-', '') AS segment
    FROM (
      SELECT cnpj_pagador, especie,
             ROW_NUMBER() OVER (PARTITION BY cnpj_pagador ORDER BY COUNT(*) DESC) AS rn
      FROM bexsal_dw.fato_notas
      WHERE tipo_documento IN ('NORMAL', 'SUBC FORM CTRC', 'REDESPACHO')
        AND data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${MONTHS_BACK} MONTH)
        AND data_emissao < CURDATE()
        AND tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
        AND especie IS NOT NULL AND especie != ''
        AND CAST(SUBSTRING_INDEX(especie, '-', 1) AS UNSIGNED) BETWEEN 1 AND 21
      GROUP BY cnpj_pagador, especie
    ) e
    WHERE e.rn = 1
  ) seg_esp ON seg_esp.cnpj_pagador = dc.cnpj
  LEFT JOIN bexsal_dw.dim_segmentos seg_dim
    ON dc.segmento REGEXP '^[0-9]+$'
    AND CAST(dc.segmento AS UNSIGNED) = seg_dim.codigo
  WHERE ${buildExcludedCnpjsClause('dc')}
    AND EXISTS (
      SELECT 1
      FROM bexsal_dw.fato_notas fn
      WHERE fn.cnpj_pagador = dc.cnpj
        AND fn.tipo_documento IN ('NORMAL', 'SUBC FORM CTRC', 'REDESPACHO')
        AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${MONTHS_BACK} MONTH)
        AND fn.data_emissao < CURDATE()
    )
`

export const QUERY_CLIENT_MONTHLY = `
  SELECT
    fn.cnpj_pagador            AS clientCnpj,
    fn.cnpj_pagador            AS clientGrouped,
    YEAR(fn.data_emissao)      AS year,
    MONTH(fn.data_emissao)     AS month,
    SUM(fn.valor_frete)        AS billing,
    COUNT(fn.ctrc)             AS deliveriesCount,
    SUM(fn.quantidade_volumes) AS volumesCount,
    SUM(fn.peso_real_kg)       AS totalWeightKg
  FROM bexsal_dw.fato_notas fn
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${MONTHS_BACK} MONTH)
  GROUP BY fn.cnpj_pagador, YEAR(fn.data_emissao), MONTH(fn.data_emissao)
  ORDER BY fn.cnpj_pagador, year, month
`

// Routes by mesoregion — total history for coverage detection + last-3-month avg for display
export const QUERY_CLIENT_ROUTES = `
  SELECT
    fn.cnpj_pagador                                                        AS clientCnpj,
    db.regiao_resumida                                                     AS region,
    MIN(fn.data_emissao)                                                   AS firstSeen,
    MAX(fn.data_emissao)                                                   AS lastSeen,
    COUNT(DISTINCT CASE
      WHEN YEAR(fn.data_emissao) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
        AND MONTH(fn.data_emissao) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
      THEN fn.ctrc END)                                                    AS tripCount,
    SUM(fn.valor_frete)                                                    AS totalRevenue,
    SUM(CASE
      WHEN fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${RECENT_MONTHS} MONTH)
      THEN fn.valor_frete ELSE 0
    END) / ${RECENT_MONTHS}                                                AS recentMonthlyAvg
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND db.regiao_resumida IS NOT NULL
  GROUP BY fn.cnpj_pagador, db.regiao_resumida
`

// Weekly billing per client — last 10 weeks for sparklines and churn detection
export const QUERY_CLIENT_WEEKLY = `
  SELECT
    fn.cnpj_pagador            AS clientCnpj,
    YEAR(fn.data_emissao)      AS year,
    WEEK(fn.data_emissao, 3)   AS week,
    SUM(fn.valor_frete)        AS billing,
    COUNT(fn.ctrc)             AS deliveriesCount
  FROM bexsal_dw.fato_notas fn
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL 10 WEEK)
  GROUP BY fn.cnpj_pagador, YEAR(fn.data_emissao), WEEK(fn.data_emissao, 3)
  ORDER BY fn.cnpj_pagador, year, week
`

// Daily billing per client — last 180 days for day-by-day expansion tracking
// Uses ALL document types (no tipo_documento filter) so reentregas count after expansion
export const QUERY_CLIENT_DAILY = `
  SELECT
    fn.cnpj_pagador          AS clientCnpj,
    DATE(fn.data_emissao)    AS date,
    SUM(fn.valor_frete)      AS billing,
    COUNT(fn.ctrc)           AS deliveriesCount
  FROM bexsal_dw.fato_notas fn
  WHERE ${BASE_FATO_FILTERS_ALL('fn')}
    AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL 180 DAY)
  GROUP BY fn.cnpj_pagador, DATE(fn.data_emissao)
  ORDER BY fn.cnpj_pagador, date
`

// Company-wide mesoregion stats — avg ticket + total volume = distribution weights
export const QUERY_ALL_ROUTES = `
  SELECT
    db.regiao_resumida                        AS region,
    AVG(fn.valor_frete)                       AS avgRevenue,
    COUNT(DISTINCT fn.ctrc)                   AS tripCount,
    SUM(fn.valor_frete)                       AS totalRevenue,
    COUNT(DISTINCT fn.cnpj_pagador)           AS clientCount
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND db.regiao_resumida IS NOT NULL
  GROUP BY db.regiao_resumida
`

// ── Delivery performance (last 30 days) ───────────────────────────────────────

export const QUERY_DELIVERY_PERF = `
  SELECT
    fn.cnpj_pagador AS cnpj,
    COUNT(*) AS totalEntregas,
    SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
             AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END) AS noPrazo,
    ROUND(
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
      * 100, 1
    ) AS performancePct
  FROM bexsal_dw.fato_notas fn
  WHERE fn.previsao_entrega IS NOT NULL
    AND fn.previsao_entrega >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    AND fn.previsao_entrega < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    AND fn.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
    AND fn.unidade_emissora != 'MTZ'
    AND fn.login != 'maira'
  GROUP BY fn.cnpj_pagador
`

export const QUERY_DELIVERY_FILIAL = `
  SELECT
    fn.cnpj_pagador AS cnpj,
    db.emissor_resumido AS filial,
    MAX(db.cidade) AS cidade,
    COUNT(*) AS totalEntregas,
    SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
             AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END) AS noPrazo,
    SUM(CASE WHEN fn.data_entrega_realizada > fn.previsao_entrega
          OR (fn.data_entrega_realizada IS NULL AND fn.previsao_entrega < CURDATE()) THEN 1 ELSE 0 END) AS foraPrazo,
    SUM(CASE WHEN fn.data_entrega_realizada IS NULL
             AND fn.previsao_entrega >= CURDATE() THEN 1 ELSE 0 END) AS pendente,
    ROUND(
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
      * 100, 1
    ) AS performancePct
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
  WHERE fn.previsao_entrega IS NOT NULL
    AND fn.previsao_entrega >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    AND fn.previsao_entrega < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    AND fn.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
    AND fn.unidade_emissora != 'MTZ'
    AND fn.login != 'maira'
  GROUP BY fn.cnpj_pagador, db.emissor_resumido
`

export const QUERY_DELIVERY_FILIAL_MONTHLY = `
  SELECT
    fn.cnpj_pagador               AS cnpj,
    db.emissor_resumido           AS filial,
    YEAR(fn.previsao_entrega)     AS year,
    MONTH(fn.previsao_entrega)    AS month,
    COUNT(*)                      AS totalEntregas,
    SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
             AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END) AS noPrazo,
    SUM(CASE WHEN fn.data_entrega_realizada > fn.previsao_entrega
          OR (fn.data_entrega_realizada IS NULL AND fn.previsao_entrega < CURDATE()) THEN 1 ELSE 0 END) AS foraPrazo,
    SUM(CASE WHEN fn.data_entrega_realizada IS NULL
             AND fn.previsao_entrega >= CURDATE() THEN 1 ELSE 0 END) AS pendente,
    ROUND(
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
      * 100, 1
    ) AS performancePct
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
  WHERE fn.previsao_entrega IS NOT NULL
    AND fn.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
    AND fn.unidade_emissora != 'MTZ'
    AND fn.login != 'maira'
    AND fn.previsao_entrega >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)
    AND fn.previsao_entrega < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  GROUP BY fn.cnpj_pagador, db.emissor_resumido, YEAR(fn.previsao_entrega), MONTH(fn.previsao_entrega)
  ORDER BY fn.cnpj_pagador, filial, year, month
`

export const QUERY_DELIVERY_FILIAL_WEEKLY = `
  SELECT
    fn.cnpj_pagador              AS cnpj,
    db.emissor_resumido          AS filial,
    YEAR(fn.previsao_entrega)    AS year,
    WEEK(fn.previsao_entrega, 3) AS week,
    COUNT(*)                     AS totalEntregas,
    SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
             AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END) AS noPrazo,
    ROUND(
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
      * 100, 1
    ) AS performancePct
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
  WHERE fn.previsao_entrega IS NOT NULL
    AND fn.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
    AND fn.unidade_emissora != 'MTZ'
    AND fn.login != 'maira'
    AND fn.previsao_entrega >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
    AND fn.previsao_entrega < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  GROUP BY fn.cnpj_pagador, db.emissor_resumido, YEAR(fn.previsao_entrega), WEEK(fn.previsao_entrega, 3)
  ORDER BY fn.cnpj_pagador, filial, year, week
`

export const QUERY_DELIVERY_WEEKLY = `
  SELECT
    fn.cnpj_pagador                   AS cnpj,
    YEAR(fn.previsao_entrega)         AS year,
    WEEK(fn.previsao_entrega, 3)      AS week,
    COUNT(fn.ctrc)                    AS totalNotas,
    ROUND(SUM(fn.valor_mercadoria), 2) AS valorMercadoria,
    ROUND(SUM(fn.valor_frete), 2)      AS valorFrete,
    ROUND(SUM(fn.valor_frete) / NULLIF(SUM(fn.valor_mercadoria), 0) * 100, 4) AS pctNota,
    COUNT(fn.ctrc)                    AS totalEntregas,
    SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
             AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END) AS noPrazo,
    ROUND(
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
      * 100, 1
    ) AS performancePct
  FROM bexsal_dw.fato_notas fn
  WHERE fn.previsao_entrega IS NOT NULL
    AND fn.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
    AND fn.unidade_emissora != 'MTZ'
    AND fn.login != 'maira'
    AND fn.previsao_entrega >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)
    AND fn.previsao_entrega < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  GROUP BY fn.cnpj_pagador, YEAR(fn.previsao_entrega), WEEK(fn.previsao_entrega, 3)
  ORDER BY fn.cnpj_pagador, year, week
`

export const QUERY_DELIVERY_MONTHLY = `
  SELECT
    fn.cnpj_pagador                   AS cnpj,
    YEAR(fn.previsao_entrega)         AS year,
    MONTH(fn.previsao_entrega)        AS month,
    COUNT(fn.ctrc)                    AS totalNotas,
    ROUND(SUM(fn.valor_mercadoria), 2) AS valorMercadoria,
    ROUND(SUM(fn.valor_frete), 2)      AS valorFrete,
    ROUND(SUM(fn.valor_frete) / NULLIF(SUM(fn.valor_mercadoria), 0) * 100, 4) AS pctNota,
    COUNT(fn.ctrc)                    AS totalEntregas,
    SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
             AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END) AS noPrazo,
    ROUND(
      SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL
               AND fn.data_entrega_realizada <= fn.previsao_entrega THEN 1 ELSE 0 END)
      / NULLIF(SUM(CASE WHEN fn.data_entrega_realizada IS NOT NULL THEN 1 ELSE 0 END), 0)
      * 100, 1
    ) AS performancePct
  FROM bexsal_dw.fato_notas fn
  WHERE fn.previsao_entrega IS NOT NULL
    AND fn.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
    AND fn.unidade_emissora != 'MTZ'
    AND fn.login != 'maira'
    AND fn.previsao_entrega >= DATE_SUB(CURDATE(), INTERVAL 18 MONTH)
    AND fn.previsao_entrega < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  GROUP BY fn.cnpj_pagador, YEAR(fn.previsao_entrega), MONTH(fn.previsao_entrega)
  ORDER BY fn.cnpj_pagador, year, month
`
