import 'dotenv/config'
import mysql from 'mysql2/promise'

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.BI_DB_HOST!,
    port:     Number(process.env.BI_DB_PORT ?? 3306),
    user:     process.env.BI_DB_USER!,
    password: process.env.BI_DB_PASSWORD!,
    database: process.env.BI_DB_NAME ?? 'bexsal_dw',
    timezone: '-03:00',
  })

  const [rows] = await conn.query(`
    SELECT sigla, regiao_resumida AS mesoregiao, nome_base AS nome_praca
    FROM bexsal_dw.dim_bases
    WHERE sigla IS NOT NULL AND sigla != ''
    ORDER BY mesoregiao, sigla
  `)

  let currentRegion = ''
  for (const r of rows as any[]) {
    if (r.mesoregiao !== currentRegion) {
      currentRegion = r.mesoregiao
      console.log(`\n== ${currentRegion ?? '(sem mesorregião)'} ==`)
    }
    console.log(`  ${r.sigla}  ${r.nome_praca}`)
  }

  await conn.end()
}

main().catch(console.error)
