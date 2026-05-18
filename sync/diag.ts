import 'dotenv/config'
import mysql from 'mysql2/promise'

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.BI_HOST,
    port:     Number(process.env.BI_PORT ?? 3306),
    user:     process.env.BI_USER,
    password: process.env.BI_PASSWORD,
    database: process.env.BI_DATABASE,
  })

  const cnpj = '01407607000153'

  // 1 — Official BI KPI for May 2026 (no JOIN)
  const [may] = await conn.query(`
    SELECT
      COUNT(*)                         AS total,
      SUM(fp.pontualidade)             AS noPrazo,
      ROUND(SUM(fp.pontualidade) / COUNT(*) * 100, 2) AS kpi_may_noJoin
    FROM bexsal_dw.fato_performance fp
    WHERE fp.cnpj_pagador = '${cnpj}'
      AND fp.previsao_entrega_final IS NOT NULL
      AND YEAR(fp.previsao_entrega_final) = 2026
      AND MONTH(fp.previsao_entrega_final) = 5
  `) as any
  console.log('=== 1. May 2026 — fato_performance sem JOIN ===')
  console.log(JSON.stringify(may, null, 2))

  // 2 — Same but WITH the dim_bases JOIN (what our bi_delivery_filial uses)
  const [mayJoin] = await conn.query(`
    SELECT
      COUNT(*)                         AS total,
      SUM(fp.pontualidade)             AS noPrazo,
      ROUND(SUM(fp.pontualidade) / COUNT(*) * 100, 2) AS kpi_may_withJoin
    FROM bexsal_dw.fato_performance fp
    JOIN bexsal_dw.dim_bases db ON fp.unidade_receptora = db.sigla
    WHERE fp.cnpj_pagador = '${cnpj}'
      AND fp.previsao_entrega_final IS NOT NULL
      AND YEAR(fp.previsao_entrega_final) = 2026
      AND MONTH(fp.previsao_entrega_final) = 5
  `) as any
  console.log('=== 2. May 2026 — com JOIN dim_bases ===')
  console.log(JSON.stringify(mayJoin, null, 2))

  // 3 — Last 30 days by previsao_entrega_final — no JOIN (what bi_delivery_perf stores)
  const [p30] = await conn.query(`
    SELECT
      COUNT(*)                         AS total,
      SUM(fp.pontualidade)             AS noPrazo,
      ROUND(SUM(fp.pontualidade) / COUNT(*) * 100, 2) AS kpi_30d_noJoin
    FROM bexsal_dw.fato_performance fp
    WHERE fp.cnpj_pagador = '${cnpj}'
      AND fp.previsao_entrega_final IS NOT NULL
      AND fp.previsao_entrega_final >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      AND fp.previsao_entrega_final < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  `) as any
  console.log('=== 3. Últimos 30 dias (previsao_entrega_final) — sem JOIN ===')
  console.log(JSON.stringify(p30, null, 2))

  // 4 — Last 30 days by previsao_entrega_final — WITH JOIN
  const [p30join] = await conn.query(`
    SELECT
      COUNT(*)                         AS total,
      SUM(fp.pontualidade)             AS noPrazo,
      ROUND(SUM(fp.pontualidade) / COUNT(*) * 100, 2) AS kpi_30d_withJoin
    FROM bexsal_dw.fato_performance fp
    JOIN bexsal_dw.dim_bases db ON fp.unidade_receptora = db.sigla
    WHERE fp.cnpj_pagador = '${cnpj}'
      AND fp.previsao_entrega_final IS NOT NULL
      AND fp.previsao_entrega_final >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      AND fp.previsao_entrega_final < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  `) as any
  console.log('=== 4. Últimos 30 dias — com JOIN dim_bases ===')
  console.log(JSON.stringify(p30join, null, 2))

  // 5 — Distinct unidade_receptora values for this CNPJ (to check JOIN matching)
  const [unidades] = await conn.query(`
    SELECT
      fp.unidade_receptora,
      COUNT(*)          AS total,
      SUM(fp.pontualidade) AS noPrazo,
      (fp.unidade_receptora IN (SELECT db.sigla FROM bexsal_dw.dim_bases db)) AS existe_em_dim_bases
    FROM bexsal_dw.fato_performance fp
    WHERE fp.cnpj_pagador = '${cnpj}'
      AND fp.previsao_entrega_final IS NOT NULL
      AND fp.previsao_entrega_final >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      AND fp.previsao_entrega_final < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    GROUP BY fp.unidade_receptora
    ORDER BY total DESC
    LIMIT 30
  `) as any
  console.log('=== 5. unidade_receptora distinct — existe em dim_bases? ===')
  console.log(JSON.stringify(unidades, null, 2))

  // 6 — dim_bases sigla sample (to compare)
  const [siglas] = await conn.query(`
    SELECT db.sigla, db.emissor_resumido, db.cidade
    FROM bexsal_dw.dim_bases db
    ORDER BY db.sigla
    LIMIT 30
  `) as any
  console.log('=== 6. dim_bases.sigla sample ===')
  console.log(JSON.stringify(siglas, null, 2))

  // 7 — How far back does fato_performance go for this CNPJ?
  const [range] = await conn.query(`
    SELECT
      MIN(fp.previsao_entrega_final) AS oldest_previsao,
      MAX(fp.previsao_entrega_final) AS newest_previsao,
      COUNT(*)                       AS total_records
    FROM bexsal_dw.fato_performance fp
    WHERE fp.cnpj_pagador = '${cnpj}'
      AND fp.previsao_entrega_final IS NOT NULL
  `) as any
  console.log('=== 7. Intervalo de datas no fato_performance ===')
  console.log(JSON.stringify(range, null, 2))

  await conn.end()
}

main().catch(console.error)
