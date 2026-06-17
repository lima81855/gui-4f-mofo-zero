import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readTextOrNull, writeJson, writeText } from '../mcp/filesystem'
import { loadSkillContent } from '../skills/skill-loader'
import { logger } from '../utils/logger'
import {
  DesignBrief,
  DesignBriefSchema,
  FunnelReferenceReport,
  FunnelReferenceReportSchema,
  FunnelStrategy,
  FunnelStrategySchema,
  OfferBrief,
  OfferBriefSchema,
  VisualFunnelArchitecture,
  VisualFunnelArchitectureSchema,
  VisualFunnelArchitectInput,
  VisualFunnelArchitectOutput,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = { offer: OfferBrief }
type FunnelStrategyFile = { strategy: FunnelStrategy }
type DesignBriefFile = { designBrief: DesignBrief }
type ReferenceReportFile = { referenceReport: FunnelReferenceReport }

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
  if (!dirs.length) throw new VisualFunnelArchitectError('Nenhum offer-brief.json encontrado em data/offers.')
  if (!selector) return path.basename(dirs[0])
  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }
  throw new VisualFunnelArchitectError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadReferenceReport(ideaId: string): Promise<FunnelReferenceReport | null> {
  if (!await fileExists(`data/references/${ideaId}/reference-report.json`)) return null
  const file = await readJson<ReferenceReportFile>(`data/references/${ideaId}/reference-report.json`)
  return FunnelReferenceReportSchema.parse(file.referenceReport)
}

function compact(text: string | null, maxChars = 6000): string {
  if (!text) return 'Arquivo nao encontrado.'
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[conteudo cortado]` : text
}

function buildPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  salesPage: string | null,
  designBrief: DesignBrief,
  referenceReport: FunnelReferenceReport | null,
  uiSkill: string,
  interactiveSkill: string,
): string {
  return `Voce e o visual-funnel-architect de uma empresa agenticia low ticket.
Sua tarefa e desenhar a experiencia visual/interativa do funil antes do funnel-builder implementar.

## SKILL UI/UX DE CONVERSAO
${uiSkill}

## SKILL FUNIS INTERATIVOS
${interactiveSkill}

## OFERTA
${JSON.stringify(offer, null, 2)}

## ESTRATEGIA DE FUNIL
${JSON.stringify(funnel, null, 2)}

## COPY DA PAGINA
${compact(salesPage)}

## DESIGN BRIEF
${JSON.stringify(designBrief, null, 2)}

## RELATORIO DE REFERENCIAS
${referenceReport ? JSON.stringify(referenceReport, null, 2) : 'Nenhum relatorio de referencias encontrado. Use apenas oferta, copy, design e skills.'}

## REGRAS
- Nao inclua WhatsApp.
- Nao copie referencias.
- Se sugerir quiz, detalhe perguntas, estados e resultado.
- Se sugerir VSL dinamica, detalhe secoes, interacoes e CTA.
- Se sugerir gamificacao, ela deve reduzir friccao e aumentar clareza.
- Nao use prova falsa, antes/depois, selo ou depoimento inexistente.
- Responda apenas JSON valido.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "recommendedExperience": "pagina-direta | vsl-dinamica | quiz-gamificado | advertorial | diagnostico-interativo | calculadora",
  "strategicRationale": "",
  "visualConcept": "",
  "screenFlow": [],
  "componentSystem": [],
  "gamificationRules": [],
  "vslDynamicRules": [],
  "quizLogic": [],
  "mobileFirstRules": [],
  "accessibilityRules": [],
  "implementationNotes": [],
  "qaChecklist": [],
  "riskNotes": []
}`
}

function renderMarkdown(plan: VisualFunnelArchitecture): string {
  return `# Visual Funnel Architecture

ideaId: ${plan.ideaId}
recommendedExperience: ${plan.recommendedExperience}

## Racional
${plan.strategicRationale}

## Conceito visual
${plan.visualConcept}

## Fluxo de telas
${plan.screenFlow.map(screen => `${screen.order}. ${screen.screenId}
   - Objetivo: ${screen.purpose}
   - Layout: ${screen.layout}
   - Interacao: ${screen.interaction}
   - Gatilho de conversao: ${screen.conversionTrigger}
   - Assets: ${screen.requiredAssets.join('; ')}`).join('\n\n')}

## Componentes
${plan.componentSystem.map(item => `- ${item}`).join('\n')}

## Gamificacao
${plan.gamificationRules.map(item => `- ${item}`).join('\n')}

## VSL dinamica
${plan.vslDynamicRules.map(item => `- ${item}`).join('\n')}

## Logica de quiz
${plan.quizLogic.map(item => `- ${item}`).join('\n')}

## Mobile-first
${plan.mobileFirstRules.map(item => `- ${item}`).join('\n')}

## Acessibilidade
${plan.accessibilityRules.map(item => `- ${item}`).join('\n')}

## Implementacao
${plan.implementationNotes.map(item => `- ${item}`).join('\n')}

## QA
${plan.qaChecklist.map(item => `- ${item}`).join('\n')}

## Riscos
${plan.riskNotes.map(item => `- ${item}`).join('\n')}
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
    value.label ??
    value.purpose ??
    value.description ??
    value.text
  const details = Object.entries(value)
    .filter(([key, entry]) => !['title', 'name', 'label', 'purpose', 'description', 'text'].includes(key) && entry !== undefined && entry !== null)
    .map(([key, entry]) => `${key}: ${Array.isArray(entry) ? entry.map(stringifyItem).filter(Boolean).join(', ') : stringifyItem(entry) || String(entry)}`)

  return [main ? String(main) : '', ...details].filter(Boolean).join(' - ')
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback
  const items = value.map(stringifyItem).filter(item => item.trim().length > 0)
  return items.length ? items : fallback
}

function normalizeScreen(value: unknown, index: number): unknown {
  if (!isRecord(value)) {
    const text = stringifyItem(value) || `Tela ${index + 1}`
    return {
      order: index + 1,
      screenId: `screen-${index + 1}`,
      purpose: text,
      layout: text,
      interaction: 'Rolagem e CTA conforme etapa do funil.',
      conversionTrigger: 'Clareza da dor e proximo passo evidente.',
      requiredAssets: [],
    }
  }

  const label = value.screenId ?? value.id ?? value.name ?? value.title ?? `screen-${index + 1}`
  return {
    order: Number(value.order ?? value.step ?? index + 1),
    screenId: String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `screen-${index + 1}`,
    purpose: String(value.purpose ?? value.goal ?? value.objective ?? value.description ?? value.title ?? `Tela ${index + 1}`),
    layout: String(value.layout ?? value.structure ?? value.wireframe ?? value.description ?? 'Layout mobile-first com hierarquia clara.'),
    interaction: String(value.interaction ?? value.behavior ?? value.action ?? 'Rolagem e CTA conforme etapa do funil.'),
    conversionTrigger: String(value.conversionTrigger ?? value.trigger ?? value.cta ?? 'Proximo passo claro para avancar no funil.'),
    requiredAssets: stringArray(value.requiredAssets ?? value.assets),
  }
}

function normalizeVisualArchitecture(response: unknown, ideaId: string): unknown {
  if (!isRecord(response)) return response

  return {
    ...response,
    ideaId,
    screenFlow: Array.isArray(response.screenFlow)
      ? response.screenFlow.map(normalizeScreen)
      : [{
        order: 1,
        screenId: 'hero',
        purpose: 'Apresentar dor principal e promessa segura.',
        layout: 'Primeira dobra mobile-first com headline, subtitulo, prova educativa e CTA.',
        interaction: 'CTA leva para explicacao da rotina/diagnostico.',
        conversionTrigger: 'Reconhecimento imediato do problema do pet.',
        requiredAssets: [],
      }],
    componentSystem: stringArray(response.componentSystem, ['Hero educativo', 'Cards de sinais', 'Blocos de rotina segura', 'CTA persistente mobile']),
    gamificationRules: stringArray(response.gamificationRules),
    vslDynamicRules: stringArray(response.vslDynamicRules),
    quizLogic: stringArray(response.quizLogic),
    mobileFirstRules: stringArray(response.mobileFirstRules, ['Priorizar leitura em uma coluna e CTA visivel sem obstruir conteudo.']),
    accessibilityRules: stringArray(response.accessibilityRules, ['Contraste adequado, botoes grandes e textos legiveis em mobile.']),
    implementationNotes: stringArray(response.implementationNotes, ['Evitar promessas medicas; incluir alerta veterinario e orientacao educativa.']),
    qaChecklist: stringArray(response.qaChecklist, ['Validar CTA, tracking, responsividade e claims antes de publicar.']),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runVisualFunnelArchitect(
  input: VisualFunnelArchitectInput,
): Promise<VisualFunnelArchitectOutput> {
  const startTime = Date.now()
  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const salesPage = await readTextOrNull(`data/funnels/${ideaId}/sales-page.md`)
  const designBrief = await loadDesignBrief(ideaId)
  const referenceReport = await loadReferenceReport(ideaId)
  const uiSkill = await loadSkillContent('ui-conversion-design')
  const interactiveSkill = await loadSkillContent('interactive-funnel-builder')

  if (!uiSkill || !interactiveSkill) {
    throw new VisualFunnelArchitectError('Skills de UI/conversao ou funis interativos nao encontradas.')
  }

  logger.info('Agente VisualFunnelArchitect - iniciando', { sessionId: input.sessionId, ideaId })

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce arquiteta experiencias visuais de funis low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildPrompt(offer, funnel, salesPage, designBrief, referenceReport, uiSkill, interactiveSkill),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as unknown
  const architecture: VisualFunnelArchitecture = VisualFunnelArchitectureSchema.parse(normalizeVisualArchitecture(parsed, ideaId))

  const outputDir = input.outputDir ?? `data/visual-funnels/${ideaId}`
  await ensureDir(outputDir)

  const architecturePath = `${outputDir}/visual-funnel-architecture.json`
  const markdownPath = `${outputDir}/visual-funnel-architecture.md`

  await writeJson(architecturePath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    architecture,
  })
  await writeText(markdownPath, renderMarkdown(architecture))

  const durationMs = Date.now() - startTime
  logger.info('Agente VisualFunnelArchitect - concluido', { ideaId, architecturePath, durationMs })

  return { ideaId, architecturePath, markdownPath, durationMs }
}

export class VisualFunnelArchitectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VisualFunnelArchitectError'
  }
}
