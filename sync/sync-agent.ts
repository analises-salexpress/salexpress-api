import 'dotenv/config'
import mysql from 'mysql2/promise'
import { createClient } from '@supabase/supabase-js'
import {
  QUERY_CLIENTS,
  QUERY_CLIENT_MONTHLY,
  QUERY_CLIENT_ROUTES,
  QUERY_CLIENT_WEEKLY,
  QUERY_CLIENT_DAILY,
  QUERY_ALL_ROUTES,
  QUERY_DELIVERY_PERF,
  QUERY_DELIVERY_PERF_WEEKLY,
  QUERY_DELIVERY_PERF_MONTHLY,
  QUERY_DELIVERY_FILIAL,
  QUERY_DELIVERY_FILIAL_MONTHLY,
  QUERY_DELIVERY_FILIAL_WEEKLY,
  QUERY_DELIVERY_WEEKLY,
  QUERY_DELIVERY_MONTHLY,
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
    client_cnpj:        r.clientCnpj,
    region:             r.region,
    first_seen:         r.firstSeen,
    last_seen:          r.lastSeen,
    trip_count:         Number(r.tripCount ?? 1),
    total_revenue:      Number(r.totalRevenue ?? 0),
    recent_monthly_avg: Number(r.recentMonthlyAvg ?? 0),
    synced_at:          new Date().toISOString(),
  }))
  const n = await upsert('bi_client_routes', data, ['client_cnpj', 'region'])
  log(`  → ${n} client route rows upserted`)
}

async function syncClientWeekly(conn: mysql.Connection) {
  log('Syncing bi_client_weekly…')
  const [rows] = await conn.query(QUERY_CLIENT_WEEKLY)
  const data = (rows as any[]).map((r) => ({
    clientCnpj:      r.clientCnpj,
    year:            Number(r.year),
    week:            Number(r.week),
    billing:         Number(r.billing ?? 0),
    deliveriesCount: Number(r.deliveriesCount ?? 0),
    syncedAt:        new Date().toISOString(),
  }))
  const n = await upsert('bi_client_weekly', data, ['clientCnpj', 'year', 'week'])
  log(`  → ${n} weekly rows upserted`)
}

async function syncClientDaily(conn: mysql.Connection) {
  log('Syncing bi_client_daily…')
  const [rows] = await conn.query(QUERY_CLIENT_DAILY)
  const data = (rows as any[]).map((r) => ({
    client_cnpj:      r.clientCnpj,
    date:             r.date,
    billing:          Number(r.billing ?? 0),
    deliveries_count: Number(r.deliveriesCount ?? 0),
    synced_at:        new Date().toISOString(),
  }))
  const n = await upsert('bi_client_daily', data, ['client_cnpj', 'date'])
  log(`  → ${n} daily rows upserted`)
}

async function syncAllRoutes(conn: mysql.Connection) {
  log('Syncing bi_all_routes…')
  const [rows] = await conn.query(QUERY_ALL_ROUTES)
  const data = (rows as any[]).map((r) => ({
    region:        r.region,
    avg_revenue:   Number(r.avgRevenue ?? 0),
    trip_count:    Number(r.tripCount ?? 0),
    total_revenue: Number(r.totalRevenue ?? 0),
    client_count:  Number(r.clientCount ?? 0),
    synced_at:     new Date().toISOString(),
  }))
  const n = await upsert('bi_all_routes', data, ['region'])
  log(`  → ${n} global route rows upserted`)
}

async function cleanOldDaily() {
  log('Cleaning old daily rows (>180 days)…')
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 180)
  let total = 0
  while (true) {
    const { data, error } = await supabase
      .from('bi_client_daily')
      .select('id')
      .lt('date', cutoff.toISOString().split('T')[0])
      .limit(500)
    if (error) throw new Error(`fetch old bi_client_daily: ${error.message}`)
    if (!data || data.length === 0) break
    const ids = data.map((r: any) => r.id)
    await supabase.from('bi_client_daily').delete().in('id', ids)
    total += ids.length
  }
  log(`  → ${total} old daily rows removed`)
}

async function cleanStaleRoutes(syncStart: string) {
  log('Cleaning stale routes…')
  let total = 0
  // Delete client routes not touched in this sync (client stopped sending to that region)
  while (true) {
    const { data, error } = await supabase
      .from('bi_client_routes')
      .select('client_cnpj, region')
      .lt('synced_at', syncStart)
      .limit(500)
    if (error) throw new Error(`fetch stale bi_client_routes: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data) {
      await supabase.from('bi_client_routes').delete()
        .eq('client_cnpj', row.client_cnpj).eq('region', row.region)
    }
    total += data.length
  }
  // Delete weekly rows not touched in this sync
  while (true) {
    const { data, error } = await supabase
      .from('bi_client_weekly')
      .select('id')
      .lt('syncedAt', syncStart)
      .limit(500)
    if (error) throw new Error(`fetch stale bi_client_weekly: ${error.message}`)
    if (!data || data.length === 0) break
    const ids = data.map((r: any) => r.id)
    await supabase.from('bi_client_weekly').delete().in('id', ids)
    total += ids.length
  }
  log(`  → ${total} stale route/weekly rows removed`)
}

async function syncDeliveryPerf(conn: mysql.Connection) {
  log('Syncing bi_delivery_perf…')
  const [rows] = await conn.query(QUERY_DELIVERY_PERF)
  const data = (rows as any[]).map((r) => ({
    cnpj:           r.cnpj,
    performance_pct: r.performancePct !== null ? Number(r.performancePct) : null,
    total_entregas:  Number(r.totalEntregas ?? 0),
    no_prazo:        Number(r.noPrazo ?? 0),
    synced_at:       new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_perf', data, ['cnpj'])
  log(`  → ${n} delivery perf rows upserted`)
}

async function syncDeliveryFilial(conn: mysql.Connection) {
  log('Syncing bi_delivery_filial…')
  const [rows] = await conn.query(QUERY_DELIVERY_FILIAL)
  const data = (rows as any[]).map((r) => ({
    cnpj:            r.cnpj,
    filial:          r.filial,
    cidade:          r.cidade ?? null,
    total_entregas:  Number(r.totalEntregas ?? 0),
    no_prazo:        Number(r.noPrazo ?? 0),
    fora_prazo:      Number(r.foraPrazo ?? 0),
    pendente:        Number(r.pendente ?? 0),
    performance_pct: r.performancePct !== null ? Number(r.performancePct) : null,
    synced_at:       new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_filial', data, ['cnpj', 'filial'])
  log(`  → ${n} delivery filial rows upserted`)
}

async function syncDeliveryPerfWeekly(conn: mysql.Connection) {
  log('Syncing bi_delivery_perf_weekly…')
  const [rows] = await conn.query(QUERY_DELIVERY_PERF_WEEKLY)
  const data = (rows as any[]).map((r) => ({
    cnpj:            r.cnpj,
    year:            Number(r.year),
    week:            Number(r.week),
    total_entregas:  Number(r.totalEntregas ?? 0),
    no_prazo:        Number(r.noPrazo ?? 0),
    performance_pct: r.performancePct !== null ? Number(r.performancePct) : null,
    synced_at:       new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_perf_weekly', data, ['cnpj', 'year', 'week'])
  log(`  → ${n} delivery perf weekly rows upserted`)
}

async function syncDeliveryPerfMonthly(conn: mysql.Connection) {
  log('Syncing bi_delivery_perf_monthly…')
  const [rows] = await conn.query(QUERY_DELIVERY_PERF_MONTHLY)
  const data = (rows as any[]).map((r) => ({
    cnpj:            r.cnpj,
    year:            Number(r.year),
    month:           Number(r.month),
    total_entregas:  Number(r.totalEntregas ?? 0),
    no_prazo:        Number(r.noPrazo ?? 0),
    performance_pct: r.performancePct !== null ? Number(r.performancePct) : null,
    synced_at:       new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_perf_monthly', data, ['cnpj', 'year', 'month'])
  log(`  → ${n} delivery perf monthly rows upserted`)
}

async function syncDeliveryFilialMonthly(conn: mysql.Connection) {
  log('Syncing bi_delivery_filial_monthly…')
  const [rows] = await conn.query(QUERY_DELIVERY_FILIAL_MONTHLY)
  const data = (rows as any[]).map((r) => ({
    cnpj:            r.cnpj,
    filial:          r.filial,
    year:            Number(r.year),
    month:           Number(r.month),
    total_entregas:  Number(r.totalEntregas ?? 0),
    no_prazo:        Number(r.noPrazo ?? 0),
    fora_prazo:      Number(r.foraPrazo ?? 0),
    pendente:        Number(r.pendente ?? 0),
    performance_pct: r.performancePct !== null ? Number(r.performancePct) : null,
    synced_at:       new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_filial_monthly', data, ['cnpj', 'filial', 'year', 'month'])
  log(`  → ${n} delivery filial monthly rows upserted`)
}

async function syncDeliveryFilialWeekly(conn: mysql.Connection) {
  log('Syncing bi_delivery_filial_weekly…')
  const [rows] = await conn.query(QUERY_DELIVERY_FILIAL_WEEKLY)
  const data = (rows as any[]).map((r) => ({
    cnpj:            r.cnpj,
    filial:          r.filial,
    year:            Number(r.year),
    week:            Number(r.week),
    total_entregas:  Number(r.totalEntregas ?? 0),
    no_prazo:        Number(r.noPrazo ?? 0),
    performance_pct: r.performancePct !== null ? Number(r.performancePct) : null,
    synced_at:       new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_filial_weekly', data, ['cnpj', 'filial', 'year', 'week'])
  log(`  → ${n} delivery filial weekly rows upserted`)
}

async function syncDeliveryWeekly(conn: mysql.Connection) {
  log('Syncing bi_delivery_weekly…')
  const [rows] = await conn.query(QUERY_DELIVERY_WEEKLY)
  const data = (rows as any[]).map((r) => ({
    cnpj:             r.cnpj,
    year:             Number(r.year),
    week:             Number(r.week),
    total_notas:      Number(r.totalNotas ?? 0),
    valor_mercadoria: Number(r.valorMercadoria ?? 0),
    valor_frete:      Number(r.valorFrete ?? 0),
    pct_nota:         r.pctNota !== null ? Number(r.pctNota) : null,
    total_entregas:   Number(r.totalEntregas ?? 0),
    no_prazo:         Number(r.noPrazo ?? 0),
    performance_pct:  r.performancePct !== null ? Number(r.performancePct) : null,
    synced_at:        new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_weekly', data, ['cnpj', 'year', 'week'])
  log(`  → ${n} delivery weekly rows upserted`)
}

async function syncDeliveryMonthly(conn: mysql.Connection) {
  log('Syncing bi_delivery_monthly…')
  const [rows] = await conn.query(QUERY_DELIVERY_MONTHLY)
  const data = (rows as any[]).map((r) => ({
    cnpj:             r.cnpj,
    year:             Number(r.year),
    month:            Number(r.month),
    total_notas:      Number(r.totalNotas ?? 0),
    valor_mercadoria: Number(r.valorMercadoria ?? 0),
    valor_frete:      Number(r.valorFrete ?? 0),
    pct_nota:         r.pctNota !== null ? Number(r.pctNota) : null,
    total_entregas:   Number(r.totalEntregas ?? 0),
    no_prazo:         Number(r.noPrazo ?? 0),
    performance_pct:  r.performancePct !== null ? Number(r.performancePct) : null,
    synced_at:        new Date().toISOString(),
  }))
  const n = await upsert('bi_delivery_monthly', data, ['cnpj', 'year', 'month'])
  log(`  → ${n} delivery monthly rows upserted`)
}

async function cleanStaleClients(syncStart: string) {
  log('Cleaning stale clients…')
  let totalRemoved = 0
  while (true) {
    const { data: staleRows, error } = await supabase
      .from('bi_clients')
      .select('cnpj')
      .lt('syncedAt', syncStart)
      .limit(500)
    if (error) throw new Error(`fetch stale bi_clients: ${error.message}`)

    const stale = (staleRows ?? []).map((r) => r.cnpj)
    if (stale.length === 0) break

    const CHUNK = 200
    for (let i = 0; i < stale.length; i += CHUNK) {
      const chunk = stale.slice(i, i + CHUNK)
      await supabase.from('bi_client_routes').delete().in('client_cnpj', chunk)
      await supabase.from('bi_client_monthly').delete().in('clientCnpj', chunk)
      await supabase.from('bi_clients').delete().in('cnpj', chunk)
    }
    totalRemoved += stale.length
  }
  log(`  → ${totalRemoved} stale clients removed`)
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

    const syncStart = new Date().toISOString()

    await syncClients(conn)
    await syncClientMonthly(conn)
    await syncClientRoutes(conn)
    await syncClientWeekly(conn)
    await syncClientDaily(conn)
    await syncAllRoutes(conn)
    await syncDeliveryPerf(conn)
    await syncDeliveryPerfWeekly(conn)
    await syncDeliveryPerfMonthly(conn)
    await syncDeliveryFilial(conn)
    await syncDeliveryFilialMonthly(conn)
    await syncDeliveryFilialWeekly(conn)
    await syncDeliveryWeekly(conn)
    await syncDeliveryMonthly(conn)
    await cleanOldDaily()
    await cleanStaleRoutes(syncStart)
    await cleanStaleClients(syncStart)

    log('=== Sync complete ===')
  } catch (err) {
    console.error('Sync failed:', err)
    process.exit(1)
  } finally {
    await conn?.end()
  }
}

main()
