import OpenAI from 'openai'
import { ensureDir, fileExists, readAllJson, readTextOrNull, writeJson } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  OfferBriefSchema,
  type OfferArchitectInput,
  type OfferArchitectOutput,
  type OfferBrief,
  type PainPoint,
  type PainPointsFile,
  type ValidatedIdea,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

async function loadValidatedIdeas(): Promise<ValidatedIdea[]> {
  const indexPath = 'data/validated-ideas/index.json'

  if (!(await fileExists(indexPath))) {
    throw new OfferArchitectError('Arquivo data/validated-ideas/index.json nao encontrado.')
  }

  const content = await readTextOrNull(indexPath)
  if (!content) {
    throw new OfferArchitectError('Indice de ideias validadas esta vazio.')
  }

  return JSON.parse(content) as ValidatedIdea[]
}

function selectIdea(ideas: ValidatedIdea[], selector?: string): ValidatedIdea {
  if (ideas.length === 0) {
    throw new OfferArchitectError('Nenhuma ideia validada encontrada.')
  }

  if (selector) {
    const normalized = selector.toLowerCase()
    const selected = ideas.find(idea =>
      idea.id === selector || idea.name.toLowerCase().includes(normalized),
    )

    if (selected) return selected
  }

  const approved = ideas.filter(idea => idea.ceoDecision === 'aprovado')
  const candidates = approved.length > 0 ? approved : ideas

  return [...candidates].sort((a, b) => b.marketScore - a.marketScore)[0]
}

async function findPainPoint(painPointId: string): Promise<PainPoint | null> {
  try {
    const painFiles = await readAllJson<PainPointsFile>('data/pain-points')
    for (const file of painFiles) {
      const found = file.painPoints.find(painPoint => painPoint.id === painPointId)
      if (found) return found
    }
  } catch (error) {
    logger.warn('OfferArchitect — erro ao ler pain points', { error: String(error) })
  }

  return null
}

function buildOfferPrompt(
  idea: ValidatedIdea,
  painPoint: PainPoint | null,
  productContent: string | null,
  skillContent: string,
): string {
  const painContext = painPoint
    ? `Dor original: ${painPoint.description}
Frequencia: ${painPoint.frequency}
Comentarios reais:
${painPoint.examples.slice(0, 5).map(example => `- "${example}"`).join('\n')}`
    : 'Dor original nao encontrada nos arquivos.'

  const productContext = productContent
    ? productContent.slice(0, 6000)
    : 'Conteudo de produto ainda nao encontrado ou nao gerado.'

  return `Voce e o agente offer-architect de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e transformar a ideia validada abaixo em uma oferta pronta para funil, copy, criativos e trafego pago.

## SKILL OPERACIONAL
${skillContent}

## IDEIA VALIDADA
ID: ${idea.id}
Nome: ${idea.name}
Descricao: ${idea.description}
Publico: ${idea.targetAudience}
Features: ${idea.coreFeatures.join(', ')}
Preco sugerido: ${idea.pricingModel}
MRR estimado: ${idea.estimatedMRR}
Score: ${idea.marketScore}
Status CEO: ${idea.ceoDecision}
Notas CEO: ${idea.ceoNotes || '(sem notas)'}

## SINAIS DE DOR
${painContext}

## CONTEUDO DO PRODUTO
${productContext}

## REGRAS
- Escreva em portugues do Brasil.
- Foque em oferta low ticket, simples, visual, vendavel e plausivel.
- Nesta operacao v1, construa a oferta como produto digital em PDF/kit de consulta, mapa, guia, checklist, protocolo visual ou planilha simples. Nao use produto fisico, estoque, envio, videos como entrega principal ou aulas longas, a menos que o CEO peca explicitamente.
- Nao prometa cura, garantia de resultado impossivel ou milagre.
- Nao invente autoridade, especialista, certificacao, depoimento, antes/depois ou prova social. Se a prova ainda nao existir, liste como ativo a coletar sem nomes proprios ficticios.
- A promessa deve ser especifica e facil de entender.
- O mecanismo unico deve ter nome.
- O order bump deve aumentar conveniencia.
- O upsell deve aprofundar resultado.
- Risk notes devem apontar riscos de compliance, entrega ou promessa.

Retorne APENAS JSON valido no formato:
{
  "ideaId": "${idea.id}",
  "productName": "",
  "targetAudience": "",
  "urgentProblem": "",
  "desire": "",
  "uniquePromise": "",
  "uniqueMechanism": "",
  "offerStack": [],
  "bonuses": [],
  "price": "",
  "orderBump": {
    "name": "",
    "promise": "",
    "price": ""
  },
  "upsell": {
    "name": "",
    "promise": "",
    "price": ""
  },
  "guarantee": "",
  "proofAssetsNeeded": [],
  "objections": [],
  "riskNotes": []
}`
}

async function loadProductContent(ideaId: string): Promise<string | null> {
  return readTextOrNull(`data/products/${ideaId}/product-content.md`)
}

export async function runOfferArchitect(input: OfferArchitectInput): Promise<OfferArchitectOutput> {
  const startTime = Date.now()

  logger.info('Agente 6 (OfferArchitect) — iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideas = await loadValidatedIdeas()
  const idea = selectIdea(ideas, input.ideaId)
  const painPoint = await findPainPoint(idea.painPointId)
  const productContent = await loadProductContent(idea.id)
  const skillContent = await loadSkillContent('low-ticket-offer-architect')

  if (!skillContent) {
    throw new OfferArchitectError('Skill low-ticket-offer-architect nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce cria offer briefs low ticket extremamente claros. Responda sempre apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildOfferPrompt(idea, painPoint, productContent, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const offerBrief: OfferBrief = OfferBriefSchema.parse(parsed)

  const outputDir = input.outputDir ?? `data/offers/${idea.id}`
  await ensureDir(outputDir)

  const offerPath = `${outputDir}/offer-brief.json`
  await writeJson(offerPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    offer: offerBrief,
  })

  const durationMs = Date.now() - startTime
  logger.info('Agente 6 (OfferArchitect) — concluido', {
    ideaId: idea.id,
    offerPath,
    durationMs,
  })

  return {
    ideaId: idea.id,
    offerPath,
    durationMs,
  }
}

export class OfferArchitectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfferArchitectError'
  }
}
