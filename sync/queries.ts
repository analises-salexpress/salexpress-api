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

// Routes by mesoregion — uses praca_destino joined to dim_bases to get regiao_resumida
export const QUERY_CLIENT_ROUTES = `
  SELECT
    fn.cnpj_remetente          AS clientCnpj,
    db.regiao_resumida         AS region,
    MIN(fn.data_emissao)       AS firstSeen,
    MAX(fn.data_emissao)       AS lastSeen,
    COUNT(DISTINCT fn.ctrc)    AS tripCount,
    SUM(fn.valor_frete)        AS totalRevenue
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND db.regiao_resumida IS NOT NULL
  GROUP BY fn.cnpj_remetente, db.regiao_resumida
`

// All mesoregions the Sal Express serves, with revenue benchmarks
export const QUERY_ALL_ROUTES = `
  SELECT
    db.regiao_resumida         AS region,
    AVG(fn.valor_frete)        AS avgRevenue,
    COUNT(DISTINCT fn.ctrc)    AS tripCount,
    COUNT(DISTINCT fn.cnpj_remetente) AS clientCount
  FROM bexsal_dw.fato_notas fn
  JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
  WHERE ${BASE_FATO_FILTERS('fn')}
    AND db.regiao_resumida IS NOT NULL
  GROUP BY db.regiao_resumida
`
