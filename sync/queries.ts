import { EXCLUDED_CNPJS, buildExcludedCnpjsClause } from './constants'

const MONTHS_BACK = 18

const excludedCnpjsList = EXCLUDED_CNPJS.map((c) => `'${c}'`).join(', ')

const BASE_FATO_FILTERS = (alias = 'fn') => `
  ${alias}.tipo_documento NOT IN ('ANULACAO', 'CORTESIA')
  AND ${alias}.unidade_emissora != 'MTZ'
  AND ${alias}.login != 'maira'
  AND ${alias}.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
  AND ${alias}.cnpj_remetente NOT IN (${excludedCnpjsList})
  AND ${alias}.data_emissao < CURDATE()
`

// Only the most recent version of each client from dim_cliente
export const QUERY_CLIENTS = `
  SELECT
    dc.cnpj,
    dc.nome_cliente          AS name,
    dc.nome_cliente_agrupado AS groupedName,
    dc.cidade                AS city,
    dc.uf                    AS state,
    dc.segmento              AS segment,
    dc.curva                 AS curve,
    dc.tipo
  FROM bexsal_dw.dim_cliente dc
  INNER JOIN (
    SELECT cnpj, MAX(versao) AS max_versao
    FROM bexsal_dw.dim_cliente
    GROUP BY cnpj
  ) latest ON dc.cnpj = latest.cnpj AND dc.versao = latest.max_versao
  WHERE ${buildExcludedCnpjsClause('dc')}
    AND EXISTS (
      SELECT 1
      FROM bexsal_dw.fato_notas fn
      WHERE fn.cnpj_remetente = dc.cnpj
        AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${MONTHS_BACK} MONTH)
        AND fn.data_emissao < CURDATE()
    )
`

export const QUERY_CLIENT_MONTHLY = `
  SELECT
    fn.cnpj_remetente         AS clientCnpj,
    fn.cnpj_remetente         AS clientGrouped,
    YEAR(fn.data_emissao)     AS year,
    MONTH(fn.data_emissao)    AS month,
    SUM(fn.valor_frete)       AS billing,
    COUNT(fn.ctrc)            AS deliveriesCount,
    SUM(fn.quantidade_volumes) AS volumesCount,
    SUM(fn.peso_real_kg)      AS totalWeightKg
  FROM bexsal_dw.fato_notas fn
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND fn.data_emissao >= DATE_SUB(CURDATE(), INTERVAL ${MONTHS_BACK} MONTH)
  GROUP BY fn.cnpj_remetente, YEAR(fn.data_emissao), MONTH(fn.data_emissao)
  ORDER BY fn.cnpj_remetente, year, month
`

export const QUERY_CLIENT_ROUTES = `
  SELECT
    fn.cnpj_remetente     AS clientCnpj,
    fn.cidade_entrega     AS deliveryCity,
    fn.uf_entrega         AS deliveryState,
    MIN(fn.data_emissao)  AS firstSeen,
    MAX(fn.data_emissao)  AS lastSeen,
    COUNT(DISTINCT fn.ctrc) AS tripCount
  FROM bexsal_dw.fato_notas fn
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND fn.cidade_entrega IS NOT NULL
    AND fn.uf_entrega IS NOT NULL
  GROUP BY fn.cnpj_remetente, fn.cidade_entrega, fn.uf_entrega
`

export const QUERY_ALL_ROUTES = `
  SELECT
    fn.cidade_entrega     AS deliveryCity,
    fn.uf_entrega         AS deliveryState,
    AVG(fn.valor_frete)   AS avgRevenue,
    COUNT(DISTINCT fn.ctrc) AS tripCount
  FROM bexsal_dw.fato_notas fn
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND fn.cidade_entrega IS NOT NULL
    AND fn.uf_entrega IS NOT NULL
  GROUP BY fn.cidade_entrega, fn.uf_entrega
  HAVING COUNT(DISTINCT fn.ctrc) >= 3
`
