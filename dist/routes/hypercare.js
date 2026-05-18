"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const prisma_1 = require("../db/prisma");
const client_1 = require("@prisma/client");
const deliveryService_1 = require("../services/deliveryService");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// ── Diagnóstico de performance (dev only) ────────────────────────────────────
// GET /hypercare/diag/performance/:cnpj
router.get('/diag/performance/:cnpj', async (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    try {
        const p30 = await (0, deliveryService_1.getDeliveryPerformanceBatch)([cnpj], 30);
        const p90 = await (0, deliveryService_1.getDeliveryPerformanceBatch)([cnpj], 90);
        res.json({ cnpj, last30days: p30[cnpj] ?? null, last90days: p90[cnpj] ?? null });
    }
    catch (e) {
        res.status(500).json({ error: e?.message ?? String(e), stack: e?.stack?.split('\n').slice(0, 5) });
    }
});
// ── CNPJ Lookup (busca no BI antes de cadastrar) ──────────────────────────────
// GET /hypercare/lookup?cnpj=12345678000195
router.get('/lookup', async (req, res) => {
    const cnpj = String(req.query.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length < 8) {
        res.status(400).json({ error: 'CNPJ inválido' });
        return;
    }
    const client = await prisma_1.prisma.biClient.findUnique({ where: { cnpj } });
    if (!client) {
        res.status(404).json({ error: 'CNPJ não encontrado no banco de dados' });
        return;
    }
    // Check if already enrolled
    const enrolled = await prisma_1.prisma.hypercareClient.findUnique({ where: { cnpj } });
    res.json({
        cnpj: client.cnpj,
        clientName: client.name,
        groupedName: client.groupedName,
        city: client.city,
        state: client.state,
        segment: client.segment,
        alreadyEnrolled: !!enrolled,
        enrolledId: enrolled?.id ?? null,
    });
});
// ── Clients ───────────────────────────────────────────────────────────────────
const enrollSchema = zod_1.z.object({
    cnpj: zod_1.z.string().min(1),
    clientName: zod_1.z.string().min(1),
    notes: zod_1.z.string().optional(),
});
// GET /hypercare/clients
router.get('/clients', async (req, res) => {
    const { status } = req.query;
    const where = {};
    if (status)
        where.status = status;
    const clients = await prisma_1.prisma.hypercareClient.findMany({
        where,
        orderBy: { enrolledAt: 'desc' },
        include: {
            enrolledBy: { select: { id: true, name: true } },
            additionalCnpjs: { select: { id: true, cnpj: true, name: true } },
            _count: { select: { touchpoints: true, meetings: true } },
        },
    });
    // Collect all CNPJs for batch BI query and city lookup
    const allCnpjsPerClient = clients.map((c) => [c.cnpj, ...c.additionalCnpjs.map((a) => a.cnpj)]);
    const uniqueCnpjs = [...new Set(allCnpjsPerClient.flat())];
    const [perfMap, biClients] = await Promise.all([
        (0, deliveryService_1.getDeliveryPerformanceBatch)(uniqueCnpjs, 90),
        prisma_1.prisma.biClient.findMany({
            where: { cnpj: { in: clients.map((c) => c.cnpj) } },
            select: { cnpj: true, city: true, state: true },
        }),
    ]);
    const biMap = Object.fromEntries(biClients.map((b) => [b.cnpj, b]));
    const data = clients.map((c) => {
        const perf = perfMap[c.cnpj] ?? { performancePct: null, semaforo: 'no_data' };
        const bi = biMap[c.cnpj];
        return {
            ...c,
            performance: perf,
            performancePct: perf.performancePct,
            semaforo: perf.semaforo,
            city: bi?.city ?? null,
            state: bi?.state ?? null,
        };
    });
    res.json(data);
});
// POST /hypercare/clients
router.post('/clients', async (req, res) => {
    const body = enrollSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const cnpj = body.data.cnpj.replace(/\D/g, '');
    const existing = await prisma_1.prisma.hypercareClient.findUnique({ where: { cnpj } });
    if (existing) {
        res.status(409).json({ error: 'Cliente já está no programa HyperCare', clientId: existing.id });
        return;
    }
    const client = await prisma_1.prisma.hypercareClient.create({
        data: {
            cnpj,
            clientName: body.data.clientName,
            notes: body.data.notes ?? null,
            enrolledById: req.user.userId,
        },
        include: {
            enrolledBy: { select: { id: true, name: true } },
            additionalCnpjs: true,
        },
    });
    res.status(201).json(client);
});
// GET /hypercare/clients/:id
router.get('/clients/:id', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({
        where: { id: req.params.id },
        include: {
            enrolledBy: { select: { id: true, name: true } },
            additionalCnpjs: { select: { id: true, cnpj: true, name: true } },
            _count: { select: { touchpoints: true, meetings: true } },
        },
    });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const cnpjs = [client.cnpj, ...client.additionalCnpjs.map((a) => a.cnpj)];
    const [perfMap, biData] = await Promise.all([
        (0, deliveryService_1.getDeliveryPerformanceBatch)(cnpjs),
        prisma_1.prisma.biClient.findUnique({
            where: { cnpj: client.cnpj },
            select: { city: true, state: true, segment: true, curve: true },
        }),
    ]);
    const perf = perfMap[client.cnpj] ?? { performancePct: null, semaforo: 'no_data' };
    res.json({
        ...client,
        performance: perf,
        performancePct: perf.performancePct,
        semaforo: perf.semaforo,
        city: biData?.city ?? null,
        state: biData?.state ?? null,
        segment: biData?.segment ?? null,
    });
});
// PUT /hypercare/clients/:id
router.put('/clients/:id', async (req, res) => {
    const schema = zod_1.z.object({
        status: zod_1.z.nativeEnum(client_1.HypercareStatus).optional(),
        clientName: zod_1.z.string().optional(),
        notes: zod_1.z.string().nullable().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const updated = await prisma_1.prisma.hypercareClient.update({
        where: { id: req.params.id },
        data: body.data,
        include: {
            enrolledBy: { select: { id: true, name: true } },
            additionalCnpjs: true,
        },
    });
    res.json(updated);
});
// DELETE /hypercare/clients/:id
router.delete('/clients/:id', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await prisma_1.prisma.hypercareClient.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
// ── Additional CNPJs ──────────────────────────────────────────────────────────
const cnpjAddSchema = zod_1.z.object({ cnpj: zod_1.z.string().min(1), name: zod_1.z.string().min(1) });
// GET /hypercare/clients/:id/cnpjs
router.get('/clients/:id/cnpjs', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const cnpjs = await prisma_1.prisma.hypercareClientCnpj.findMany({
        where: { clientId: req.params.id },
        orderBy: { createdAt: 'asc' },
    });
    res.json(cnpjs);
});
// POST /hypercare/clients/:id/cnpjs
router.post('/clients/:id/cnpjs', async (req, res) => {
    const body = cnpjAddSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const cnpj = body.data.cnpj.replace(/\D/g, '');
    if (cnpj === client.cnpj) {
        res.status(400).json({ error: 'Este CNPJ já é o principal do cliente' });
        return;
    }
    try {
        const added = await prisma_1.prisma.hypercareClientCnpj.create({
            data: { clientId: req.params.id, cnpj, name: body.data.name },
        });
        res.status(201).json(added);
    }
    catch {
        res.status(409).json({ error: 'CNPJ já vinculado a este cliente' });
    }
});
// DELETE /hypercare/clients/:id/cnpjs/:cnpj
router.delete('/clients/:id/cnpjs/:cnpj', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await prisma_1.prisma.hypercareClientCnpj.deleteMany({
        where: { clientId: req.params.id, cnpj: req.params.cnpj.replace(/\D/g, '') },
    });
    res.status(204).send();
});
// ── Performance (BI) ──────────────────────────────────────────────────────────
async function getClientAllCnpjs(clientId) {
    const client = await prisma_1.prisma.hypercareClient.findUnique({
        where: { id: clientId },
        include: { additionalCnpjs: { select: { cnpj: true } } },
    });
    if (!client)
        return [];
    return [client.cnpj, ...client.additionalCnpjs.map((a) => a.cnpj)];
}
// GET /hypercare/clients/:id/performance?days=30
// GET /hypercare/clients/:id/performance?filterYear=2025&filterWeek=20
// GET /hypercare/clients/:id/performance?filterYear=2025&filterMonth=5
router.get('/clients/:id/performance', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({
        where: { id: req.params.id },
        include: { additionalCnpjs: { select: { cnpj: true } } },
    });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const cnpjs = [client.cnpj, ...client.additionalCnpjs.map((a) => a.cnpj)];
    const filterYear = req.query.filterYear ? Number(req.query.filterYear) : null;
    const filterWeek = req.query.filterWeek ? Number(req.query.filterWeek) : null;
    const filterMonth = req.query.filterMonth ? Number(req.query.filterMonth) : null;
    const MONTH_NAMES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    let byFilial;
    let filterLabel = null;
    let overallSource;
    if (filterYear && filterWeek) {
        ;
        [byFilial, overallSource] = await Promise.all([
            (0, deliveryService_1.getDeliveryFilialByWeek)(cnpjs, filterYear, filterWeek),
            (0, deliveryService_1.getPerfOverallByWeek)(cnpjs, filterYear, filterWeek),
        ]);
        filterLabel = `S${String(filterWeek).padStart(2, '0')}/${filterYear}`;
    }
    else if (filterYear && filterMonth) {
        ;
        [byFilial, overallSource] = await Promise.all([
            (0, deliveryService_1.getDeliveryFilialByMonth)(cnpjs, filterYear, filterMonth),
            (0, deliveryService_1.getPerfOverallByMonth)(cnpjs, filterYear, filterMonth),
        ]);
        filterLabel = `${MONTH_NAMES_PT[filterMonth - 1]}/${filterYear}`;
    }
    else {
        ;
        [byFilial, overallSource] = await Promise.all([
            (0, deliveryService_1.getDeliveryPerformanceByFilial)(cnpjs),
            (0, deliveryService_1.getPerfOverall)(cnpjs),
        ]);
    }
    const [weekly, monthly, availablePeriods] = await Promise.all([
        (0, deliveryService_1.getDeliveryPerformanceWeekly)(cnpjs, 12),
        (0, deliveryService_1.getDeliveryPerformanceMonthly)(cnpjs, 18),
        (0, deliveryService_1.getAvailableFilialPeriods)(cnpjs),
    ]);
    const overallPct = overallSource.performancePct;
    res.json({
        clientId: client.id,
        cnpj: client.cnpj,
        clientName: client.clientName,
        cnpjs,
        filterLabel,
        overall: {
            performancePct: overallPct,
            semaforo: overallPct === null ? 'no_data'
                : overallPct >= 95 ? 'green'
                    : overallPct >= 90 ? 'yellow'
                        : overallPct >= 85 ? 'red'
                            : 'critical',
            totalEntregas: overallSource.totalEntregas,
            noPrazo: overallSource.noPrazo,
            foraPrazo: overallSource.totalEntregas - overallSource.noPrazo,
        },
        byFilial,
        weekly,
        monthly,
        availableWeeks: availablePeriods.weeks,
        availableMonths: availablePeriods.months,
    });
});
// ── Touchpoints ───────────────────────────────────────────────────────────────
const touchpointSchema = zod_1.z.object({
    type: zod_1.z.nativeEnum(client_1.TouchpointType),
    summary: zod_1.z.string().min(1),
    outcome: zod_1.z.nativeEnum(client_1.TouchpointOutcome),
    occurredAt: zod_1.z.string().datetime().optional(),
});
router.get('/clients/:id/touchpoints', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const touchpoints = await prisma_1.prisma.hypercareTouchpoint.findMany({
        where: { clientId: req.params.id },
        orderBy: { occurredAt: 'desc' },
        include: { user: { select: { id: true, name: true } } },
    });
    res.json(touchpoints);
});
router.post('/clients/:id/touchpoints', async (req, res) => {
    const body = touchpointSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const tp = await prisma_1.prisma.hypercareTouchpoint.create({
        data: {
            clientId: req.params.id,
            userId: req.user.userId,
            type: body.data.type,
            summary: body.data.summary,
            outcome: body.data.outcome,
            occurredAt: body.data.occurredAt ? new Date(body.data.occurredAt) : new Date(),
        },
        include: { user: { select: { id: true, name: true } } },
    });
    res.status(201).json(tp);
});
router.delete('/touchpoints/:id', async (req, res) => {
    const tp = await prisma_1.prisma.hypercareTouchpoint.findUnique({ where: { id: req.params.id } });
    if (!tp) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    if (req.user.role !== client_1.Role.MANAGER && tp.userId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    await prisma_1.prisma.hypercareTouchpoint.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
// ── GGR Meetings ──────────────────────────────────────────────────────────────
const meetingSchema = zod_1.z.object({
    meetingDate: zod_1.z.string().datetime(),
    agenda: zod_1.z.string().optional(),
    minutes: zod_1.z.string().optional(),
});
const meetingUpdateSchema = zod_1.z.object({
    agenda: zod_1.z.string().nullable().optional(),
    minutes: zod_1.z.string().nullable().optional(),
});
router.get('/clients/:id/meetings', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const meetings = await prisma_1.prisma.hypercareMeeting.findMany({
        where: { clientId: req.params.id },
        orderBy: { meetingDate: 'desc' },
        include: {
            user: { select: { id: true, name: true } },
            actionItems: { orderBy: { createdAt: 'asc' } },
        },
    });
    res.json(meetings);
});
router.post('/clients/:id/meetings', async (req, res) => {
    const body = meetingSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const meeting = await prisma_1.prisma.hypercareMeeting.create({
        data: {
            clientId: req.params.id,
            userId: req.user.userId,
            meetingDate: new Date(body.data.meetingDate),
            agenda: body.data.agenda ?? null,
            minutes: body.data.minutes ?? null,
        },
        include: { user: { select: { id: true, name: true } }, actionItems: true },
    });
    res.status(201).json(meeting);
});
router.put('/meetings/:id', async (req, res) => {
    const body = meetingUpdateSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const meeting = await prisma_1.prisma.hypercareMeeting.findUnique({ where: { id: req.params.id } });
    if (!meeting) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    if (req.user.role !== client_1.Role.MANAGER && meeting.userId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const updated = await prisma_1.prisma.hypercareMeeting.update({
        where: { id: req.params.id },
        data: body.data,
        include: { user: { select: { id: true, name: true } }, actionItems: true },
    });
    res.json(updated);
});
// ── Action Items ──────────────────────────────────────────────────────────────
const actionItemSchema = zod_1.z.object({
    description: zod_1.z.string().min(1),
    responsible: zod_1.z.string().min(1),
    dueDate: zod_1.z.string().datetime().nullable().optional(),
});
router.get('/action-items', async (req, res) => {
    const { status, clientId } = req.query;
    const where = {};
    if (status)
        where.status = status;
    if (clientId)
        where.meeting = { clientId: clientId };
    const items = await prisma_1.prisma.hypercareActionItem.findMany({
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
    });
    const now = new Date();
    const enriched = items.map((item) => ({
        ...item,
        isOverdue: item.status === 'OPEN' && item.dueDate !== null && item.dueDate < now,
    }));
    res.json(enriched);
});
router.post('/meetings/:id/action-items', async (req, res) => {
    const body = actionItemSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const meeting = await prisma_1.prisma.hypercareMeeting.findUnique({ where: { id: req.params.id } });
    if (!meeting) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const item = await prisma_1.prisma.hypercareActionItem.create({
        data: {
            meetingId: req.params.id,
            description: body.data.description,
            responsible: body.data.responsible,
            dueDate: body.data.dueDate ? new Date(body.data.dueDate) : null,
        },
    });
    res.status(201).json(item);
});
router.put('/action-items/:id', async (req, res) => {
    const schema = zod_1.z.object({
        status: zod_1.z.nativeEnum(client_1.ActionItemStatus).optional(),
        description: zod_1.z.string().optional(),
        responsible: zod_1.z.string().optional(),
        dueDate: zod_1.z.string().datetime().nullable().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const item = await prisma_1.prisma.hypercareActionItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const updated = await prisma_1.prisma.hypercareActionItem.update({
        where: { id: req.params.id },
        data: {
            ...body.data,
            dueDate: body.data.dueDate !== undefined
                ? (body.data.dueDate ? new Date(body.data.dueDate) : null)
                : undefined,
        },
    });
    res.json(updated);
});
router.delete('/action-items/:id', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (req, res) => {
    const item = await prisma_1.prisma.hypercareActionItem.findUnique({ where: { id: req.params.id } });
    if (!item) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await prisma_1.prisma.hypercareActionItem.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
// ── Filial Flags ──────────────────────────────────────────────────────────────
// GET /hypercare/clients/:id/filial-flags
// Retorna filiais flagadas do cliente, enriquecidas com dados de performance atual
router.get('/clients/:id/filial-flags', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({
        where: { id: req.params.id },
        include: { additionalCnpjs: { select: { cnpj: true } } },
    });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const flags = await prisma_1.prisma.hypercareFilialFlag.findMany({
        where: { clientId: req.params.id },
        include: {
            flaggedBy: { select: { id: true, name: true } },
            actions: {
                orderBy: { createdAt: 'asc' },
                include: { createdBy: { select: { id: true, name: true } } },
            },
        },
        orderBy: { createdAt: 'asc' },
    });
    const allCnpjs = [client.cnpj, ...client.additionalCnpjs.map((a) => a.cnpj)];
    const filialPerf = await prisma_1.prisma.biDeliveryFilial.findMany({
        where: { cnpj: { in: allCnpjs } },
    });
    const perfMap = new Map(filialPerf.map((f) => [f.filial, f]));
    const enriched = await Promise.all(flags.map(async (flag) => {
        const filialData = perfMap.get(flag.filial) ?? null;
        const weeklyPerf = await (0, deliveryService_1.getDeliveryFilialWeekly)(allCnpjs, flag.filial, 12);
        return { ...flag, filialData, weeklyPerf };
    }));
    res.json(enriched);
});
// POST /hypercare/clients/:id/filial-flags
router.post('/clients/:id/filial-flags', async (req, res) => {
    const schema = zod_1.z.object({
        filial: zod_1.z.string().min(1),
        note: zod_1.z.string().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    try {
        const flag = await prisma_1.prisma.hypercareFilialFlag.create({
            data: {
                clientId: req.params.id,
                filial: body.data.filial,
                note: body.data.note ?? null,
                flaggedById: req.user.userId,
            },
            include: {
                flaggedBy: { select: { id: true, name: true } },
                actions: true,
            },
        });
        res.status(201).json(flag);
    }
    catch {
        res.status(409).json({ error: 'Filial já está flagada para este cliente' });
    }
});
// DELETE /hypercare/clients/:id/filial-flags/:filial
router.delete('/clients/:id/filial-flags/:filial', async (req, res) => {
    const client = await prisma_1.prisma.hypercareClient.findUnique({ where: { id: req.params.id } });
    if (!client) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await prisma_1.prisma.hypercareFilialFlag.deleteMany({
        where: { clientId: req.params.id, filial: decodeURIComponent(req.params.filial) },
    });
    res.status(204).send();
});
// ── Filial Actions ─────────────────────────────────────────────────────────────
const filialActionSchema = zod_1.z.object({
    description: zod_1.z.string().min(1),
    responsible: zod_1.z.string().min(1),
    dueDate: zod_1.z.string().datetime().nullable().optional(),
});
// POST /hypercare/filial-flags/:flagId/actions
router.post('/filial-flags/:flagId/actions', async (req, res) => {
    const body = filialActionSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const flag = await prisma_1.prisma.hypercareFilialFlag.findUnique({ where: { id: req.params.flagId } });
    if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
    }
    const action = await prisma_1.prisma.hypercareFilialAction.create({
        data: {
            flagId: req.params.flagId,
            description: body.data.description,
            responsible: body.data.responsible,
            dueDate: body.data.dueDate ? new Date(body.data.dueDate) : null,
            createdById: req.user.userId,
        },
        include: { createdBy: { select: { id: true, name: true } } },
    });
    res.status(201).json(action);
});
// PUT /hypercare/filial-actions/:id
router.put('/filial-actions/:id', async (req, res) => {
    const schema = zod_1.z.object({
        status: zod_1.z.nativeEnum(client_1.ActionItemStatus).optional(),
        description: zod_1.z.string().optional(),
        responsible: zod_1.z.string().optional(),
        dueDate: zod_1.z.string().datetime().nullable().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const action = await prisma_1.prisma.hypercareFilialAction.findUnique({ where: { id: req.params.id } });
    if (!action) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const updated = await prisma_1.prisma.hypercareFilialAction.update({
        where: { id: req.params.id },
        data: {
            ...body.data,
            dueDate: body.data.dueDate !== undefined
                ? (body.data.dueDate ? new Date(body.data.dueDate) : null)
                : undefined,
        },
        include: { createdBy: { select: { id: true, name: true } } },
    });
    res.json(updated);
});
// DELETE /hypercare/filial-actions/:id
router.delete('/filial-actions/:id', async (req, res) => {
    const action = await prisma_1.prisma.hypercareFilialAction.findUnique({ where: { id: req.params.id } });
    if (!action) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await prisma_1.prisma.hypercareFilialAction.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
    const [activeClients, openActions] = await Promise.all([
        prisma_1.prisma.hypercareClient.findMany({
            where: { status: 'ACTIVE' },
            include: {
                enrolledBy: { select: { id: true, name: true } },
                additionalCnpjs: { select: { cnpj: true } },
                _count: { select: { touchpoints: true, meetings: true } },
            },
        }),
        prisma_1.prisma.hypercareActionItem.count({ where: { status: 'OPEN' } }),
    ]);
    // Aggregate all CNPJs for batch query
    const allUniqueCnpjs = [
        ...new Set(activeClients.flatMap((c) => [c.cnpj, ...c.additionalCnpjs.map((a) => a.cnpj)])),
    ];
    let perfMap = {};
    try {
        perfMap = await (0, deliveryService_1.getDeliveryPerformanceBatch)(allUniqueCnpjs, 30);
    }
    catch {
        // BI unavailable — dashboard still returns without performance data
    }
    const clients = activeClients.map((c) => {
        const perf = perfMap[c.cnpj] ?? { performancePct: null, semaforo: 'no_data' };
        return {
            ...c,
            performance: perf,
            performancePct: perf.performancePct,
            semaforo: perf.semaforo,
        };
    });
    const summary = {
        totalActive: activeClients.length,
        greenCount: clients.filter((c) => c.performance.semaforo === 'green').length,
        yellowCount: clients.filter((c) => c.performance.semaforo === 'yellow').length,
        redCount: clients.filter((c) => c.performance.semaforo === 'red').length,
        criticalCount: clients.filter((c) => c.performance.semaforo === 'critical').length,
        openActionItems: openActions,
    };
    res.json({ summary, clients });
});
exports.default = router;
//# sourceMappingURL=hypercare.js.map