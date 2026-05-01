"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOpportunities = getOpportunities;
exports.getClientExpansionDetail = getClientExpansionDetail;
exports.calcNrr = calcNrr;
const analyticsService_1 = require("./analyticsService");
const prisma_1 = require("../db/prisma");
const BASELINE_MONTHS = 3;
const DECLINE_THRESHOLD = 0.10;
function calcBaseline(months) {
    const now = new Date();
    const completed = months.filter((m) => m.year < now.getFullYear() ||
        (m.year === now.getFullYear() && m.month < now.getMonth() + 1));
    if (completed.length === 0)
        return 0;
    const recent = completed.slice(-BASELINE_MONTHS);
    return recent.reduce((sum, m) => sum + m.billing, 0) / recent.length;
}
function lastCompletedMonth(months) {
    const now = new Date();
    const completed = months.filter((m) => m.year < now.getFullYear() || (m.year === now.getFullYear() && m.month < now.getMonth() + 1));
    return completed.at(-1)?.billing ?? 0;
}
async function getOpportunities(limit = 50, offset = 0) {
    const now = new Date();
    const cutoffYear = now.getMonth() >= BASELINE_MONTHS + 2
        ? now.getFullYear()
        : now.getFullYear() - 1;
    const cutoffMonth = ((now.getMonth() - (BASELINE_MONTHS + 2) + 12) % 12) + 1;
    // Fetch everything in parallel — no N+1
    const [{ clients }, allMonthly, allClientRoutes, allRoutes, existingCards] = await Promise.all([
        (0, analyticsService_1.getClients)({ limit: 5000 }),
        prisma_1.prisma.biClientMonthly.findMany({
            where: {
                OR: [
                    { year: { gt: cutoffYear } },
                    { year: cutoffYear, month: { gte: cutoffMonth } },
                ],
            },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
        }),
        prisma_1.prisma.biClientRoute.findMany(),
        (0, analyticsService_1.getAllRoutes)(),
        prisma_1.prisma.kanbanCard.findMany({ select: { clientId: true } }),
    ]);
    const cardCnpjs = new Set(existingCards.map((c) => c.clientId));
    // Group monthly by cnpj
    const monthlyByCnpj = new Map();
    for (const row of allMonthly) {
        const list = monthlyByCnpj.get(row.clientCnpj) ?? [];
        list.push({ year: row.year, month: row.month, billing: row.billing });
        monthlyByCnpj.set(row.clientCnpj, list);
    }
    // Group client routes by cnpj
    const routesByCnpj = new Map();
    for (const r of allClientRoutes) {
        const set = routesByCnpj.get(r.clientCnpj) ?? new Set();
        set.add(`${r.deliveryCity}|${r.deliveryState}`);
        routesByCnpj.set(r.clientCnpj, set);
    }
    const allRouteRevMap = new Map(allRoutes.map((r) => [`${r.deliveryCity}|${r.deliveryState}`, r.avgRevenue]));
    const scored = [];
    for (const client of clients) {
        const months = monthlyByCnpj.get(client.cnpj) ?? [];
        const baselineBilling = calcBaseline(months);
        if (baselineBilling === 0)
            continue;
        const currentBilling = lastCompletedMonth(months);
        const usedRoutes = routesByCnpj.get(client.cnpj) ?? new Set();
        const uncoveredRoutes = allRoutes.filter((r) => !usedRoutes.has(`${r.deliveryCity}|${r.deliveryState}`));
        const uncoveredRevenueEstimate = uncoveredRoutes.reduce((sum, r) => sum + r.avgRevenue, 0);
        let declineGap = 0;
        if (baselineBilling > 0 && currentBilling < baselineBilling) {
            const dropRatio = (baselineBilling - currentBilling) / baselineBilling;
            if (dropRatio > DECLINE_THRESHOLD)
                declineGap = baselineBilling - currentBilling;
        }
        const totalScore = uncoveredRevenueEstimate + declineGap;
        scored.push({
            cnpj: client.cnpj,
            clientName: client.name,
            groupedName: client.groupedName,
            city: client.city,
            state: client.state,
            segment: client.segment,
            curve: client.curve,
            baselineBilling: Math.round(baselineBilling * 100) / 100,
            currentBilling: Math.round(currentBilling * 100) / 100,
            uncoveredRoutesCount: uncoveredRoutes.length,
            uncoveredRevenueEstimate: Math.round(uncoveredRevenueEstimate * 100) / 100,
            declineGap: Math.round(declineGap * 100) / 100,
            totalScore: Math.round(totalScore * 100) / 100,
            hasKanbanCard: cardCnpjs.has(client.cnpj),
        });
    }
    scored.sort((a, b) => b.totalScore - a.totalScore);
    return {
        opportunities: scored.slice(offset, offset + limit),
        total: scored.length,
    };
}
async function getClientExpansionDetail(cnpj) {
    const [recentMonths, uncoveredRoutes, clientRoutes] = await Promise.all([
        prisma_1.prisma.biClientMonthly.findMany({
            where: { clientCnpj: cnpj },
            orderBy: [{ year: 'asc' }, { month: 'asc' }],
            take: 12,
        }),
        (async () => {
            const [clientRouteList, allRoutes] = await Promise.all([
                (0, analyticsService_1.getClientRoutes)(cnpj),
                (0, analyticsService_1.getAllRoutes)(),
            ]);
            const usedKeys = new Set(clientRouteList.map((r) => `${r.deliveryCity}|${r.deliveryState}`));
            return allRoutes.filter((r) => !usedKeys.has(`${r.deliveryCity}|${r.deliveryState}`));
        })(),
        (0, analyticsService_1.getClientRoutes)(cnpj),
    ]);
    const months = recentMonths.map((m) => ({ year: m.year, month: m.month, billing: m.billing }));
    const baseline = calcBaseline(months);
    const current = lastCompletedMonth(months);
    let declineGap = 0;
    if (baseline > 0 && current < baseline) {
        const dropRatio = (baseline - current) / baseline;
        if (dropRatio > DECLINE_THRESHOLD)
            declineGap = baseline - current;
    }
    const uncoveredRevenueEstimate = uncoveredRoutes.reduce((sum, r) => sum + r.avgRevenue, 0);
    return {
        baseline: Math.round(baseline * 100) / 100,
        currentBilling: Math.round(current * 100) / 100,
        declineGap: Math.round(declineGap * 100) / 100,
        uncoveredRoutesCount: uncoveredRoutes.length,
        uncoveredRevenueEstimate: Math.round(uncoveredRevenueEstimate * 100) / 100,
        coveredRoutes: clientRoutes,
        uncoveredRoutes,
        monthlyHistory: months,
    };
}
async function calcNrr(cnpj) {
    const rows = await prisma_1.prisma.biClientMonthly.findMany({
        where: { clientCnpj: cnpj },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
        take: 6,
    });
    if (rows.length < 2)
        return null;
    const now = new Date();
    const completed = rows.filter((m) => m.year < now.getFullYear() || (m.year === now.getFullYear() && m.month < now.getMonth() + 1));
    if (completed.length < 2)
        return null;
    let positiveSum = 0;
    let negativeSum = 0;
    const base = completed[0].billing;
    for (let i = 1; i < completed.length; i++) {
        const delta = completed[i].billing - completed[i - 1].billing;
        const ratio = Math.abs(delta) / (completed[i - 1].billing || 1);
        if (ratio <= DECLINE_THRESHOLD)
            continue;
        if (delta > 0)
            positiveSum += delta;
        else
            negativeSum += Math.abs(delta);
    }
    if (base === 0)
        return null;
    return Math.round(((positiveSum - negativeSum) / base) * 10000) / 100;
}
//# sourceMappingURL=expansionService.js.map