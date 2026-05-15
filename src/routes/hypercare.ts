import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/roles'
import { prisma } from '../db/prisma'
import { AuthenticatedRequest } from '../types'
import { Role, HypercareStatus, TouchpointType, TouchpointOutcome, ActionItemStatus } from '@prisma/client'
import {
  getDeliveryPerformanceByFilial,
  getDeliveryPerformanceWeekly,
  getDeliveryPerformanceBatch,
} from '../services/deliveryService'

const router = Router()
router.use(authenticate)

// ── Clients ───────────────────────────────────────────────────────────────────

const enrollSchema = z.object({
  cnpj:       z.string().min(1),
  clientName: z.string().min(1),
  notes:      z.string().optional(),
})

// GET /hypercare/clients
router.get('/clients', async (req: AuthenticatedRequest, res) => {
  const { status } = req.query
  const where: any = {}
  if (status) where.status = status as HypercareStatus

  const clients = await prisma.hypercareClient.findMany({
    where,
    orderBy: { enrolledAt: 'desc' },
    include: {
      enrolledBy: { select: { id: true, name: true } },
      _count: { select: { touchpoints: true, meetings: true } },
    },
  })

  // Fetch current performance for all clients from BI
  const cnpjs = clients.map((c) => c.cnpj)
  const perfMap = await getDeliveryPerformanceBatch(cnpjs, 30)

  const data = clients.map((c) => ({
    ...c,
    performance: perfMap[c.cnpj] ?? { performancePct: null, semaforo: 'no_data' },
  }))

  res.json(data)
})

// POST /hypercare/clients
router.post('/clients', async (req: AuthenticatedRequest, res) => {
  const body = enrollSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const existing = await prisma.hypercareClient.findUnique({ where: { cnpj: body.data.cnpj } })
  if (existing) {
    res.status(409).json({ error: 'Cliente já está no programa HyperCare', clientId: existing.id })
    return
  }

  const client = await prisma.hypercareClient.create({
    data: {
      cnpj:        body.data.cnpj,
      clientName:  body.data.clientName,
      notes:       body.data.notes ?? null,
      enrolledById: req.user!.userId,
    },
    include: { enrolledBy: { select: { id: true, name: true } } },
  })

  res.status(201).json(client)
})

// PUT /hypercare/clients/:id
router.put('/clients/:id', async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    status:     z.nativeEnum(HypercareStatus).optional(),
    clientName: z.string().optional(),
    notes:      z.string().nullable().optional(),
  })
  const body = schema.safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return }

  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const updated = await prisma.hypercareClient.update({
    where: { id: req.params.id },
    data:  body.data,
    include: { enrolledBy: { select: { id: true, name: true } } },
  })
  res.json(updated)
})

// DELETE /hypercare/clients/:id (manager only)
router.delete('/clients/:id', requireRole(Role.MANAGER), async (req, res) => {
  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }
  await prisma.hypercareClient.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

// ── Performance (BI) ──────────────────────────────────────────────────────────

// GET /hypercare/clients/:id/performance?days=30
router.get('/clients/:id/performance', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const days = Math.min(Number(req.query.days ?? 30), 90)
  const [byFilial, weekly] = await Promise.all([
    getDeliveryPerformanceByFilial(client.cnpj, days),
    getDeliveryPerformanceWeekly(client.cnpj, Math.ceil(days / 7)),
  ])

  // Overall performance (weighted avg of delivered)
  const totalDelivered = byFilial.reduce((s, f) => s + f.noPrazo + f.foraPrazo, 0)
  const totalNoPrazo   = byFilial.reduce((s, f) => s + f.noPrazo, 0)
  const overallPct     = totalDelivered > 0 ? Math.round((totalNoPrazo / totalDelivered) * 1000) / 10 : null

  res.json({
    clientId:   client.id,
    cnpj:       client.cnpj,
    clientName: client.clientName,
    days,
    overall: {
      performancePct: overallPct,
      semaforo: overallPct === null ? 'no_data'
        : overallPct >= 95 ? 'green'
        : overallPct >= 90 ? 'yellow'
        : overallPct >= 85 ? 'red'
        : 'critical',
    },
    byFilial,
    weekly,
  })
})

// ── Touchpoints ───────────────────────────────────────────────────────────────

const touchpointSchema = z.object({
  type:       z.nativeEnum(TouchpointType),
  summary:    z.string().min(1),
  outcome:    z.nativeEnum(TouchpointOutcome),
  occurredAt: z.string().datetime().optional(),
})

// GET /hypercare/clients/:id/touchpoints
router.get('/clients/:id/touchpoints', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const touchpoints = await prisma.hypercareTouchpoint.findMany({
    where: { clientId: req.params.id },
    orderBy: { occurredAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  })
  res.json(touchpoints)
})

// POST /hypercare/clients/:id/touchpoints
router.post('/clients/:id/touchpoints', async (req: AuthenticatedRequest, res) => {
  const body = touchpointSchema.safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return }

  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const tp = await prisma.hypercareTouchpoint.create({
    data: {
      clientId:   req.params.id,
      userId:     req.user!.userId,
      type:       body.data.type,
      summary:    body.data.summary,
      outcome:    body.data.outcome,
      occurredAt: body.data.occurredAt ? new Date(body.data.occurredAt) : new Date(),
    },
    include: { user: { select: { id: true, name: true } } },
  })
  res.status(201).json(tp)
})

// DELETE /hypercare/touchpoints/:id
router.delete('/touchpoints/:id', async (req: AuthenticatedRequest, res) => {
  const tp = await prisma.hypercareTouchpoint.findUnique({ where: { id: req.params.id } })
  if (!tp) { res.status(404).json({ error: 'Not found' }); return }
  if (req.user!.role !== Role.MANAGER && tp.userId !== req.user!.userId) {
    res.status(403).json({ error: 'Forbidden' }); return
  }
  await prisma.hypercareTouchpoint.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

// ── GGR Meetings ──────────────────────────────────────────────────────────────

const meetingSchema = z.object({
  meetingDate: z.string().datetime(),
  agenda:      z.string().optional(),
  minutes:     z.string().optional(),
})

const meetingUpdateSchema = z.object({
  agenda:  z.string().nullable().optional(),
  minutes: z.string().nullable().optional(),
})

// GET /hypercare/clients/:id/meetings
router.get('/clients/:id/meetings', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const meetings = await prisma.hypercareMeeting.findMany({
    where: { clientId: req.params.id },
    orderBy: { meetingDate: 'desc' },
    include: {
      user: { select: { id: true, name: true } },
      actionItems: { orderBy: { createdAt: 'asc' } },
    },
  })
  res.json(meetings)
})

// POST /hypercare/clients/:id/meetings
router.post('/clients/:id/meetings', async (req: AuthenticatedRequest, res) => {
  const body = meetingSchema.safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return }

  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const meeting = await prisma.hypercareMeeting.create({
    data: {
      clientId:    req.params.id,
      userId:      req.user!.userId,
      meetingDate: new Date(body.data.meetingDate),
      agenda:      body.data.agenda ?? null,
      minutes:     body.data.minutes ?? null,
    },
    include: {
      user: { select: { id: true, name: true } },
      actionItems: true,
    },
  })
  res.status(201).json(meeting)
})

// PUT /hypercare/meetings/:id
router.put('/meetings/:id', async (req: AuthenticatedRequest, res) => {
  const body = meetingUpdateSchema.safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return }

  const meeting = await prisma.hypercareMeeting.findUnique({ where: { id: req.params.id } })
  if (!meeting) { res.status(404).json({ error: 'Not found' }); return }

  if (req.user!.role !== Role.MANAGER && meeting.userId !== req.user!.userId) {
    res.status(403).json({ error: 'Forbidden' }); return
  }

  const updated = await prisma.hypercareMeeting.update({
    where: { id: req.params.id },
    data:  body.data,
    include: { user: { select: { id: true, name: true } }, actionItems: true },
  })
  res.json(updated)
})

// ── Action Items ──────────────────────────────────────────────────────────────

const actionItemSchema = z.object({
  description: z.string().min(1),
  responsible: z.string().min(1),
  dueDate:     z.string().datetime().nullable().optional(),
})

// GET /hypercare/action-items?clientId=&status=OPEN
router.get('/action-items', async (req: AuthenticatedRequest, res) => {
  const { status, clientId } = req.query
  const where: any = {}
  if (status)   where.status = status as ActionItemStatus
  if (clientId) where.meeting = { clientId: clientId as string }

  const items = await prisma.hypercareActionItem.findMany({
    where,
    orderBy: { dueDate: 'asc' },
    include: {
      meeting: {
        select: {
          id: true, meetingDate: true,
          client: { select: { id: true, clientName: true, cnpj: true } },
        },
      },
    },
  })

  // Mark overdue items
  const now = new Date()
  const enriched = items.map((item) => ({
    ...item,
    isOverdue: item.status === 'OPEN' && item.dueDate !== null && item.dueDate < now,
  }))

  res.json(enriched)
})

// POST /hypercare/meetings/:id/action-items
router.post('/meetings/:id/action-items', async (req: AuthenticatedRequest, res) => {
  const body = actionItemSchema.safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return }

  const meeting = await prisma.hypercareMeeting.findUnique({ where: { id: req.params.id } })
  if (!meeting) { res.status(404).json({ error: 'Not found' }); return }

  const item = await prisma.hypercareActionItem.create({
    data: {
      meetingId:   req.params.id,
      description: body.data.description,
      responsible: body.data.responsible,
      dueDate:     body.data.dueDate ? new Date(body.data.dueDate) : null,
    },
  })
  res.status(201).json(item)
})

// PUT /hypercare/action-items/:id
router.put('/action-items/:id', async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    status:      z.nativeEnum(ActionItemStatus).optional(),
    description: z.string().optional(),
    responsible: z.string().optional(),
    dueDate:     z.string().datetime().nullable().optional(),
  })
  const body = schema.safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return }

  const item = await prisma.hypercareActionItem.findUnique({ where: { id: req.params.id } })
  if (!item) { res.status(404).json({ error: 'Not found' }); return }

  const updated = await prisma.hypercareActionItem.update({
    where: { id: req.params.id },
    data: {
      ...body.data,
      dueDate: body.data.dueDate !== undefined
        ? (body.data.dueDate ? new Date(body.data.dueDate) : null)
        : undefined,
    },
  })
  res.json(updated)
})

// DELETE /hypercare/action-items/:id
router.delete('/action-items/:id', requireRole(Role.MANAGER), async (req, res) => {
  const item = await prisma.hypercareActionItem.findUnique({ where: { id: req.params.id } })
  if (!item) { res.status(404).json({ error: 'Not found' }); return }
  await prisma.hypercareActionItem.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

// ── Dashboard ─────────────────────────────────────────────────────────────────

// GET /hypercare/dashboard
router.get('/dashboard', async (req: AuthenticatedRequest, res) => {
  const [activeClients, openActions] = await Promise.all([
    prisma.hypercareClient.findMany({
      where: { status: 'ACTIVE' },
      include: {
        enrolledBy: { select: { id: true, name: true } },
        _count: { select: { touchpoints: true, meetings: true } },
      },
    }),
    prisma.hypercareActionItem.count({
      where: { status: 'OPEN' },
    }),
  ])

  const cnpjs  = activeClients.map((c) => c.cnpj)
  const perfMap = await getDeliveryPerformanceBatch(cnpjs, 30)

  const clients = activeClients.map((c) => ({
    ...c,
    performance: perfMap[c.cnpj] ?? { performancePct: null, semaforo: 'no_data' },
  }))

  const summary = {
    totalActive:    activeClients.length,
    greenCount:     clients.filter((c) => c.performance.semaforo === 'green').length,
    yellowCount:    clients.filter((c) => c.performance.semaforo === 'yellow').length,
    redCount:       clients.filter((c) => c.performance.semaforo === 'red').length,
    criticalCount:  clients.filter((c) => c.performance.semaforo === 'critical').length,
    openActionItems: openActions,
  }

  res.json({ summary, clients })
})

export default router
