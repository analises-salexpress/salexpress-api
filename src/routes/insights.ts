import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { getOpportunities, getClientExpansionDetail } from '../services/expansionService'
import { getClientById } from '../services/analyticsService'

const router = Router()

router.use(authenticate)

// GET /insights/opportunities?limit=50&offset=0
router.get('/opportunities', async (req, res) => {
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const { opportunities, total } = await getOpportunities(limit, offset)

  res.json({ data: opportunities, total, limit, offset })
})

// GET /insights/client/:cnpj
router.get('/client/:cnpj', async (req, res) => {
  const { cnpj } = req.params

  const [client, detail] = await Promise.all([
    getClientById(cnpj),
    getClientExpansionDetail(cnpj),
  ])

  if (!client) {
    res.status(404).json({ error: 'Client not found in BI cache' })
    return
  }

  res.json({ client, ...detail })
})

export default router
