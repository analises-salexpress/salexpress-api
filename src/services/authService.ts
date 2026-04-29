import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../db/prisma'
import { JWTPayload } from '../types'

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email, active: true } })
  if (!user) throw new Error('Credenciais inválidas')

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw new Error('Credenciais inválidas')

  const payload: JWTPayload = { userId: user.id, email: user.email, role: user.role }

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'],
  })

  const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
    expiresIn: '7d',
  })

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt },
  })

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }
}

export async function refreshAccessToken(refreshToken: string) {
  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
  if (!stored || stored.expiresAt < new Date()) throw new Error('Refresh token inválido ou expirado')

  const user = await prisma.user.findUnique({ where: { id: stored.userId } })
  if (!user || !user.active) throw new Error('Usuário inativo')

  const payload: JWTPayload = { userId: user.id, email: user.email, role: user.role }
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'],
  })

  return { accessToken }
}

export async function logout(refreshToken: string) {
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } })
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
