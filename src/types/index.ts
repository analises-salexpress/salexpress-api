import { Request } from 'express'
import { Role } from '@prisma/client'

export interface JWTPayload {
  userId: string
  email: string
  role: Role
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload
}

export interface ApiResponse<T = unknown> {
  data?: T
  message?: string
  error?: string
}

export interface PaginationQuery {
  page?: string
  limit?: string
}

export function paginate(page = 1, limit = 20) {
  const take = Math.min(limit, 100)
  const skip = (page - 1) * take
  return { take, skip }
}
