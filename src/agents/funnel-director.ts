import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, listFiles, readJson, writeJson } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  FunnelStrategySchema,
  OfferBriefSchema,
  type FunnelDirectorInput,
  type FunnelDirectorOutput,
  type FunnelStrategy,
  type OfferBrief,
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

async function loadOfferBrief(selector?: string): Promise<OfferBrief> {
  if (selector) {
    const directPath = `data/offers/${selector}/offer-brief.json`
    if (await fileExists(directPath)) {
      const file = await readJson<OfferBriefFile>(directPath)
      return OfferBriefSchema.parse(file.offer)
    }
  }

  const files = await listOfferFiles()
  if (files.length === 0) {
    throw new FunnelDirectorError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  for (const filePath of files) {
    const file = await readJson<OfferBriefFile>(filePath)
    const offer = OfferBriefSchema.parse(file.offer)
    if (!selector || offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer
    }
  }

  throw new FunnelDirectorError(`Oferta nao encontrada para seletor: ${selector}`)
}

async function listOfferFiles(): Promise<string[]> {
  const dirs = await listDirectories('data/offers')
  const files: string[] = []

  for (const dir of dirs) {
    const filePath = `${dir}/offer-brief.json`
    if (await fileExists(filePath)) files.push(filePath)
  }

  return files
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

function buildFunnelPrompt(offer: OfferBrief, skillContent: string): string {
  return `Voce e o agente funnel-director de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e escolher o funil mais simples e mais adequado para vender a oferta abaixo.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
Produto: ${offer.productName}
Publico: ${offer.targetAudience}
Problema urgente: ${offer.urgentProblem}
Desejo: ${offer.desire}
Promessa unica: ${offer.uniquePromise}
Mecanismo unico: ${offer.uniqueMechanism}
Stack:
${offer.offerStack.map(item => `- ${item}`).join('\n')}
Bonus:
${offer.bonuses.map(item => `- ${item}`).join('\n')}
Preco: ${offer.price}
Order bump: ${offer.orderBump.name} — ${offer.orderBump.promise} — ${offer.orderBump.price}
Upsell: ${offer.upsell.name} — ${offer.upsell.promise} — ${offer.upsell.price}
Garantia: ${offer.guarantee}
Provas necessarias:
${offer.proofAssetsNeeded.map(item => `- ${item}`).join('\n')}
Objecoes:
${offer.objections.map(item => `- ${item}`).join('\n')}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## REGRAS
- Nao existe funil de WhatsApp nesta operacao.
- Escolha apenas entre: pagina-direta, vsl-curta, quiz, advertorial.
- O funil deve ser proporcional ao preco e a complexidade da oferta.
- Para ofertas simples de R$47, prefira pagina-direta salvo se houver forte ceticismo ou baixa consciencia.
- TrackingEvents deve incluir eventos que o tracking-agent configurara depois.
- LeadMagnet pode ser "nenhum" quando nao fizer sentido.
- Responda em portugues do Brasil.

Retorne APENAS JSON valido:
{
  "ideaId": "${offer.ideaId}",
  "recommendedFunnel": "pagina-direta | vsl-curta | quiz | advertorial",
  "why": "",
  "trafficTemperature": "frio | morno | quente",
  "awarenessLevel": "inconsciente | problema | solucao | produto | muito-consciente",
  "pageSections": [],
  "leadMagnet": "",
  "checkoutFlow": "",
  "orderBumpPlacement": "",
  "upsellPlacement": "",
  "trackingEvents": [],
  "mainRisks": []
}`
}

function stringifySection(section: unknown): string {
  if (typeof section === 'string') return section
  if (!section || typeof section !== 'object') return String(section ?? '')

  const record = section as Record<string, unknown>
  const title =
    record.title ??
    record.name ??
    record.section ??
    record.sectionName ??
    record.headline ??
    record.id
  const description =
    record.description ??
    record.copy ??
    record.content ??
    record.purpose ??
    record.goal ??
    record.text

  const extras = Object.entries(record)
    .filter(([key, value]) => !['title', 'name', 'section', 'sectionName', 'headline', 'id', 'description', 'copy', 'content', 'purpose', 'goal', 'text'].includes(key) && value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)

  return [title, description, ...extras].filter(Boolean).join(' - ')
}

function normalizeFunnelStrategy(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response

  const record = response as Record<string, unknown>
  return {
    ...record,
    pageSections: Array.isArray(record.pageSections)
      ? record.pageSections.map(stringifySection).filter(section => section.trim().length > 0)
      : record.pageSections,
  }
}

export async function runFunnelDirector(input: FunnelDirectorInput): Promise<FunnelDirectorOutput> {
  const startTime = Date.now()

  logger.info('Agente 7 (FunnelDirector) — iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const offer = await loadOfferBrief(input.ideaId)
  const skillContent = await loadSkillContent('low-ticket-funnel-director')
  if (!skillContent) {
    throw new FunnelDirectorError('Skill low-ticket-funnel-director nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce cria estrategias de funil low ticket. Responda sempre apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildFunnelPrompt(offer, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const funnelStrategy: FunnelStrategy = FunnelStrategySchema.parse(normalizeFunnelStrategy(parsed))

  const outputDir = input.outputDir ?? `data/funnels/${offer.ideaId}`
  await ensureDir(outputDir)

  const funnelPath = `${outputDir}/funnel-strategy.json`
  await writeJson(funnelPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    strategy: funnelStrategy,
  })

  const durationMs = Date.now() - startTime
  logger.info('Agente 7 (FunnelDirector) — concluido', {
    ideaId: offer.ideaId,
    funnelPath,
    durationMs,
  })

  return {
    ideaId: offer.ideaId,
    funnelPath,
    durationMs,
  }
}

export class FunnelDirectorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FunnelDirectorError'
  }
}
