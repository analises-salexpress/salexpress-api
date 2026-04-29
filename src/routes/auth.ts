import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { login, refreshAccessToken, logout } from '../services/authService'
import { authenticate } from '../middleware/auth'
import { AuthenticatedRequest } from '../types'

const router = Router()

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

router.post('/login', async (req: Request, res: Response) => {
  const result = loginSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() })
    return
  }

  try {
    const data = await login(result.data.email, result.data.password)
    res.json({ data })
  } catch (err) {
    res.status(401).json({ error: (err as Error).message })
  }
})

router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken obrigatório' })
    return
  }

  try {
    const data = await refreshAccessToken(refreshToken as string)
    res.json({ data })
  } catch (err) {
    res.status(401).json({ error: (err as Error).message })
  }
})

router.post('/logout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { refreshToken } = req.body
  if (refreshToken) {
    await logout(refreshToken as string)
  }
  res.json({ message: 'Logout realizado com sucesso' })
})

export default router
