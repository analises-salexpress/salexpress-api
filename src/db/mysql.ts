import mysql from 'mysql2/promise'

export const biPool = mysql.createPool({
  host: process.env.BI_DB_HOST,
  port: Number(process.env.BI_DB_PORT) || 3306,
  user: process.env.BI_DB_USER,
  password: process.env.BI_DB_PASSWORD,
  database: process.env.BI_DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

export async function queryBI<T = unknown>(sql: string, params?: (string | number | boolean | null)[]): Promise<T[]> {
  const [rows] = await biPool.execute(sql, params)
  return rows as T[]
}
