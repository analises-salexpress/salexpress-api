"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const prisma_1 = require("../db/prisma");
const analyticsService_1 = require("../services/analyticsService");
const deliveryService_1 = require("../services/deliveryService");
const client_1 = require("@prisma/client");
const exceljs_1 = __importDefault(require("exceljs"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// Average of last N completed months across one or more CNPJs
async function recentAvg(cnpjs, months = 3) {
    const rows = await (0, analyticsService_1.aggregateRecentBilling)(cnpjs, months + 1);
    const now = new Date();
    const completed = rows.filter((r) => r.year < now.getFullYear() || (r.year === now.getFullYear() && r.month < now.getMonth() + 1));
    const slice = completed.slice(-months);
    if (slice.length === 0)
        return 0;
    return slice.reduce((s, r) => s + r.billing, 0) / months;
}
// ISO week number helper (same mode as MySQL WEEK(..., 3))
function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return { year: d.getUTCFullYear(), week };
}
// ── Business-days helpers ─────────────────────────────────────────────────────
// Count working days (Mon–Fri) in a month, optionally capped at toDay
function countBusinessDays(year, month, toDay) {
    const last = toDay ?? new Date(year, month, 0).getDate();
    let n = 0;
    for (let d = 1; d <= last; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        if (dow !== 0 && dow !== 6)
            n++;
    }
    return n;
}
// Average business days per month over the last N completed months (for baseline rate)
function avgBaselineBusinessDays(now, months = 3) {
    let total = 0;
    for (let i = 2; i <= months + 1; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        total += countBusinessDays(d.getFullYear(), d.getMonth() + 1);
    }
    return total / months;
}
// Build projection object for the current month
function buildProjection(currentBilling, baselineAvg, now) {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const yesterdayDay = now.getDate() - 1; // sync data goes up to yesterday
    const totalBd = countBusinessDays(year, month);
    const elapsed = yesterdayDay >= 1 ? countBusinessDays(year, month, yesterdayDay) : 0;
    const avgBaseBd = avgBaselineBusinessDays(now);
    // asOfDate: the last date that is included in the sync data (yesterday)
    const asOfDate = yesterdayDay >= 1
        ? `${year}-${String(month).padStart(2, '0')}-${String(yesterdayDay).padStart(2, '0')}`
        : null;
    if (elapsed === 0) {
        return {
            businessDaysElapsed: 0,
            businessDaysInMonth: totalBd,
            dailyRateCurrent: null,
            dailyRateBaseline: Math.round((baselineAvg / avgBaseBd) * 100) / 100,
            projectedBilling: null,
            projectedDelta: null,
            onTrack: null, // insufficient data
            asOfDate,
        };
    }
    const dailyRateCurrent = currentBilling / elapsed;
    const projectedBilling = Math.round(dailyRateCurrent * totalBd * 100) / 100;
    const projectedDelta = Math.round((projectedBilling - baselineAvg) * 100) / 100;
    const dailyRateBaseline = Math.round((baselineAvg / avgBaseBd) * 100) / 100;
    return {
        businessDaysElapsed: elapsed,
        businessDaysInMonth: totalBd,
        dailyRateCurrent: Math.round(dailyRateCurrent * 100) / 100,
        dailyRateBaseline,
        projectedBilling,
        projectedDelta,
        onTrack: projectedDelta >= 0,
        asOfDate,
    };
}
// Quarter helpers
function quarterMonths(q) {
    return [q * 3 - 2, q * 3 - 1, q * 3]; // Q1→[1,2,3], Q2→[4,5,6], Q3→[7,8,9], Q4→[10,11,12]
}
function dateQuarter(d) {
    return Math.ceil((d.getMonth() + 1) / 3);
}
async function calcQuarterlyExpansion(cnpjs, baselineAvg, startDate, quarter, year) {
    const months = quarterMonths(quarter);
    const rows = await prisma_1.prisma.biClientMonthly.findMany({
        where: { clientCnpj: { in: cnpjs }, year, month: { in: months } },
    });
    // aggregate across CNPJs per month
    const billingMap = new Map();
    for (const r of rows)
        billingMap.set(r.month, (billingMap.get(r.month) ?? 0) + r.billing);
    let total = 0;
    for (const month of months) {
        const monthStart = new Date(year, month - 1, 1);
        if (monthStart >= new Date(startDate.getFullYear(), startDate.getMonth(), 1)) {
            total += (billingMap.get(month) ?? 0) - baselineAvg;
        }
    }
    return Math.round(total * 100) / 100;
}
// Label "Semana N (DD/MM – DD/MM)"
function weekLabel(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7;
    const weekStart = new Date(jan4);
    weekStart.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    const fmt = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return `Semana ${week} (${fmt(weekStart)} – ${fmt(weekEnd)})`;
}
// GET /metrics/expansion
// All active expansion goals — baseline vs current avg with progress toward target
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
    const now = new Date();
    const results = await Promise.all(goals.map(async (g) => {
        const cnpjs = await (0, analyticsService_1.getCardCnpjs)(g.clientId, g.cardId);
        const curMonth = await (0, analyticsService_1.aggregateCurrentMonthFromDaily)(cnpjs);
        const projection = buildProjection(curMonth, g.baselineAvg, now);
        const deltaMonthly = Math.round((curMonth - g.baselineAvg) * 100) / 100;
        const targetGain = g.targetValue != null ? Math.round((g.targetValue - g.baselineAvg) * 100) / 100 : null;
        // Progress uses projected billing when available, otherwise raw
        const billingForProgress = projection.projectedBilling ?? curMonth;
        const progressPct = targetGain != null && targetGain > 0
            ? Math.min(Math.round(((billingForProgress - g.baselineAvg) / targetGain) * 100), 200)
            : null;
        // lostExpansion: uses projection mid-month; if no data yet, falls back to raw
        const lostExpansion = projection.onTrack === null
            ? deltaMonthly < 0
            : projection.onTrack === false;
        return {
            goalId: g.id,
            clientId: g.clientId,
            clientName: g.card?.clientName ?? g.clientId,
            vendor: g.vendor,
            card: g.card,
            startDate: g.startDate,
            baselineAvg: g.baselineAvg,
            currentMonthBilling: Math.round(curMonth * 100) / 100,
            deltaMonthly,
            targetValue: g.targetValue,
            targetGain,
            progressPct,
            lostExpansion,
            projection, // objeto completo para exibição no card
            targetHit: g.targetValue != null && (projection.projectedBilling ?? curMonth) >= g.targetValue,
        };
    }));
    // Summary — negativos não deduzem do total (regra de negócio já definida)
    const totalMonthlyGain = Math.round(results.filter((r) => !r.lostExpansion).reduce((s, r) => s + r.deltaMonthly, 0) * 100) / 100;
    const totalProjectedGain = Math.round(results.filter((r) => r.projection.projectedDelta != null && r.projection.projectedDelta > 0)
        .reduce((s, r) => s + (r.projection.projectedDelta ?? 0), 0) * 100) / 100;
    res.json({
        summary: {
            totalClients: results.length,
            clientsWithGain: results.filter((r) => !r.lostExpansion).length,
            clientsAtRisk: results.filter((r) => r.lostExpansion).length,
            totalMonthlyGain, // soma dos ganhos reais do mês (exclui negativos)
            totalProjectedGain, // soma das projeções positivas para o mês cheio
            asOfDate: results[0]?.projection.asOfDate ?? null,
        },
        clients: results,
    });
});
// GET /metrics/expansion/quarterly?quarter=1&year=2025
// Goals started in the selected quarter + expansion generated within that quarter
router.get('/expansion/quarterly', async (req, res) => {
    const quarter = Number(req.query.quarter);
    const year = Number(req.query.year ?? new Date().getFullYear());
    if (![1, 2, 3, 4].includes(quarter)) {
        res.status(400).json({ error: 'quarter must be 1, 2, 3 or 4' });
        return;
    }
    const months = quarterMonths(quarter);
    const qStart = new Date(year, months[0] - 1, 1);
    const qEnd = new Date(year, months[2], 1); // exclusive
    const where = {
        startDate: { gte: qStart, lt: qEnd },
    };
    if (req.user.role === client_1.Role.VENDOR) {
        where.vendorId = req.user.userId;
    }
    else if (req.query.vendorId) {
        where.vendorId = req.query.vendorId;
    }
    const goals = await prisma_1.prisma.expansionGoal.findMany({
        where,
        include: {
            vendor: { select: { id: true, name: true } },
            card: { select: { id: true, clientName: true } },
        },
        orderBy: { startDate: 'asc' },
    });
    const clients = await Promise.all(goals.map(async (g) => {
        const cnpjs = await (0, analyticsService_1.getCardCnpjs)(g.clientId, g.cardId);
        const [curMonth, qExpansion] = await Promise.all([
            (0, analyticsService_1.aggregateCurrentMonthFromDaily)(cnpjs),
            calcQuarterlyExpansion(cnpjs, g.baselineAvg, g.startDate, quarter, year),
        ]);
        const targetGain = g.targetValue != null ? g.targetValue - g.baselineAvg : null;
        const progressPct = targetGain != null && targetGain > 0
            ? Math.min(Math.round((qExpansion / (targetGain * months.length)) * 100), 200)
            : null;
        return {
            goalId: g.id,
            clientId: g.clientId,
            clientName: g.card?.clientName ?? g.clientId,
            vendor: g.vendor,
            startDate: g.startDate,
            baselineAvg: g.baselineAvg,
            currentMonthBilling: Math.round(curMonth * 100) / 100,
            quarterlyExpansion: qExpansion,
            lostExpansion: qExpansion < 0, // flag para alerta no card
            targetValue: g.targetValue,
            targetGain,
            progressPct,
            targetHit: g.targetValue != null && qExpansion >= (targetGain ?? Infinity) * months.length,
        };
    }));
    // Expansões negativas não deduzem do total — contam como zero
    const totalExpansion = clients.reduce((s, c) => s + Math.max(0, c.quarterlyExpansion), 0);
    const positiveClients = clients.filter((c) => c.quarterlyExpansion > 0).length;
    const lostClients = clients.filter((c) => c.quarterlyExpansion < 0).length;
    res.json({
        quarter,
        year,
        label: `Q${quarter} ${year}`,
        summary: {
            totalClients: clients.length,
            totalExpansion: Math.round(totalExpansion * 100) / 100,
            positiveClients,
            lostClients,
        },
        clients,
    });
});
// GET /metrics/dashboard — visão geral completa para a tela de Dashboards
// ?status=IDENTIFIED|CONTACTED|NEGOTIATING|EXPANDED|LOST  (opcional — filtra seção "Negociação")
router.get('/dashboard', async (req, res) => {
    const now = new Date();
    // Status filter para a seção "Negociação em Andamento"
    const VALID_STATUSES = new Set(['IDENTIFIED', 'CONTACTED', 'NEGOTIATING', 'EXPANDED', 'LOST']);
    const DEFAULT_ACTIVE = ['IDENTIFIED', 'CONTACTED', 'NEGOTIATING'];
    const filterStatus = req.query.status;
    const negotiationStatuses = filterStatus && VALID_STATUSES.has(filterStatus.toUpperCase())
        ? [filterStatus.toUpperCase()]
        : DEFAULT_ACTIVE;
    const vendorFilter = req.user.role === client_1.Role.VENDOR ? { assignedToId: req.user.userId } : {};
    // ── Kanban pipeline — sempre mostra o funil completo ──────────────────────
    const allCards = await prisma_1.prisma.kanbanCard.findMany({
        where: vendorFilter,
        select: { status: true, manualExpansionPotential: true, expansionForecast: true },
    });
    const pipeline = {
        identified: 0, contacted: 0, negotiating: 0, won: 0, lost: 0,
        totalActive: 0,
        totalPotential: 0,
        totalForecast: 0,
        cardsWithPotential: 0,
        cardsWithForecast: 0,
    };
    const ACTIVE_STATUSES = new Set(['IDENTIFIED', 'CONTACTED', 'NEGOTIATING']);
    for (const c of allCards) {
        if (c.status === 'IDENTIFIED')
            pipeline.identified++;
        if (c.status === 'CONTACTED')
            pipeline.contacted++;
        if (c.status === 'NEGOTIATING')
            pipeline.negotiating++;
        if (c.status === 'EXPANDED')
            pipeline.won++;
        if (c.status === 'LOST')
            pipeline.lost++;
        if (ACTIVE_STATUSES.has(c.status)) {
            pipeline.totalActive++;
            if (c.manualExpansionPotential != null) {
                pipeline.totalPotential += c.manualExpansionPotential;
                pipeline.cardsWithPotential++;
            }
            if (c.expansionForecast != null) {
                pipeline.totalForecast += c.expansionForecast;
                pipeline.cardsWithForecast++;
            }
        }
    }
    pipeline.totalPotential = Math.round(pipeline.totalPotential * 100) / 100;
    pipeline.totalForecast = Math.round(pipeline.totalForecast * 100) / 100;
    // ── Negociação — filtrada pelo status selecionado no funil ────────────────
    const [filteredCount, filteredCardsWithPotential] = await Promise.all([
        prisma_1.prisma.kanbanCard.count({
            where: { status: { in: negotiationStatuses }, ...vendorFilter },
        }),
        prisma_1.prisma.kanbanCard.findMany({
            where: {
                status: { in: negotiationStatuses },
                ...vendorFilter,
                manualExpansionPotential: { not: null },
            },
            select: { clientId: true, manualExpansionPotential: true, expansionForecast: true },
        }),
    ]);
    let totalNegotiationDelta = 0;
    let totalPotentialFiltered = 0;
    let totalForecastFiltered = 0;
    for (const c of filteredCardsWithPotential) {
        const avg = await recentAvg([c.clientId], 3);
        // Ganho potencial líquido é sempre ≥ 0: só conta quando potencial > frete base
        totalNegotiationDelta += Math.max(0, c.manualExpansionPotential - avg);
        totalPotentialFiltered += c.manualExpansionPotential;
        if (c.expansionForecast != null)
            totalForecastFiltered += c.expansionForecast;
    }
    const negotiation = {
        filteredStatus: filterStatus?.toUpperCase() ?? 'TODOS',
        clientsInNegotiation: filteredCount,
        clientsWithPotential: filteredCardsWithPotential.length,
        totalPotential: Math.round(totalPotentialFiltered * 100) / 100,
        totalNegotiationDelta: Math.round(totalNegotiationDelta * 100) / 100,
        totalForecast: Math.round(totalForecastFiltered * 100) / 100,
    };
    // ── Expansion goals projection ─────────────────────────────────────────────
    const goalsWhere = { status: 'ACTIVE' };
    if (req.user.role === client_1.Role.VENDOR)
        goalsWhere.vendorId = req.user.userId;
    const goals = await prisma_1.prisma.expansionGoal.findMany({
        where: goalsWhere,
        include: {
            vendor: { select: { id: true, name: true } },
            card: { select: { clientName: true } },
        },
        orderBy: { startDate: 'asc' },
    });
    let totalCurrentBilling = 0;
    let totalBaselineAvg = 0;
    let totalProjectedDelta = 0;
    let clientsOnTrack = 0;
    let clientsAtRisk = 0;
    let asOfDate = null;
    const monthlyProjection = [];
    for (const g of goals) {
        const cnpjs = await (0, analyticsService_1.getCardCnpjs)(g.clientId, g.cardId);
        const curMonth = await (0, analyticsService_1.aggregateCurrentMonthFromDaily)(cnpjs);
        const proj = buildProjection(curMonth, g.baselineAvg, now);
        if (!asOfDate && proj.asOfDate)
            asOfDate = proj.asOfDate;
        totalCurrentBilling += curMonth;
        totalBaselineAvg += g.baselineAvg;
        if (proj.projectedDelta != null)
            totalProjectedDelta += proj.projectedDelta;
        if (proj.onTrack === true)
            clientsOnTrack++;
        if (proj.onTrack === false)
            clientsAtRisk++;
        monthlyProjection.push({
            goalId: g.id,
            clientId: g.clientId,
            clientName: g.card?.clientName ?? g.clientId,
            vendor: g.vendor,
            baselineAvg: Math.round(g.baselineAvg * 100) / 100,
            currentMonthBilling: Math.round(curMonth * 100) / 100,
            deltaThisMonth: Math.round((curMonth - g.baselineAvg) * 100) / 100,
            projectedBilling: proj.projectedBilling,
            projectedDelta: proj.projectedDelta,
            onTrack: proj.onTrack,
            asOfDate: proj.asOfDate,
        });
    }
    res.json({
        pipeline,
        negotiation,
        expansion: {
            activeGoals: goals.length,
            totalCurrentBilling: Math.round(totalCurrentBilling * 100) / 100,
            totalBaselineAvg: Math.round(totalBaselineAvg * 100) / 100,
            totalDeltaThisMonth: Math.round((totalCurrentBilling - totalBaselineAvg) * 100) / 100,
            totalProjectedDelta: Math.round(totalProjectedDelta * 100) / 100,
            clientsOnTrack,
            clientsAtRisk,
            asOfDate,
        },
        monthlyProjection,
    });
});
// GET /metrics/expansion/dashboard-summary (manager only)
router.get('/expansion/dashboard-summary', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (_req, res) => {
    const goals = await prisma_1.prisma.expansionGoal.findMany({
        where: { status: 'ACTIVE' },
        include: { vendor: { select: { id: true, name: true } } },
    });
    let totalDelta = 0;
    let hittingTarget = 0;
    let withTarget = 0;
    for (const g of goals) {
        const cnpjs = await (0, analyticsService_1.getCardCnpjs)(g.clientId, g.cardId ?? null);
        const cur = await recentAvg(cnpjs, 3);
        const delta = cur - g.baselineAvg;
        totalDelta += delta;
        if (g.targetValue != null) {
            withTarget++;
            if (cur >= g.targetValue)
                hittingTarget++;
        }
    }
    res.json({
        totalClients: goals.length,
        totalDeltaMonthly: Math.round(totalDelta * 100) / 100,
        withTarget,
        hittingTarget,
    });
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
            select: { id: true, clientId: true, baselineAvg: true, status: true, startDate: true, cardId: true },
        }),
    ]);
    const cardsByStatus = cards.reduce((acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1;
        return acc;
    }, {});
    let totalExpansionDelta = 0;
    const activeGoals = goals.filter((g) => g.status === 'ACTIVE');
    for (const g of activeGoals) {
        const cnpjs = await (0, analyticsService_1.getCardCnpjs)(g.clientId, g.cardId ?? null);
        const current = await recentAvg(cnpjs, 3);
        totalExpansionDelta += current - g.baselineAvg;
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
            select: { clientId: true, baselineAvg: true, vendorId: true, cardId: true },
        }),
        prisma_1.prisma.user.findMany({
            where: { role: client_1.Role.VENDOR, active: true },
            select: { id: true, name: true },
        }),
    ]);
    // Total expansion delta across all active goals
    let totalExpansionDelta = 0;
    for (const g of activeGoals) {
        const cnpjs = await (0, analyticsService_1.getCardCnpjs)(g.clientId, g.cardId);
        const current = await recentAvg(cnpjs, 3);
        totalExpansionDelta += current - g.baselineAvg;
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
// GET /metrics/expansion/:goalId/weekly — weekly billing + observations since expansion start
router.get('/expansion/:goalId/weekly', async (req, res) => {
    const goal = await prisma_1.prisma.expansionGoal.findUnique({
        where: { id: req.params.goalId },
        include: {
            card: { select: { clientName: true } },
            weekNotes: true,
        },
    });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && goal.vendorId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    // Weekly billing aggregated across all CNPJs for this card
    const cnpjs = await (0, analyticsService_1.getCardCnpjs)(goal.clientId, goal.cardId);
    const weeklyRows = await (0, analyticsService_1.aggregateWeeklyBilling)(cnpjs);
    // Build week map from startDate to now
    const start = isoWeek(new Date(goal.startDate));
    const nowWeek = isoWeek(new Date());
    const noteMap = new Map(goal.weekNotes.map((n) => [`${n.year}-${n.week}`, n]));
    const billingMap = new Map(weeklyRows.map((r) => [`${r.year}-${r.week}`, r.billing]));
    const weeks = [];
    let cur = { ...start };
    while (cur.year < nowWeek.year || (cur.year === nowWeek.year && cur.week <= nowWeek.week)) {
        const key = `${cur.year}-${cur.week}`;
        const note = noteMap.get(key);
        weeks.push({
            year: cur.year,
            week: cur.week,
            label: weekLabel(cur.year, cur.week),
            billing: billingMap.get(key) ?? 0,
            observation: note?.observation ?? null,
            noteId: note?.id ?? null,
        });
        // advance one week
        cur.week++;
        if (cur.week > 52) {
            cur.week = 1;
            cur.year++;
        }
    }
    res.json({
        goalId: goal.id,
        clientId: goal.clientId,
        clientName: goal.card?.clientName ?? goal.clientId,
        baselineAvg: goal.baselineAvg,
        startDate: goal.startDate,
        weeks,
    });
});
// PUT /metrics/expansion/:goalId/week-note — upsert observation for a week
router.put('/expansion/:goalId/week-note', async (req, res) => {
    const schema = zod_1.z.object({
        year: zod_1.z.number().int(),
        week: zod_1.z.number().int().min(1).max(53),
        observation: zod_1.z.string(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const goal = await prisma_1.prisma.expansionGoal.findUnique({ where: { id: req.params.goalId } });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && goal.vendorId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const note = await prisma_1.prisma.expansionWeekNote.upsert({
        where: { goalId_year_week: { goalId: goal.id, year: body.data.year, week: body.data.week } },
        update: { observation: body.data.observation },
        create: { goalId: goal.id, year: body.data.year, week: body.data.week, observation: body.data.observation },
    });
    res.json(note);
});
// GET /metrics/expansion/:goalId/daily — day-by-day billing since expansion start
router.get('/expansion/:goalId/daily', async (req, res) => {
    const goal = await prisma_1.prisma.expansionGoal.findUnique({
        where: { id: req.params.goalId },
        include: { card: { select: { clientName: true } } },
    });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && goal.vendorId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const cnpjs = await (0, analyticsService_1.getCardCnpjs)(goal.clientId, goal.cardId);
    const startDate = new Date(goal.startDate);
    startDate.setHours(0, 0, 0, 0);
    const rows = await prisma_1.prisma.biClientDaily.findMany({
        where: { clientCnpj: { in: cnpjs }, date: { gte: startDate } },
    });
    // Aggregate across CNPJs per date
    const billingMap = new Map();
    for (const r of rows) {
        const key = r.date.toISOString().split('T')[0];
        billingMap.set(key, (billingMap.get(key) ?? 0) + r.billing);
    }
    // Build complete array from startDate to yesterday (sync goes up to yesterday)
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const days = [];
    const cursor = new Date(startDate);
    while (cursor <= yesterday) {
        const key = cursor.toISOString().split('T')[0];
        days.push({
            date: key,
            billing: Math.round((billingMap.get(key) ?? 0) * 100) / 100,
            label: `${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        });
        cursor.setDate(cursor.getDate() + 1);
    }
    res.json({
        goalId: goal.id,
        clientId: goal.clientId,
        clientName: goal.card?.clientName ?? goal.clientId,
        baselineAvg: goal.baselineAvg,
        startDate: goal.startDate,
        days,
    });
});
// GET /metrics/expansion/:goalId/history — monthly billing for chart
router.get('/expansion/:goalId/history', async (req, res) => {
    const goal = await prisma_1.prisma.expansionGoal.findUnique({
        where: { id: req.params.goalId },
        include: { card: { select: { clientName: true } } },
    });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && goal.vendorId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const cnpjs = await (0, analyticsService_1.getCardCnpjs)(goal.clientId, goal.cardId);
    const rows = await (0, analyticsService_1.aggregateMonthlyHistory)(cnpjs);
    const history = rows.map((r) => ({
        year: r.year,
        month: r.month,
        billing: r.billing,
        label: `${String(r.month).padStart(2, '0')}/${r.year}`,
    }));
    res.json({
        goalId: goal.id,
        clientId: goal.clientId,
        clientName: goal.card?.clientName ?? goal.clientId,
        baselineAvg: goal.baselineAvg,
        targetValue: goal.targetValue,
        startDate: goal.startDate,
        history,
    });
});
// PUT /metrics/goals/:id/target — set or update target monthly billing (manager only)
router.put('/goals/:id/target', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (req, res) => {
    const schema = zod_1.z.object({ targetValue: zod_1.z.number().positive() });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const goal = await prisma_1.prisma.expansionGoal.findUnique({ where: { id: req.params.id } });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    const updated = await prisma_1.prisma.expansionGoal.update({
        where: { id: req.params.id },
        data: { targetValue: body.data.targetValue },
    });
    res.json(updated);
});
// PUT /metrics/goals/:id/vendor — reassign vendor (manager only)
router.put('/goals/:id/vendor', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (req, res) => {
    const schema = zod_1.z.object({ vendorId: zod_1.z.string().min(1) });
    const body = schema.safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: body.error.flatten() });
        return;
    }
    const [goal, vendor] = await Promise.all([
        prisma_1.prisma.expansionGoal.findUnique({ where: { id: req.params.id } }),
        prisma_1.prisma.user.findUnique({ where: { id: body.data.vendorId }, select: { id: true, name: true, role: true } }),
    ]);
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
    }
    const updated = await prisma_1.prisma.expansionGoal.update({
        where: { id: req.params.id },
        data: { vendorId: body.data.vendorId },
        include: { vendor: { select: { id: true, name: true } } },
    });
    res.json(updated);
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
// GET /metrics/expansion/:goalId/presentation — financial data for "Apresentar Expansão"
router.get('/expansion/:goalId/presentation', async (req, res) => {
    const goal = await prisma_1.prisma.expansionGoal.findUnique({
        where: { id: req.params.goalId },
        include: { card: { select: { id: true, clientName: true } } },
    });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && goal.vendorId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const cnpjs = await (0, analyticsService_1.getCardCnpjs)(goal.clientId, goal.cardId);
    const startDate = new Date(goal.startDate);
    const [weekly, monthly] = await Promise.all([
        (0, deliveryService_1.getExpansionPresentationWeekly)(cnpjs, startDate),
        (0, deliveryService_1.getExpansionPresentationMonthly)(cnpjs, startDate),
    ]);
    res.json({
        goalId: goal.id,
        clientId: goal.clientId,
        clientName: goal.card?.clientName ?? goal.clientId,
        cnpjs,
        startDate: goal.startDate,
        baselineAvg: goal.baselineAvg,
        targetValue: goal.targetValue,
        weekly,
        monthly,
    });
});
// GET /metrics/expansion/:goalId/presentation/export — Excel download
router.get('/expansion/:goalId/presentation/export', async (req, res) => {
    const goal = await prisma_1.prisma.expansionGoal.findUnique({
        where: { id: req.params.goalId },
        include: { card: { select: { id: true, clientName: true } } },
    });
    if (!goal) {
        res.status(404).json({ error: 'Goal not found' });
        return;
    }
    if (req.user.role === client_1.Role.VENDOR && goal.vendorId !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const cnpjs = await (0, analyticsService_1.getCardCnpjs)(goal.clientId, goal.cardId);
    const startDate = new Date(goal.startDate);
    const baselineAvg = goal.baselineAvg;
    const clientName = goal.card?.clientName ?? goal.clientId;
    const [weekly, monthly] = await Promise.all([
        (0, deliveryService_1.getExpansionPresentationWeekly)(cnpjs, startDate),
        (0, deliveryService_1.getExpansionPresentationMonthly)(cnpjs, startDate),
    ]);
    const wb = new exceljs_1.default.Workbook();
    wb.creator = 'Sal Express';
    wb.created = new Date();
    // ── Semana a Semana ──
    const ws1 = wb.addWorksheet('Semana a Semana');
    ws1.columns = [
        { header: 'Semana', key: 'weekLabel', width: 14 },
        { header: 'Notas', key: 'totalNotas', width: 10 },
        { header: 'Valor da Nota (R$)', key: 'valorMercadoria', width: 18 },
        { header: 'Frete (R$)', key: 'valorFrete', width: 16 },
        { header: '% da Nota', key: 'pctNota', width: 12 },
    ];
    ws1.getRow(1).font = { bold: true };
    for (const r of weekly) {
        ws1.addRow({
            weekLabel: r.weekLabel,
            totalNotas: r.totalNotas,
            valorMercadoria: r.valorMercadoria,
            valorFrete: r.valorFrete,
            pctNota: r.pctNota !== null ? `${r.pctNota.toFixed(2)}%` : '-',
        });
    }
    // ── Mês a Mês ──
    const ws2 = wb.addWorksheet('Mês a Mês');
    ws2.columns = [
        { header: 'Mês', key: 'monthLabel', width: 12 },
        { header: 'Notas', key: 'totalNotas', width: 10 },
        { header: 'Valor da Nota (R$)', key: 'valorMercadoria', width: 18 },
        { header: 'Frete (R$)', key: 'valorFrete', width: 16 },
        { header: '% da Nota', key: 'pctNota', width: 12 },
        { header: 'Baseline (R$)', key: 'baseline', width: 16 },
        { header: 'Δ vs Baseline (R$)', key: 'delta', width: 18 },
    ];
    ws2.getRow(1).font = { bold: true };
    for (const r of monthly) {
        const delta = Math.round((r.valorFrete - baselineAvg) * 100) / 100;
        ws2.addRow({
            monthLabel: r.monthLabel + (r.isCurrentMonth ? ' *' : ''),
            totalNotas: r.totalNotas,
            valorMercadoria: r.valorMercadoria,
            valorFrete: r.valorFrete,
            pctNota: r.pctNota !== null ? `${r.pctNota.toFixed(2)}%` : '-',
            baseline: baselineAvg,
            delta,
        });
    }
    if (monthly.some((m) => m.isCurrentMonth)) {
        ws2.addRow({ monthLabel: '* Mês em curso (parcial)' });
    }
    const safeName = clientName.replace(/[^a-zA-Z0-9 ]/g, '').trim().substring(0, 30);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="apresentacao_${safeName}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
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