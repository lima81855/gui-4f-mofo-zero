import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readText, writeJson } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CreativePackSchema,
  FunnelStrategySchema,
  OfferBriefSchema,
  type AdCopywriterInput,
  type AdCopywriterOutput,
  type CreativePack,
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

type FunnelStrategyFile = {
  metadata: {
    agentVersion: string
    processedAt: string
    durationMs: number
  }
  strategy: FunnelStrategy
}

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) {
    return selector
  }

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new AdCopywriterError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new AdCopywriterError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadSalesPage(ideaId: string): Promise<string> {
  return readText(`data/funnels/${ideaId}/sales-page.md`)
}

async function loadCreativeReferences(): Promise<string> {
  const refs = await Promise.all([
    readText('skills/creative-copy/references/behavioral-blueprint.md'),
    readText('skills/creative-copy/references/funnel-creative-bridge.md'),
    readText('skills/creative-copy/references/no-brain-stack-creatives.md'),
  ])

  return refs.join('\n\n---\n\n')
}

function buildAdPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  salesPage: string,
  skillContent: string,
  references: string,
): string {
  return `Voce e o agente ad-copywriter de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e criar um pacote de criativos estaticos para testar em trafego pago.

## SKILL PRINCIPAL
${skillContent}

## REFERENCIAS
${references}

## OFERTA
Produto: ${offer.productName}
Publico: ${offer.targetAudience}
Problema urgente: ${offer.urgentProblem}
Desejo: ${offer.desire}
Promessa unica: ${offer.uniquePromise}
Mecanismo unico: ${offer.uniqueMechanism}
Preco: ${offer.price}
Stack:
${offer.offerStack.map(item => `- ${item}`).join('\n')}
Bonus:
${offer.bonuses.map(item => `- ${item}`).join('\n')}
Garantia: ${offer.guarantee}
Objecoes:
${offer.objections.map(item => `- ${item}`).join('\n')}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## FUNIL
Tipo: ${funnel.recommendedFunnel}
Temperatura: ${funnel.trafficTemperature}
Consciencia: ${funnel.awarenessLevel}
Eventos: ${funnel.trackingEvents.join(', ')}

## PAGINA DE VENDAS
${salesPage.slice(0, 5000)}

## REGRAS
- Nao existe funil de WhatsApp.
- Nao use "garantido", "garantida", "100%", "milagre", "cura" ou promessa absoluta.
- Gere criativos estaticos para Meta Ads/Reels feed.
- Gere pelo menos 12 criativos.
- Inclua pelo menos: 3 dor direta, 3 erro comum, 2 diagnostico, 2 prova visual, 2 perda evitavel.
- Cada imageText deve ter 3 a 9 palavras quando possivel.
- O creativePack deve alinhar cada criativo com a pagina de vendas.
- Responda apenas JSON valido.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "creativeAngles": [
    {
      "angle": "",
      "state": "reconhecimento | erro-invisivel | alivio-imediato | perda-evitavel | prova-visual",
      "hook": "",
      "imageText": "",
      "primaryText": "",
      "headline": "",
      "visualBrief": "",
      "cta": "",
      "objectionHandled": "",
      "landingPageMatch": ""
    }
  ]
}`
}

export async function runAdCopywriter(input: AdCopywriterInput): Promise<AdCopywriterOutput> {
  const startTime = Date.now()

  logger.info('Agente 9 (AdCopywriter) — iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const salesPage = await loadSalesPage(ideaId)
  const skillContent = await loadSkillContent('static-ad-creative-copy')

  if (!skillContent) {
    throw new AdCopywriterError('Skill static-ad-creative-copy nao encontrada.')
  }

  const references = await loadCreativeReferences()

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce escreve pacotes de criativos low ticket claros, testaveis e sem claims proibidos. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildAdPrompt(offer, funnel, salesPage, skillContent, references),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const creativePack: CreativePack = CreativePackSchema.parse(parsed)

  const outputDir = input.outputDir ?? `data/creatives/${ideaId}`
  await ensureDir(outputDir)

  const creativePath = `${outputDir}/ad-copies.json`
  await writeJson(creativePath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    creativePack,
  })

  const durationMs = Date.now() - startTime
  logger.info('Agente 9 (AdCopywriter) — concluido', {
    ideaId,
    creativePath,
    durationMs,
  })

  return {
    ideaId,
    creativePath,
    durationMs,
  }
}

export class AdCopywriterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdCopywriterError'
  }
}
