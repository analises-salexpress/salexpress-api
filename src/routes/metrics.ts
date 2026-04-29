import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/roles'
import { prisma } from '../db/prisma'
import { AuthenticatedRequest } from '../types'
import { getClientRecentMonths } from '../services/analyticsService'
import { Role } from '@prisma/client'

const router = Router()

router.use(authenticate)

// Returns the sum of billing for the last N full months
async function recentBillingSum(cnpj: string, months: number): Promise<number> {
  const rows = await getClientRecentMonths(cnpj, months)
  const now = new Date()
  const completed = rows.filter(
    (r) => r.year < now.getFullYear() || (r.year === now.getFullYear() && r.month < now.getMonth() + 1),
  )
  return completed.slice(-months).reduce((s, r) => s + r.billing, 0)
}

// GET /metrics/expansion
// All active expansion goals with current delta vs baseline
router.get('/expansion', async (req: AuthenticatedRequest, res) => {
  const where: any = { status: 'ACTIVE' }
  if (req.user!.role === Role.VENDOR) where.vendorId = req.user!.userId

  const goals = await prisma.expansionGoal.findMany({
    where,
    include: {
      vendor: { select: { id: true, name: true } },
      card:   { select: { id: true, status: true, clientName: true } },
    },
    orderBy: { startDate: 'asc' },
  })

  const results = await Promise.all(
    goals.map(async (g) => {
      // Quarter = 3 months. Compare last 3 months vs baseline
      const currentQuarterBilling = await recentBillingSum(g.clientId, 3)
      const baselineQuarter = g.baselineAvg * 3
      const delta = currentQuarterBilling - baselineQuarter

      return {
        goalId:          g.id,
        clientId:        g.clientId,
        clientName:      g.card?.clientName ?? g.clientId,
        vendor:          g.vendor,
        card:            g.card,
        startDate:       g.startDate,
        baselineAvg:     g.baselineAvg,
        baselineQuarter: Math.round(baselineQuarter * 100) / 100,
        currentQuarter:  Math.round(currentQuarterBilling * 100) / 100,
        delta:           Math.round(delta * 100) / 100,
        targetValue:     g.targetValue,
        targetHit:       g.targetValue != null && delta >= g.targetValue,
      }
    }),
  )

  res.json(results)
})

// GET /metrics/vendor/:vendorId
router.get('/vendor/:vendorId', requireRole(Role.MANAGER), async (req, res) => {
  const { vendorId } = req.params

  const vendor = await prisma.user.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, email: true },
  })
  if (!vendor) {
    res.status(404).json({ error: 'Vendor not found' })
    return
  }

  const [cards, goals] = await Promise.all([
    prisma.kanbanCard.findMany({
      where: { assignedToId: vendorId },
      select: { id: true, status: true, clientName: true, createdAt: true },
    }),
    prisma.expansionGoal.findMany({
      where: { vendorId },
      select: { id: true, clientId: true, baselineAvg: true, status: true, startDate: true },
    }),
  ])

  const cardsByStatus = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1
    return acc
  }, {})

  let totalExpansionDelta = 0
  const activeGoals = goals.filter((g) => g.status === 'ACTIVE')
  for (const g of activeGoals) {
    const current = await recentBillingSum(g.clientId, 3)
    totalExpansionDelta += current - g.baselineAvg * 3
  }

  res.json({
    vendor,
    cardsByStatus,
    totalCards:          cards.length,
    activeGoals:         activeGoals.length,
    achievedGoals:       goals.filter((g) => g.status === 'ACHIEVED').length,
    totalExpansionDelta: Math.round(totalExpansionDelta * 100) / 100,
  })
})

// GET /metrics/summary (manager view)
router.get('/summary', requireRole(Role.MANAGER), async (_req, res) => {
  const [
    activeCards,
    lostCards,
    expandedCards,
    activeGoals,
    allVendors,
  ] = await Promise.all([
    prisma.kanbanCard.count({ where: { status: { not: 'LOST' } } }),
    prisma.kanbanCard.count({ where: { status: 'LOST' } }),
    prisma.kanbanCard.count({ where: { status: 'EXPANDED' } }),
    prisma.expansionGoal.findMany({
      where: { status: 'ACTIVE' },
      select: { clientId: true, baselineAvg: true, vendorId: true },
    }),
    prisma.user.findMany({
      where: { role: Role.VENDOR, active: true },
      select: { id: true, name: true },
    }),
  ])

  // Total expansion delta across all active goals
  let totalExpansionDelta = 0
  for (const g of activeGoals) {
    const current = await recentBillingSum(g.clientId, 3)
    totalExpansionDelta += current - g.baselineAvg * 3
  }

  // Cards per vendor
  const cardCounts = await Promise.all(
    allVendors.map(async (v) => ({
      vendor: v,
      active: await prisma.kanbanCard.count({
        where: { assignedToId: v.id, status: { not: 'LOST' } },
      }),
    })),
  )

  res.json({
    cards: { active: activeCards, lost: lostCards, expanded: expandedCards },
    activeGoals:         activeGoals.length,
    totalExpansionDelta: Math.round(totalExpansionDelta * 100) / 100,
    vendorCards:         cardCounts,
  })
})

// ── Expansion Goals CRUD ──────────────────────────────────────────────────────

const goalSchema = z.object({
  clientId:    z.string(),
  cardId:      z.string().optional(),
  startDate:   z.string().datetime(),
  baselineAvg: z.number().positive(),
  targetValue: z.number().optional(),
})

// POST /metrics/goals
router.post('/goals', async (req: AuthenticatedRequest, res) => {
  const body = goalSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const goal = await prisma.expansionGoal.create({
    data: { ...body.data, vendorId: req.user!.userId },
  })
  res.status(201).json(goal)
})

// PUT /metrics/goals/:id/status
router.put('/goals/:id/status', async (req: AuthenticatedRequest, res) => {
  const { status } = req.body
  if (!['ACTIVE', 'ACHIEVED', 'CANCELLED'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }

  const goal = await prisma.expansionGoal.findUnique({ where: { id: req.params.id } })
  if (!goal) {
    res.status(404).json({ error: 'Goal not found' })
    return
  }

  if (req.user!.role === Role.VENDOR && goal.vendorId !== req.user!.userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const updated = await prisma.expansionGoal.update({
    where: { id: req.params.id },
    data: { status },
  })
  res.json(updated)
})

export default router
