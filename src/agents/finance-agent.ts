import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  BudgetRulesSchema,
  DailyMetricsSchema,
  MediaPlanSchema,
  OfferBriefSchema,
  OptimizationDecisionSchema,
  TrackingPlanSchema,
  type BudgetRules,
  type DailyMetrics,
  type FinanceAgentInput,
  type FinanceAgentOutput,
  type MediaPlan,
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

type OptimizationDecisionFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  decision: OptimizationDecision
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
    throw new FinanceAgentError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new FinanceAgentError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadOptimizationDecision(ideaId: string): Promise<OptimizationDecision | null> {
  const filePath = `data/optimization/${ideaId}/decision-log.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<OptimizationDecisionFile>(filePath)
  return OptimizationDecisionSchema.parse(file.decision)
}

async function loadDailyMetrics(ideaId: string): Promise<DailyMetrics | null> {
  const filePath = `data/metrics/${ideaId}/daily-metrics.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<DailyMetricsFile | DailyMetrics>(filePath)
  if ('metrics' in file && file.metrics) return DailyMetricsSchema.parse(file.metrics)
  return DailyMetricsSchema.parse(file)
}

function buildFinancePrompt(
  offer: OfferBrief,
  trackingPlan: TrackingPlan,
  mediaPlan: MediaPlan,
  decision: OptimizationDecision | null,
  metrics: DailyMetrics | null,
  skillContent: string,
): string {
  return `Voce e o finance-agent de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e proteger caixa, margem e limite de teste da oferta.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
ID: ${offer.ideaId}
Produto: ${offer.productName}
Preco principal: ${offer.price}
Order bump: ${offer.orderBump.name} - ${offer.orderBump.price}
Upsell: ${offer.upsell.name} - ${offer.upsell.price}
Garantia: ${offer.guarantee}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## TRACKING
readyForTraffic: ${trackingPlan.readyForTraffic ? 'sim' : 'nao'}
Checklist:
${trackingPlan.validationChecklist.map(item => `- ${item}`).join('\n')}

## PLANO DE MIDIA
launchStatus: ${mediaPlan.launchStatus}
Orcamento planejado: ${mediaPlan.campaign.budgetType} - ${mediaPlan.campaign.dailyBudget}
Duracao: ${mediaPlan.campaign.duration}
Regras de pausa:
${mediaPlan.pauseRules.map(item => `- ${item}`).join('\n')}
Regras de escala:
${mediaPlan.scaleRules.map(item => `- ${item}`).join('\n')}

## DECISAO DE METRICAS
${decision ? JSON.stringify(decision, null, 2) : 'Nenhuma decisao de metricas encontrada.'}

## METRICAS REAIS
${metrics ? JSON.stringify(metrics, null, 2) : 'Nenhum arquivo data/metrics/{ideaId}/daily-metrics.json encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Se trackingPlan.readyForTraffic for false, cashStatus deve ser "bloqueado".
- Se mediaPlan.launchStatus for bloqueado, cashStatus deve ser "bloqueado".
- Se nao houver metricas reais, nao liberar escala.
- Sem dados reais, verba real deve ser zero ou "nao liberar verba real".
- Nao invente taxa de plataforma, CPA, ROAS, receita ou margem.
- Pode dizer que estimativas conservadoras estao pendentes, mas nao cite percentuais ou valores sem fonte.
- Se cashStatus for bloqueado e dailyBudgetCap for R$0, stopLossRules nao deve recomendar gasto de teste.
- ceoApprovalRequired deve ser true quando houver qualquer liberacao de verba real.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "cashStatus": "bloqueado | teste-controlado | escala-permitida",
  "summary": "",
  "testBudgetLimit": "",
  "dailyBudgetCap": "",
  "maxLossAllowed": "",
  "breakEvenCpa": "",
  "targetCpa": "",
  "marginAssumptions": [],
  "releaseConditions": [],
  "stopLossRules": [],
  "scaleRules": [],
  "cashProtectionActions": [],
  "ceoApprovalRequired": true,
  "riskNotes": []
}`
}

function renderMarkdown(rules: BudgetRules): string {
  return `# Budget Rules

ideaId: ${rules.ideaId}

cashStatus: ${rules.cashStatus}

ceoApprovalRequired: ${rules.ceoApprovalRequired ? 'sim' : 'nao'}

## Resumo
${rules.summary}

## Limites
- Teto de teste: ${rules.testBudgetLimit}
- Teto diario: ${rules.dailyBudgetCap}
- Perda maxima permitida: ${rules.maxLossAllowed}
- CPA de equilibrio: ${rules.breakEvenCpa}
- CPA alvo: ${rules.targetCpa}

## Premissas de margem
${rules.marginAssumptions.map(item => `- ${item}`).join('\n')}

## Condicoes para liberar verba
${rules.releaseConditions.map(item => `- ${item}`).join('\n')}

## Stop loss
${rules.stopLossRules.map(item => `- ${item}`).join('\n')}

## Escala
${rules.scaleRules.map(item => `- ${item}`).join('\n')}

## Protecao de caixa
${rules.cashProtectionActions.map(item => `- ${item}`).join('\n')}

## Riscos
${rules.riskNotes.map(item => `- ${item}`).join('\n')}
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

function withFallback(items: string[], fallback: string[]): string[] {
  return items.length > 0 ? items : fallback
}

function normalizeBudgetRules(response: unknown): unknown {
  if (!isRecord(response)) return response

  return {
    ...response,
    marginAssumptions: withFallback(stringArray(response.marginAssumptions), [
      'Produto digital low ticket com entrega em PDF/kit de consulta; margem depende de taxas, impostos e suporte.',
      'CPA alvo deve ser calculado pelo preco real recebido no checkout, nao por estimativa inventada.',
      'Nao liberar escala antes de compra real, tracking coerente e leitura de caixa conciliada.',
    ]),
    releaseConditions: withFallback(stringArray(response.releaseConditions), [
      'Tracking de PageView, ViewContent, InitiateCheckout e Purchase validado.',
      'Compra real conciliada entre checkout, Meta Ads e relatorio interno.',
      'CEO aprovar limite de teste e perda maxima antes de subir verba real.',
    ]),
    stopLossRules: withFallback(stringArray(response.stopLossRules), [
      'Alerta ao gastar o valor de uma venda sem InitiateCheckout qualificado.',
      'Pausar para diagnostico ao gastar de uma a duas vendas sem Purchase.',
      'Nao aumentar verba enquanto houver divergencia entre checkout, pixel/CAPI e relatorio interno.',
    ]),
    scaleRules: withFallback(stringArray(response.scaleRules), [
      'Manter teste controlado ate existir compra real com CPA dentro da meta.',
      'Aumentar orcamento apenas de forma gradual em criativo vencedor e com tracking estavel.',
      'Nao escalar campanha que tenha ROAS negativo, checkout sem compra ou dados de atribuicao incoerentes.',
    ]),
    cashProtectionActions: withFallback(stringArray(response.cashProtectionActions), [
      'Registrar gasto, compras, CPA e ROAS no snapshot operacional antes de qualquer decisao.',
      'Bloquear aumento de verba se o funil ainda estiver em validacao.',
      'Separar diagnostico de criativo, pagina, checkout e tracking antes de culpar somente a oferta.',
    ]),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runFinanceAgent(input: FinanceAgentInput): Promise<FinanceAgentOutput> {
  const startTime = Date.now()

  logger.info('Agente 15 (FinanceAgent) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const trackingPlan = await loadTrackingPlan(ideaId)
  const mediaPlan = await loadMediaPlan(ideaId)
  const decision = await loadOptimizationDecision(ideaId)
  const metrics = await loadDailyMetrics(ideaId)
  const skillContent = await loadSkillContent('low-ticket-cash-guardrails')

  if (!skillContent) {
    throw new FinanceAgentError('Skill low-ticket-cash-guardrails nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce protege caixa e margem em ofertas low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildFinancePrompt(offer, trackingPlan, mediaPlan, decision, metrics, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const budgetRules = BudgetRulesSchema.parse(normalizeBudgetRules(parsed))

  const outputDir = input.outputDir ?? `data/finance/${ideaId}`
  await ensureDir(outputDir)

  const budgetRulesPath = `${outputDir}/budget-rules.json`
  const markdownPath = `${outputDir}/budget-rules.md`

  await writeJson(budgetRulesPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    budgetRules,
  })
  await writeText(markdownPath, renderMarkdown(budgetRules))

  const durationMs = Date.now() - startTime
  logger.info('Agente 15 (FinanceAgent) - concluido', {
    ideaId,
    budgetRulesPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    budgetRulesPath,
    markdownPath,
    durationMs,
  }
}

export class FinanceAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinanceAgentError'
  }
}
