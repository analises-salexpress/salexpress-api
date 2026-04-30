"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClientMonthly = getClientMonthly;
exports.getClientRecentMonths = getClientRecentMonths;
exports.getClientRoutes = getClientRoutes;
exports.getAllRoutes = getAllRoutes;
exports.getUncoveredRoutes = getUncoveredRoutes;
exports.getClients = getClients;
exports.getClientById = getClientById;
const prisma_1 = require("../db/prisma");
// Returns billing rows for a client sorted oldest → newest
async function getClientMonthly(clientCnpj) {
    return prisma_1.prisma.biClientMonthly.findMany({
        where: { clientCnpj },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
}
// Returns the last N months of billing for a client (for baseline calculation)
async function getClientRecentMonths(clientCnpj, months) {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
    return prisma_1.prisma.biClientMonthly.findMany({
        where: {
            clientCnpj,
            OR: [
                { year: { gt: cutoff.getFullYear() } },
                {
                    year: cutoff.getFullYear(),
                    month: { gte: cutoff.getMonth() + 1 },
                },
            ],
        },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
}
// Returns all routes a specific client has used
async function getClientRoutes(clientCnpj) {
    return prisma_1.prisma.biClientRoute.findMany({
        where: { clientCnpj },
        orderBy: { tripCount: 'desc' },
    });
}
// Returns all routes served by Sal Express
async function getAllRoutes() {
    return prisma_1.prisma.biAllRoute.findMany({
        orderBy: { avgRevenue: 'desc' },
    });
}
// Returns routes served by Sal Express that a given client has NOT used
async function getUncoveredRoutes(clientCnpj) {
    const [clientRoutes, allRoutes] = await Promise.all([
        getClientRoutes(clientCnpj),
        getAllRoutes(),
    ]);
    const usedKeys = new Set(clientRoutes.map((r) => `${r.deliveryCity}|${r.deliveryState}`));
    return allRoutes.filter((r) => !usedKeys.has(`${r.deliveryCity}|${r.deliveryState}`));
}
// Returns all active clients from the BI cache, optionally filtered
async function getClients(opts) {
    const { search, state, segment, curve, limit = 50, offset = 0 } = opts;
    const where = {};
    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { groupedName: { contains: search, mode: 'insensitive' } },
            { cnpj: { contains: search } },
        ];
    }
    if (state)
        where.state = state;
    if (segment)
        where.segment = segment;
    if (curve)
        where.curve = curve;
    const [clients, total] = await Promise.all([
        prisma_1.prisma.biClient.findMany({ where, take: limit, skip: offset, orderBy: { name: 'asc' } }),
        prisma_1.prisma.biClient.count({ where }),
    ]);
    return { clients, total };
}
async function getClientById(cnpj) {
    return prisma_1.prisma.biClient.findUnique({ where: { cnpj } });
}
//# sourceMappingURL=analyticsService.js.map