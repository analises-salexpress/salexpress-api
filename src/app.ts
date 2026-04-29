import express from 'express'
import cors from 'cors'
import path from 'path'
import authRoutes from './routes/auth'
import usersRoutes from './routes/users'
import insightsRoutes from './routes/insights'
import clientsRoutes from './routes/clients'
import kanbanRoutes from './routes/kanban'
import metricsRoutes from './routes/metrics'
import filesRoutes from './routes/files'
import messagesRoutes from './routes/messages'
import reportsRoutes from './routes/reports'

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
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() })
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

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

// Global error handler — catches unhandled throws from async routes
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Erro interno do servidor' })
})

export default app
