"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const analyticsService_1 = require("../services/analyticsService");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /clients?search=&state=MG&segment=&curve=A&limit=50&offset=0
router.get('/', async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    try {
        const { clients, total } = await (0, analyticsService_1.getClients)({
            search: req.query.search,
            state: req.query.state,
            segment: req.query.segment,
            curve: req.query.curve,
            limit,
            offset,
        });
        res.json({ data: clients, total, limit, offset });
    }
    catch (err) {
        console.error('[clients] error:', err?.message);
        res.status(500).json({ error: 'Erro ao buscar clientes', detail: err?.message });
    }
});
// GET /clients/:cnpj
router.get('/:cnpj', async (req, res) => {
    const { cnpj } = req.params;
    const [client, monthly, routes] = await Promise.all([
        (0, analyticsService_1.getClientById)(cnpj),
        (0, analyticsService_1.getClientMonthly)(cnpj),
        (0, analyticsService_1.getClientRoutes)(cnpj),
    ]);
    if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
    }
    res.json({ client, monthly, routes });
});
exports.default = router;
//# sourceMappingURL=clients.js.map