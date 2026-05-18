"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const prisma_1 = require("../db/prisma");
const client_1 = require("@prisma/client");
const analyticsService_1 = require("../services/analyticsService");
const deliveryService_1 = require("../services/deliveryService");
const exceljs_1 = __importDefault(require("exceljs"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// ── Cards ─────────────────────────────────────────────────────────────────────
const cardCreateSchema = zod_1.z.object({
    clientId: zod_1.z.string().min(1),
    clientName: zod_1.z.string().min(1),
    status: zod_1.z.nativeEnum(client_1.CardStatus).optional(),
    priority: zod_1.z.nativeEnum(client_1.Priority).optional(),
    assignedToId: zod_1.z.string().optional(),
    manualExpansionPotential: zod_1.z.number().nullable().optional(),
    expansionForecast: zod_1.z.number().nullable().optional(),
});
const cardUpdateSchema = zod_1.z.object({
    status: zod_1.z.nativeEnum(client_1.CardStatus).optional(),
    priority: zod_1.z.nativeEnum(client_1.Priority).optional(),
    assignedToId: zod_1.z.string().nullable().optional(),
    clientName: zod_1.z.string().optional(),
    manualExpansionPotential: zod_1.z.number().nullable().optional(),
    expansionForecast: zod_1.z.number().nullable().optional(),
    currentCarrier: zod_1.z.string().nullable().optional(),
});
// GET /kanban/cards?status=CONTACTED&assignedToId=&clientId=&limit=50&offset=0
router.get('/cards', async (req, res) => {
    const { status, assignedToId, clientId } = req.query;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const where = {};
    // Vendors only see their own cards
    if (req.user.role === client_1.Role.VENDOR) {
        where.assignedToId = req.user.userId;
    }
    else if (assignedToId) {
        where.assignedToId = assignedToId;
    }
    if (status)
        where.status = status;
    if (clientId)
        where.clientId = clientId;
    const [cards, total] = await Promise.all([
        prisma_1.prisma.kanbanCard.findMany({
            where,
            take: limit,
            skip: offset,
            orderBy: { updatedAt: 'desc' },
            include: {
                assignedTo: { select: { id: true, name: true, email: true } },
                createdBy: { select: { id: true, name: true } },
                additionalCnpjs: { select: { id: true, cnpj: true, name: true } },
                _count: { select: { notes: true, files: true } },
            },
        }),
        prisma_1.prisma.kanbanCard.count({ where }),
    ]);
    res.json({ data: cards, total, limit, offset });
});
// POST /kanban/cards
router.post('/cards', async (req, res) => {
    const body = cardCreateSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const card = await prisma_1.prisma.kanbanCard.create({
        data: {
            ...body.data,
            createdById: req.user.userId,
            assignedToId: body.data.assignedToId ?? req.user.userId,
        },
        include: {
            assignedTo: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
        },
    });
    await prisma_1.prisma.kanbanActivity.create({
        data: {
            cardId: card.id,
            userId: req.user.userId,
            action: 'CREATED',
            newStatus: card.status,
        },
    });
    res.status(201).json(card);
});
// PUT /kanban/cards/:id
router.put('/cards/:id', async (req, res) => {
    const body = cardUpdateSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const existing = await prisma_1.prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!existing) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    // Vendors can only update their own cards
    if (req.user.role === client_1.Role.VENDOR && existing.assignedToId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    // Exige evidência antes de mover para EXPANDED
    if (body.data.status === 'EXPANDED' && existing.status !== 'EXPANDED') {
        const evidenceCount = await prisma_1.prisma.file.count({
            where: { cardId: req.params.id, isEvidence: true },
        });
        if (evidenceCount === 0) {
            res.status(422).json({
                error: 'Anexe uma evidência do trabalho antes de marcar como Expandido.',
                code: 'EVIDENCE_REQUIRED',
                cardId: req.params.id,
            });
            return;
        }
    }
    const updated = await prisma_1.prisma.kanbanCard.update({
        where: { id: req.params.id },
        data: body.data,
        include: {
            assignedTo: { select: { id: true, name: true } },
        },
    });
    if (body.data.status && body.data.status !== existing.status) {
        await prisma_1.prisma.kanbanActivity.create({
            data: {
                cardId: updated.id,
                userId: req.user.userId,
                action: 'STATUS_CHANGED',
                oldStatus: existing.status,
                newStatus: updated.status,
            },
        });
        if (body.data.status === 'EXPANDED') {
            const alreadyHasGoal = await prisma_1.prisma.expansionGoal.findFirst({ where: { cardId: updated.id } });
            if (!alreadyHasGoal) {
                const now = new Date();
                const additional = await prisma_1.prisma.cardAdditionalCnpj.findMany({
                    where: { cardId: updated.id },
                    select: { cnpj: true },
                });
                const allCnpjs = [updated.clientId, ...additional.map((a) => a.cnpj)];
                const rows = await (0, analyticsService_1.aggregateRecentBilling)(allCnpjs, 4);
                const completed = rows
                    .filter((r) => r.year < now.getFullYear() || (r.year === now.getFullYear() && r.month < now.getMonth() + 1))
                    .slice(-3);
                const baselineAvg = completed.length > 0
                    ? Math.round((completed.reduce((s, r) => s + r.billing, 0) / 3) * 100) / 100
                    : 0;
                await prisma_1.prisma.expansionGoal.create({
                    data: {
                        clientId: updated.clientId,
                        vendorId: updated.assignedToId ?? req.user.userId,
                        cardId: updated.id,
                        startDate: now,
                        baselineAvg,
                        status: 'ACTIVE',
                    },
                });
            }
        }
    }
    res.json(updated);
});
// DELETE /kanban/cards/:id (manager only)
router.delete('/cards/:id', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (req, res) => {
    const existing = await prisma_1.prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!existing) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    await prisma_1.prisma.kanbanCard.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
// ── Additional CNPJs ──────────────────────────────────────────────────────────
// GET /kanban/cards/:id/cnpjs
router.get('/cards/:id/cnpjs', async (req, res) => {
    const card = await prisma_1.prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    const cnpjs = await prisma_1.prisma.cardAdditionalCnpj.findMany({
        where: { cardId: req.params.id },
        orderBy: { createdAt: 'asc' },
    });
    res.json(cnpjs);
});
// POST /kanban/cards/:id/cnpjs
router.post('/cards/:id/cnpjs', async (req, res) => {
    const schema = zod_1.z.object({ cnpj: zod_1.z.string().min(1), name: zod_1.z.string().min(1) });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const card = await prisma_1.prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && card.assignedToId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    if (body.data.cnpj === card.clientId) {
        res.status(400).json({ error: 'Este CNPJ já é o CNPJ principal do card' });
        return;
    }
    try {
        const additional = await prisma_1.prisma.cardAdditionalCnpj.create({
            data: { cardId: req.params.id, cnpj: body.data.cnpj, name: body.data.name },
        });
        res.status(201).json(additional);
    }
    catch {
        res.status(409).json({ error: 'CNPJ já vinculado a este card' });
    }
});
// DELETE /kanban/cards/:id/cnpjs/:cnpj
router.delete('/cards/:id/cnpjs/:cnpj', async (req, res) => {
    const card = await prisma_1.prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && card.assignedToId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    await prisma_1.prisma.cardAdditionalCnpj.deleteMany({
        where: { cardId: req.params.id, cnpj: req.params.cnpj },
    });
    res.status(204).send();
});
// ── Notes ─────────────────────────────────────────────────────────────────────
const noteSchema = zod_1.z.object({ content: zod_1.z.string().min(1) });
// GET /kanban/cards/:id/notes
router.get('/cards/:id/notes', async (req, res) => {
    const notes = await prisma_1.prisma.kanbanNote.findMany({
        where: { cardId: req.params.id },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
    });
    res.json(notes);
});
// POST /kanban/cards/:id/notes
router.post('/cards/:id/notes', async (req, res) => {
    const body = noteSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const card = await prisma_1.prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    const note = await prisma_1.prisma.kanbanNote.create({
        data: { cardId: req.params.id, userId: req.user.userId, content: body.data.content },
        include: { user: { select: { id: true, name: true } } },
    });
    await prisma_1.prisma.kanbanActivity.create({
        data: { cardId: req.params.id, userId: req.user.userId, action: 'NOTE_ADDED' },
    });
    res.status(201).json(note);
});
// DELETE /kanban/notes/:noteId
router.delete('/notes/:noteId', async (req, res) => {
    const note = await prisma_1.prisma.kanbanNote.findUnique({ where: { id: req.params.noteId } });
    if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
    }
    if (req.user.role !== client_1.Role.MANAGER && note.userId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    await prisma_1.prisma.kanbanNote.delete({ where: { id: req.params.noteId } });
    res.status(204).send();
});
// ── Apresentação de Expansão ──────────────────────────────────────────────────
async function getCardCnpjs(cardId) {
    const card = await prisma_1.prisma.kanbanCard.findUnique({
        where: { id: cardId },
        include: { additionalCnpjs: { select: { cnpj: true } } },
    });
    if (!card)
        return null;
    return {
        cnpjs: [card.clientId, ...card.additionalCnpjs.map((a) => a.cnpj)],
        clientName: card.clientName,
    };
}
// GET /kanban/cards/:id/expansion-presentation
router.get('/cards/:id/expansion-presentation', async (req, res) => {
    const cardData = await getCardCnpjs(req.params.id);
    if (!cardData) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    const goal = await prisma_1.prisma.expansionGoal.findFirst({
        where: { cardId: req.params.id, status: 'ACTIVE' },
        orderBy: { startDate: 'asc' },
    });
    // Default: 6 months back if no goal
    const startDate = goal?.startDate ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const [weekly, monthly] = await Promise.all([
        (0, deliveryService_1.getExpansionPresentationWeekly)(cardData.cnpjs, startDate),
        (0, deliveryService_1.getExpansionPresentationMonthly)(cardData.cnpjs, startDate),
    ]);
    res.json({
        clientName: cardData.clientName,
        cnpjs: cardData.cnpjs,
        startDate: startDate.toISOString(),
        baselineAvg: goal?.baselineAvg ?? null,
        weekly,
        monthly,
    });
});
// GET /kanban/cards/:id/expansion-presentation/export
router.get('/cards/:id/expansion-presentation/export', async (req, res) => {
    const cardData = await getCardCnpjs(req.params.id);
    if (!cardData) {
        res.status(404).json({ error: 'Card not found' });
        return;
    }
    const goal = await prisma_1.prisma.expansionGoal.findFirst({
        where: { cardId: req.params.id, status: 'ACTIVE' },
        orderBy: { startDate: 'asc' },
    });
    const startDate = goal?.startDate ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const baselineAvg = goal?.baselineAvg ?? null;
    const [weekly, monthly] = await Promise.all([
        (0, deliveryService_1.getExpansionPresentationWeekly)(cardData.cnpjs, startDate),
        (0, deliveryService_1.getExpansionPresentationMonthly)(cardData.cnpjs, startDate),
    ]);
    const wb = new exceljs_1.default.Workbook();
    wb.creator = 'Sal Express';
    wb.created = new Date();
    // ── Sheet 1: Semana a Semana ──
    const ws1 = wb.addWorksheet('Semana a Semana');
    ws1.columns = [
        { header: 'Semana', key: 'weekLabel', width: 14 },
        { header: 'Notas', key: 'totalNotas', width: 10 },
        { header: 'Valor da Nota (R$)', key: 'valorMercadoria', width: 18 },
        { header: 'Frete (R$)', key: 'valorFrete', width: 16 },
        { header: '% da Nota', key: 'pctNota', width: 12 },
    ];
    ws1.getRow(1).font = { bold: true };
    for (const r of weekly) {
        ws1.addRow({
            weekLabel: r.weekLabel,
            totalNotas: r.totalNotas,
            valorMercadoria: r.valorMercadoria,
            valorFrete: r.valorFrete,
            pctNota: r.pctNota !== null ? `${r.pctNota.toFixed(2)}%` : '-',
        });
    }
    // ── Sheet 2: Mês a Mês ──
    const ws2 = wb.addWorksheet('Mês a Mês');
    ws2.columns = [
        { header: 'Mês', key: 'monthLabel', width: 12 },
        { header: 'Notas', key: 'totalNotas', width: 10 },
        { header: 'Valor da Nota (R$)', key: 'valorMercadoria', width: 18 },
        { header: 'Frete (R$)', key: 'valorFrete', width: 16 },
        { header: '% da Nota', key: 'pctNota', width: 12 },
        { header: 'Baseline (R$)', key: 'baseline', width: 16 },
        { header: 'Δ vs Baseline (R$)', key: 'delta', width: 18 },
    ];
    ws2.getRow(1).font = { bold: true };
    for (const r of monthly) {
        const delta = baselineAvg !== null ? Math.round((r.valorFrete - baselineAvg) * 100) / 100 : null;
        ws2.addRow({
            monthLabel: r.monthLabel + (r.isCurrentMonth ? ' *' : ''),
            totalNotas: r.totalNotas,
            valorMercadoria: r.valorMercadoria,
            valorFrete: r.valorFrete,
            pctNota: r.pctNota !== null ? `${r.pctNota.toFixed(2)}%` : '-',
            baseline: baselineAvg ?? '-',
            delta: delta !== null ? delta : '-',
        });
    }
    if (monthly.some((m) => m.isCurrentMonth)) {
        ws2.addRow({ monthLabel: '* Mês em curso (parcial)' });
    }
    const safeName = cardData.clientName.replace(/[^a-zA-Z0-9 ]/g, '').trim().substring(0, 30);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="expansao_${safeName}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
});
// ── Activities ────────────────────────────────────────────────────────────────
// GET /kanban/cards/:id/activities
router.get('/cards/:id/activities', async (req, res) => {
    const activities = await prisma_1.prisma.kanbanActivity.findMany({
        where: { cardId: req.params.id },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
    });
    res.json(activities);
});
exports.default = router;
//# sourceMappingURL=kanban.js.map