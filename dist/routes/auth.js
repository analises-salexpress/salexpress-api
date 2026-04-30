"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const authService_1 = require("../services/authService");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email('E-mail inválido'),
    password: zod_1.z.string().min(1, 'Senha obrigatória'),
});
router.post('/login', async (req, res) => {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() });
        return;
    }
    try {
        const data = await (0, authService_1.login)(result.data.email, result.data.password);
        res.json({ data });
    }
    catch (err) {
        res.status(401).json({ error: err.message });
    }
});
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        res.status(400).json({ error: 'refreshToken obrigatório' });
        return;
    }
    try {
        const data = await (0, authService_1.refreshAccessToken)(refreshToken);
        res.json({ data });
    }
    catch (err) {
        res.status(401).json({ error: err.message });
    }
});
router.post('/logout', auth_1.authenticate, async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
        await (0, authService_1.logout)(refreshToken);
    }
    res.json({ message: 'Logout realizado com sucesso' });
});
exports.default = router;
//# sourceMappingURL=auth.js.map