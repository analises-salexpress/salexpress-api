import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { swaggerSpec } from './swagger'
import authRoutes from './routes/auth'
import usersRoutes from './routes/users'
import insightsRoutes from './routes/insights'
import clientsRoutes from './routes/clients'
import kanbanRoutes from './routes/kanban'
import metricsRoutes from './routes/metrics'
import filesRoutes from './routes/files'
import messagesRoutes from './routes/messages'
import reportsRoutes from './routes/reports'
import chatRoutes from './routes/chat'

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.1.5', timestamp: new Date().toISOString() })
})

app.get('/diag', async (_req, res) => {
  const { prisma } = await import('./db/prisma')
  const results: Record<string, string> = {}
  const tests: [string, () => Promise<unknown>][] = [
    ['user.count', () => prisma.user.count()],
    ['kanbanCard.count', () => prisma.kanbanCard.count()],
    ['biClient.count', () => prisma.biClient.count()],
    ['biClientMonthly.count', () => prisma.biClientMonthly.count()],
    ['expansionGoal.count', () => prisma.expansionGoal.count()],
  ]
  for (const [name, fn] of tests) {
    try {
      const r = await fn()
      results[name] = String(r)
    } catch (e: any) {
      results[name] = 'ERROR: ' + e?.message?.substring(0, 100)
    }
  }
  res.json(results)
})

app.get('/diag/dim-bases', async (_req, res) => {
  const mysql = await import('mysql2/promise')
  let conn: any = null
  try {
    conn = await mysql.createConnection({
      host:     process.env.BI_DB_HOST!,
      port:     Number(process.env.BI_DB_PORT ?? 3306),
      user:     process.env.BI_DB_USER!,
      password: process.env.BI_DB_PASSWORD!,
      database: process.env.BI_DB_NAME ?? 'bexsal_dw',
      timezone: '-03:00',
    })
    const [rows] = await conn.query(`
      SELECT sigla, regiao_resumida AS mesoregiao, nome_base AS nome_praca
      FROM bexsal_dw.dim_bases
      WHERE sigla IS NOT NULL AND sigla != ''
      ORDER BY mesoregiao, sigla
    `)
    const grouped: Record<string, { sigla: string; nome_praca: string }[]> = {}
    for (const r of rows as any[]) {
      const key = r.mesoregiao ?? '(sem mesoregiao)'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push({ sigla: r.sigla, nome_praca: r.nome_praca })
    }
    res.json({ total: (rows as any[]).length, mesoregions: grouped })
  } catch (e: any) {
    res.status(500).json({ error: e?.message })
  } finally {
    await conn?.end()
  }
})

app.get('/diag/client-routes/:cnpj', async (req, res) => {
  const mysql = await import('mysql2/promise')
  let conn: any = null
  try {
    conn = await mysql.createConnection({
      host:     process.env.BI_DB_HOST!,
      port:     Number(process.env.BI_DB_PORT ?? 3306),
      user:     process.env.BI_DB_USER!,
      password: process.env.BI_DB_PASSWORD!,
      database: process.env.BI_DB_NAME ?? 'bexsal_dw',
      timezone: '-03:00',
    })
    const cnpj = req.params.cnpj.replace(/\D/g, '')
    const [rows] = await conn.query(`
      SELECT
        LEFT(fn.praca_destino, 3)  AS sigla,
        db.regiao_resumida         AS mesoregiao,
        COUNT(*)                   AS entregas
      FROM bexsal_dw.fato_notas fn
      LEFT JOIN bexsal_dw.dim_bases db ON LEFT(fn.praca_destino, 3) = db.sigla
      WHERE fn.cnpj_pagador = ?
        AND fn.tipo_documento IN ('NORMAL', 'SUBC FORM CTRC', 'REDESPACHO')
        AND fn.tipo_baixa NOT IN ('LIQU OCOR', 'CANCELADO')
        AND YEAR(fn.data_emissao) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
        AND MONTH(fn.data_emissao) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
      GROUP BY LEFT(fn.praca_destino, 3), db.regiao_resumida
      ORDER BY entregas DESC
    `, [cnpj])
    const semMapeamento = (rows as any[]).filter((r: any) => !r.mesoregiao)
    res.json({
      cnpj,
      mes: 'ultimo mes completo',
      total_siglas: (rows as any[]).length,
      siglas_sem_mapeamento: semMapeamento.length,
      rotas: rows,
    })
  } catch (e: any) {
    res.status(500).json({ error: e?.message })
  } finally {
    await conn?.end()
  }
})

app.get('/docs/openapi.json', (_req, res) => {
  res.json(swaggerSpec)
})

app.get('/docs', (_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Sal Express API</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/docs/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      persistAuthorization: true,
    })
  </script>
</body>
</html>`)
})

app.use('/auth', authRoutes)
app.use('/users', usersRoutes)
app.use('/insights', insightsRoutes)
app.use('/clients', clientsRoutes)
app.use('/kanban', kanbanRoutes)
app.use('/metrics', metricsRoutes)
app.use('/files', filesRoutes)
app.use('/messages', messagesRoutes)
app.use('/reports', reportsRoutes)
app.use('/chat', chatRoutes)

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

// Global error handler — catches unhandled throws from async routes
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Erro interno do servidor' })
})

export default app
