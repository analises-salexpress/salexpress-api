"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const prisma_1 = require("../db/prisma");
const analyticsService_1 = require("../services/analyticsService");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// Returns the sum of billing for the last N full months
async function recentBillingSum(cnpj, months) {
    const rows = await (0, analyticsService_1.getClientRecentMonths)(cnpj, months);
    const now = new Date();
    const completed = rows.filter((r) => r.year < now.getFullYear() || (r.year === now.getFullYear() && r.month < now.getMonth() + 1));
    return completed.slice(-months).reduce((s, r) => s + r.billing, 0);
}
// GET /metrics/expansion
// All active expansion goals with current delta vs baseline
router.get('/expansion', async (req, res) => {
    const where = { status: 'ACTIVE' };
    if (req.user.role === client_1.Role.VENDOR)
        where.vendorId = req.user.userId;
    const goals = await prisma_1.prisma.expansionGoal.findMany({
        where,
        include: {
            vendor: { select: { id: true, name: true } },
            card: { select: { id: true, status: true, clientName: true } },
        },
        orderBy: { startDate: 'asc' },
    });
    const results = await Promise.all(goals.map(async (g) => {
        // Quarter = 3 months. Compare last 3 months vs baseline
        const currentQuarterBilling = await recentBillingSum(g.clientId, 3);
        const baselineQuarter = g.baselineAvg * 3;
        const delta = currentQuarterBilling - baselineQuarter;
        return {
            goalId: g.id,
            clientId: g.clientId,
            clientName: g.card?.clientName ?? g.clientId,
            vendor: g.vendor,
            card: g.card,
            startDate: g.startDate,
            baselineAvg: g.baselineAvg,
            baselineQuarter: Math.round(baselineQuarter * 100) / 100,
            currentQuarter: Math.round(currentQuarterBilling * 100) / 100,
            delta: Math.round(delta * 100) / 100,
            targetValue: g.targetValue,
            targetHit: g.targetValue != null && delta >= g.targetValue,
        };
    }));
    res.json(results);
});
// GET /metrics/vendor/:vendorId
router.get('/vendor/:vendorId', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (req, res) => {
    const { vendorId } = req.params;
    const vendor = await prisma_1.prisma.user.findUnique({
        where: { id: vendorId },
        select: { id: true, name: true, email: true },
    });
    if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
    }
    const [cards, goals] = await Promise.all([
        prisma_1.prisma.kanbanCard.findMany({
            where: { assignedToId: vendorId },
            select: { id: true, status: true, clientName: true, createdAt: true },
        }),
        prisma_1.prisma.expansionGoal.findMany({
            where: { vendorId },
            select: { id: true, clientId: true, baselineAvg: true, status: true, startDate: true },
        }),
    ]);
    const cardsByStatus = cards.reduce((acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1;
        return acc;
    }, {});
    let totalExpansionDelta = 0;
    const activeGoals = goals.filter((g) => g.status === 'ACTIVE');
    for (const g of activeGoals) {
        const current = await recentBillingSum(g.clientId, 3);
        totalExpansionDelta += current - g.baselineAvg * 3;
    }
    res.json({
        vendor,
        cardsByStatus,
        totalCards: cards.length,
        activeGoals: activeGoals.length,
        achievedGoals: goals.filter((g) => g.status === 'ACHIEVED').length,
        totalExpansionDelta: Math.round(totalExpansionDelta * 100) / 100,
    });
});
// GET /metrics/summary (manager view)
router.get('/summary', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (_req, res) => {
    const [activeCards, lostCards, expandedCards, activeGoals, allVendors,] = await Promise.all([
        prisma_1.prisma.kanbanCard.count({ where: { status: { not: 'LOST' } } }),
        prisma_1.prisma.kanbanCard.count({ where: { status: 'LOST' } }),
        prisma_1.prisma.kanbanCard.count({ where: { status: 'EXPANDED' } }),
        prisma_1.prisma.expansionGoal.findMany({
            where: { status: 'ACTIVE' },
            select: { clientId: true, baselineAvg: true, vendorId: true },
        }),
        prisma_1.prisma.user.findMany({
            where: { role: client_1.Role.VENDOR, active: true },
            select: { id: true, name: true },
        }),
    ]);
    // Total expansion delta across all active goals
    let totalExpansionDelta = 0;
    for (const g of activeGoals) {
        const current = await recentBillingSum(g.clientId, 3);
        totalExpansionDelta += current - g.baselineAvg * 3;
    }
    // Cards per vendor
    const cardCounts = await Promise.all(allVendors.map(async (v) => ({
        vendor: v,
        active: await prisma_1.prisma.kanbanCard.count({
            where: { assignedToId: v.id, status: { not: 'LOST' } },
        }),
    })));
    res.json({
        cards: { active: activeCards, lost: lostCards, expanded: expandedCards },
        activeGoals: activeGoals.length,
        totalExpansionDelta: Math.round(totalExpansionDelta * 100) / 100,
        vendorCards: cardCounts,
    });
});
// ── Expansion Goals CRUD ──────────────────────────────────────────────────────
const goalSchema = zod_1.z.object({
    clientId: zod_1.z.string(),
    cardId: zod_1.z.string().optional(),
    startDate: zod_1.z.string().datetime(),
    baselineAvg: zod_1.z.number().positive(),
    targetValue: zod_1.z.number().optional(),
});
// POST /metrics/goals
router.post('/goals', async (req, res) => {
    const body = goalSchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const goal = await prisma_1.prisma.expansionGoal.create({
        data: { ...body.data, vendorId: req.user.userId },
    });
    res.status(201).json(goal);
});
// PUT /metrics/goals/:id/status
router.put('/goals/:id/status', async (req, res) => {
    const { status } = req.body;
    if (!['ACTIVE', 'ACHIEVED', 'CANCELLED'].includes(status)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
    }
    const goal = await prisma_1.prisma.expansionGoal.findUnique({ where: { id: req.params.id } });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && goal.vendorId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const updated = await prisma_1.prisma.expansionGoal.update({
        where: { id: req.params.id },
        data: { status },
    });
    res.json(updated);
});
exports.default = router;
//# sourceMappingURL=metrics.js.map