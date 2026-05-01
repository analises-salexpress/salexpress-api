import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Use direct URL (bypasses pgBouncer) to avoid prepared statement conflicts during seed
const directUrl = process.env.APP_DATABASE_DIRECT_URL ?? process.env.APP_DATABASE_URL
const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
})

async function main() {
  const passwordHash = await bcrypt.hash('081900@Joao', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@salexpress.com.br' },
    update: { passwordHash },
    create: {
      name: 'Administrador',
      email: 'admin@salexpress.com.br',
      passwordHash,
      role: Role.MANAGER,
    },
  })

  console.log('Seed executado com sucesso!')
  console.log(`Usuário admin criado: ${admin.email}`)
  console.log('Senha inicial: Admin@123')
  console.log('IMPORTANTE: Troque a senha após o primeiro login!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
