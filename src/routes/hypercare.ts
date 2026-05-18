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
  getDeliveryPerformanceMonthly,
  getDeliveryPerformanceBatch,
} from '../services/deliveryService'

const router = Router()
router.use(authenticate)

// ── Diagnóstico de performance (dev only) ────────────────────────────────────
// GET /hypercare/diag/performance/:cnpj
router.get('/diag/performance/:cnpj', async (req: AuthenticatedRequest, res) => {
  const cnpj = req.params.cnpj.replace(/\D/g, '')
  try {
    const p30 = await getDeliveryPerformanceBatch([cnpj], 30)
    const p90 = await getDeliveryPerformanceBatch([cnpj], 90)
    res.json({ cnpj, last30days: p30[cnpj] ?? null, last90days: p90[cnpj] ?? null })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e), stack: e?.stack?.split('\n').slice(0, 5) })
  }
})

// ── CNPJ Lookup (busca no BI antes de cadastrar) ──────────────────────────────

// GET /hypercare/lookup?cnpj=12345678000195
router.get('/lookup', async (req: AuthenticatedRequest, res) => {
  const cnpj = String(req.query.cnpj ?? '').replace(/\D/g, '')
  if (cnpj.length < 8) {
    res.status(400).json({ error: 'CNPJ inválido' })
    return
  }

  const client = await prisma.biClient.findUnique({ where: { cnpj } })
  if (!client) {
    res.status(404).json({ error: 'CNPJ não encontrado no banco de dados' })
    return
  }

  // Check if already enrolled
  const enrolled = await prisma.hypercareClient.findUnique({ where: { cnpj } })

  res.json({
    cnpj:        client.cnpj,
    clientName:  client.name,
    groupedName: client.groupedName,
    city:        client.city,
    state:       client.state,
    segment:     client.segment,
    alreadyEnrolled: !!enrolled,
    enrolledId:  enrolled?.id ?? null,
  })
})

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
      enrolledBy:     { select: { id: true, name: true } },
      additionalCnpjs: { select: { id: true, cnpj: true, name: true } },
      _count: { select: { touchpoints: true, meetings: true } },
    },
  })

  // Collect all CNPJs for batch BI query and city lookup
  const allCnpjsPerClient = clients.map((c) => [c.cnpj, ...c.additionalCnpjs.map((a) => a.cnpj)])
  const uniqueCnpjs = [...new Set(allCnpjsPerClient.flat())]

  const [perfMap, biClients] = await Promise.all([
    getDeliveryPerformanceBatch(uniqueCnpjs, 90),
    prisma.biClient.findMany({
      where: { cnpj: { in: clients.map((c) => c.cnpj) } },
      select: { cnpj: true, city: true, state: true },
    }),
  ])

  const biMap = Object.fromEntries(biClients.map((b) => [b.cnpj, b]))

  const data = clients.map((c) => {
    const perf = perfMap[c.cnpj] ?? { performancePct: null, semaforo: 'no_data' as const }
    const bi   = biMap[c.cnpj]
    return {
      ...c,
      performance:    perf,
      performancePct: perf.performancePct,
      semaforo:       perf.semaforo,
      city:           bi?.city  ?? null,
      state:          bi?.state ?? null,
    }
  })

  res.json(data)
})

// POST /hypercare/clients
router.post('/clients', async (req: AuthenticatedRequest, res) => {
  const body = enrollSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const cnpj = body.data.cnpj.replace(/\D/g, '')

  const existing = await prisma.hypercareClient.findUnique({ where: { cnpj } })
  if (existing) {
    res.status(409).json({ error: 'Cliente já está no programa HyperCare', clientId: existing.id })
    return
  }

  const client = await prisma.hypercareClient.create({
    data: {
      cnpj,
      clientName:   body.data.clientName,
      notes:        body.data.notes ?? null,
      enrolledById: req.user!.userId,
    },
    include: {
      enrolledBy:     { select: { id: true, name: true } },
      additionalCnpjs: true,
    },
  })

  res.status(201).json(client)
})

// GET /hypercare/clients/:id
router.get('/clients/:id', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({
    where: { id: req.params.id },
    include: {
      enrolledBy:      { select: { id: true, name: true } },
      additionalCnpjs: { select: { id: true, cnpj: true, name: true } },
      _count: { select: { touchpoints: true, meetings: true } },
    },
  })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const cnpjs = [client.cnpj, ...client.additionalCnpjs.map((a) => a.cnpj)]
  const [perfMap, biData] = await Promise.all([
    getDeliveryPerformanceBatch(cnpjs),
    prisma.biClient.findUnique({
      where: { cnpj: client.cnpj },
      select: { city: true, state: true, segment: true, curve: true },
    }),
  ])

  const perf = perfMap[client.cnpj] ?? { performancePct: null, semaforo: 'no_data' as const }
  res.json({
    ...client,
    performance:    perf,
    performancePct: perf.performancePct,
    semaforo:       perf.semaforo,
    city:           biData?.city  ?? null,
    state:          biData?.state ?? null,
    segment:        biData?.segment ?? null,
  })
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
    include: {
      enrolledBy:     { select: { id: true, name: true } },
      additionalCnpjs: true,
    },
  })
  res.json(updated)
})

// DELETE /hypercare/clients/:id
router.delete('/clients/:id', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }
  await prisma.hypercareClient.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

// ── Additional CNPJs ──────────────────────────────────────────────────────────

const cnpjAddSchema = z.object({ cnpj: z.string().min(1), name: z.string().min(1) })

// GET /hypercare/clients/:id/cnpjs
router.get('/clients/:id/cnpjs', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const cnpjs = await prisma.hypercareClientCnpj.findMany({
    where: { clientId: req.params.id },
    orderBy: { createdAt: 'asc' },
  })
  res.json(cnpjs)
})

// POST /hypercare/clients/:id/cnpjs
router.post('/clients/:id/cnpjs', async (req: AuthenticatedRequest, res) => {
  const body = cnpjAddSchema.safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return }

  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const cnpj = body.data.cnpj.replace(/\D/g, '')

  if (cnpj === client.cnpj) {
    res.status(400).json({ error: 'Este CNPJ já é o principal do cliente' })
    return
  }

  try {
    const added = await prisma.hypercareClientCnpj.create({
      data: { clientId: req.params.id, cnpj, name: body.data.name },
    })
    res.status(201).json(added)
  } catch {
    res.status(409).json({ error: 'CNPJ já vinculado a este cliente' })
  }
})

// DELETE /hypercare/clients/:id/cnpjs/:cnpj
router.delete('/clients/:id/cnpjs/:cnpj', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({ where: { id: req.params.id } })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  await prisma.hypercareClientCnpj.deleteMany({
    where: { clientId: req.params.id, cnpj: req.params.cnpj.replace(/\D/g, '') },
  })
  res.status(204).send()
})

// ── Performance (BI) ──────────────────────────────────────────────────────────

async function getClientAllCnpjs(clientId: string): Promise<string[]> {
  const client = await prisma.hypercareClient.findUnique({
    where: { id: clientId },
    include: { additionalCnpjs: { select: { cnpj: true } } },
  })
  if (!client) return []
  return [client.cnpj, ...client.additionalCnpjs.map((a) => a.cnpj)]
}

// GET /hypercare/clients/:id/performance?days=30
router.get('/clients/:id/performance', async (req: AuthenticatedRequest, res) => {
  const client = await prisma.hypercareClient.findUnique({
    where: { id: req.params.id },
    include: { additionalCnpjs: { select: { cnpj: true } } },
  })
  if (!client) { res.status(404).json({ error: 'Not found' }); return }

  const days  = Math.min(Number(req.query.days ?? 90), 180)
  const weeks = Math.ceil(days / 7)
  const cnpjs = [client.cnpj, ...client.additionalCnpjs.map((a) => a.cnpj)]

  const [byFilial, weekly, monthly] = await Promise.all([
    getDeliveryPerformanceByFilial(cnpjs, days),
    getDeliveryPerformanceWeekly(cnpjs, weeks),
    getDeliveryPerformanceMonthly(cnpjs, 3),
  ])

  const totalDelivered = byFilial.reduce((s, f) => s + f.noPrazo + f.foraPrazo, 0)
  const totalNoPrazo   = byFilial.reduce((s, f) => s + f.noPrazo, 0)
  const overallPct     = totalDelivered > 0
    ? Math.round((totalNoPrazo / totalDelivered) * 1000) / 10
    : null

  res.json({
    clientId:   client.id,
    cnpj:       client.cnpj,
    clientName: client.clientName,
    cnpjs,
    days,
    overall: {
      performancePct: overallPct,
      semaforo: overallPct === null ? 'no_data'
        : overallPct >= 95 ? 'green'
        : overallPct >= 90 ? 'yellow'
        : overallPct >= 85 ? 'red'
        : 'critical',
      totalEntregas:  byFilial.reduce((s, f) => s + f.totalEntregas, 0),
      noPrazo:        totalNoPrazo,
      foraPrazo:      byFilial.reduce((s, f) => s + f.foraPrazo, 0),
    },
    byFilial,
    weekly,
    monthly,
  })
})

// ── Touchpoints ───────────────────────────────────────────────────────────────

const touchpointSchema = z.object({
  type:       z.nativeEnum(TouchpointType),
  summary:    z.string().min(1),
  outcome:    z.nativeEnum(TouchpointOutcome),
  occurredAt: z.string().datetime().optional(),
})

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
    include: { user: { select: { id: true, name: true } }, actionItems: true },
  })
  res.status(201).json(meeting)
})

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

  const now = new Date()
  const enriched = items.map((item) => ({
    ...item,
    isOverdue: item.status === 'OPEN' && item.dueDate !== null && item.dueDate < now,
  }))

  res.json(enriched)
})

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

router.delete('/action-items/:id', requireRole(Role.MANAGER), async (req, res) => {
  const item = await prisma.hypercareActionItem.findUnique({ where: { id: req.params.id } })
  if (!item) { res.status(404).json({ error: 'Not found' }); return }
  await prisma.hypercareActionItem.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req: AuthenticatedRequest, res) => {
  const [activeClients, openActions] = await Promise.all([
    prisma.hypercareClient.findMany({
      where: { status: 'ACTIVE' },
      include: {
        enrolledBy:     { select: { id: true, name: true } },
        additionalCnpjs: { select: { cnpj: true } },
        _count: { select: { touchpoints: true, meetings: true } },
      },
    }),
    prisma.hypercareActionItem.count({ where: { status: 'OPEN' } }),
  ])

  // Aggregate all CNPJs for batch query
  const allUniqueCnpjs = [
    ...new Set(activeClients.flatMap((c) => [c.cnpj, ...c.additionalCnpjs.map((a) => a.cnpj)])),
  ]
  let perfMap: Awaited<ReturnType<typeof getDeliveryPerformanceBatch>> = {}
  try {
    perfMap = await getDeliveryPerformanceBatch(allUniqueCnpjs, 30)
  } catch {
    // BI unavailable — dashboard still returns without performance data
  }

  const clients = activeClients.map((c) => {
    const perf = perfMap[c.cnpj] ?? { performancePct: null, semaforo: 'no_data' as const }
    return {
      ...c,
      performance:    perf,
      performancePct: perf.performancePct,
      semaforo:       perf.semaforo,
    }
  })

  const summary = {
    totalActive:     activeClients.length,
    greenCount:      clients.filter((c) => c.performance.semaforo === 'green').length,
    yellowCount:     clients.filter((c) => c.performance.semaforo === 'yellow').length,
    redCount:        clients.filter((c) => c.performance.semaforo === 'red').length,
    criticalCount:   clients.filter((c) => c.performance.semaforo === 'critical').length,
    openActionItems: openActions,
  }

  res.json({ summary, clients })
})

export default router
