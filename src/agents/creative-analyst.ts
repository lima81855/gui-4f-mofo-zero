import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CreativeAnalysisSchema,
  CreativePackSchema,
  CreativePerformanceSchema,
  MediaPlanSchema,
  OfferBriefSchema,
  OptimizationDecisionSchema,
  OrganicContentPlanSchema,
  VideoScriptPackSchema,
  type CreativeAnalysis,
  type CreativeAnalystInput,
  type CreativeAnalystOutput,
  type CreativePack,
  type CreativePerformance,
  type MediaPlan,
  type OfferBrief,
  type OptimizationDecision,
  type OrganicContentPlan,
  type VideoScriptPack,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = { offer: OfferBrief }
type CreativePackFile = { creativePack: CreativePack }
type VideoScriptPackFile = { videoScriptPack?: VideoScriptPack, scriptPack?: VideoScriptPack }
type MediaPlanFile = { mediaPlan: MediaPlan }
type OrganicContentFile = { contentPlan: OrganicContentPlan }
type OptimizationDecisionFile = { decision: OptimizationDecision }
type CreativeMetricsFile = { metrics?: CreativePerformance[], creatives?: CreativePerformance[] }

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) return selector

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) throw new CreativeAnalystError('Nenhum offer-brief.json encontrado em data/offers.')
  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) return offer.ideaId
  }

  throw new CreativeAnalystError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadMediaPlan(ideaId: string): Promise<MediaPlan | null> {
  const filePath = `data/media/${ideaId}/launch-plan.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<MediaPlanFile>(filePath)
  return MediaPlanSchema.parse(file.mediaPlan)
}

async function loadOrganicContent(ideaId: string): Promise<OrganicContentPlan | null> {
  const filePath = `data/organic/${ideaId}/content-calendar.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<OrganicContentFile>(filePath)
  return OrganicContentPlanSchema.parse(file.contentPlan)
}

async function loadOptimizationDecision(ideaId: string): Promise<OptimizationDecision | null> {
  const filePath = `data/optimization/${ideaId}/decision-log.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<OptimizationDecisionFile>(filePath)
  return OptimizationDecisionSchema.parse(file.decision)
}

async function loadCreativeMetrics(ideaId: string): Promise<CreativePerformance[] | null> {
  const filePath = `data/metrics/${ideaId}/creative-metrics.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<CreativeMetricsFile | CreativePerformance[]>(filePath)
  const rows = Array.isArray(file) ? file : file.metrics ?? file.creatives ?? []
  return rows.map(row => CreativePerformanceSchema.parse(row))
}

function buildPrompt(
  offer: OfferBrief,
  creativePack: CreativePack | null,
  videoScripts: VideoScriptPack | null,
  mediaPlan: MediaPlan | null,
  organicContent: OrganicContentPlan | null,
  decision: OptimizationDecision | null,
  creativeMetrics: CreativePerformance[] | null,
  skillContent: string,
): string {
  return `Voce e o creative-analyst de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e analisar criativos, separar gargalos e pedir novas variacoes sem inventar dados.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
${JSON.stringify(offer, null, 2)}

## COPIES DE CRIATIVOS
${creativePack ? JSON.stringify(creativePack, null, 2) : 'Nenhum pack de criativos encontrado.'}

## ROTEIROS
${videoScripts ? JSON.stringify(videoScripts, null, 2) : 'Nenhum pack de roteiros encontrado.'}

## PLANO DE MIDIA
${mediaPlan ? JSON.stringify(mediaPlan, null, 2) : 'Nenhum plano de midia encontrado.'}

## CONTEUDO ORGANICO
${organicContent ? JSON.stringify(organicContent, null, 2) : 'Nenhum calendario organico encontrado.'}

## DECISAO DE METRICAS
${decision ? JSON.stringify(decision, null, 2) : 'Nenhuma decisao de metricas encontrada.'}

## METRICAS REAIS POR CRIATIVO
${creativeMetrics ? JSON.stringify(creativeMetrics, null, 2) : 'Nenhum arquivo data/metrics/{ideaId}/creative-metrics.json encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Se nao houver metricas reais por criativo, metricsAvailable deve ser false e decision deve ser "aguardando-dados" ou "criar-variacoes".
- Nao invente CTR, CPC, CPA, ROAS, compras, receita ou vencedores.
- Sem metricas reais, winners e losers devem ficar vazios; use inconclusive para hipoteses existentes.
- Nao recomende escalar se mediaPlan.launchStatus for bloqueado ou se nao houver compra atribuida.
- Nao peça prova falsa, antes/depois, depoimento inventado, promessa absoluta, cura ou milagre.
- Gere pelo menos 5 pedidos de variacao.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "metricsAvailable": ${creativeMetrics ? 'true' : 'false'},
  "decision": "aguardando-dados | criar-variacoes | pausar-criativos | manter-teste | escalar-vencedores",
  "summary": "",
  "winners": [],
  "losers": [],
  "inconclusive": [],
  "insights": [],
  "iterationRequests": [
    {
      "source": "",
      "angle": "",
      "format": "estatico | video | organico | ugc | carrossel",
      "reason": "",
      "brief": ""
    }
  ],
  "trackingRequests": [],
  "pageRequests": [],
  "mediaBuyerNotes": [],
  "doNotScaleYet": [],
  "riskNotes": []
}`
}

function renderMarkdown(analysis: CreativeAnalysis): string {
  return `# Creative Analysis

ideaId: ${analysis.ideaId}

metricsAvailable: ${analysis.metricsAvailable ? 'sim' : 'nao'}

decision: ${analysis.decision}

## Resumo
${analysis.summary}

## Vencedores
${analysis.winners.map(item => `- ${item}`).join('\n')}

## Perdedores
${analysis.losers.map(item => `- ${item}`).join('\n')}

## Inconclusivos
${analysis.inconclusive.map(item => `- ${item}`).join('\n')}

## Insights
${analysis.insights.map(item => `- ${item}`).join('\n')}

## Novas variacoes pedidas
${analysis.iterationRequests.map(item => `- ${item.format} | ${item.angle} | fonte: ${item.source} | motivo: ${item.reason} | brief: ${item.brief}`).join('\n')}

## Pedidos para tracking
${analysis.trackingRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para pagina
${analysis.pageRequests.map(item => `- ${item}`).join('\n')}

## Notas para media buyer
${analysis.mediaBuyerNotes.map(item => `- ${item}`).join('\n')}

## Nao escalar ainda
${analysis.doNotScaleYet.map(item => `- ${item}`).join('\n')}

## Riscos
${analysis.riskNotes.map(item => `- ${item}`).join('\n')}
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

function normalizeCreativeFormat(value: unknown): string {
  const format = itemToString(value).toLowerCase()
  if (['reels', 'shorts', 'story', 'stories', 'tiktok'].includes(format)) return 'video'
  if (['static', 'imagem', 'image'].includes(format)) return 'estatico'
  if (['carousel'].includes(format)) return 'carrossel'
  if (['estatico', 'video', 'organico', 'ugc', 'carrossel'].includes(format)) return format
  return 'estatico'
}

function normalizeAnalysis(response: unknown): unknown {
  if (!isRecord(response)) return response
  const insights = stringArray(response.insights)
  const iterationRequests = Array.isArray(response.iterationRequests)
    ? response.iterationRequests.map(item => {
      if (!isRecord(item)) return item
      return {
        ...item,
        source: itemToString(item.source),
        angle: itemToString(item.angle),
        format: normalizeCreativeFormat(item.format),
        reason: itemToString(item.reason),
        brief: itemToString(item.brief),
      }
    })
    : []

  return {
    ...response,
    winners: stringArray(response.winners),
    losers: stringArray(response.losers),
    inconclusive: stringArray(response.inconclusive),
    insights: insights.length > 0 ? insights : ['Sem metricas reais por criativo; tratar todos os criativos como hipoteses ainda inconclusivas.'],
    iterationRequests: iterationRequests.length > 0 ? iterationRequests : [{
      source: 'backlog inicial',
      angle: 'diagnostico visual',
      format: 'estatico',
      reason: 'Criar variacao inicial enquanto metricas por criativo ainda nao existem.',
      brief: 'Criativo educativo mostrando sintomas comuns da planta e convite leve para diagnosticar antes de agir.',
    }],
    trackingRequests: stringArray(response.trackingRequests),
    pageRequests: stringArray(response.pageRequests),
    mediaBuyerNotes: stringArray(response.mediaBuyerNotes),
    doNotScaleYet: stringArray(response.doNotScaleYet),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runCreativeAnalyst(input: CreativeAnalystInput): Promise<CreativeAnalystOutput> {
  const startTime = Date.now()

  logger.info('Agente 21 (CreativeAnalyst) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const creativePack = await loadCreativePack(ideaId)
  const videoScripts = await loadVideoScripts(ideaId)
  const mediaPlan = await loadMediaPlan(ideaId)
  const organicContent = await loadOrganicContent(ideaId)
  const decision = await loadOptimizationDecision(ideaId)
  const creativeMetrics = await loadCreativeMetrics(ideaId)
  const skillContent = await loadSkillContent('low-ticket-creative-analysis')

  if (!skillContent) throw new CreativeAnalystError('Skill low-ticket-creative-analysis nao encontrada.')

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'Voce analisa criativos low ticket. Responda apenas JSON valido.' },
      { role: 'user', content: buildPrompt(offer, creativePack, videoScripts, mediaPlan, organicContent, decision, creativeMetrics, skillContent) },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const analysis = CreativeAnalysisSchema.parse(normalizeAnalysis(parsed))

  const outputDir = input.outputDir ?? `data/creatives/${ideaId}`
  await ensureDir(outputDir)

  const analysisPath = `${outputDir}/creative-analysis.json`
  const markdownPath = `${outputDir}/creative-analysis.md`

  await writeJson(analysisPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    analysis,
  })
  await writeText(markdownPath, renderMarkdown(analysis))

  const durationMs = Date.now() - startTime
  logger.info('Agente 21 (CreativeAnalyst) - concluido', {
    ideaId,
    analysisPath,
    markdownPath,
    durationMs,
  })

  return { ideaId, analysisPath, markdownPath, durationMs }
}

export class CreativeAnalystError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CreativeAnalystError'
  }
}
