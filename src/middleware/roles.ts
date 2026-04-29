import { Response, NextFunction } from 'express'
import { Role } from '@prisma/client'
import { AuthenticatedRequest } from '../types'

export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Permissão insuficiente' })
      return
    }
    next()
  }
}
