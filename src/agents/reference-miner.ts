import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, writeJson, writeText } from '../mcp/filesystem'
import { getFirecrawlHealth, scrapeFunnelReference } from '../mcp/firecrawl'
import { loadSkillContent } from '../skills/skill-loader'
import { logger } from '../utils/logger'
import {
  FunnelReferenceReport,
  FunnelReferenceReportSchema,
  FunnelStrategy,
  FunnelStrategySchema,
  OfferBrief,
  OfferBriefSchema,
  ReferenceMinerInput,
  ReferenceMinerOutput,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = { offer: OfferBrief }
type FunnelStrategyFile = { strategy: FunnelStrategy }

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const fs = await import('fs/promises')
    const projectRoot = path.resolve(__dirname, '..', '..')
    const entries = await fs.readdir(path.join(projectRoot, dirPath), { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => `${dirPath}/${entry.name}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) return selector

  const dirs = await listDirectories('data/offers')
  if (!dirs.length) throw new ReferenceMinerError('Nenhum offer-brief.json encontrado em data/offers.')
  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new ReferenceMinerError(`Oferta nao encontrada para seletor: ${selector}`)
}

async function loadOfferBrief(ideaId: string): Promise<OfferBrief> {
  const file = await readJson<OfferBriefFile>(`data/offers/${ideaId}/offer-brief.json`)
  return OfferBriefSchema.parse(file.offer)
}

async function loadFunnelStrategy(ideaId: string): Promise<FunnelStrategy> {
  const file = await readJson<FunnelStrategyFile>(`data/funnels/${ideaId}/funnel-strategy.json`)
  return FunnelStrategySchema.parse(file.strategy)
}

function compact(value: string, maxChars = 3500): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n[conteudo cortado]` : value
}

function buildPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  uiSkill: string,
  interactiveSkill: string,
  scrapedReferences: Array<{ url: string; title: string; markdown: string }>,
): string {
  return `Voce e o reference-miner de uma empresa agenticia low ticket.
Sua tarefa e transformar oferta, estrategia de funil e referencias web em um relatorio de padroes para design e implementacao.

## REGRA CENTRAL
Nao copie paginas. Extraia padroes, estruturas, riscos e oportunidades para criar uma pagina propria.

## SKILL UI
${uiSkill}

## SKILL FUNIS INTERATIVOS
${interactiveSkill}

## OFERTA
${JSON.stringify(offer, null, 2)}

## ESTRATEGIA DE FUNIL
${JSON.stringify(funnel, null, 2)}

## REFERENCIAS RASPADAS
${scrapedReferences.length
    ? scrapedReferences.map((ref, index) => `### ${index + 1}. ${ref.title}\nURL: ${ref.url}\n${compact(ref.markdown)}`).join('\n\n')
    : 'Nenhuma URL real foi raspada. Gere estrategia de busca e padroes esperados sem fingir que analisou concorrentes.'}

## SAIDA
Responda apenas JSON valido:
{
  "ideaId": "${offer.ideaId}",
  "researchStatus": "${scrapedReferences.length ? 'referencias-coletadas' : 'sem-firecrawl'}",
  "queryStrategy": [],
  "references": [],
  "marketPatterns": [],
  "uiOpportunities": [],
  "doNotCopy": [],
  "recommendationsForDesign": [],
  "recommendationsForBuilder": [],
  "riskNotes": []
}`
}

function renderMarkdown(report: FunnelReferenceReport): string {
  return `# Funnel Reference Report

ideaId: ${report.ideaId}
researchStatus: ${report.researchStatus}

## Estrategia de busca
${report.queryStrategy.map(item => `- ${item}`).join('\n')}

## Referencias
${report.references.map(ref => `### ${ref.title}
URL: ${ref.url}
Tipo: ${ref.funnelType}
Fonte: ${ref.source}

Secoes:
${ref.pageSections.map(item => `- ${item}`).join('\n')}

Padroes visuais:
${ref.visualPatterns.map(item => `- ${item}`).join('\n')}

Elementos de conversao:
${ref.conversionElements.map(item => `- ${item}`).join('\n')}
`).join('\n')}

## Padroes de mercado
${report.marketPatterns.map(item => `- ${item}`).join('\n')}

## Oportunidades de UI
${report.uiOpportunities.map(item => `- ${item}`).join('\n')}

## Nao copiar
${report.doNotCopy.map(item => `- ${item}`).join('\n')}

## Recomendacoes para design
${report.recommendationsForDesign.map(item => `- ${item}`).join('\n')}

## Recomendacoes para builder
${report.recommendationsForBuilder.map(item => `- ${item}`).join('\n')}

## Riscos
${report.riskNotes.map(item => `- ${item}`).join('\n')}
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringifyItem(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (!isRecord(value)) return ''

  const main =
    value.title ??
    value.name ??
    value.pattern ??
    value.opportunity ??
    value.recommendation ??
    value.query ??
    value.item ??
    value.description

  const details = Object.entries(value)
    .filter(([key, entry]) => !['title', 'name', 'pattern', 'opportunity', 'recommendation', 'query', 'item', 'description'].includes(key) && entry !== undefined && entry !== null)
    .map(([key, entry]) => `${key}: ${Array.isArray(entry) ? entry.map(stringifyItem).filter(Boolean).join(', ') : stringifyItem(entry) || String(entry)}`)

  return [main ? String(main) : '', ...details].filter(Boolean).join(' - ')
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback
  const items = value.map(stringifyItem).filter(item => item.trim().length > 0)
  return items.length ? items : fallback
}

function normalizeReference(value: unknown, index: number): unknown {
  if (!isRecord(value)) {
    return {
      url: 'referencia-simulada',
      title: `Padrao de mercado ${index + 1}`,
      source: 'llm',
      funnelType: 'low-ticket',
      pageSections: [stringifyItem(value)].filter(Boolean),
      visualPatterns: [],
      conversionElements: [],
      copyPatterns: [],
      interactionPatterns: [],
      differentiationOpportunities: [],
      riskNotes: [],
    }
  }

  return {
    url: String(value.url ?? value.link ?? value.domain ?? 'referencia-simulada'),
    title: String(value.title ?? value.name ?? value.referenceName ?? `Padrao de mercado ${index + 1}`),
    source: String(value.source ?? 'llm'),
    funnelType: String(value.funnelType ?? value.type ?? value.format ?? 'low-ticket'),
    pageSections: stringArray(value.pageSections ?? value.sections),
    visualPatterns: stringArray(value.visualPatterns ?? value.visuals ?? value.designPatterns),
    conversionElements: stringArray(value.conversionElements ?? value.conversion ?? value.elements),
    copyPatterns: stringArray(value.copyPatterns ?? value.copy),
    interactionPatterns: stringArray(value.interactionPatterns ?? value.interactions),
    differentiationOpportunities: stringArray(value.differentiationOpportunities ?? value.opportunities),
    riskNotes: stringArray(value.riskNotes ?? value.risks),
  }
}

function normalizeReferenceReport(response: unknown, ideaId: string): unknown {
  if (!isRecord(response)) return response

  const report = {
    ...response,
    ideaId,
    queryStrategy: stringArray(response.queryStrategy, ['Pesquisar funis low ticket de cuidados pet, coceira, alergia e controle de pulgas.']),
    references: Array.isArray(response.references)
      ? response.references.map(normalizeReference)
      : [],
    marketPatterns: stringArray(response.marketPatterns, ['Dor visual e urgente: tutor percebe coceira, vermelhidao ou pulgas e busca orientacao simples.']),
    uiOpportunities: stringArray(response.uiOpportunities, ['Criar experiencia mobile de diagnostico leve com sinais, rotina segura e alerta veterinario.']),
    doNotCopy: stringArray(response.doNotCopy, ['Nao copiar layout, promessa, depoimentos ou linguagem medica de concorrentes.']),
    recommendationsForDesign: stringArray(response.recommendationsForDesign, ['Usar visual limpo, empatico e educativo, com hierarquia forte para sinais de alerta e seguranca.']),
    recommendationsForBuilder: stringArray(response.recommendationsForBuilder, ['Priorizar carregamento rapido, CTA claro, prova visual educativa e eventos de quiz/checkout.']),
    riskNotes: stringArray(response.riskNotes),
  }

  return report
}

async function scrapeReferences(urls: string[] = []) {
  const health = getFirecrawlHealth()
  if (!urls.length || !health.configured) return []

  const results = []
  for (const url of urls.slice(0, 8)) {
    results.push(await scrapeFunnelReference({ url, mobile: true }))
  }
  return results
}

export async function runReferenceMiner(input: ReferenceMinerInput): Promise<ReferenceMinerOutput> {
  const startTime = Date.now()
  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const uiSkill = await loadSkillContent('ui-conversion-design')
  const interactiveSkill = await loadSkillContent('interactive-funnel-builder')

  if (!uiSkill || !interactiveSkill) {
    throw new ReferenceMinerError('Skills de UI/conversao ou funis interativos nao encontradas.')
  }

  logger.info('Agente ReferenceMiner - iniciando', {
    sessionId: input.sessionId,
    ideaId,
    urls: input.urls?.length || 0,
  })

  const scrapedReferences = await scrapeReferences(input.urls)
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce minera referencias de funis low ticket para orientar design sem plagio. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildPrompt(offer, funnel, uiSkill, interactiveSkill, scrapedReferences),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as unknown
  const report = FunnelReferenceReportSchema.parse(normalizeReferenceReport(parsed, ideaId))

  const outputDir = input.outputDir ?? `data/references/${ideaId}`
  await ensureDir(outputDir)

  const reportPath = `${outputDir}/reference-report.json`
  const markdownPath = `${outputDir}/reference-report.md`

  await writeJson(reportPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      sourceUrls: input.urls || [],
    },
    referenceReport: report,
  })
  await writeText(markdownPath, renderMarkdown(report))

  const durationMs = Date.now() - startTime
  logger.info('Agente ReferenceMiner - concluido', { ideaId, reportPath, durationMs })

  return { ideaId, reportPath, markdownPath, durationMs }
}

export class ReferenceMinerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceMinerError'
  }
}
