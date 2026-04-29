import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/roles'
import { prisma } from '../db/prisma'
import { AuthenticatedRequest } from '../types'
import { CardStatus, Priority, Role } from '@prisma/client'

const router = Router()

router.use(authenticate)

// ── Cards ─────────────────────────────────────────────────────────────────────

const cardCreateSchema = z.object({
  clientId:    z.string().min(1),
  clientName:  z.string().min(1),
  status:      z.nativeEnum(CardStatus).optional(),
  priority:    z.nativeEnum(Priority).optional(),
  assignedToId: z.string().optional(),
})

const cardUpdateSchema = z.object({
  status:      z.nativeEnum(CardStatus).optional(),
  priority:    z.nativeEnum(Priority).optional(),
  assignedToId: z.string().nullable().optional(),
  clientName:  z.string().optional(),
})

// GET /kanban/cards?status=CONTACTED&assignedToId=&clientId=&limit=50&offset=0
router.get('/cards', async (req: AuthenticatedRequest, res) => {
  const { status, assignedToId, clientId } = req.query
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const where: any = {}

  // Vendors only see their own cards
  if (req.user!.role === Role.VENDOR) {
    where.assignedToId = req.user!.userId
  } else if (assignedToId) {
    where.assignedToId = assignedToId as string
  }

  if (status)   where.status   = status as CardStatus
  if (clientId) where.clientId = clientId as string

  const [cards, total] = await Promise.all([
    prisma.kanbanCard.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { updatedAt: 'desc' },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy:  { select: { id: true, name: true } },
        _count: { select: { notes: true, files: true } },
      },
    }),
    prisma.kanbanCard.count({ where }),
  ])

  res.json({ data: cards, total, limit, offset })
})

// POST /kanban/cards
router.post('/cards', async (req: AuthenticatedRequest, res) => {
  const body = cardCreateSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const card = await prisma.kanbanCard.create({
    data: {
      ...body.data,
      createdById:  req.user!.userId,
      assignedToId: body.data.assignedToId ?? req.user!.userId,
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy:  { select: { id: true, name: true } },
    },
  })

  await prisma.kanbanActivity.create({
    data: {
      cardId:    card.id,
      userId:    req.user!.userId,
      action:    'CREATED',
      newStatus: card.status,
    },
  })

  res.status(201).json(card)
})

// PUT /kanban/cards/:id
router.put('/cards/:id', async (req: AuthenticatedRequest, res) => {
  const body = cardUpdateSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const existing = await prisma.kanbanCard.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Card not found' })
    return
  }

  // Vendors can only update their own cards
  if (req.user!.role === Role.VENDOR && existing.assignedToId !== req.user!.userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const updated = await prisma.kanbanCard.update({
    where: { id: req.params.id },
    data:  body.data,
    include: {
      assignedTo: { select: { id: true, name: true } },
    },
  })

  if (body.data.status && body.data.status !== existing.status) {
    await prisma.kanbanActivity.create({
      data: {
        cardId:    updated.id,
        userId:    req.user!.userId,
        action:    'STATUS_CHANGED',
        oldStatus: existing.status,
        newStatus: updated.status,
      },
    })
  }

  res.json(updated)
})

// DELETE /kanban/cards/:id (manager only)
router.delete('/cards/:id', requireRole(Role.MANAGER), async (req, res) => {
  const existing = await prisma.kanbanCard.findUnique({ where: { id: req.params.id } })
  if (!existing) {
    res.status(404).json({ error: 'Card not found' })
    return
  }
  await prisma.kanbanCard.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

// ── Notes ─────────────────────────────────────────────────────────────────────

const noteSchema = z.object({ content: z.string().min(1) })

// GET /kanban/cards/:id/notes
router.get('/cards/:id/notes', async (req, res) => {
  const notes = await prisma.kanbanNote.findMany({
    where: { cardId: req.params.id },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  })
  res.json(notes)
})

// POST /kanban/cards/:id/notes
router.post('/cards/:id/notes', async (req: AuthenticatedRequest, res) => {
  const body = noteSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const card = await prisma.kanbanCard.findUnique({ where: { id: req.params.id } })
  if (!card) {
    res.status(404).json({ error: 'Card not found' })
    return
  }

  const note = await prisma.kanbanNote.create({
    data: { cardId: req.params.id, userId: req.user!.userId, content: body.data.content },
    include: { user: { select: { id: true, name: true } } },
  })

  await prisma.kanbanActivity.create({
    data: { cardId: req.params.id, userId: req.user!.userId, action: 'NOTE_ADDED' },
  })

  res.status(201).json(note)
})

// DELETE /kanban/notes/:noteId
router.delete('/notes/:noteId', async (req: AuthenticatedRequest, res) => {
  const note = await prisma.kanbanNote.findUnique({ where: { id: req.params.noteId } })
  if (!note) {
    res.status(404).json({ error: 'Note not found' })
    return
  }

  if (req.user!.role !== Role.MANAGER && note.userId !== req.user!.userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  await prisma.kanbanNote.delete({ where: { id: req.params.noteId } })
  res.status(204).send()
})

// ── Activities ────────────────────────────────────────────────────────────────

// GET /kanban/cards/:id/activities
router.get('/cards/:id/activities', async (req, res) => {
  const activities = await prisma.kanbanActivity.findMany({
    where: { cardId: req.params.id },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  })
  res.json(activities)
})

export default router
