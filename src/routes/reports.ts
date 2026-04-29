import { Router } from 'express'
import ExcelJS from 'exceljs'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/roles'
import { prisma } from '../db/prisma'
import { getOpportunities } from '../services/expansionService'
import { getClientRecentMonths } from '../services/analyticsService'
import { Role } from '@prisma/client'

const router = Router()

router.use(authenticate)

// GET /reports/expansion/export
// Excel with all active expansion goals + current delta
router.get('/expansion/export', async (req, res) => {
  const goals = await prisma.expansionGoal.findMany({
    where: { status: 'ACTIVE' },
    include: {
      vendor: { select: { name: true } },
      card:   { select: { clientName: true, status: true } },
    },
    orderBy: { startDate: 'asc' },
  })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Expansão de Clientes')

  ws.columns = [
    { header: 'Cliente',        key: 'clientName',      width: 35 },
    { header: 'CNPJ',           key: 'clientId',        width: 20 },
    { header: 'Vendedor',       key: 'vendor',          width: 25 },
    { header: 'Status Card',    key: 'cardStatus',      width: 18 },
    { header: 'Início',         key: 'startDate',       width: 14 },
    { header: 'Baseline (mês)', key: 'baselineAvg',     width: 18 },
    { header: 'Atual (3 meses)',key: 'currentQuarter',  width: 18 },
    { header: 'Delta',          key: 'delta',           width: 16 },
    { header: 'Meta',           key: 'targetValue',     width: 16 },
    { header: 'Meta atingida',  key: 'targetHit',       width: 16 },
  ]

  // Style header row
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' },
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  for (const g of goals) {
    const recentMonths = await getClientRecentMonths(g.clientId, 3)
    const now = new Date()
    const completed = recentMonths.filter(
      (r) => r.year < now.getFullYear() || (r.year === now.getFullYear() && r.month < now.getMonth() + 1),
    )
    const currentQuarter = completed.slice(-3).reduce((s, r) => s + r.billing, 0)
    const baselineQuarter = g.baselineAvg * 3
    const delta = currentQuarter - baselineQuarter

    ws.addRow({
      clientName:     g.card?.clientName ?? g.clientId,
      clientId:       g.clientId,
      vendor:         g.vendor.name,
      cardStatus:     g.card?.status ?? '—',
      startDate:      g.startDate.toLocaleDateString('pt-BR'),
      baselineAvg:    g.baselineAvg,
      currentQuarter: Math.round(currentQuarter * 100) / 100,
      delta:          Math.round(delta * 100) / 100,
      targetValue:    g.targetValue ?? '—',
      targetHit:      g.targetValue != null && delta >= g.targetValue ? 'Sim' : 'Não',
    })
  }

  // Color negative deltas red
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const deltaCell = row.getCell('delta')
    if (typeof deltaCell.value === 'number' && deltaCell.value < 0) {
      deltaCell.font = { color: { argb: 'FFD32F2F' } }
    }
  })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="expansao-${Date.now()}.xlsx"`)

  await wb.xlsx.write(res)
  res.end()
})

// GET /reports/opportunities/export (manager only)
router.get('/opportunities/export', requireRole(Role.MANAGER), async (_req, res) => {
  const { opportunities } = await getOpportunities(500, 0)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Oportunidades de Expansão')

  ws.columns = [
    { header: 'Posição',              key: 'rank',                  width: 10 },
    { header: 'Cliente',              key: 'clientName',            width: 35 },
    { header: 'CNPJ',                 key: 'cnpj',                  width: 20 },
    { header: 'Cidade',               key: 'city',                  width: 20 },
    { header: 'Estado',               key: 'state',                 width: 10 },
    { header: 'Segmento',             key: 'segment',               width: 18 },
    { header: 'Curva',                key: 'curve',                 width: 10 },
    { header: 'Baseline (mês)',        key: 'baselineBilling',       width: 18 },
    { header: 'Billing atual',         key: 'currentBilling',        width: 18 },
    { header: 'Rotas não cobertas',   key: 'uncoveredRoutesCount',  width: 20 },
    { header: 'Potencial rotas (R$)', key: 'uncoveredRevenueEstimate', width: 22 },
    { header: 'Gap de queda (R$)',    key: 'declineGap',            width: 18 },
    { header: 'Score total',          key: 'totalScore',            width: 16 },
    { header: 'Card ativo',           key: 'hasKanbanCard',         width: 14 },
  ]

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' },
  }

  opportunities.forEach((o, idx) => {
    ws.addRow({
      rank:                    idx + 1,
      clientName:              o.clientName,
      cnpj:                    o.cnpj,
      city:                    o.city ?? '—',
      state:                   o.state ?? '—',
      segment:                 o.segment ?? '—',
      curve:                   o.curve ?? '—',
      baselineBilling:         o.baselineBilling,
      currentBilling:          o.currentBilling,
      uncoveredRoutesCount:    o.uncoveredRoutesCount,
      uncoveredRevenueEstimate: o.uncoveredRevenueEstimate,
      declineGap:              o.declineGap,
      totalScore:              o.totalScore,
      hasKanbanCard:           o.hasKanbanCard ? 'Sim' : 'Não',
    })
  })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="oportunidades-${Date.now()}.xlsx"`)

  await wb.xlsx.write(res)
  res.end()
})

export default router
