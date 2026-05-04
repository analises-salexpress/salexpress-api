import { PrismaClient } from '@prisma/client'

const base = process.env.APP_DATABASE_URL ?? ''
const url = base.includes('pgbouncer=true') ? base : base + (base.includes('?') ? '&' : '?') + 'pgbouncer=true'

const prisma = new PrismaClient({ datasources: { db: { url } } })

async function run() {
  console.log('Dropping old route tables...')
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS bi_client_routes CASCADE')
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS bi_all_routes CASCADE')

  console.log('Creating bi_client_routes...')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE bi_client_routes (
      id SERIAL PRIMARY KEY,
      client_cnpj TEXT NOT NULL,
      region TEXT NOT NULL,
      first_seen TIMESTAMPTZ NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL,
      trip_count INT NOT NULL DEFAULT 1,
      total_revenue FLOAT NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_cnpj, region)
    )
  `)
  await prisma.$executeRawUnsafe('CREATE INDEX bi_client_routes_cnpj_idx ON bi_client_routes(client_cnpj)')

  console.log('Creating bi_all_routes...')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE bi_all_routes (
      id SERIAL PRIMARY KEY,
      region TEXT NOT NULL UNIQUE,
      avg_revenue FLOAT NOT NULL DEFAULT 0,
      trip_count INT NOT NULL DEFAULT 0,
      client_count INT NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  console.log('Migration complete!')
  await prisma.$disconnect()
}

run().catch(async (e) => {
  console.error(e.message)
  await prisma.$disconnect()
  process.exit(1)
})
