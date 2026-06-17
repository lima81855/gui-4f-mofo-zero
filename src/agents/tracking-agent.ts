import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  DesignBriefSchema,
  FunnelStrategySchema,
  OfferBriefSchema,
  TrackingPlanSchema,
  type DesignBrief,
  type FunnelStrategy,
  type OfferBrief,
  type TrackingAgentInput,
  type TrackingAgentOutput,
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

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) {
    return selector
  }

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new TrackingAgentError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new TrackingAgentError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadDesignBrief(ideaId: string): Promise<DesignBrief | null> {
  const filePath = `data/design/${ideaId}/design-brief.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<DesignBriefFile>(filePath)
  return DesignBriefSchema.parse(file.designBrief)
}

function buildTrackingPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  designBrief: DesignBrief | null,
  skillContent: string,
): string {
  return `Voce e o tracking-agent de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e criar o plano tecnico de tracking antes da oferta ir para trafego pago.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
ID: ${offer.ideaId}
Produto: ${offer.productName}
Preco: ${offer.price}
Order bump: ${offer.orderBump.name} - ${offer.orderBump.price}
Upsell: ${offer.upsell.name} - ${offer.upsell.price}
Publico: ${offer.targetAudience}

## FUNIL
Tipo: ${funnel.recommendedFunnel}
Temperatura: ${funnel.trafficTemperature}
Lead magnet: ${funnel.leadMagnet}
Checkout: ${funnel.checkoutFlow}
Eventos pedidos pelo funil:
${funnel.trackingEvents.map(event => `- ${event}`).join('\n')}

## DESIGN / IMPLEMENTACAO
${designBrief ? `Hero: ${designBrief.landingPageBrief.hero}
CTA: ${designBrief.landingPageBrief.ctaStyle}
Notas mobile:
${designBrief.landingPageBrief.mobileNotes.map(item => `- ${item}`).join('\n')}` : 'Design brief ainda nao encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Priorize Meta Pixel + Meta Conversion API via n8n.
- Inclua normalizacao e hash SHA256 de email e telefone.
- Inclua fbp, fbc, client_ip_address e client_user_agent como campos opcionais sem hash quando disponiveis.
- Use browser-pixel + server-capi com event_id compartilhado para deduplicacao.
- Inclua PageView, ViewContent, InitiateCheckout e Purchase. Inclua AddToCart se houver CTA/carrinho.
- Inclua Lead apenas se o funil tiver quiz ou lead magnet real.
- readyForTraffic deve ser false se ainda faltam Pixel ID, Access Token CAPI, webhook n8n e teste de Purchase no Events Manager.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "architecture": "",
  "pixelSetup": [],
  "capiSetup": [],
  "n8nWorkflow": [],
  "eventMap": [
    {
      "eventName": "",
      "trigger": "",
      "channel": "browser-pixel | server-capi | both",
      "eventIdStrategy": "",
      "parameters": [],
      "validation": ""
    }
  ],
  "matchingFields": [
    {
      "field": "",
      "source": "",
      "normalization": "",
      "hashing": "",
      "required": true
    }
  ],
  "utmPattern": [],
  "checkoutRequirements": [],
  "validationChecklist": [],
  "riskNotes": [],
  "readyForTraffic": false
}`
}

function renderMarkdown(plan: TrackingPlan): string {
  return `# Tracking Plan

ideaId: ${plan.ideaId}

readyForTraffic: ${plan.readyForTraffic ? 'sim' : 'nao'}

## Arquitetura
${plan.architecture}

## Pixel
${plan.pixelSetup.map(item => `- ${item}`).join('\n')}

## CAPI
${plan.capiSetup.map(item => `- ${item}`).join('\n')}

## Workflow n8n
${plan.n8nWorkflow.map(item => `- ${item}`).join('\n')}

## Mapa de eventos
${plan.eventMap.map(event => `### ${event.eventName}
- Trigger: ${event.trigger}
- Canal: ${event.channel}
- Event ID: ${event.eventIdStrategy}
- Parametros: ${event.parameters.join(', ')}
- Validacao: ${event.validation}`).join('\n\n')}

## Campos de correspondencia
${plan.matchingFields.map(field => `- ${field.field}: fonte=${field.source}; normalizacao=${field.normalization}; hash=${field.hashing}; obrigatorio=${field.required ? 'sim' : 'nao'}`).join('\n')}

## UTMs
${plan.utmPattern.map(item => `- ${item}`).join('\n')}

## Checkout
${plan.checkoutRequirements.map(item => `- ${item}`).join('\n')}

## Checklist de validacao
${plan.validationChecklist.map(item => `- ${item}`).join('\n')}

## Riscos
${plan.riskNotes.map(item => `- ${item}`).join('\n')}
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trackingItemToString(item: unknown): string {
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (Array.isArray(item)) return item.map(trackingItemToString).filter(Boolean).join('; ')

  if (isRecord(item)) {
    const preferredKeys = ['name', 'field', 'parameter', 'description', 'value', 'notes']
    const parts = preferredKeys
      .filter(key => item[key] !== undefined)
      .map(key => trackingItemToString(item[key]))
      .filter(Boolean)

    if (parts.length > 0) return parts.join(' - ')

    return Object.entries(item)
      .map(([key, value]) => `${key}: ${trackingItemToString(value)}`)
      .join('; ')
  }

  return ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(trackingItemToString).filter(Boolean)
}

function normalizeTrackingPlanResponse(response: unknown): unknown {
  if (!isRecord(response)) return response

  const normalized = { ...response }
  normalized.pixelSetup = stringArray(normalized.pixelSetup)
  normalized.capiSetup = stringArray(normalized.capiSetup)
  normalized.n8nWorkflow = stringArray(normalized.n8nWorkflow)
  normalized.utmPattern = stringArray(normalized.utmPattern)
  normalized.checkoutRequirements = stringArray(normalized.checkoutRequirements)
  normalized.validationChecklist = stringArray(normalized.validationChecklist)
  normalized.riskNotes = stringArray(normalized.riskNotes)

  if (Array.isArray(normalized.eventMap)) {
    normalized.eventMap = normalized.eventMap.map(event => {
      if (!isRecord(event)) return event
      return {
        ...event,
        parameters: stringArray(event.parameters),
      }
    })
  }

  return normalized
}

export async function runTrackingAgent(input: TrackingAgentInput): Promise<TrackingAgentOutput> {
  const startTime = Date.now()

  logger.info('Agente 12 (TrackingAgent) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const designBrief = await loadDesignBrief(ideaId)
  const skillContent = await loadSkillContent('meta-capi-n8n-tracking')

  if (!skillContent) {
    throw new TrackingAgentError('Skill meta-capi-n8n-tracking nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce cria planos tecnicos de tracking para Meta Ads em ofertas low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildTrackingPrompt(offer, funnel, designBrief, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const trackingPlan = TrackingPlanSchema.parse(normalizeTrackingPlanResponse(parsed))

  const outputDir = input.outputDir ?? `data/tracking/${ideaId}`
  await ensureDir(outputDir)

  const trackingPath = `${outputDir}/tracking-plan.json`
  const markdownPath = `${outputDir}/tracking-plan.md`

  await writeJson(trackingPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    trackingPlan,
  })
  await writeText(markdownPath, renderMarkdown(trackingPlan))

  const durationMs = Date.now() - startTime
  logger.info('Agente 12 (TrackingAgent) - concluido', {
    ideaId,
    trackingPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    trackingPath,
    markdownPath,
    durationMs,
  }
}

export class TrackingAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrackingAgentError'
  }
}
