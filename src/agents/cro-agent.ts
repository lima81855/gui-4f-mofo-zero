import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readTextOrNull, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  BudgetRulesSchema,
  CroPlanSchema,
  DailyMetricsSchema,
  DesignBriefSchema,
  FunnelStrategySchema,
  OfferBriefSchema,
  OptimizationDecisionSchema,
  TrackingPlanSchema,
  type BudgetRules,
  type CroAgentInput,
  type CroAgentOutput,
  type CroPlan,
  type DailyMetrics,
  type DesignBrief,
  type FunnelStrategy,
  type OfferBrief,
  type OptimizationDecision,
  type TrackingPlan,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  offer: OfferBrief
}

type FunnelStrategyFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  strategy: FunnelStrategy
}

type DesignBriefFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  designBrief: DesignBrief
}

type TrackingPlanFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  trackingPlan: TrackingPlan
}

type OptimizationDecisionFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  decision: OptimizationDecision
}

type BudgetRulesFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  budgetRules: BudgetRules
}

type DailyMetricsFile = {
  metadata?: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  metrics?: DailyMetrics
}

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) {
    return selector
  }

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new CroAgentError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new CroAgentError(`Oferta nao encontrada para seletor: ${selector}`)
}

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const fs = await import('fs/promises')
    const projectRoot = path.resolve(__dirname, '..', '..')
    const resolved = path.join(projectRoot, dirPath)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => `${dirPath}/${entry.name}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function loadOfferBrief(ideaId: string): Promise<OfferBrief> {
  const file = await readJson<OfferBriefFile>(`data/offers/${ideaId}/offer-brief.json`)
  return OfferBriefSchema.parse(file.offer)
}

async function loadFunnelStrategy(ideaId: string): Promise<FunnelStrategy> {
  const file = await readJson<FunnelStrategyFile>(`data/funnels/${ideaId}/funnel-strategy.json`)
  return FunnelStrategySchema.parse(file.strategy)
}

async function loadDesignBrief(ideaId: string): Promise<DesignBrief> {
  const file = await readJson<DesignBriefFile>(`data/design/${ideaId}/design-brief.json`)
  return DesignBriefSchema.parse(file.designBrief)
}

async function loadTrackingPlan(ideaId: string): Promise<TrackingPlan> {
  const file = await readJson<TrackingPlanFile>(`data/tracking/${ideaId}/tracking-plan.json`)
  return TrackingPlanSchema.parse(file.trackingPlan)
}

async function loadOptimizationDecision(ideaId: string): Promise<OptimizationDecision | null> {
  const filePath = `data/optimization/${ideaId}/decision-log.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<OptimizationDecisionFile>(filePath)
  return OptimizationDecisionSchema.parse(file.decision)
}

async function loadBudgetRules(ideaId: string): Promise<BudgetRules | null> {
  const filePath = `data/finance/${ideaId}/budget-rules.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<BudgetRulesFile>(filePath)
  return BudgetRulesSchema.parse(file.budgetRules)
}

async function loadDailyMetrics(ideaId: string): Promise<DailyMetrics | null> {
  const filePath = `data/metrics/${ideaId}/daily-metrics.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<DailyMetricsFile | DailyMetrics>(filePath)
  if ('metrics' in file && file.metrics) return DailyMetricsSchema.parse(file.metrics)
  return DailyMetricsSchema.parse(file)
}

function compactText(text: string | null, maxChars: number): string {
  if (!text) return 'Arquivo nao encontrado.'
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[conteudo cortado para caber no contexto]`
}

function buildCroPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  salesPage: string | null,
  designBrief: DesignBrief,
  trackingPlan: TrackingPlan,
  decision: OptimizationDecision | null,
  budgetRules: BudgetRules | null,
  metrics: DailyMetrics | null,
  skillContent: string,
): string {
  return `Voce e o cro-agent de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e transformar oferta, pagina, checkout, tracking, metricas e caixa em um plano concreto de conversao.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
ID: ${offer.ideaId}
Produto: ${offer.productName}
Publico: ${offer.targetAudience}
Problema: ${offer.urgentProblem}
Desejo: ${offer.desire}
Promessa: ${offer.uniquePromise}
Mecanismo: ${offer.uniqueMechanism}
Preco: ${offer.price}
Order bump: ${offer.orderBump.name} - ${offer.orderBump.price}
Upsell: ${offer.upsell.name} - ${offer.upsell.price}
Garantia: ${offer.guarantee}
Stack:
${offer.offerStack.map(item => `- ${item}`).join('\n')}
Objecoes:
${offer.objections.map(item => `- ${item}`).join('\n')}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## FUNIL
${JSON.stringify(funnel, null, 2)}

## COPY DA PAGINA
${compactText(salesPage, 7000)}

## DESIGN
${JSON.stringify(designBrief, null, 2)}

## TRACKING
readyForTraffic: ${trackingPlan.readyForTraffic ? 'sim' : 'nao'}
${JSON.stringify(trackingPlan, null, 2)}

## DECISAO DE METRICAS
${decision ? JSON.stringify(decision, null, 2) : 'Nenhuma decisao de metricas encontrada.'}

## FINANCEIRO
${budgetRules ? JSON.stringify(budgetRules, null, 2) : 'Nenhuma regra financeira encontrada.'}

## METRICAS REAIS
${metrics ? JSON.stringify(metrics, null, 2) : 'Nenhum arquivo data/metrics/{ideaId}/daily-metrics.json encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Se nao houver metricas reais, mode deve ser "pre-lancamento".
- Se houver metricas reais, mode deve ser "com-dados".
- Se trackingPlan.readyForTraffic for false, nao recomende teste pago ao vivo; priorize QA, eventos e ajustes de baixo risco.
- Se budgetRules.cashStatus for "bloqueado", nao recomende liberar verba.
- Em modo pre-lancamento, nao chame ajustes de "teste A/B"; chame de variacao para QA, revisao interna ou backlog de teste futuro.
- Nao invente conversao, CTR, CPA, ROAS, receita, compras ou dados de checkout.
- Nao use promessas absolutas, prova falsa, certificacao inexistente, depoimento inventado, antes/depois ou prova visual sem origem verificavel.
- Separe pedidos para pagina, checkout, oferta, tracking e criativos.
- Inclua pelo menos 6 testes, priorizados.
- Cada teste deve mudar uma variavel principal e ter metrica de sucesso e metrica de guarda.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "mode": "pre-lancamento | com-dados",
  "summary": "",
  "mainBottleneck": "",
  "tests": [
    {
      "name": "",
      "area": "primeira-dobra | oferta | prova | checkout | preco | order-bump | upsell | mobile | tracking | copy",
      "priority": "alta | media | baixa",
      "hypothesis": "",
      "change": "",
      "successMetric": "",
      "guardrailMetric": ""
    }
  ],
  "pageRequests": [],
  "checkoutRequests": [],
  "offerRequests": [],
  "trackingRequests": [],
  "creativeRequests": [],
  "doNotChangeYet": [],
  "riskNotes": []
}`
}

function renderMarkdown(plan: CroPlan): string {
  return `# CRO Plan

ideaId: ${plan.ideaId}

mode: ${plan.mode}

## Resumo
${plan.summary}

## Gargalo principal
${plan.mainBottleneck}

## Testes priorizados
${plan.tests.map((test, index) => `${index + 1}. ${test.name}
   - Area: ${test.area}
   - Prioridade: ${test.priority}
   - Hipotese: ${test.hypothesis}
   - Mudanca: ${test.change}
   - Metrica de sucesso: ${test.successMetric}
   - Metrica de guarda: ${test.guardrailMetric}`).join('\n\n')}

## Pedidos para pagina
${plan.pageRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para checkout
${plan.checkoutRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para oferta
${plan.offerRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para tracking
${plan.trackingRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para criativos
${plan.creativeRequests.map(item => `- ${item}`).join('\n')}

## Nao mudar ainda
${plan.doNotChangeYet.map(item => `- ${item}`).join('\n')}

## Riscos
${plan.riskNotes.map(item => `- ${item}`).join('\n')}
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemToString(item: unknown): string {
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (Array.isArray(item)) return item.map(itemToString).filter(Boolean).join('; ')
  if (isRecord(item)) {
    return Object.entries(item)
      .map(([key, value]) => `${key}: ${itemToString(value)}`)
      .join('; ')
  }
  return ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(itemToString).filter(Boolean)
}

function normalizeCroPlan(response: unknown): unknown {
  if (!isRecord(response)) return response

  const tests = Array.isArray(response.tests)
    ? response.tests.map(test => {
      if (!isRecord(test)) return test
      return {
        ...test,
        name: itemToString(test.name),
        hypothesis: itemToString(test.hypothesis),
        change: itemToString(test.change),
        successMetric: itemToString(test.successMetric),
        guardrailMetric: itemToString(test.guardrailMetric),
      }
    })
    : []

  return {
    ...response,
    tests,
    pageRequests: stringArray(response.pageRequests),
    checkoutRequests: stringArray(response.checkoutRequests),
    offerRequests: stringArray(response.offerRequests),
    trackingRequests: stringArray(response.trackingRequests),
    creativeRequests: stringArray(response.creativeRequests),
    doNotChangeYet: stringArray(response.doNotChangeYet),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runCroAgent(input: CroAgentInput): Promise<CroAgentOutput> {
  const startTime = Date.now()

  logger.info('Agente 16 (CroAgent) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const salesPage = await readTextOrNull(`data/funnels/${ideaId}/sales-page.md`)
  const designBrief = await loadDesignBrief(ideaId)
  const trackingPlan = await loadTrackingPlan(ideaId)
  const decision = await loadOptimizationDecision(ideaId)
  const budgetRules = await loadBudgetRules(ideaId)
  const metrics = await loadDailyMetrics(ideaId)
  const skillContent = await loadSkillContent('low-ticket-cro-playbook')

  if (!skillContent) {
    throw new CroAgentError('Skill low-ticket-cro-playbook nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce e especialista em CRO para low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildCroPrompt(
          offer,
          funnel,
          salesPage,
          designBrief,
          trackingPlan,
          decision,
          budgetRules,
          metrics,
          skillContent,
        ),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const croPlan = CroPlanSchema.parse(normalizeCroPlan(parsed))

  const outputDir = input.outputDir ?? `data/cro/${ideaId}`
  await ensureDir(outputDir)

  const croPlanPath = `${outputDir}/cro-plan.json`
  const markdownPath = `${outputDir}/cro-plan.md`

  await writeJson(croPlanPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    croPlan,
  })
  await writeText(markdownPath, renderMarkdown(croPlan))

  const durationMs = Date.now() - startTime
  logger.info('Agente 16 (CroAgent) - concluido', {
    ideaId,
    croPlanPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    croPlanPath,
    markdownPath,
    durationMs,
  }
}

export class CroAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CroAgentError'
  }
}
