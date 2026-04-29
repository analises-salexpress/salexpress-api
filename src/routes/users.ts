import { Router, Response } from 'express'
import { z } from 'zod'
import { Role } from '@prisma/client'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/roles'
import { hashPassword, verifyPassword } from '../services/authService'
import { AuthenticatedRequest } from '../types'

const router = Router()

router.use(authenticate)

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
} as const

router.get('/', requireRole(Role.MANAGER), async (_req, res: Response) => {
  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: { name: 'asc' },
  })
  res.json({ data: users })
})

router.get('/me', async (req: AuthenticatedRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: userSelect,
  })
  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado' })
    return
  }
  res.json({ data: user })
})

const createUserSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
  role: z.nativeEnum(Role).optional(),
})

router.post('/', requireRole(Role.MANAGER), async (req: AuthenticatedRequest, res: Response) => {
  const result = createUserSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() })
    return
  }

  const existing = await prisma.user.findUnique({ where: { email: result.data.email } })
  if (existing) {
    res.status(409).json({ error: 'E-mail já cadastrado' })
    return
  }

  const passwordHash = await hashPassword(result.data.password)
  const user = await prisma.user.create({
    data: {
      name: result.data.name,
      email: result.data.email,
      passwordHash,
      role: result.data.role ?? Role.VENDOR,
    },
    select: userSelect,
  })

  res.status(201).json({ data: user, message: 'Usuário criado com sucesso' })
})

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  active: z.boolean().optional(),
  role: z.nativeEnum(Role).optional(),
})

router.put('/:id', requireRole(Role.MANAGER), async (req: AuthenticatedRequest, res: Response) => {
  const result = updateUserSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() })
    return
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: result.data,
      select: userSelect,
    })
    res.json({ data: user })
  } catch {
    res.status(404).json({ error: 'Usuário não encontrado' })
  }
})

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'Nova senha deve ter pelo menos 8 caracteres'),
})

router.put('/:id/password', async (req: AuthenticatedRequest, res: Response) => {
  const isManager = req.user?.role === Role.MANAGER
  const isSelf = req.user?.userId === req.params.id

  if (!isManager && !isSelf) {
    res.status(403).json({ error: 'Permissão insuficiente' })
    return
  }

  const result = changePasswordSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() })
    return
  }

  const user = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado' })
    return
  }

  if (!isManager) {
    if (!result.data.currentPassword) {
      res.status(400).json({ error: 'Senha atual obrigatória' })
      return
    }
    const valid = await verifyPassword(user.passwordHash, result.data.currentPassword)
    if (!valid) {
      res.status(400).json({ error: 'Senha atual incorreta' })
      return
    }
  }

  const passwordHash = await hashPassword(result.data.newPassword)
  await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } })

  res.json({ message: 'Senha alterada com sucesso' })
})

export default router
