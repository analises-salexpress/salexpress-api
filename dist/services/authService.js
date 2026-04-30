"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.refreshAccessToken = refreshAccessToken;
exports.logout = logout;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../db/prisma");
async function login(email, password) {
    const user = await prisma_1.prisma.user.findUnique({ where: { email, active: true } });
    if (!user)
        throw new Error('Credenciais inválidas');
    const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!valid)
        throw new Error('Credenciais inválidas');
    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, {
        expiresIn: (process.env.JWT_EXPIRES_IN || '8h'),
    });
    const refreshToken = jsonwebtoken_1.default.sign({ userId: user.id }, process.env.JWT_SECRET, {
        expiresIn: '7d',
    });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await prisma_1.prisma.refreshToken.create({
        data: { token: refreshToken, userId: user.id, expiresAt },
    });
    return {
        accessToken,
        refreshToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
}
async function refreshAccessToken(refreshToken) {
    const stored = await prisma_1.prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.expiresAt < new Date())
        throw new Error('Refresh token inválido ou expirado');
    const user = await prisma_1.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.active)
        throw new Error('Usuário inativo');
    const payload = { userId: user.id, email: user.email, role: user.role };
    const accessToken = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, {
        expiresIn: (process.env.JWT_EXPIRES_IN || '8h'),
    });
    return { accessToken };
}
async function logout(refreshToken) {
    await prisma_1.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
}
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 12);
}
async function verifyPassword(hash, password) {
    return bcryptjs_1.default.compare(password, hash);
}
//# sourceMappingURL=authService.js.map