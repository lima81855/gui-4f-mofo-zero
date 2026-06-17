import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readTextOrNull, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  FunnelStrategySchema,
  OfferBriefSchema,
  type FunnelStrategy,
  type OfferBrief,
  type SalesPageCopywriterInput,
  type SalesPageCopywriterOutput,
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

async function loadOfferBrief(selector?: string): Promise<OfferBrief> {
  const ideaId = await resolveIdeaId(selector)
  const file = await readJson<OfferBriefFile>(`data/offers/${ideaId}/offer-brief.json`)
  return OfferBriefSchema.parse(file.offer)
}

async function loadFunnelStrategy(ideaId: string): Promise<FunnelStrategy> {
  const file = await readJson<FunnelStrategyFile>(`data/funnels/${ideaId}/funnel-strategy.json`)
  return FunnelStrategySchema.parse(file.strategy)
}

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) {
    return selector
  }

  if (!selector) {
    const dirs = await listDirectories('data/offers')
    if (dirs.length === 0) {
      throw new SalesPageCopywriterError('Nenhum offer-brief.json encontrado em data/offers.')
    }
    return path.basename(dirs[0])
  }

  const dirs = await listDirectories('data/offers')
  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new SalesPageCopywriterError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadProductContent(ideaId: string): Promise<string | null> {
  return readTextOrNull(`data/products/${ideaId}/product-content.md`)
}

function buildCopyPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  productContent: string | null,
  skillContent: string,
): string {
  const productContext = productContent
    ? productContent.slice(0, 7000)
    : 'Conteudo do produto nao encontrado. Use apenas offer brief e estrategia de funil.'

  return `Voce e o agente sales-page-copywriter de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e escrever a copy completa da pagina de vendas para a oferta abaixo.

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
Bonus:
${offer.bonuses.map(item => `- ${item}`).join('\n')}
Order bump: ${offer.orderBump.name} — ${offer.orderBump.promise} — ${offer.orderBump.price}
Upsell: ${offer.upsell.name} — ${offer.upsell.promise} — ${offer.upsell.price}
Garantia: ${offer.guarantee}
Provas necessarias:
${offer.proofAssetsNeeded.map(item => `- ${item}`).join('\n')}
Objecoes:
${offer.objections.map(item => `- ${item}`).join('\n')}
Riscos:
${offer.riskNotes.map(item => `- ${item}`).join('\n')}

## FUNIL
Tipo: ${funnel.recommendedFunnel}
Por que: ${funnel.why}
Temperatura: ${funnel.trafficTemperature}
Consciencia: ${funnel.awarenessLevel}
Secoes:
${funnel.pageSections.map(section => `- ${section}`).join('\n')}

## CONTEUDO DO PRODUTO
${productContext}

## REGRAS
- Escreva em portugues do Brasil.
- Gere uma pagina de vendas direta, pronta para design implementar.
- Nao inclua funil de WhatsApp.
- Nao prometa salvamento garantido da planta.
- Nao use palavras como "garantido", "garantida", "milagre", "definitivo" ou "100%".
- Nao use hype vazio.
- Inclua CTAs claros.
- Inclua blocos de objecao e FAQ.
- Inclua copy curta para order bump e upsell em secoes separadas.
- Use Markdown com titulos claros.

Estruture exatamente assim, substituindo todos os exemplos por texto final sem colchetes:
---
ideaId: ${offer.ideaId}
productName: ${offer.productName}
funnel: ${funnel.recommendedFunnel}
---

# Escreva aqui a headline final da pagina, sem colchetes e sem rotulo explicativo

## Subheadline
...

## Cena da dor
...

## Por que as solucoes comuns falham
...

## O mecanismo unico
...

## O que e o produto
...

## O que vem dentro
...

## Como usar
...

## Beneficios concretos
...

## Provas que precisam entrar na pagina
...

## Oferta
...

## Order bump
...

## Upsell pos-compra
...

## Garantia
...

## FAQ
...

## CTA final
...`
}

export async function runSalesPageCopywriter(input: SalesPageCopywriterInput): Promise<SalesPageCopywriterOutput> {
  const startTime = Date.now()

  logger.info('Agente 8 (SalesPageCopywriter) — iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const offer = await loadOfferBrief(input.ideaId)
  const funnel = await loadFunnelStrategy(offer.ideaId)
  const productContent = await loadProductContent(offer.ideaId)
  const skillContent = await loadSkillContent('bencivenga-low-ticket-copy')

  if (!skillContent) {
    throw new SalesPageCopywriterError('Skill bencivenga-low-ticket-copy nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce escreve paginas de venda low ticket com clareza, especificidade e compliance. Responda apenas Markdown.',
      },
      {
        role: 'user',
        content: buildCopyPrompt(offer, funnel, productContent, skillContent),
      },
    ],
  })

  const salesPage = completion.choices[0]?.message?.content?.trim() || ''
  if (!salesPage) {
    throw new SalesPageCopywriterError('OpenAI retornou uma copy vazia.')
  }

  const outputDir = input.outputDir ?? `data/funnels/${offer.ideaId}`
  await ensureDir(outputDir)

  const copyPath = `${outputDir}/sales-page.md`
  const metadata = `<!--
agentVersion: 1.0.0
processedAt: ${new Date().toISOString()}
durationMs: ${Date.now() - startTime}
-->

`
  await writeText(copyPath, metadata + salesPage)

  const durationMs = Date.now() - startTime
  logger.info('Agente 8 (SalesPageCopywriter) — concluido', {
    ideaId: offer.ideaId,
    copyPath,
    durationMs,
  })

  return {
    ideaId: offer.ideaId,
    copyPath,
    durationMs,
  }
}

export class SalesPageCopywriterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SalesPageCopywriterError'
  }
}
