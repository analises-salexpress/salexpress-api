"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const exceljs_1 = __importDefault(require("exceljs"));
const auth_1 = require("../middleware/auth");
const roles_1 = require("../middleware/roles");
const prisma_1 = require("../db/prisma");
const expansionService_1 = require("../services/expansionService");
const analyticsService_1 = require("../services/analyticsService");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /reports/expansion/export
// Excel with all active expansion goals + current delta
router.get('/expansion/export', async (req, res) => {
    const goals = await prisma_1.prisma.expansionGoal.findMany({
        where: { status: 'ACTIVE' },
        include: {
            vendor: { select: { name: true } },
            card: { select: { clientName: true, status: true } },
        },
        orderBy: { startDate: 'asc' },
    });
    const wb = new exceljs_1.default.Workbook();
    const ws = wb.addWorksheet('Expansão de Clientes');
    ws.columns = [
        { header: 'Cliente', key: 'clientName', width: 35 },
        { header: 'CNPJ', key: 'clientId', width: 20 },
        { header: 'Vendedor', key: 'vendor', width: 25 },
        { header: 'Status Card', key: 'cardStatus', width: 18 },
        { header: 'Início', key: 'startDate', width: 14 },
        { header: 'Baseline (mês)', key: 'baselineAvg', width: 18 },
        { header: 'Atual (3 meses)', key: 'currentQuarter', width: 18 },
        { header: 'Delta', key: 'delta', width: 16 },
        { header: 'Meta', key: 'targetValue', width: 16 },
        { header: 'Meta atingida', key: 'targetHit', width: 16 },
    ];
    // Style header row
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' },
    };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (const g of goals) {
        const recentMonths = await (0, analyticsService_1.getClientRecentMonths)(g.clientId, 3);
        const now = new Date();
        const completed = recentMonths.filter((r) => r.year < now.getFullYear() || (r.year === now.getFullYear() && r.month < now.getMonth() + 1));
        const currentQuarter = completed.slice(-3).reduce((s, r) => s + r.billing, 0);
        const baselineQuarter = g.baselineAvg * 3;
        const delta = currentQuarter - baselineQuarter;
        ws.addRow({
            clientName: g.card?.clientName ?? g.clientId,
            clientId: g.clientId,
            vendor: g.vendor.name,
            cardStatus: g.card?.status ?? '—',
            startDate: g.startDate.toLocaleDateString('pt-BR'),
            baselineAvg: g.baselineAvg,
            currentQuarter: Math.round(currentQuarter * 100) / 100,
            delta: Math.round(delta * 100) / 100,
            targetValue: g.targetValue ?? '—',
            targetHit: g.targetValue != null && delta >= g.targetValue ? 'Sim' : 'Não',
        });
    }
    // Color negative deltas red
    ws.eachRow((row, rowNum) => {
        if (rowNum === 1)
            return;
        const deltaCell = row.getCell('delta');
        if (typeof deltaCell.value === 'number' && deltaCell.value < 0) {
            deltaCell.font = { color: { argb: 'FFD32F2F' } };
        }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="expansao-${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
});
// GET /reports/opportunities/export (manager only)
router.get('/opportunities/export', (0, roles_1.requireRole)(client_1.Role.MANAGER), async (_req, res) => {
    const { opportunities } = await (0, expansionService_1.getOpportunities)(500, 0);
    const wb = new exceljs_1.default.Workbook();
    const ws = wb.addWorksheet('Oportunidades de Expansão');
    ws.columns = [
        { header: 'Posição', key: 'rank', width: 10 },
        { header: 'Cliente', key: 'clientName', width: 35 },
        { header: 'CNPJ', key: 'cnpj', width: 20 },
        { header: 'Cidade', key: 'city', width: 20 },
        { header: 'Estado', key: 'state', width: 10 },
        { header: 'Segmento', key: 'segment', width: 18 },
        { header: 'Curva', key: 'curve', width: 10 },
        { header: 'Baseline (mês)', key: 'baselineBilling', width: 18 },
        { header: 'Billing atual', key: 'currentBilling', width: 18 },
        { header: 'Rotas não cobertas', key: 'uncoveredRoutesCount', width: 20 },
        { header: 'Potencial rotas (R$)', key: 'uncoveredRevenueEstimate', width: 22 },
        { header: 'Gap de queda (R$)', key: 'declineGap', width: 18 },
        { header: 'Score total', key: 'totalScore', width: 16 },
        { header: 'Card ativo', key: 'hasKanbanCard', width: 14 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' },
    };
    opportunities.forEach((o, idx) => {
        ws.addRow({
            rank: idx + 1,
            clientName: o.clientName,
            cnpj: o.cnpj,
            city: o.city ?? '—',
            state: o.state ?? '—',
            segment: o.segment ?? '—',
            curve: o.curve ?? '—',
            baselineBilling: o.baselineBilling,
            currentBilling: o.currentBilling,
            uncoveredRoutesCount: o.uncoveredRoutesCount,
            uncoveredRevenueEstimate: o.uncoveredRevenueEstimate,
            declineGap: o.declineGap,
            totalScore: o.totalScore,
            hasKanbanCard: o.hasKanbanCard ? 'Sim' : 'Não',
        });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="oportunidades-${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
});
exports.default = router;
//# sourceMappingURL=reports.js.map