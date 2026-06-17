import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readTextOrNull, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CheckoutOpsPlanSchema,
  CroPlanSchema,
  DesignBriefSchema,
  FunnelBuilderPlanSchema,
  FunnelStrategySchema,
  OfferBriefSchema,
  TrackingPlanSchema,
  type CheckoutOpsPlan,
  type CroPlan,
  type DesignBrief,
  type FunnelBuilderInput,
  type FunnelBuilderOutput,
  type FunnelBuilderPlan,
  type FunnelStrategy,
  type OfferBrief,
  type TrackingPlan,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = { offer: OfferBrief }
type FunnelStrategyFile = { strategy: FunnelStrategy }
type DesignBriefFile = { designBrief: DesignBrief }
type TrackingPlanFile = { trackingPlan: TrackingPlan }
type CroPlanFile = { croPlan: CroPlan }
type CheckoutOpsFile = { checkoutOpsPlan: CheckoutOpsPlan }

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) return selector

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new FunnelBuilderError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new FunnelBuilderError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadCroPlan(ideaId: string): Promise<CroPlan | null> {
  const filePath = `data/cro/${ideaId}/cro-plan.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<CroPlanFile>(filePath)
  return CroPlanSchema.parse(file.croPlan)
}

async function loadCheckoutOpsPlan(ideaId: string): Promise<CheckoutOpsPlan | null> {
  const filePath = `data/implementation/${ideaId}/checkout-checklist.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<CheckoutOpsFile>(filePath)
  return CheckoutOpsPlanSchema.parse(file.checkoutOpsPlan)
}

function compactText(text: string | null, maxChars: number): string {
  if (!text) return 'Arquivo nao encontrado.'
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[conteudo cortado para caber no contexto]`
}

function buildPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  salesPage: string | null,
  designBrief: DesignBrief,
  trackingPlan: TrackingPlan,
  croPlan: CroPlan | null,
  checkoutOpsPlan: CheckoutOpsPlan | null,
  skillContent: string,
): string {
  return `Voce e o funnel-builder de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e transformar copy, design, checkout e tracking em uma especificacao publicavel de pagina/funil.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
${JSON.stringify(offer, null, 2)}

## ESTRATEGIA DE FUNIL
${JSON.stringify(funnel, null, 2)}

## COPY DA PAGINA
${compactText(salesPage, 9000)}

## DESIGN
${JSON.stringify(designBrief, null, 2)}

## TRACKING
readyForTraffic: ${trackingPlan.readyForTraffic ? 'sim' : 'nao'}
${JSON.stringify(trackingPlan, null, 2)}

## CRO
${croPlan ? JSON.stringify(croPlan, null, 2) : 'Nenhum plano CRO encontrado.'}

## CHECKOUT OPS
${checkoutOpsPlan ? JSON.stringify(checkoutOpsPlan, null, 2) : 'Nenhum checklist de checkout encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Nao invente URL real, dominio, link de checkout, conta, pixel ou plataforma.
- Se checkoutOpsPlan.readiness for "bloqueado" ou trackingPlan.readyForTraffic for false, buildStatus deve ser "bloqueado".
- Se salesPage estiver ausente, buildStatus deve ser "bloqueado".
- Nao diga que pagina esta publicada.
- CTA sem link real deve ter status "bloqueado" ou "pendente" no linkMap.
- Nenhuma prova, certificacao, antes/depois ou depoimento sem origem verificavel.
- Gere pelo menos 8 secoes de pagina.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "buildStatus": "bloqueado | pronto-com-pendencias | pronto",
  "summary": "",
  "recommendedImplementation": "",
  "pageStructure": [
    {
      "order": 1,
      "sectionId": "",
      "purpose": "",
      "sourceCopy": "",
      "designDirection": "",
      "requiredAssets": [],
      "cta": ""
    }
  ],
  "responsiveRules": [],
  "assetRequirements": [],
  "linkMap": [
    {
      "label": "",
      "source": "",
      "destination": "",
      "status": "pendente | validar | pronto | bloqueado",
      "validation": ""
    }
  ],
  "trackingEmbedRequirements": [],
  "seoAndPerformanceChecklist": [],
  "complianceChecklist": [],
  "publishChecklist": [],
  "goLiveBlockers": [],
  "handoffNotes": [],
  "riskNotes": []
}`
}

function renderMarkdown(plan: FunnelBuilderPlan): string {
  return `# Page Build Checklist

ideaId: ${plan.ideaId}

buildStatus: ${plan.buildStatus}

## Resumo
${plan.summary}

## Implementacao recomendada
${plan.recommendedImplementation}

## Estrutura da pagina
${plan.pageStructure.map(section => `${section.order}. ${section.sectionId}
   - Objetivo: ${section.purpose}
   - Copy fonte: ${section.sourceCopy}
   - Direcao visual: ${section.designDirection}
   - Assets: ${section.requiredAssets.join('; ')}
   - CTA: ${section.cta}`).join('\n\n')}

## Regras responsivas
${plan.responsiveRules.map(item => `- ${item}`).join('\n')}

## Assets necessarios
${plan.assetRequirements.map(item => `- ${item}`).join('\n')}

## Mapa de links
${plan.linkMap.map(item => `- [${item.status}] ${item.label}: ${item.source} -> ${item.destination} | validacao: ${item.validation}`).join('\n')}

## Tracking embed
${plan.trackingEmbedRequirements.map(item => `- ${item}`).join('\n')}

## SEO e performance
${plan.seoAndPerformanceChecklist.map(item => `- ${item}`).join('\n')}

## Compliance
${plan.complianceChecklist.map(item => `- ${item}`).join('\n')}

## Checklist de publicacao
${plan.publishChecklist.map(item => `- ${item}`).join('\n')}

## Bloqueios de go-live
${plan.goLiveBlockers.map(item => `- ${item}`).join('\n')}

## Handoff
${plan.handoffNotes.map(item => `- ${item}`).join('\n')}

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
  if (isRecord(item)) return Object.entries(item).map(([key, value]) => `${key}: ${itemToString(value)}`).join('; ')
  return ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(itemToString).filter(Boolean)
}

function normalizeFunnelBuilderPlan(response: unknown): unknown {
  if (!isRecord(response)) return response

  const pageStructure = Array.isArray(response.pageStructure)
    ? response.pageStructure.map(section => {
      if (!isRecord(section)) return section
      return {
        ...section,
        requiredAssets: stringArray(section.requiredAssets),
      }
    })
    : []

  return {
    ...response,
    pageStructure,
    responsiveRules: stringArray(response.responsiveRules),
    assetRequirements: stringArray(response.assetRequirements),
    trackingEmbedRequirements: stringArray(response.trackingEmbedRequirements),
    seoAndPerformanceChecklist: stringArray(response.seoAndPerformanceChecklist),
    complianceChecklist: stringArray(response.complianceChecklist),
    publishChecklist: stringArray(response.publishChecklist),
    goLiveBlockers: stringArray(response.goLiveBlockers),
    handoffNotes: stringArray(response.handoffNotes),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runFunnelBuilder(input: FunnelBuilderInput): Promise<FunnelBuilderOutput> {
  const startTime = Date.now()

  logger.info('Agente 18 (FunnelBuilder) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const salesPage = await readTextOrNull(`data/funnels/${ideaId}/sales-page.md`)
  const designBrief = await loadDesignBrief(ideaId)
  const trackingPlan = await loadTrackingPlan(ideaId)
  const croPlan = await loadCroPlan(ideaId)
  const checkoutOpsPlan = await loadCheckoutOpsPlan(ideaId)
  const skillContent = await loadSkillContent('low-ticket-funnel-builder')

  if (!skillContent) {
    throw new FunnelBuilderError('Skill low-ticket-funnel-builder nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce e especialista em build de paginas low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildPrompt(offer, funnel, salesPage, designBrief, trackingPlan, croPlan, checkoutOpsPlan, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const funnelBuilderPlan = FunnelBuilderPlanSchema.parse(normalizeFunnelBuilderPlan(parsed))

  const outputDir = input.outputDir ?? `data/implementation/${ideaId}`
  await ensureDir(outputDir)

  const pageChecklistPath = `${outputDir}/page-checklist.json`
  const markdownPath = `${outputDir}/page-checklist.md`

  await writeJson(pageChecklistPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    funnelBuilderPlan,
  })
  await writeText(markdownPath, renderMarkdown(funnelBuilderPlan))

  const durationMs = Date.now() - startTime
  logger.info('Agente 18 (FunnelBuilder) - concluido', {
    ideaId,
    pageChecklistPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    pageChecklistPath,
    markdownPath,
    durationMs,
  }
}

export class FunnelBuilderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FunnelBuilderError'
  }
}
