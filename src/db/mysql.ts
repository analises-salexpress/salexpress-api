import mysql from 'mysql2/promise'

function biConfig() {
  return {
    host:     process.env.BI_DB_HOST!,
    port:     Number(process.env.BI_DB_PORT ?? 3306),
    user:     process.env.BI_DB_USER!,
    password: process.env.BI_DB_PASSWORD!,
    database: process.env.BI_DB_NAME ?? 'bexsal_dw',
    timezone: '-03:00',
  }
}

export async function queryBI<T = unknown>(sql: string, params?: (string | number | boolean | null)[]): Promise<T[]> {
  const conn = await mysql.createConnection(biConfig())
  try {
    const [rows] = await conn.query(sql, params)
    return rows as T[]
  } finally {
    await conn.end()
  }
}
