import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readText, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CreativePackSchema,
  DesignBriefSchema,
  OfferBriefSchema,
  VideoScriptPackSchema,
  type CreativePack,
  type DesignBrief,
  type DesignBriefAgentInput,
  type DesignBriefAgentOutput,
  type OfferBrief,
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

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) {
    return selector
  }

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new DesignBriefAgentError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new DesignBriefAgentError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadCreativePack(ideaId: string): Promise<CreativePack> {
  const file = await readJson<CreativePackFile>(`data/creatives/${ideaId}/ad-copies.json`)
  return CreativePackSchema.parse(file.creativePack)
}

async function loadVideoScriptPack(ideaId: string): Promise<VideoScriptPack> {
  const file = await readJson<VideoScriptPackFile>(`data/creatives/${ideaId}/video-scripts.json`)
  return VideoScriptPackSchema.parse(file.scriptPack)
}

function buildDesignPrompt(
  offer: OfferBrief,
  salesPage: string,
  creativePack: CreativePack,
  videoScriptPack: VideoScriptPack,
  skillContent: string,
): string {
  return `Voce e o agente design-brief-agent de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e transformar oferta, copy, criativos e roteiros em uma direcao visual executavel para design e implementacao.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
Produto: ${offer.productName}
Publico: ${offer.targetAudience}
Problema: ${offer.urgentProblem}
Desejo: ${offer.desire}
Promessa: ${offer.uniquePromise}
Mecanismo: ${offer.uniqueMechanism}
Preco: ${offer.price}
Stack:
${offer.offerStack.map(item => `- ${item}`).join('\n')}
Bonus:
${offer.bonuses.map(item => `- ${item}`).join('\n')}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## PAGINA DE VENDAS
${salesPage.slice(0, 5000)}

## CRIATIVOS ESTATICOS
${creativePack.creativeAngles.slice(0, 12).map((angle, index) => `${index + 1}. ${angle.angle} / ${angle.state}
Hook: ${angle.hook}
Texto imagem: ${angle.imageText}
Visual: ${angle.visualBrief}`).join('\n\n')}

## ROTEIROS DE VIDEO
${videoScriptPack.scripts.map((script, index) => `${index + 1}. ${script.name} / ${script.format}
Hook: ${script.hook}
Cenas: ${script.sceneByScene.join(' | ')}`).join('\n\n')}

## REGRAS
- Nao invente depoimentos, selos, certificacoes ou antes/depois.
- Se ainda nao houver prova real, indique placeholder de prova real a coletar.
- Nao sugira certificado, autoridade, especialista ou selo se isso nao existir nos arquivos de entrada.
- Nao use "garantido", "garantida", "100%", "milagre", "cura" ou promessa absoluta.
- Nao inclua WhatsApp na operacao.
- O resultado deve ser implementavel por designer e desenvolvedor.
- Responda apenas JSON valido.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "brandDirection": {
    "positioning": "",
    "visualMood": "",
    "colorPalette": [],
    "typography": "",
    "imageryStyle": "",
    "avoid": []
  },
  "landingPageBrief": {
    "hero": "",
    "sections": [],
    "trustElements": [],
    "ctaStyle": "",
    "mobileNotes": []
  },
  "productMockups": [],
  "staticCreativeBriefs": [],
  "videoAssetBriefs": [],
  "assetChecklist": [],
  "implementationNotes": [],
  "complianceNotes": []
}`
}

function renderMarkdown(brief: DesignBrief): string {
  return `# Design Brief

ideaId: ${brief.ideaId}

## Direcao da marca

**Posicionamento:** ${brief.brandDirection.positioning}

**Mood visual:** ${brief.brandDirection.visualMood}

**Paleta:** ${brief.brandDirection.colorPalette.join(', ')}

**Tipografia:** ${brief.brandDirection.typography}

**Imagem:** ${brief.brandDirection.imageryStyle}

**Evitar:**
${brief.brandDirection.avoid.map(item => `- ${item}`).join('\n')}

## Landing page

**Hero:** ${brief.landingPageBrief.hero}

**Secoes:**
${brief.landingPageBrief.sections.map(item => `- ${item}`).join('\n')}

**Confiança/prova:**
${brief.landingPageBrief.trustElements.map(item => `- ${item}`).join('\n')}

**CTA:** ${brief.landingPageBrief.ctaStyle}

**Mobile:**
${brief.landingPageBrief.mobileNotes.map(item => `- ${item}`).join('\n')}

## Mockups do produto
${brief.productMockups.map(item => `- ${item}`).join('\n')}

## Briefs de criativos estaticos
${brief.staticCreativeBriefs.map(item => `- ${item}`).join('\n')}

## Assets para videos
${brief.videoAssetBriefs.map(item => `- ${item}`).join('\n')}

## Checklist de assets
${brief.assetChecklist.map(item => `- ${item}`).join('\n')}

## Notas de implementacao
${brief.implementationNotes.map(item => `- ${item}`).join('\n')}

## Compliance
${brief.complianceNotes.map(item => `- ${item}`).join('\n')}
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function briefItemToString(item: unknown): string {
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (Array.isArray(item)) return item.map(briefItemToString).filter(Boolean).join('; ')

  if (isRecord(item)) {
    const preferredKeys = ['title', 'name', 'section', 'angle', 'description', 'details', 'notes']
    const parts = preferredKeys
      .filter(key => item[key] !== undefined)
      .map(key => briefItemToString(item[key]))
      .filter(Boolean)

    if (parts.length > 0) return parts.join(' - ')

    return Object.entries(item)
      .map(([key, value]) => `${key}: ${briefItemToString(value)}`)
      .join('; ')
  }

  return ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(briefItemToString).filter(Boolean)
}

function stringValue(value: unknown, fallback: string): string {
  const parsed = briefItemToString(value).trim()
  return parsed.length > 0 ? parsed : fallback
}

function normalizeDesignBriefResponse(response: unknown): unknown {
  if (!isRecord(response)) return response

  const normalized = { ...response }

  const brandDirection = isRecord(normalized.brandDirection)
    ? normalized.brandDirection
    : {}

  normalized.brandDirection = {
    positioning: stringValue(brandDirection.positioning ?? normalized.positioning, 'Oferta low ticket direta, visual e orientada a solucao pratica.'),
    visualMood: stringValue(brandDirection.visualMood ?? normalized.visualMood, 'Limpo, domestico, confiavel e facil de executar.'),
    colorPalette: stringArray(brandDirection.colorPalette).length > 0
      ? stringArray(brandDirection.colorPalette)
      : ['verde limpeza', 'azul claro', 'branco', 'cinza suave'],
    typography: stringValue(brandDirection.typography, 'Sans-serif legivel, com titulos fortes e corpo de leitura simples.'),
    imageryStyle: stringValue(brandDirection.imageryStyle, 'Mockups do kit digital, ambientes domesticos claros e fotos de objetos reais sem exagero.'),
    avoid: stringArray(brandDirection.avoid).length > 0
      ? stringArray(brandDirection.avoid)
      : ['promessa milagrosa', 'antes e depois falso', 'selos ou autoridade nao comprovados'],
  }

  const landingPageBrief = isRecord(normalized.landingPageBrief)
    ? normalized.landingPageBrief
    : {}

  const sections = stringArray(landingPageBrief.sections).length > 0
    ? stringArray(landingPageBrief.sections)
    : stringArray(normalized.sections).length > 0
      ? stringArray(normalized.sections)
      : [
          'Primeira dobra com problema urgente, promessa especifica e mockup do kit digital.',
          'Bloco de mecanismo em 3 etapas mostrando como o usuario identifica, remove e previne.',
          'Stack da oferta com entregaveis visuais, bonus e garantia.',
          'Objeções, seguranca de uso e chamada para checkout.',
        ]

  normalized.landingPageBrief = {
    hero: stringValue(landingPageBrief.hero ?? normalized.hero, 'Mostre a dor do mofo no ambiente e apresente o kit digital como primeiro passo seguro.'),
    sections,
    trustElements: stringArray(landingPageBrief.trustElements),
    ctaStyle: stringValue(landingPageBrief.ctaStyle, 'Botao verde solido, texto direto e preco proximo ao CTA.'),
    mobileNotes: stringArray(landingPageBrief.mobileNotes).length > 0
      ? stringArray(landingPageBrief.mobileNotes)
      : ['Hero curto', 'CTA visivel sem empilhar botoes repetidos', 'mockup legivel em tela pequena'],
  }

  normalized.productMockups = stringArray(normalized.productMockups)
  normalized.staticCreativeBriefs = stringArray(normalized.staticCreativeBriefs)
  normalized.videoAssetBriefs = stringArray(normalized.videoAssetBriefs)
  normalized.assetChecklist = stringArray(normalized.assetChecklist)
  normalized.implementationNotes = stringArray(normalized.implementationNotes)
  normalized.complianceNotes = stringArray(normalized.complianceNotes)

  return normalized
}

export async function runDesignBriefAgent(input: DesignBriefAgentInput): Promise<DesignBriefAgentOutput> {
  const startTime = Date.now()

  logger.info('Agente 11 (DesignBriefAgent) — iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const salesPage = await readText(`data/funnels/${ideaId}/sales-page.md`)
  const creativePack = await loadCreativePack(ideaId)
  const videoScriptPack = await loadVideoScriptPack(ideaId)
  const skillContent = await loadSkillContent('low-ticket-design-brief')

  if (!skillContent) {
    throw new DesignBriefAgentError('Skill low-ticket-design-brief nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce cria briefs de design para ofertas low ticket, com foco em clareza, conversao e compliance. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildDesignPrompt(offer, salesPage, creativePack, videoScriptPack, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const designBrief: DesignBrief = DesignBriefSchema.parse(normalizeDesignBriefResponse(parsed))

  const outputDir = input.outputDir ?? `data/design/${ideaId}`
  await ensureDir(outputDir)

  const designPath = `${outputDir}/design-brief.json`
  const markdownPath = `${outputDir}/design-brief.md`

  await writeJson(designPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    designBrief,
  })
  await writeText(markdownPath, renderMarkdown(designBrief))

  const durationMs = Date.now() - startTime
  logger.info('Agente 11 (DesignBriefAgent) — concluido', {
    ideaId,
    designPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    designPath,
    markdownPath,
    durationMs,
  }
}

export class DesignBriefAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesignBriefAgentError'
  }
}
