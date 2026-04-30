"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_1 = require("../db/prisma");
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const authService_1 = require("../services/authService");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
const userSelect = {
    id: true,
    name: true,
    email: true,
    role: true,
    active: true,
    createdAt: true,
};
router.get('/', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (_req, res) => {
    const users = await prisma_1.prisma.user.findMany({
        select: userSelect,
        orderBy: { name: 'asc' },
    });
    res.json({ data: users });
});
router.get('/me', async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: req.user.userId },
        select: userSelect,
    });
    if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }
    res.json({ data: user });
});
const createUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
    email: zod_1.z.string().email('E-mail inválido'),
    password: zod_1.z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
    role: zod_1.z.nativeEnum(client_1.Role).optional(),
});
router.post('/', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (req, res) => {
    const result = createUserSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() });
        return;
    }
    const existing = await prisma_1.prisma.user.findUnique({ where: { email: result.data.email } });
    if (existing) {
        res.status(409).json({ error: 'E-mail já cadastrado' });
        return;
    }
    const passwordHash = await (0, authService_1.hashPassword)(result.data.password);
    const user = await prisma_1.prisma.user.create({
        data: {
            name: result.data.name,
            email: result.data.email,
            passwordHash,
            role: result.data.role ?? client_1.Role.VENDOR,
        },
        select: userSelect,
    });
    res.status(201).json({ data: user, message: 'Usuário criado com sucesso' });
});
const updateUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).optional(),
    active: zod_1.z.boolean().optional(),
    role: zod_1.z.nativeEnum(client_1.Role).optional(),
});
router.put('/:id', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (req, res) => {
    const result = updateUserSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() });
        return;
    }
    try {
        const user = await prisma_1.prisma.user.update({
            where: { id: req.params.id },
            data: result.data,
            select: userSelect,
        });
        res.json({ data: user });
    }
    catch {
        res.status(404).json({ error: 'Usuário não encontrado' });
    }
});
const changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().optional(),
    newPassword: zod_1.z.string().min(8, 'Nova senha deve ter pelo menos 8 caracteres'),
});
router.put('/:id/password', async (req, res) => {
    const isManager = req.user?.role === client_1.Role.MANAGER;
    const isSelf = req.user?.userId === req.params.id;
    if (!isManager && !isSelf) {
        res.status(403).json({ error: 'Permissão insuficiente' });
        return;
    }
    const result = changePasswordSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: 'Dados inválidos', details: result.error.flatten() });
        return;
    }
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }
    if (!isManager) {
        if (!result.data.currentPassword) {
            res.status(400).json({ error: 'Senha atual obrigatória' });
            return;
        }
        const valid = await (0, authService_1.verifyPassword)(user.passwordHash, result.data.currentPassword);
        if (!valid) {
            res.status(400).json({ error: 'Senha atual incorreta' });
            return;
        }
    }
    const passwordHash = await (0, authService_1.hashPassword)(result.data.newPassword);
    await prisma_1.prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
    res.json({ message: 'Senha alterada com sucesso' });
});
exports.default = router;
//# sourceMappingURL=users.js.map