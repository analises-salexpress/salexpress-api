import { PrismaClient } from '@prisma/client'

function buildUrl(url: string | undefined): string | undefined {
  if (!url) return url
  if (url.includes('pgbouncer=true')) return url
  const separator = url.includes('?') ? '&' : '?'
  return url + separator + 'pgbouncer=true&connection_limit=5'
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: { url: buildUrl(process.env.APP_DATABASE_URL) },
  },
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
