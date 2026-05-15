"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClientMonthly = getClientMonthly;
exports.getClientRecentMonths = getClientRecentMonths;
exports.getClientRoutes = getClientRoutes;
exports.getAllRoutes = getAllRoutes;
exports.getUncoveredRoutes = getUncoveredRoutes;
exports.getClients = getClients;
exports.getClientById = getClientById;
exports.aggregateMonthlyHistory = aggregateMonthlyHistory;
exports.aggregateRecentBilling = aggregateRecentBilling;
exports.aggregateCurrentMonth = aggregateCurrentMonth;
exports.aggregateCurrentMonthFromDaily = aggregateCurrentMonthFromDaily;
exports.aggregateWeeklyBilling = aggregateWeeklyBilling;
exports.getCardCnpjs = getCardCnpjs;
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
    const usedRegions = new Set(clientRoutes.map((r) => r.region));
    return allRoutes.filter((r) => !usedRegions.has(r.region));
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
// ── Multi-CNPJ aggregation helpers ───────────────────────────────────────────
function aggregateByMonth(rows) {
    const map = new Map();
    for (const r of rows) {
        const key = `${r.year}-${r.month}`;
        const e = map.get(key);
        if (e)
            e.billing += r.billing;
        else
            map.set(key, { year: r.year, month: r.month, billing: r.billing });
    }
    return Array.from(map.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}
// Aggregated monthly billing for one or more CNPJs (full history)
async function aggregateMonthlyHistory(cnpjs) {
    const rows = await prisma_1.prisma.biClientMonthly.findMany({
        where: { clientCnpj: { in: cnpjs } },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    return aggregateByMonth(rows);
}
// Aggregated recent N months for one or more CNPJs (for baseline/avg calculation)
async function aggregateRecentBilling(cnpjs, months) {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const rows = await prisma_1.prisma.biClientMonthly.findMany({
        where: {
            clientCnpj: { in: cnpjs },
            OR: [
                { year: { gt: cutoff.getFullYear() } },
                { year: cutoff.getFullYear(), month: { gte: cutoff.getMonth() + 1 } },
            ],
        },
    });
    return aggregateByMonth(rows);
}
// Aggregated current month billing for one or more CNPJs (from bi_client_monthly, standard doc types only)
async function aggregateCurrentMonth(cnpjs) {
    const now = new Date();
    const rows = await prisma_1.prisma.biClientMonthly.findMany({
        where: { clientCnpj: { in: cnpjs }, year: now.getFullYear(), month: now.getMonth() + 1 },
    });
    return rows.reduce((s, r) => s + r.billing, 0);
}
// Current month billing summed from bi_client_daily — includes ALL document types (reentregas etc.)
// Used for expanded clients where all freight types must count
async function aggregateCurrentMonthFromDaily(cnpjs) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const rows = await prisma_1.prisma.biClientDaily.findMany({
        where: { clientCnpj: { in: cnpjs }, date: { gte: monthStart } },
    });
    return rows.reduce((s, r) => s + r.billing, 0);
}
// Aggregated weekly billing for one or more CNPJs
async function aggregateWeeklyBilling(cnpjs) {
    const rows = await prisma_1.prisma.biClientWeekly.findMany({
        where: { clientCnpj: { in: cnpjs } },
        orderBy: [{ year: 'asc' }, { week: 'asc' }],
    });
    const map = new Map();
    for (const r of rows) {
        const key = `${r.year}-${r.week}`;
        const e = map.get(key);
        if (e)
            e.billing += r.billing;
        else
            map.set(key, { year: r.year, week: r.week, billing: r.billing });
    }
    return Array.from(map.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week);
}
// All CNPJs for a card (primary + additional)
async function getCardCnpjs(primaryCnpj, cardId) {
    if (!cardId)
        return [primaryCnpj];
    const additional = await prisma_1.prisma.cardAdditionalCnpj.findMany({
        where: { cardId },
        select: { cnpj: true },
    });
    return [primaryCnpj, ...additional.map((a) => a.cnpj)];
}
//# sourceMappingURL=analyticsService.js.map