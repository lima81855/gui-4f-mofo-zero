import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readTextOrNull, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CreativePackSchema,
  FunnelStrategySchema,
  OfferBriefSchema,
  OrganicContentPlanSchema,
  ProductQualityReviewSchema,
  VideoScriptPackSchema,
  type CreativePack,
  type FunnelStrategy,
  type OfferBrief,
  type OrganicContentPlan,
  type OrganicContentPlannerInput,
  type OrganicContentPlannerOutput,
  type ProductQualityReview,
  type VideoScriptPack,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = { offer: OfferBrief }
type FunnelStrategyFile = { strategy: FunnelStrategy }
type CreativePackFile = { creativePack: CreativePack }
type VideoScriptPackFile = { videoScriptPack?: VideoScriptPack, scriptPack?: VideoScriptPack }
type QualityReviewFile = { qualityReview: ProductQualityReview }

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) return selector

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) throw new OrganicContentPlannerError('Nenhum offer-brief.json encontrado em data/offers.')
  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) return offer.ideaId
  }

  throw new OrganicContentPlannerError(`Oferta nao encontrada para seletor: ${selector}`)
}

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const fs = await import('fs/promises')
    const projectRoot = path.resolve(__dirname, '..', '..')
    const resolved = path.join(projectRoot, dirPath)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => `${dirPath}/${entry.name}`)
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

async function loadCreativePack(ideaId: string): Promise<CreativePack | null> {
  const filePath = `data/creatives/${ideaId}/ad-copies.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<CreativePackFile | CreativePack>(filePath)
  if ('creativePack' in file) return CreativePackSchema.parse(file.creativePack)
  return CreativePackSchema.parse(file)
}

async function loadVideoScripts(ideaId: string): Promise<VideoScriptPack | null> {
  const filePath = `data/creatives/${ideaId}/video-scripts.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<VideoScriptPackFile | VideoScriptPack>(filePath)
  if ('videoScriptPack' in file && file.videoScriptPack) return VideoScriptPackSchema.parse(file.videoScriptPack)
  if ('scriptPack' in file && file.scriptPack) return VideoScriptPackSchema.parse(file.scriptPack)
  return VideoScriptPackSchema.parse(file)
}

async function loadQualityReview(ideaId: string): Promise<ProductQualityReview | null> {
  const filePath = `data/products/${ideaId}/quality-review.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<QualityReviewFile>(filePath)
  return ProductQualityReviewSchema.parse(file.qualityReview)
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
  creativePack: CreativePack | null,
  videoScripts: VideoScriptPack | null,
  qualityReview: ProductQualityReview | null,
  skillContent: string,
): string {
  return `Voce e o organic-content-planner de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e criar uma esteira organica que aquece mercado, testa angulos e cria ponte para a oferta.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
${JSON.stringify(offer, null, 2)}

## FUNIL
${JSON.stringify(funnel, null, 2)}

## COPY DA PAGINA
${compactText(salesPage, 7000)}

## CRIATIVOS PAGOS
${creativePack ? JSON.stringify(creativePack, null, 2) : 'Nenhum pack de criativos encontrado.'}

## ROTEIROS
${videoScripts ? JSON.stringify(videoScripts, null, 2) : 'Nenhum pack de roteiros encontrado.'}

## REVIEW DE QUALIDADE
${qualityReview ? JSON.stringify(qualityReview, null, 2) : 'Nenhum review de qualidade encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Nao invente prova, depoimento, antes/depois, resultado garantido, cura ou milagre.
- Se qualityReview tiver status "revisar", os conteudos devem educar expectativas e reforcar limites.
- CTA organico deve ser leve: salvar, comentar, ver o kit, diagnosticar a planta ou visitar a pagina.
- Gere 14 posts em weeklyCalendar, cobrindo dor, erro, diagnostico, metodo, prova e oferta.
- Cada post deve ter ponte clara para pagina ou criativo.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "contentPath": "dor percebida -> erro comum -> diagnostico -> metodo -> prova verificavel -> oferta",
  "strategySummary": "",
  "primaryAudience": "",
  "contentPillars": [],
  "weeklyCalendar": [
    {
      "day": "D1",
      "stage": "dor | erro | diagnostico | metodo | prova | oferta",
      "theme": "",
      "format": "reels | carrossel | story | post | shorts",
      "hook": "",
      "summary": "",
      "cta": "",
      "creativeBrief": "",
      "landingPageBridge": ""
    }
  ],
  "repurposeRules": [],
  "creativeRequests": [],
  "pageFeedbackSignals": [],
  "riskNotes": []
}`
}

function renderMarkdown(plan: OrganicContentPlan): string {
  return `# Organic Content Calendar

ideaId: ${plan.ideaId}

contentPath: ${plan.contentPath}

## Estrategia
${plan.strategySummary}

## Publico primario
${plan.primaryAudience}

## Pilares
${plan.contentPillars.map(item => `- ${item}`).join('\n')}

## Calendario
${plan.weeklyCalendar.map(post => `### ${post.day} - ${post.theme}
- Etapa: ${post.stage}
- Formato: ${post.format}
- Hook: ${post.hook}
- Resumo: ${post.summary}
- CTA: ${post.cta}
- Brief criativo: ${post.creativeBrief}
- Ponte para pagina: ${post.landingPageBridge}`).join('\n\n')}

## Reaproveitamento
${plan.repurposeRules.map(item => `- ${item}`).join('\n')}

## Pedidos para criativos
${plan.creativeRequests.map(item => `- ${item}`).join('\n')}

## Sinais para pagina
${plan.pageFeedbackSignals.map(item => `- ${item}`).join('\n')}

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

function normalizePlan(response: unknown): unknown {
  if (!isRecord(response)) return response
  return {
    ...response,
    contentPillars: stringArray(response.contentPillars),
    repurposeRules: stringArray(response.repurposeRules),
    creativeRequests: stringArray(response.creativeRequests),
    pageFeedbackSignals: stringArray(response.pageFeedbackSignals),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runOrganicContentPlanner(input: OrganicContentPlannerInput): Promise<OrganicContentPlannerOutput> {
  const startTime = Date.now()

  logger.info('Agente 20 (OrganicContentPlanner) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const salesPage = await readTextOrNull(`data/funnels/${ideaId}/sales-page.md`)
  const creativePack = await loadCreativePack(ideaId)
  const videoScripts = await loadVideoScripts(ideaId)
  const qualityReview = await loadQualityReview(ideaId)
  const skillContent = await loadSkillContent('organic-content-paths')

  if (!skillContent) throw new OrganicContentPlannerError('Skill organic-content-paths nao encontrada.')

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'Voce planeja conteudo organico para ofertas low ticket. Responda apenas JSON valido.' },
      { role: 'user', content: buildPrompt(offer, funnel, salesPage, creativePack, videoScripts, qualityReview, skillContent) },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const contentPlan = OrganicContentPlanSchema.parse(normalizePlan(parsed))

  const outputDir = input.outputDir ?? `data/organic/${ideaId}`
  await ensureDir(outputDir)

  const calendarPath = `${outputDir}/content-calendar.json`
  const markdownPath = `${outputDir}/content-calendar.md`

  await writeJson(calendarPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    contentPlan,
  })
  await writeText(markdownPath, renderMarkdown(contentPlan))

  const durationMs = Date.now() - startTime
  logger.info('Agente 20 (OrganicContentPlanner) - concluido', {
    ideaId,
    calendarPath,
    markdownPath,
    durationMs,
  })

  return { ideaId, calendarPath, markdownPath, durationMs }
}

export class OrganicContentPlannerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrganicContentPlannerError'
  }
}
