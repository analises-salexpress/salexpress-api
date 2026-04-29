import { BASE_FILTERS, buildExcludedCnpjsClause } from './constants'

// Last 18 months covers the 3-month baseline window for any current expansion goal
const MONTHS_BACK = 18

export const QUERY_CLIENT_MONTHLY = `
  SELECT
    dc.cnpj                 AS clientCnpj,
    dc.nome_agrupado        AS clientGrouped,
    YEAR(fn.data_emissao)   AS year,
    MONTH(fn.data_emissao)  AS month,
    SUM(fn.valor_nota)      AS billing,
    COUNT(fn.ctrc)          AS deliveriesCount,
    SUM(fn.volumes)         AS volumesCount,
    SUM(fn.peso_real)       AS totalWeightKg
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_cliente dc ON fn.cnpj_remetente = dc.cnpj
  WHERE ${BASE_FILTERS('fn', 'dc')}
    AND fn.tipo_frete = 'CIF'
    AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${MONTHS_BACK} MONTH)
  GROUP BY dc.cnpj, dc.nome_agrupado, YEAR(fn.data_emissao), MONTH(fn.data_emissao)
  ORDER BY dc.cnpj, year, month
`

// Routes actually used per client (all time, for coverage gap analysis)
export const QUERY_CLIENT_ROUTES = `
  SELECT
    dc.cnpj                  AS clientCnpj,
    dd.cidade                AS deliveryCity,
    dd.estado                AS deliveryState,
    MIN(fn.data_emissao)     AS firstSeen,
    MAX(fn.data_emissao)     AS lastSeen,
    COUNT(DISTINCT fn.ctrc)  AS tripCount
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_cliente dc     ON fn.cnpj_remetente   = dc.cnpj
  JOIN bexsal_dw.dim_destinatario dd ON fn.id_destinatario = dd.id
  WHERE ${BASE_FILTERS('fn', 'dc')}
    AND fn.tipo_frete = 'CIF'
  GROUP BY dc.cnpj, dd.cidade, dd.estado
`

// All routes Sal Express serves (at least 3 trips — avoids one-off anomalies)
export const QUERY_ALL_ROUTES = `
  SELECT
    dd.cidade                AS deliveryCity,
    dd.estado                AS deliveryState,
    AVG(fn.valor_nota)       AS avgRevenue,
    COUNT(DISTINCT fn.ctrc)  AS tripCount
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_cliente dc     ON fn.cnpj_remetente   = dc.cnpj
  JOIN bexsal_dw.dim_destinatario dd ON fn.id_destinatario = dd.id
  WHERE ${BASE_FILTERS('fn', 'dc')}
    AND fn.tipo_frete = 'CIF'
  GROUP BY dd.cidade, dd.estado
  HAVING COUNT(DISTINCT fn.ctrc) >= 3
`

// Client master: only clients active in the last 18 months
export const QUERY_CLIENTS = `
  SELECT
    dc.cnpj,
    dc.razao_social    AS name,
    dc.nome_agrupado   AS groupedName,
    dc.cidade          AS city,
    dc.estado          AS state,
    dc.segmento        AS segment,
    dc.curva           AS curve,
    dc.tipo
  FROM bexsal_dw.dim_cliente dc
  WHERE ${buildExcludedCnpjsClause('dc')}
    AND EXISTS (
      SELECT 1
      FROM bexsal_dw.fato_notas fn
      WHERE fn.cnpj_remetente = dc.cnpj
        AND fn.tipo_frete = 'CIF'
        AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${MONTHS_BACK} MONTH)
        AND fn.data_emissao < CURDATE()
    )
`
