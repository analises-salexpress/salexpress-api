import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { getClients, getClientById, getClientMonthly, getClientRoutes } from '../services/analyticsService'

const router = Router()

router.use(authenticate)

// GET /clients?search=&state=MG&segment=&curve=A&limit=50&offset=0
router.get('/', async (req, res) => {
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  try {
    const { clients, total } = await getClients({
      search:  req.query.search  as string | undefined,
      state:   req.query.state   as string | undefined,
      segment: req.query.segment as string | undefined,
      curve:   req.query.curve   as string | undefined,
      limit,
      offset,
    })
    res.json({ data: clients, total, limit, offset })
  } catch (err: any) {
    console.error('[clients] error:', err?.message)
    res.status(500).json({ error: 'Erro ao buscar clientes', detail: err?.message })
  }
})

// GET /clients/:cnpj
router.get('/:cnpj', async (req, res) => {
  const { cnpj } = req.params

  const [client, monthly, routes] = await Promise.all([
    getClientById(cnpj),
    getClientMonthly(cnpj),
    getClientRoutes(cnpj),
  ])

  if (!client) {
    res.status(404).json({ error: 'Client not found' })
    return
  }

  res.json({ client, monthly, routes })
})

export default router
