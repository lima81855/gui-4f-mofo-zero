import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  DailyMetricsSchema,
  MediaPlanSchema,
  OfferBriefSchema,
  OptimizationDecisionSchema,
  TrackingPlanSchema,
  type DailyMetrics,
  type MediaPlan,
  type MetricsAnalystInput,
  type MetricsAnalystOutput,
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

type TrackingPlanFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  trackingPlan: TrackingPlan
}

type MediaPlanFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  mediaPlan: MediaPlan
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
    throw new MetricsAnalystError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new MetricsAnalystError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadTrackingPlan(ideaId: string): Promise<TrackingPlan> {
  const file = await readJson<TrackingPlanFile>(`data/tracking/${ideaId}/tracking-plan.json`)
  return TrackingPlanSchema.parse(file.trackingPlan)
}

async function loadMediaPlan(ideaId: string): Promise<MediaPlan> {
  const file = await readJson<MediaPlanFile>(`data/media/${ideaId}/launch-plan.json`)
  return MediaPlanSchema.parse(file.mediaPlan)
}

async function loadDailyMetrics(ideaId: string): Promise<DailyMetrics | null> {
  const filePath = `data/metrics/${ideaId}/daily-metrics.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<DailyMetricsFile | DailyMetrics>(filePath)
  if ('metrics' in file && file.metrics) return DailyMetricsSchema.parse(file.metrics)
  return DailyMetricsSchema.parse(file)
}

function buildMetricsPrompt(
  offer: OfferBrief,
  trackingPlan: TrackingPlan,
  mediaPlan: MediaPlan,
  metrics: DailyMetrics | null,
  skillContent: string,
): string {
  return `Voce e o metrics-analyst de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e ler dados reais da oferta e decidir a proxima acao operacional sem chutar.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
ID: ${offer.ideaId}
Produto: ${offer.productName}
Preco: ${offer.price}
Order bump: ${offer.orderBump.name} - ${offer.orderBump.price}
Upsell: ${offer.upsell.name} - ${offer.upsell.price}
Riscos da oferta:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## TRACKING
readyForTraffic: ${trackingPlan.readyForTraffic ? 'sim' : 'nao'}
Checklist:
${trackingPlan.validationChecklist.map(item => `- ${item}`).join('\n')}

## PLANO DE MIDIA
launchStatus: ${mediaPlan.launchStatus}
Campanha: ${mediaPlan.campaign.campaignName}
Orcamento: ${mediaPlan.campaign.budgetType} - ${mediaPlan.campaign.dailyBudget}
Regras de pausa:
${mediaPlan.pauseRules.map(item => `- ${item}`).join('\n')}
Regras de escala:
${mediaPlan.scaleRules.map(item => `- ${item}`).join('\n')}

## METRICAS REAIS
${metrics ? JSON.stringify(metrics, null, 2) : 'Nenhum arquivo data/metrics/{ideaId}/daily-metrics.json encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Se nao houver metricas reais, decision deve ser "aguardando-dados".
- Se trackingPlan.readyForTraffic for false ou mediaPlan.launchStatus for bloqueado, nao recomende escalar nem aumentar verba.
- Nao invente compras, ROAS, CTR ou CPA se nao estiverem nos dados.
- Separar problema de tracking, criativo, pagina, checkout, oferta e caixa.
- Proteger caixa: sem dados confiaveis, budgetChange deve ser "sem aumento".
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "metricsAvailable": ${metrics ? 'true' : 'false'},
  "summary": "",
  "decision": "aguardando-dados | pausar | ajustar | escalar | manter | criar-novo-teste",
  "reason": "",
  "actions": [],
  "budgetChange": "",
  "creativeRequests": [],
  "funnelRequests": [],
  "trackingRequests": [],
  "financeNotes": [],
  "riskNotes": []
}`
}

function renderMarkdown(decision: OptimizationDecision): string {
  return `# Optimization Decision

ideaId: ${decision.ideaId}

metricsAvailable: ${decision.metricsAvailable ? 'sim' : 'nao'}

decision: ${decision.decision}

## Resumo
${decision.summary}

## Motivo
${decision.reason}

## Acoes
${decision.actions.map(item => `- ${item}`).join('\n')}

## Verba
${decision.budgetChange}

## Pedidos para criativos
${decision.creativeRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para funil
${decision.funnelRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para tracking
${decision.trackingRequests.map(item => `- ${item}`).join('\n')}

## Financeiro
${decision.financeNotes.map(item => `- ${item}`).join('\n')}

## Riscos
${decision.riskNotes.map(item => `- ${item}`).join('\n')}
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

function normalizeOptimizationDecision(response: unknown): unknown {
  if (!isRecord(response)) return response

  return {
    ...response,
    actions: stringArray(response.actions),
    creativeRequests: stringArray(response.creativeRequests),
    funnelRequests: stringArray(response.funnelRequests),
    trackingRequests: stringArray(response.trackingRequests),
    financeNotes: stringArray(response.financeNotes),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runMetricsAnalyst(input: MetricsAnalystInput): Promise<MetricsAnalystOutput> {
  const startTime = Date.now()

  logger.info('Agente 14 (MetricsAnalyst) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const trackingPlan = await loadTrackingPlan(ideaId)
  const mediaPlan = await loadMediaPlan(ideaId)
  const metrics = await loadDailyMetrics(ideaId)
  const skillContent = await loadSkillContent('low-ticket-kpi-optimization')

  if (!skillContent) {
    throw new MetricsAnalystError('Skill low-ticket-kpi-optimization nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce interpreta KPIs de low ticket e decide a proxima acao operacional. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildMetricsPrompt(offer, trackingPlan, mediaPlan, metrics, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const decision = OptimizationDecisionSchema.parse(normalizeOptimizationDecision(parsed))

  const outputDir = input.outputDir ?? `data/optimization/${ideaId}`
  await ensureDir(outputDir)

  const decisionPath = `${outputDir}/decision-log.json`
  const markdownPath = `${outputDir}/decision-log.md`

  await writeJson(decisionPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    decision,
  })
  await writeText(markdownPath, renderMarkdown(decision))

  const durationMs = Date.now() - startTime
  logger.info('Agente 14 (MetricsAnalyst) - concluido', {
    ideaId,
    decisionPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    decisionPath,
    markdownPath,
    durationMs,
  }
}

export class MetricsAnalystError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetricsAnalystError'
  }
}
