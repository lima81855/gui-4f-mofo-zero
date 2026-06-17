import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readText, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CreativePackSchema,
  OfferBriefSchema,
  VideoScriptPackSchema,
  type CreativePack,
  type OfferBrief,
  type VideoScriptPack,
  type VideoScriptwriterInput,
  type VideoScriptwriterOutput,
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

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) {
    return selector
  }

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new VideoScriptwriterError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new VideoScriptwriterError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadSalesPage(ideaId: string): Promise<string> {
  return readText(`data/funnels/${ideaId}/sales-page.md`)
}

function buildVideoPrompt(
  offer: OfferBrief,
  creativePack: CreativePack,
  salesPage: string,
  skillContent: string,
): string {
  return `Voce e o agente video-scriptwriter de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e transformar os angulos de criativos estaticos em roteiros curtos para UGC/Reels/VSL curta.

## SKILL OPERACIONAL
${skillContent}

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
Garantia: ${offer.guarantee}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## ANGULOS DE CRIATIVOS
${creativePack.creativeAngles.map((angle, index) => `${index + 1}. ${angle.angle} / ${angle.state}
Hook: ${angle.hook}
Texto imagem: ${angle.imageText}
Copy: ${angle.primaryText}
Visual: ${angle.visualBrief}
CTA: ${angle.cta}`).join('\n\n')}

## PAGINA DE VENDAS
${salesPage.slice(0, 4500)}

## REGRAS
- Nao existe funil de WhatsApp.
- Nao use "garantido", "garantida", "100%", "milagre", "cura" ou promessa absoluta.
- Gere pelo menos 6 roteiros.
- Inclua formatos variados: ugc, demonstracao, vsl-curta e organico.
- Cada roteiro deve ser gravavel com celular.
- Mostre o produto, mapa, checklist ou diagnostico visual sempre que possivel.
- CTA deve levar para a pagina direta/Kit SOS, nao para conversa manual.
- Responda apenas JSON valido.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "scripts": [
    {
      "name": "",
      "sourceAngle": "",
      "format": "ugc | demonstracao | vsl-curta | organico",
      "hook": "",
      "sceneByScene": [],
      "voiceover": "",
      "onScreenText": [],
      "cta": ""
    }
  ]
}`
}

function renderMarkdown(pack: VideoScriptPack): string {
  const blocks = pack.scripts.map((script, index) => {
    const scenes = script.sceneByScene.map(scene => `- ${scene}`).join('\n')
    const texts = script.onScreenText.map(text => `- ${text}`).join('\n')

    return `## ${index + 1}. ${script.name}

**Formato:** ${script.format}
**Angulo base:** ${script.sourceAngle}
**Hook:** ${script.hook}

### Cena a cena
${scenes}

### Voiceover
${script.voiceover}

### Texto na tela
${texts}

### CTA
${script.cta}`
  }).join('\n\n')

  return `# Roteiros de Video

ideaId: ${pack.ideaId}

${blocks}
`
}

export async function runVideoScriptwriter(input: VideoScriptwriterInput): Promise<VideoScriptwriterOutput> {
  const startTime = Date.now()

  logger.info('Agente 10 (VideoScriptwriter) — iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const creativePack = await loadCreativePack(ideaId)
  const salesPage = await loadSalesPage(ideaId)
  const skillContent = await loadSkillContent('short-form-low-ticket-scripts')

  if (!skillContent) {
    throw new VideoScriptwriterError('Skill short-form-low-ticket-scripts nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce escreve roteiros curtos para criativos low ticket, com clareza, celular-first e sem claims proibidos. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildVideoPrompt(offer, creativePack, salesPage, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const scriptPack: VideoScriptPack = VideoScriptPackSchema.parse(parsed)

  const outputDir = input.outputDir ?? `data/creatives/${ideaId}`
  await ensureDir(outputDir)

  const scriptsPath = `${outputDir}/video-scripts.json`
  const markdownPath = `${outputDir}/video-scripts.md`

  await writeJson(scriptsPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    scriptPack,
  })
  await writeText(markdownPath, renderMarkdown(scriptPack))

  const durationMs = Date.now() - startTime
  logger.info('Agente 10 (VideoScriptwriter) — concluido', {
    ideaId,
    scriptsPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    scriptsPath,
    markdownPath,
    durationMs,
  }
}

export class VideoScriptwriterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoScriptwriterError'
  }
}
