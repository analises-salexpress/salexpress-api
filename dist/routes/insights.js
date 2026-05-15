"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const expansionService_1 = require("../services/expansionService");
const analyticsService_1 = require("../services/analyticsService");
const prisma_1 = require("../db/prisma");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /insights/opportunities?limit=50&offset=0&region=...&segment=...&city=...&tab=new|in_progress
router.get('/opportunities', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const region = req.query.region ? String(req.query.region) : undefined;
    const segment = req.query.segment ? String(req.query.segment) : undefined;
    const city = req.query.city ? String(req.query.city) : undefined;
    const tab = req.query.tab === 'in_progress' ? 'in_progress' : 'new';
    try {
        const { opportunities, total } = tab === 'in_progress'
            ? await (0, expansionService_1.getInProgressOpportunities)(limit, offset)
            : await (0, expansionService_1.getOpportunities)(limit, offset, region, segment, city);
        res.json({ data: opportunities, total, limit, offset, tab });
    }
    catch (err) {
        console.error('[opportunities] error:', err?.message, err?.stack?.split('\n')[1]);
        res.status(500).json({ error: 'Erro ao calcular oportunidades', detail: err?.message });
    }
});
// GET /insights/churn?limit=50&offset=0&segment=Auto+Peças&city=Vitoria&type=CHURN
router.get('/churn', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const segment = req.query.segment ? String(req.query.segment) : undefined;
    const city = req.query.city ? String(req.query.city) : undefined;
    const type = req.query.type === 'CHURN' || req.query.type === 'POSSIVEL_CHURN'
        ? req.query.type
        : undefined;
    try {
        const { churns, total } = await (0, expansionService_1.getChurnAnalysis)(limit, offset, segment, city, type);
        res.json({ data: churns, total, limit, offset });
    }
    catch (err) {
        console.error('[churn] error:', err?.message, err?.stack?.split('\n')[1]);
        res.status(500).json({ error: 'Erro ao calcular churns', detail: err?.message });
    }
});
// POST /insights/opportunities/:cnpj/exclude — admin only
router.post('/opportunities/:cnpj/exclude', async (req, res) => {
    const user = req.user;
    if (user?.role !== 'MANAGER') {
        res.status(403).json({ error: 'Acesso restrito ao administrador' });
        return;
    }
    const { cnpj } = req.params;
    await prisma_1.prisma.opportunityExclusion.upsert({
        where: { cnpj },
        update: { excludedBy: user.email, excludedAt: new Date() },
        create: { cnpj, excludedBy: user.email },
    });
    res.json({ ok: true });
});
// DELETE /insights/opportunities/:cnpj/exclude — admin only (reactivate)
router.delete('/opportunities/:cnpj/exclude', async (req, res) => {
    const user = req.user;
    if (user?.role !== 'MANAGER') {
        res.status(403).json({ error: 'Acesso restrito ao administrador' });
        return;
    }
    const { cnpj } = req.params;
    await prisma_1.prisma.opportunityExclusion.deleteMany({ where: { cnpj } });
    res.json({ ok: true });
});
// GET /insights/opportunities/excluded — list excluded clients (admin only)
router.get('/opportunities/excluded', async (req, res) => {
    const user = req.user;
    if (user?.role !== 'MANAGER') {
        res.status(403).json({ error: 'Acesso restrito ao administrador' });
        return;
    }
    const exclusions = await prisma_1.prisma.opportunityExclusion.findMany({
        orderBy: { excludedAt: 'desc' },
    });
    const clients = await prisma_1.prisma.biClient.findMany({
        where: { cnpj: { in: exclusions.map((e) => e.cnpj) } },
        select: { cnpj: true, name: true, groupedName: true, city: true, state: true, segment: true },
    });
    const clientMap = new Map(clients.map((c) => [c.cnpj, c]));
    const data = exclusions.map((e) => ({
        ...e,
        client: clientMap.get(e.cnpj) ?? null,
    }));
    res.json({ data });
});
// GET /insights/client/:cnpj
router.get('/client/:cnpj', async (req, res) => {
    const { cnpj } = req.params;
    const [client, detail] = await Promise.all([
        (0, analyticsService_1.getClientById)(cnpj),
        (0, expansionService_1.getClientExpansionDetail)(cnpj),
    ]);
    if (!client) {
        res.status(404).json({ error: 'Client not found in BI cache' });
        return;
    }
    res.json({ client, ...detail });
});
exports.default = router;
//# sourceMappingURL=insights.js.map