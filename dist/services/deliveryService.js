"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeliveryFilialByWeek = getDeliveryFilialByWeek;
exports.getDeliveryFilialByMonth = getDeliveryFilialByMonth;
exports.getAvailableFilialPeriods = getAvailableFilialPeriods;
exports.getDeliveryFilialWeekly = getDeliveryFilialWeekly;
exports.getDeliveryPerformanceBatch = getDeliveryPerformanceBatch;
exports.getDeliveryPerformanceByFilial = getDeliveryPerformanceByFilial;
exports.getDeliveryPerformanceWeekly = getDeliveryPerformanceWeekly;
exports.getDeliveryPerformanceMonthly = getDeliveryPerformanceMonthly;
exports.getExpansionPresentationWeekly = getExpansionPresentationWeekly;
exports.getExpansionPresentationMonthly = getExpansionPresentationMonthly;
const prisma_1 = require("../db/prisma");
const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function semaforo(pct) {
    if (pct === null)
        return 'no_data';
    if (pct >= 95)
        return 'green';
    if (pct >= 90)
        return 'yellow';
    if (pct >= 85)
        return 'red';
    return 'critical';
}
// Returns the Monday (start) of a given ISO week (WEEK mode 3)
function isoWeekStart(year, week) {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // 1=Mon…7=Sun
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - (dayOfWeek - 1));
    const d = new Date(week1Monday);
    d.setDate(week1Monday.getDate() + (week - 1) * 7);
    return d;
}
async function getDeliveryFilialByWeek(cnpjs, year, week) {
    if (cnpjs.length === 0)
        return [];
    const rows = await prisma_1.prisma.biDeliveryFilialWeekly.findMany({
        where: { cnpj: { in: cnpjs }, year, week },
        orderBy: { totalEntregas: 'desc' },
    });
    const filialMap = new Map();
    for (const r of rows) {
        const prev = filialMap.get(r.filial);
        if (prev) {
            prev.totalEntregas += r.totalEntregas;
            prev.noPrazo += r.noPrazo;
        }
        else {
            filialMap.set(r.filial, { totalEntregas: r.totalEntregas, noPrazo: r.noPrazo });
        }
    }
    return Array.from(filialMap.entries())
        .sort((a, b) => b[1].totalEntregas - a[1].totalEntregas)
        .map(([filial, d]) => {
        const pct = d.totalEntregas > 0
            ? Math.round(d.noPrazo / d.totalEntregas * 1000) / 10
            : null;
        return {
            filial,
            cidade: null,
            totalEntregas: d.totalEntregas,
            noPrazo: d.noPrazo,
            foraPrazo: d.totalEntregas - d.noPrazo,
            pendente: 0,
            performancePct: pct,
            semaforo: semaforo(pct),
        };
    });
}
async function getDeliveryFilialByMonth(cnpjs, year, month) {
    if (cnpjs.length === 0)
        return [];
    const rows = await prisma_1.prisma.biDeliveryFilialMonthly.findMany({
        where: { cnpj: { in: cnpjs }, year, month },
        orderBy: { totalEntregas: 'desc' },
    });
    const filialMap = new Map();
    for (const r of rows) {
        const prev = filialMap.get(r.filial);
        if (prev) {
            prev.totalEntregas += r.totalEntregas;
            prev.noPrazo += r.noPrazo;
            prev.foraPrazo += r.foraPrazo;
            prev.pendente += r.pendente;
        }
        else {
            filialMap.set(r.filial, {
                totalEntregas: r.totalEntregas,
                noPrazo: r.noPrazo,
                foraPrazo: r.foraPrazo,
                pendente: r.pendente,
            });
        }
    }
    return Array.from(filialMap.entries())
        .sort((a, b) => b[1].totalEntregas - a[1].totalEntregas)
        .map(([filial, d]) => {
        const delivered = d.noPrazo + d.foraPrazo;
        const pct = delivered > 0
            ? Math.round(d.noPrazo / delivered * 1000) / 10
            : null;
        return {
            filial,
            cidade: null,
            totalEntregas: d.totalEntregas,
            noPrazo: d.noPrazo,
            foraPrazo: d.foraPrazo,
            pendente: d.pendente,
            performancePct: pct,
            semaforo: semaforo(pct),
        };
    });
}
// Returns available weeks and months for filter dropdowns
async function getAvailableFilialPeriods(cnpjs) {
    if (cnpjs.length === 0)
        return { weeks: [], months: [] };
    const [weekRows, monthRows] = await Promise.all([
        prisma_1.prisma.biDeliveryFilialWeekly.findMany({
            where: { cnpj: { in: cnpjs } },
            select: { year: true, week: true },
            distinct: ['year', 'week'],
            orderBy: [{ year: 'desc' }, { week: 'desc' }],
            take: 24,
        }),
        prisma_1.prisma.biDeliveryFilialMonthly.findMany({
            where: { cnpj: { in: cnpjs } },
            select: { year: true, month: true },
            distinct: ['year', 'month'],
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 18,
        }),
    ]);
    const uniqueWeeks = Array.from(new Map(weekRows.map((r) => [`${r.year}-${r.week}`, r])).values()).sort((a, b) => b.year - a.year || b.week - a.week);
    const uniqueMonths = Array.from(new Map(monthRows.map((r) => [`${r.year}-${r.month}`, r])).values()).sort((a, b) => b.year - a.year || b.month - a.month);
    return {
        weeks: uniqueWeeks.map((r) => ({
            year: r.year,
            week: r.week,
            label: `S${String(r.week).padStart(2, '0')}/${r.year}`,
        })),
        months: uniqueMonths.map((r) => ({
            year: r.year,
            month: r.month,
            label: `${MONTH_NAMES[r.month - 1]}/${r.year}`,
        })),
    };
}
async function getDeliveryFilialWeekly(cnpjs, filial, weeks = 12) {
    if (cnpjs.length === 0)
        return [];
    const rows = await prisma_1.prisma.biDeliveryFilialWeekly.findMany({
        where: { cnpj: { in: cnpjs }, filial },
        orderBy: [{ year: 'asc' }, { week: 'asc' }],
    });
    const weekMap = new Map();
    for (const r of rows) {
        const key = `${r.year}-${r.week}`;
        const prev = weekMap.get(key);
        if (prev) {
            prev.totalEntregas += r.totalEntregas;
            prev.noPrazo += r.noPrazo;
        }
        else {
            weekMap.set(key, { year: r.year, week: r.week, totalEntregas: r.totalEntregas, noPrazo: r.noPrazo });
        }
    }
    const sorted = Array.from(weekMap.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week);
    const recent = sorted.slice(-weeks);
    return recent.map((w) => {
        const pct = w.totalEntregas > 0
            ? Math.round(w.noPrazo / w.totalEntregas * 1000) / 10
            : null;
        return {
            year: w.year,
            week: w.week,
            weekLabel: `S${String(w.week).padStart(2, '0')}/${w.year}`,
            totalEntregas: w.totalEntregas,
            noPrazo: w.noPrazo,
            performancePct: pct,
            semaforo: semaforo(pct),
        };
    });
}
async function getDeliveryPerformanceBatch(cnpjs, _days = 30) {
    if (cnpjs.length === 0)
        return {};
    const rows = await prisma_1.prisma.biDeliveryPerf.findMany({
        where: { cnpj: { in: cnpjs } },
    });
    const result = {};
    for (const r of rows) {
        result[r.cnpj] = { performancePct: r.performancePct, semaforo: semaforo(r.performancePct) };
    }
    return result;
}
async function getDeliveryPerformanceByFilial(cnpjs, _days = 30) {
    const rows = await prisma_1.prisma.biDeliveryFilial.findMany({
        where: { cnpj: { in: cnpjs } },
        orderBy: { totalEntregas: 'desc' },
    });
    return rows.map((r) => ({
        filial: r.filial,
        cidade: r.cidade,
        totalEntregas: r.totalEntregas,
        noPrazo: r.noPrazo,
        foraPrazo: r.foraPrazo,
        pendente: r.pendente,
        performancePct: r.performancePct,
        semaforo: semaforo(r.performancePct),
    }));
}
async function getDeliveryPerformanceWeekly(cnpjs, weeks = 12) {
    if (cnpjs.length === 0)
        return [];
    const rows = await prisma_1.prisma.biDeliveryPerfWeekly.findMany({
        where: { cnpj: { in: cnpjs } },
        orderBy: [{ year: 'asc' }, { week: 'asc' }],
    });
    const weekMap = new Map();
    for (const r of rows) {
        const key = `${r.year}-${r.week}`;
        const prev = weekMap.get(key);
        if (prev) {
            prev.totalEntregas += r.totalEntregas;
            prev.noPrazo += r.noPrazo;
        }
        else {
            weekMap.set(key, { year: r.year, week: r.week, totalEntregas: r.totalEntregas, noPrazo: r.noPrazo });
        }
    }
    const sorted = Array.from(weekMap.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week);
    const recent = sorted.slice(-weeks);
    return recent.map((w) => {
        const pct = w.totalEntregas > 0
            ? Math.round(w.noPrazo / w.totalEntregas * 1000) / 10
            : null;
        return {
            year: w.year,
            week: w.week,
            weekLabel: `S${String(w.week).padStart(2, '0')}/${w.year}`,
            totalEntregas: w.totalEntregas,
            noPrazo: w.noPrazo,
            performancePct: pct,
            semaforo: semaforo(pct),
        };
    });
}
async function getDeliveryPerformanceMonthly(cnpjs, months = 18) {
    if (cnpjs.length === 0)
        return [];
    const now = new Date();
    const rows = await prisma_1.prisma.biDeliveryPerfMonthly.findMany({
        where: { cnpj: { in: cnpjs } },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const monthMap = new Map();
    for (const r of rows) {
        const key = `${r.year}-${r.month}`;
        const prev = monthMap.get(key);
        if (prev) {
            prev.totalEntregas += r.totalEntregas;
            prev.noPrazo += r.noPrazo;
        }
        else {
            monthMap.set(key, { year: r.year, month: r.month, totalEntregas: r.totalEntregas, noPrazo: r.noPrazo });
        }
    }
    const sorted = Array.from(monthMap.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    const recent = sorted.slice(-months);
    return recent.map((m) => {
        const pct = m.totalEntregas > 0
            ? Math.round(m.noPrazo / m.totalEntregas * 1000) / 10
            : null;
        return {
            year: m.year,
            month: m.month,
            monthLabel: `${MONTH_NAMES[m.month - 1]}/${m.year}`,
            totalEntregas: m.totalEntregas,
            noPrazo: m.noPrazo,
            foraPrazo: m.totalEntregas - m.noPrazo,
            pendente: 0,
            performancePct: pct,
            semaforo: semaforo(pct),
            isCurrentMonth: m.year === now.getFullYear() && m.month === now.getMonth() + 1,
        };
    });
}
async function getExpansionPresentationWeekly(cnpjs, startDate) {
    if (cnpjs.length === 0)
        return [];
    const rows = await prisma_1.prisma.biDeliveryWeekly.findMany({
        where: { cnpj: { in: cnpjs } },
        orderBy: [{ year: 'asc' }, { week: 'asc' }],
    });
    const weekMap = new Map();
    for (const r of rows) {
        if (isoWeekStart(r.year, r.week) < startDate)
            continue;
        const key = `${r.year}-${r.week}`;
        const prev = weekMap.get(key);
        if (prev) {
            prev.totalNotas += r.totalNotas;
            prev.valorMercadoria += r.valorMercadoria;
            prev.valorFrete += r.valorFrete;
        }
        else {
            weekMap.set(key, { year: r.year, week: r.week, totalNotas: r.totalNotas, valorMercadoria: r.valorMercadoria, valorFrete: r.valorFrete });
        }
    }
    return Array.from(weekMap.values())
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week)
        .map((w) => ({
        year: w.year,
        week: w.week,
        weekLabel: `S${String(w.week).padStart(2, '0')}/${w.year}`,
        totalNotas: w.totalNotas,
        valorMercadoria: w.valorMercadoria,
        valorFrete: w.valorFrete,
        pctNota: w.valorMercadoria > 0
            ? Math.round(w.valorFrete / w.valorMercadoria * 100000) / 1000
            : null,
    }));
}
async function getExpansionPresentationMonthly(cnpjs, startDate) {
    if (cnpjs.length === 0)
        return [];
    const now = new Date();
    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth() + 1;
    const rows = await prisma_1.prisma.biDeliveryMonthly.findMany({
        where: { cnpj: { in: cnpjs } },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    const monthMap = new Map();
    for (const r of rows) {
        if (r.year < startYear || (r.year === startYear && r.month < startMonth))
            continue;
        const key = `${r.year}-${r.month}`;
        const prev = monthMap.get(key);
        if (prev) {
            prev.totalNotas += r.totalNotas;
            prev.valorMercadoria += r.valorMercadoria;
            prev.valorFrete += r.valorFrete;
        }
        else {
            monthMap.set(key, { year: r.year, month: r.month, totalNotas: r.totalNotas, valorMercadoria: r.valorMercadoria, valorFrete: r.valorFrete });
        }
    }
    return Array.from(monthMap.values())
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
        .map((m) => ({
        year: m.year,
        month: m.month,
        monthLabel: `${MONTH_NAMES[m.month - 1]}/${m.year}`,
        totalNotas: m.totalNotas,
        valorMercadoria: m.valorMercadoria,
        valorFrete: m.valorFrete,
        pctNota: m.valorMercadoria > 0
            ? Math.round(m.valorFrete / m.valorMercadoria * 100000) / 1000
            : null,
        isCurrentMonth: m.year === now.getFullYear() && m.month === now.getMonth() + 1,
    }));
}
//# sourceMappingURL=deliveryService.js.map