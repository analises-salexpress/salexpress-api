"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const expansionService_1 = require("../services/expansionService");
const analyticsService_1 = require("../services/analyticsService");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /insights/opportunities?limit=50&offset=0
router.get('/opportunities', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    try {
        const { opportunities, total } = await (0, expansionService_1.getOpportunities)(limit, offset);
        res.json({ data: opportunities, total, limit, offset });
    }
    catch (err) {
        console.error('[opportunities] error:', err?.message, err?.stack?.split('\n')[1]);
        res.status(500).json({ error: 'Erro ao calcular oportunidades', detail: err?.message });
    }
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