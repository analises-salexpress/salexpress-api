import { PrismaClient } from '@prisma/client'

const base = process.env.APP_DATABASE_URL ?? ''
const url = base.includes('pgbouncer=true') ? base : base + (base.includes('?') ? '&' : '?') + 'pgbouncer=true'
const prisma = new PrismaClient({ datasources: { db: { url } } })

async function run() {
  console.log('Adding new columns...')

  // bi_client_routes: add recent_monthly_avg
  await prisma.$executeRawUnsafe(`
    ALTER TABLE bi_client_routes
    ADD COLUMN IF NOT EXISTS recent_monthly_avg FLOAT NOT NULL DEFAULT 0
  `)

  // bi_all_routes: add total_revenue
  await prisma.$executeRawUnsafe(`
    ALTER TABLE bi_all_routes
    ADD COLUMN IF NOT EXISTS total_revenue FLOAT NOT NULL DEFAULT 0
  `)

  // kanban_cards: add manual_expansion_potential
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "KanbanCard"
    ADD COLUMN IF NOT EXISTS manual_expansion_potential FLOAT
  `)

  console.log('Migration complete!')
  await prisma.$disconnect()
}

run().catch(async (e) => {
  console.error(e.message)
  await prisma.$disconnect()
  process.exit(1)
})
