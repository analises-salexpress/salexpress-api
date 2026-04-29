import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('Admin@123', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@salexpress.com.br' },
    update: {},
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
