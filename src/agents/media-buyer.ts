import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CreativePackSchema,
  FunnelStrategySchema,
  MediaPlanSchema,
  OfferBriefSchema,
  TrackingPlanSchema,
  VideoScriptPackSchema,
  type CreativePack,
  type FunnelStrategy,
  type MediaBuyerInput,
  type MediaBuyerOutput,
  type MediaPlan,
  type OfferBrief,
  type TrackingPlan,
  type VideoScriptPack,
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

type CreativePackFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  creativePack: CreativePack
}

type VideoScriptPackFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  scriptPack: VideoScriptPack
}

type TrackingPlanFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  trackingPlan: TrackingPlan
}

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) {
    return selector
  }

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new MediaBuyerError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new MediaBuyerError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadCreativePack(ideaId: string): Promise<CreativePack> {
  const file = await readJson<CreativePackFile>(`data/creatives/${ideaId}/ad-copies.json`)
  return CreativePackSchema.parse(file.creativePack)
}

async function loadVideoScriptPack(ideaId: string): Promise<VideoScriptPack> {
  const file = await readJson<VideoScriptPackFile>(`data/creatives/${ideaId}/video-scripts.json`)
  return VideoScriptPackSchema.parse(file.scriptPack)
}

async function loadTrackingPlan(ideaId: string): Promise<TrackingPlan> {
  const file = await readJson<TrackingPlanFile>(`data/tracking/${ideaId}/tracking-plan.json`)
  return TrackingPlanSchema.parse(file.trackingPlan)
}

function buildMediaPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  creativePack: CreativePack,
  videoScriptPack: VideoScriptPack,
  trackingPlan: TrackingPlan,
  skillContent: string,
): string {
  return `Voce e o media-buyer de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e criar o plano de lancamento de Meta Ads para a oferta abaixo.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
ID: ${offer.ideaId}
Produto: ${offer.productName}
Preco: ${offer.price}
Order bump: ${offer.orderBump.name} - ${offer.orderBump.price}
Upsell: ${offer.upsell.name} - ${offer.upsell.price}
Publico: ${offer.targetAudience}
Promessa: ${offer.uniquePromise}
Mecanismo: ${offer.uniqueMechanism}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## FUNIL
Tipo: ${funnel.recommendedFunnel}
Temperatura: ${funnel.trafficTemperature}
Consciencia: ${funnel.awarenessLevel}
Checkout: ${funnel.checkoutFlow}
Eventos: ${funnel.trackingEvents.join(', ')}

## TRACKING
readyForTraffic: ${trackingPlan.readyForTraffic ? 'sim' : 'nao'}
Eventos:
${trackingPlan.eventMap.map(event => `- ${event.eventName}: ${event.channel}`).join('\n')}
Checklist:
${trackingPlan.validationChecklist.map(item => `- ${item}`).join('\n')}
UTMs:
${trackingPlan.utmPattern.map(item => `- ${item}`).join('\n')}

## CRIATIVOS ESTATICOS
${creativePack.creativeAngles.map((angle, index) => `${index + 1}. ${angle.angle} / ${angle.state}
Hook: ${angle.hook}
Headline: ${angle.headline}
Texto imagem: ${angle.imageText}
CTA: ${angle.cta}`).join('\n\n')}

## ROTEIROS
${videoScriptPack.scripts.map((script, index) => `${index + 1}. ${script.name} / ${script.format}
Hook: ${script.hook}
CTA: ${script.cta}`).join('\n\n')}

## REGRAS
- Nao inclua WhatsApp.
- Se readyForTraffic for "nao", launchStatus deve ser "pre-lancamento" ou "bloqueado", nunca "liberado".
- Nao recomendar subir campanha com dinheiro real antes de validar Purchase no Events Manager.
- Se launchStatus for "bloqueado", o orcamento deve ser descrito como simulado/planejado, nao como verba a executar.
- Usar campanha de vendas/conversoes otimizando para Purchase quando liberado.
- Para R$47, manter orcamento de teste conservador.
- Nao incluir publico de visitantes, engajados ou remarketing se ainda nao ha base real de trafego.
- Nao criar promessas absolutas nos criativos.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "launchStatus": "bloqueado | pre-lancamento | liberado",
  "readinessNotes": [],
  "campaign": {
    "campaignName": "",
    "objective": "",
    "optimizationEvent": "",
    "budgetType": "",
    "dailyBudget": "",
    "duration": ""
  },
  "adSets": [
    {
      "name": "",
      "audience": "",
      "budget": "",
      "placements": "",
      "creativesToUse": [],
      "hypothesis": ""
    }
  ],
  "creativeTests": [
    {
      "creativeName": "",
      "angle": "",
      "format": "",
      "successSignal": "",
      "failureSignal": ""
    }
  ],
  "utmPlan": [],
  "pauseRules": [],
  "scaleRules": [],
  "reportingCadence": [],
  "preLaunchChecklist": [],
  "creativeRequests": [],
  "riskNotes": []
}`
}

function renderMarkdown(plan: MediaPlan): string {
  return `# Media Launch Plan

ideaId: ${plan.ideaId}

launchStatus: ${plan.launchStatus}

## Prontidao
${plan.readinessNotes.map(item => `- ${item}`).join('\n')}

## Campanha
- Nome: ${plan.campaign.campaignName}
- Objetivo: ${plan.campaign.objective}
- Evento de otimizacao: ${plan.campaign.optimizationEvent}
- Orcamento: ${plan.campaign.budgetType} - ${plan.campaign.dailyBudget}
- Duracao: ${plan.campaign.duration}

## Conjuntos
${plan.adSets.map(adSet => `### ${adSet.name}
- Publico: ${adSet.audience}
- Orcamento: ${adSet.budget}
- Posicionamentos: ${adSet.placements}
- Criativos: ${adSet.creativesToUse.join(', ')}
- Hipotese: ${adSet.hypothesis}`).join('\n\n')}

## Testes de criativo
${plan.creativeTests.map(test => `- ${test.creativeName}: ${test.angle} (${test.format}) | sucesso: ${test.successSignal} | falha: ${test.failureSignal}`).join('\n')}

## UTMs
${plan.utmPlan.map(item => `- ${item}`).join('\n')}

## Regras de pausa
${plan.pauseRules.map(item => `- ${item}`).join('\n')}

## Regras de escala
${plan.scaleRules.map(item => `- ${item}`).join('\n')}

## Rotina de leitura
${plan.reportingCadence.map(item => `- ${item}`).join('\n')}

## Checklist antes de publicar
${plan.preLaunchChecklist.map(item => `- ${item}`).join('\n')}

## Pedidos para criativos
${plan.creativeRequests.map(item => `- ${item}`).join('\n')}

## Riscos
${plan.riskNotes.map(item => `- ${item}`).join('\n')}
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mediaItemToString(item: unknown): string {
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (Array.isArray(item)) return item.map(mediaItemToString).filter(Boolean).join('; ')

  if (isRecord(item)) {
    const preferredKeys = ['name', 'title', 'angle', 'description', 'rule', 'notes']
    const parts = preferredKeys
      .filter(key => item[key] !== undefined)
      .map(key => mediaItemToString(item[key]))
      .filter(Boolean)

    if (parts.length > 0) return parts.join(' - ')

    return Object.entries(item)
      .map(([key, value]) => `${key}: ${mediaItemToString(value)}`)
      .join('; ')
  }

  return ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(mediaItemToString).filter(Boolean)
}

function normalizeMediaPlanResponse(response: unknown): unknown {
  if (!isRecord(response)) return response

  const normalized = { ...response }
  normalized.readinessNotes = stringArray(normalized.readinessNotes)
  normalized.utmPlan = stringArray(normalized.utmPlan)
  normalized.pauseRules = stringArray(normalized.pauseRules)
  normalized.scaleRules = stringArray(normalized.scaleRules)
  normalized.reportingCadence = stringArray(normalized.reportingCadence)
  normalized.preLaunchChecklist = stringArray(normalized.preLaunchChecklist)
  normalized.creativeRequests = stringArray(normalized.creativeRequests)
  normalized.riskNotes = stringArray(normalized.riskNotes)

  if (Array.isArray(normalized.adSets)) {
    normalized.adSets = normalized.adSets.map(adSet => {
      if (!isRecord(adSet)) return adSet
      return {
        ...adSet,
        creativesToUse: stringArray(adSet.creativesToUse),
      }
    })
  }

  return normalized
}

export async function runMediaBuyer(input: MediaBuyerInput): Promise<MediaBuyerOutput> {
  const startTime = Date.now()

  logger.info('Agente 13 (MediaBuyer) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const creativePack = await loadCreativePack(ideaId)
  const videoScriptPack = await loadVideoScriptPack(ideaId)
  const trackingPlan = await loadTrackingPlan(ideaId)
  const skillContent = await loadSkillContent('low-ticket-meta-launch')

  if (!skillContent) {
    throw new MediaBuyerError('Skill low-ticket-meta-launch nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce cria planos de midia paga para Meta Ads em ofertas low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildMediaPrompt(offer, funnel, creativePack, videoScriptPack, trackingPlan, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const mediaPlan = MediaPlanSchema.parse(normalizeMediaPlanResponse(parsed))

  const outputDir = input.outputDir ?? `data/media/${ideaId}`
  await ensureDir(outputDir)

  const mediaPlanPath = `${outputDir}/launch-plan.json`
  const markdownPath = `${outputDir}/launch-plan.md`

  await writeJson(mediaPlanPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    mediaPlan,
  })
  await writeText(markdownPath, renderMarkdown(mediaPlan))

  const durationMs = Date.now() - startTime
  logger.info('Agente 13 (MediaBuyer) - concluido', {
    ideaId,
    mediaPlanPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    mediaPlanPath,
    markdownPath,
    durationMs,
  }
}

export class MediaBuyerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaBuyerError'
  }
}
