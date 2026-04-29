import 'dotenv/config'
import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'
import {
  QUERY_CLIENTS,
  QUERY_CLIENT_MONTHLY,
  QUERY_CLIENT_ROUTES,
  QUERY_ALL_ROUTES,
} from './queries'

// ── Setup ─────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function getConnection() {
  return mysql.createConnection({
    host:     process.env.BI_DB_HOST!,
    port:     Number(process.env.BI_DB_PORT ?? 3306),
    user:     process.env.BI_DB_USER!,
    password: process.env.BI_DB_PASSWORD!,
    database: process.env.BI_DB_NAME ?? 'bexsal_dw',
    timezone: '-03:00',
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

async function upsert(table: string, rows: object[], conflictCols: string[]) {
  if (rows.length === 0) return 0
  const CHUNK = 500
  let total = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: conflictCols.join(',') })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
    total += chunk.length
  }
  return total
}

// ── Sync steps ────────────────────────────────────────────────────────────────

async function syncClients(conn: mysql.Connection) {
  log('Syncing bi_clients…')
  const [rows] = await conn.query(QUERY_CLIENTS)
  const data = (rows as any[]).map((r) => ({
    cnpj:        r.cnpj,
    name:        r.name,
    groupedName: r.groupedName,
    city:        r.city ?? null,
    state:       r.state ?? null,
    segment:     r.segment ?? null,
    curve:       r.curve ?? null,
    tipo:        r.tipo ?? null,
    syncedAt:    new Date().toISOString(),
  }))
  const n = await upsert('bi_clients', data, ['cnpj'])
  log(`  → ${n} clients upserted`)
}

async function syncClientMonthly(conn: mysql.Connection) {
  log('Syncing bi_client_monthly…')
  const [rows] = await conn.query(QUERY_CLIENT_MONTHLY)
  const data = (rows as any[]).map((r) => ({
    clientCnpj:     r.clientCnpj,
    clientGrouped:  r.clientGrouped,
    year:           Number(r.year),
    month:          Number(r.month),
    billing:        Number(r.billing ?? 0),
    deliveriesCount: Number(r.deliveriesCount ?? 0),
    volumesCount:   Number(r.volumesCount ?? 0),
    totalWeightKg:  Number(r.totalWeightKg ?? 0),
    syncedAt:       new Date().toISOString(),
  }))
  const n = await upsert('bi_client_monthly', data, ['clientCnpj', 'year', 'month'])
  log(`  → ${n} monthly rows upserted`)
}

async function syncClientRoutes(conn: mysql.Connection) {
  log('Syncing bi_client_routes…')
  const [rows] = await conn.query(QUERY_CLIENT_ROUTES)
  const data = (rows as any[]).map((r) => ({
    clientCnpj:    r.clientCnpj,
    deliveryCity:  r.deliveryCity,
    deliveryState: r.deliveryState,
    firstSeen:     r.firstSeen,
    lastSeen:      r.lastSeen,
    tripCount:     Number(r.tripCount ?? 1),
    syncedAt:      new Date().toISOString(),
  }))
  const n = await upsert('bi_client_routes', data, ['clientCnpj', 'deliveryCity', 'deliveryState'])
  log(`  → ${n} client route rows upserted`)
}

async function syncAllRoutes(conn: mysql.Connection) {
  log('Syncing bi_all_routes…')
  const [rows] = await conn.query(QUERY_ALL_ROUTES)
  const data = (rows as any[]).map((r) => ({
    deliveryCity:  r.deliveryCity,
    deliveryState: r.deliveryState,
    avgRevenue:    Number(r.avgRevenue ?? 0),
    tripCount:     Number(r.tripCount ?? 0),
    syncedAt:      new Date().toISOString(),
  }))
  const n = await upsert('bi_all_routes', data, ['deliveryCity', 'deliveryState'])
  log(`  → ${n} global route rows upserted`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('=== Sal Express Sync Agent started ===')

  const required = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'BI_DB_HOST', 'BI_DB_USER', 'BI_DB_PASSWORD',
  ]
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key}`)
      process.exit(1)
    }
  }

  let conn: mysql.Connection | null = null
  try {
    conn = await getConnection()
    log('MySQL connected')

    await syncClients(conn)
    await syncClientMonthly(conn)
    await syncClientRoutes(conn)
    await syncAllRoutes(conn)

    log('=== Sync complete ===')
  } catch (err) {
    console.error('Sync failed:', err)
    process.exit(1)
  } finally {
    await conn?.end()
  }
}

main()
