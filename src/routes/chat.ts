import { Router } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { authenticate } from '../middleware/auth'
import { AuthenticatedRequest } from '../types'
import {
  toolGetOverview,
  toolGetTopClients,
  toolGetClientDetail,
  toolGetChurnRisk,
  toolGetGrowthClients,
  toolGetRouteAnalysis,
  toolSearchClients,
} from '../services/chatDataService'

const router = Router()
router.use(authenticate)

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é o analista de inteligência comercial da Sal Express — empresa de transporte de cargas fracionadas urgentes que opera em MG, ES e SP. Sua audiência principal é o João Otávio Penha, Gerente Executivo Comercial.

## A empresa
A Sal Express é uma transportadora B2B especializada em fretes fracionados urgentes. Atende indústrias, distribuidores, laboratórios e empresas de varejo em Minas Gerais, Espírito Santo e São Paulo. As rotas são organizadas por mesorregião geográfica de destino. A empresa não faz 100% da carga dos seus clientes — existe sempre potencial de expansão com novos destinos ou maior volume nas rotas existentes.

## Dados disponíveis (sincronizados diariamente às 9h, D-1)

**bi_clients** — Cadastro de clientes ativos nos últimos 18 meses
- cnpj, name, groupedName, city, state
- segment: segmento de mercado (derivado do tipo de mercadoria transportada)
- curve: curva ABC (A = maior volume, B = intermediário, C = menor volume)
- tipo: tipo do cliente

**bi_client_monthly** — Faturamento mensal por cliente (18 meses de histórico)
- billing: faturamento em R$ (inclui: NORMAL, SUBC FORM CTRC, REDESPACHO; exclui cancelados)
- deliveriesCount: quantidade de CTRCs (cada CTRC = 1 entrega/coleta)
- volumesCount: volumes transportados
- totalWeightKg: peso bruto em kg
- avgTicket por CTRC = billing / deliveriesCount

**bi_client_daily** — Faturamento diário (últimos 180 dias)
- Inclui TODOS os tipos de documento (inclusive reentregas, ocorrências)
- Usado para análise de clientes em expansão

**bi_client_weekly** — Faturamento semanal (últimas 10 semanas)

**bi_client_routes** — Mesorregiões usadas por cada cliente
- region: mesorregião de destino
- tripCount: CTRCs no último mês nessa rota
- totalRevenue: receita total histórica nessa rota
- recentMonthlyAvg: média mensal recente
- firstSeen / lastSeen: quando o cliente começou/usou por último essa rota

**bi_all_routes** — Todas as rotas que a Sal Express opera (referência do mercado)
- Ticket médio, volume total, quantidade de clientes por rota

## Conceitos-chave
- **CTRC**: Conhecimento de Transporte Rodoviário de Carga — cada entrega/coleta gera um CTRC
- **Ticket médio**: billing / deliveriesCount — indica o valor médio por entrega
- **Churn**: cliente com queda consistente de faturamento — risco de perder para concorrente
- **Expansão**: cliente que aumenta volume ou passa a usar novas mesorregiões
- **Curva A**: clientes estratégicos, maior proteção e atenção comercial
- **Mesorregião**: agrupamento geográfico dos municípios de destino (ex: Vale do Rio Doce, Zona da Mata, RMBH, Litoral Norte ES)

## Sua missão
Você analisa como CEO + analista sênior de mercado de transportes. Vá além do número bruto:
- Explique o que o dado significa comercialmente
- Identifique padrões, anomalias, riscos e oportunidades
- Conecte tendências a ações práticas para o time de vendas
- Quando identificar algo crítico, destaque em **negrito**
- Use markdown com headers e tabelas quando ajudar a organizar a resposta
- Seja direto — João precisa de insight acionável, não de relatório genérico

Sempre busque os dados antes de responder. Se precisar de mais detalhes sobre um cliente específico, busque o detalhe dele.`

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_overview',
    description: 'Visão geral da empresa: faturamento total, tendência mensal, breakdown por segmento, estado, curva ABC e top rotas. Use para perguntas gerais sobre a empresa.',
    input_schema: {
      type: 'object',
      properties: {
        months_back: { type: 'number', description: 'Quantos meses de histórico (padrão: 6)' },
      },
    },
  },
  {
    name: 'get_top_clients',
    description: 'Top clientes por faturamento em um período. Pode filtrar por segmento, estado ou curva ABC.',
    input_schema: {
      type: 'object',
      properties: {
        limit:       { type: 'number', description: 'Quantidade de clientes (padrão: 20)' },
        months_back: { type: 'number', description: 'Período em meses (padrão: 3)' },
        segment:     { type: 'string', description: 'Filtrar por segmento (opcional)' },
        state:       { type: 'string', description: 'Filtrar por estado UF (opcional)' },
        curve:       { type: 'string', description: 'Filtrar por curva A, B ou C (opcional)' },
      },
    },
  },
  {
    name: 'get_client_detail',
    description: 'Detalhe completo de um cliente: histórico mensal, tendência, rotas usadas e semanas recentes. Busque por CNPJ ou nome parcial.',
    input_schema: {
      type: 'object',
      properties: {
        cnpj: { type: 'string', description: 'CNPJ do cliente (somente números)' },
        name: { type: 'string', description: 'Nome parcial do cliente' },
      },
    },
  },
  {
    name: 'get_churn_risk',
    description: 'Clientes com queda de faturamento significativa — risco de churn. Compara média dos últimos 3 meses vs 3 meses anteriores.',
    input_schema: {
      type: 'object',
      properties: {
        threshold_pct: { type: 'number', description: 'Queda mínima em % para alertar (padrão: 20)' },
        limit:         { type: 'number', description: 'Quantidade máxima de clientes (padrão: 25)' },
      },
    },
  },
  {
    name: 'get_growth_clients',
    description: 'Clientes com maior crescimento de faturamento. Ordenados por crescimento absoluto mensal (R$).',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Quantidade (padrão: 20)' },
      },
    },
  },
  {
    name: 'get_route_analysis',
    description: 'Análise de todas as mesorregiões: receita total, ticket médio, volume de CTRCs, clientes ativos por rota.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_clients',
    description: 'Busca clientes por nome ou CNPJ. Use para encontrar o CNPJ de um cliente antes de chamar get_client_detail.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nome parcial ou CNPJ' },
        limit: { type: 'number', description: 'Quantidade máxima (padrão: 10)' },
      },
      required: ['query'],
    },
  },
]

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'get_overview':       return toolGetOverview(input)
    case 'get_top_clients':    return toolGetTopClients(input)
    case 'get_client_detail':  return toolGetClientDetail(input)
    case 'get_churn_risk':     return toolGetChurnRisk(input)
    case 'get_growth_clients': return toolGetGrowthClients(input)
    case 'get_route_analysis': return toolGetRouteAnalysis()
    case 'search_clients':     return toolSearchClients(input as { query: string; limit?: number })
    default: return { error: `Ferramenta desconhecida: ${name}` }
  }
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string(),
})

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1),
})

router.post('/analyze', async (req: AuthenticatedRequest, res) => {
  const body = bodySchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor' })
    return
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Mutable copy — Claude tool-use loop appends assistant + tool_result turns
  const messages: Anthropic.MessageParam[] = body.data.messages.map((m) => ({
    role:    m.role,
    content: m.content,
  }))

  const MAX_ITERATIONS = 6 // prevent infinite loops
  let iterations = 0

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      tools:      TOOLS,
      messages,
    })

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      res.json({ role: 'assistant', content: text })
      return
    }

    if (response.stop_reason === 'tool_use') {
      // Append assistant message with tool calls
      messages.push({ role: 'assistant', content: response.content })

      // Execute all tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          try {
            const result = await executeTool(block.name, block.input as Record<string, any>)
            toolResults.push({
              type:        'tool_result',
              tool_use_id: block.id,
              content:     JSON.stringify(result),
            })
          } catch (err: any) {
            toolResults.push({
              type:        'tool_result',
              tool_use_id: block.id,
              content:     JSON.stringify({ error: err?.message ?? 'Erro ao buscar dados' }),
            })
          }
        }
      }

      messages.push({ role: 'user', content: toolResults })
      continue
    }

    // Unexpected stop reason
    break
  }

  res.status(500).json({ error: 'Não foi possível gerar uma resposta. Tente novamente.' })
})

export default router
