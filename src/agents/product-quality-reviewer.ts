import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readTextOrNull, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CheckoutOpsPlanSchema,
  CroPlanSchema,
  FunnelBuilderPlanSchema,
  FunnelStrategySchema,
  OfferBriefSchema,
  ProductQualityReviewSchema,
  type CheckoutOpsPlan,
  type CroPlan,
  type FunnelBuilderPlan,
  type FunnelStrategy,
  type OfferBrief,
  type ProductQualityReview,
  type ProductQualityReviewerInput,
  type ProductQualityReviewerOutput,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = { offer: OfferBrief }
type FunnelStrategyFile = { strategy: FunnelStrategy }
type CroPlanFile = { croPlan: CroPlan }
type CheckoutOpsFile = { checkoutOpsPlan: CheckoutOpsPlan }
type FunnelBuilderFile = { funnelBuilderPlan: FunnelBuilderPlan }

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) return selector

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new ProductQualityReviewerError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new ProductQualityReviewerError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadCroPlan(ideaId: string): Promise<CroPlan | null> {
  const filePath = `data/cro/${ideaId}/cro-plan.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<CroPlanFile>(filePath)
  return CroPlanSchema.parse(file.croPlan)
}

async function loadCheckoutOpsPlan(ideaId: string): Promise<CheckoutOpsPlan | null> {
  const filePath = `data/implementation/${ideaId}/checkout-checklist.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<CheckoutOpsFile>(filePath)
  return CheckoutOpsPlanSchema.parse(file.checkoutOpsPlan)
}

async function loadFunnelBuilderPlan(ideaId: string): Promise<FunnelBuilderPlan | null> {
  const filePath = `data/implementation/${ideaId}/page-checklist.json`
  if (!await fileExists(filePath)) return null
  const file = await readJson<FunnelBuilderFile>(filePath)
  return FunnelBuilderPlanSchema.parse(file.funnelBuilderPlan)
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
  productContent: string | null,
  croPlan: CroPlan | null,
  checkoutOpsPlan: CheckoutOpsPlan | null,
  funnelBuilderPlan: FunnelBuilderPlan | null,
  skillContent: string,
): string {
  return `Voce e o product-quality-reviewer de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e revisar se o produto entrega a promessa da oferta antes de liberar escala.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
${JSON.stringify(offer, null, 2)}

## FUNIL
${JSON.stringify(funnel, null, 2)}

## COPY DA PAGINA
${compactText(salesPage, 8000)}

## CONTEUDO DO PRODUTO
${compactText(productContent, 12000)}

## CRO
${croPlan ? JSON.stringify(croPlan, null, 2) : 'Nenhum plano CRO encontrado.'}

## CHECKOUT OPS
${checkoutOpsPlan ? JSON.stringify(checkoutOpsPlan, null, 2) : 'Nenhum checklist de checkout encontrado.'}

## PAGE BUILD
${funnelBuilderPlan ? JSON.stringify(funnelBuilderPlan, null, 2) : 'Nenhum checklist de pagina encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Nao invente modulos, aulas, bonus, prova, resultados, depoimentos ou conteudos que nao estejam no produto.
- Se productContent estiver ausente ou raso demais para cumprir a promessa, qualityStatus deve ser "bloqueado".
- Se houver lacunas importantes mas corrigiveis, qualityStatus deve ser "revisar".
- So use "aprovado" se o conteudo cobrir promessa, mecanismo, uso, limites e suporte.
- Nao aprove promessa absoluta, cura, milagre, resultado garantido ou prova sem fonte verificavel.
- Score deve refletir apenas o alinhamento real entre oferta e produto.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "qualityStatus": "bloqueado | revisar | aprovado",
  "summary": "",
  "promiseAlignmentScore": 0,
  "refundRisk": "alto | medio | baixo",
  "deliveryClarity": "alta | media | baixa",
  "strengths": [],
  "gaps": [
    {
      "area": "promessa | conteudo | clareza | entrega | risco | suporte | compliance",
      "severity": "alta | media | baixa",
      "finding": "",
      "recommendation": ""
    }
  ],
  "requiredFixesBeforeTraffic": [],
  "productBuilderRequests": [],
  "copyAlignmentRequests": [],
  "supportAndOnboardingRequests": [],
  "approvalConditions": [],
  "riskNotes": []
}`
}

function renderMarkdown(review: ProductQualityReview): string {
  return `# Product Quality Review

ideaId: ${review.ideaId}

qualityStatus: ${review.qualityStatus}

promiseAlignmentScore: ${review.promiseAlignmentScore}

refundRisk: ${review.refundRisk}

deliveryClarity: ${review.deliveryClarity}

## Resumo
${review.summary}

## Pontos fortes
${review.strengths.map(item => `- ${item}`).join('\n')}

## Lacunas
${review.gaps.map(gap => `- [${gap.severity}] ${gap.area}: ${gap.finding} | recomendacao: ${gap.recommendation}`).join('\n')}

## Correcoes obrigatorias antes do trafego
${review.requiredFixesBeforeTraffic.map(item => `- ${item}`).join('\n')}

## Pedidos para product-builder
${review.productBuilderRequests.map(item => `- ${item}`).join('\n')}

## Pedidos para copy
${review.copyAlignmentRequests.map(item => `- ${item}`).join('\n')}

## Suporte e onboarding
${review.supportAndOnboardingRequests.map(item => `- ${item}`).join('\n')}

## Condicoes de aprovacao
${review.approvalConditions.map(item => `- ${item}`).join('\n')}

## Riscos
${review.riskNotes.map(item => `- ${item}`).join('\n')}
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

function normalizeReview(response: unknown): unknown {
  if (!isRecord(response)) return response

  const rawGaps = Array.isArray(response.gaps) ? response.gaps : []
  const validAreas = new Set(['promessa', 'conteudo', 'clareza', 'entrega', 'risco', 'suporte', 'compliance'])
  const validSeverities = new Set(['alta', 'media', 'baixa'])

  const gaps = rawGaps.map(gap => {
    if (!isRecord(gap)) return gap
    let area = String(gap.area || '').toLowerCase()
    if (area === 'prova' || area === 'provas') {
      area = 'conteudo'
    } else if (!validAreas.has(area)) {
      area = 'conteudo'
    }

    let severity = String(gap.severity || '').toLowerCase()
    if (!validSeverities.has(severity)) {
      severity = 'baixa'
    }

    return {
      ...gap,
      area,
      severity,
      finding: String(gap.finding || ''),
      recommendation: String(gap.recommendation || ''),
    }
  })

  return {
    ...response,
    strengths: stringArray(response.strengths),
    gaps,
    requiredFixesBeforeTraffic: stringArray(response.requiredFixesBeforeTraffic),
    productBuilderRequests: stringArray(response.productBuilderRequests),
    copyAlignmentRequests: stringArray(response.copyAlignmentRequests),
    supportAndOnboardingRequests: stringArray(response.supportAndOnboardingRequests),
    approvalConditions: stringArray(response.approvalConditions),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runProductQualityReviewer(input: ProductQualityReviewerInput): Promise<ProductQualityReviewerOutput> {
  const startTime = Date.now()

  logger.info('Agente 19 (ProductQualityReviewer) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const salesPage = await readTextOrNull(`data/funnels/${ideaId}/sales-page.md`)
  const productContent = await readTextOrNull(`data/products/${ideaId}/product-content.md`)
  const croPlan = await loadCroPlan(ideaId)
  const checkoutOpsPlan = await loadCheckoutOpsPlan(ideaId)
  const funnelBuilderPlan = await loadFunnelBuilderPlan(ideaId)
  const skillContent = await loadSkillContent('low-ticket-product-quality-review')

  if (!skillContent) {
    throw new ProductQualityReviewerError('Skill low-ticket-product-quality-review nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce e especialista em qualidade de produto low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildPrompt(offer, funnel, salesPage, productContent, croPlan, checkoutOpsPlan, funnelBuilderPlan, skillContent),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const qualityReview = ProductQualityReviewSchema.parse(normalizeReview(parsed))

  const outputDir = input.outputDir ?? `data/products/${ideaId}`
  await ensureDir(outputDir)

  const qualityReviewPath = `${outputDir}/quality-review.json`
  const markdownPath = `${outputDir}/quality-review.md`

  await writeJson(qualityReviewPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    qualityReview,
  })
  await writeText(markdownPath, renderMarkdown(qualityReview))

  const durationMs = Date.now() - startTime
  logger.info('Agente 19 (ProductQualityReviewer) - concluido', {
    ideaId,
    qualityReviewPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    qualityReviewPath,
    markdownPath,
    durationMs,
  }
}

export class ProductQualityReviewerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductQualityReviewerError'
  }
}
