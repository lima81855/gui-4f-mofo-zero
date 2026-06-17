import OpenAI from 'openai'
import path from 'path'
import { ensureDir, fileExists, readJson, readTextOrNull, writeJson, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { loadSkillContent } from '../skills/skill-loader'
import {
  CheckoutOpsPlanSchema,
  CroPlanSchema,
  DesignBriefSchema,
  FunnelStrategySchema,
  OfferBriefSchema,
  TrackingPlanSchema,
  type CheckoutOpsInput,
  type CheckoutOpsOutput,
  type CheckoutOpsPlan,
  type CroPlan,
  type DesignBrief,
  type FunnelStrategy,
  type OfferBrief,
  type TrackingPlan,
} from '../types'

const MODEL = 'gpt-4o'
const client = new OpenAI()

type OfferBriefFile = { offer: OfferBrief }
type FunnelStrategyFile = { strategy: FunnelStrategy }
type DesignBriefFile = { designBrief: DesignBrief }
type TrackingPlanFile = { trackingPlan: TrackingPlan }
type CroPlanFile = { croPlan: CroPlan }

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) return selector

  const dirs = await listDirectories('data/offers')
  if (dirs.length === 0) {
    throw new CheckoutOpsError('Nenhum offer-brief.json encontrado em data/offers.')
  }

  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new CheckoutOpsError(`Oferta nao encontrada para seletor: ${selector}`)
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

async function loadDesignBrief(ideaId: string): Promise<DesignBrief> {
  const file = await readJson<DesignBriefFile>(`data/design/${ideaId}/design-brief.json`)
  return DesignBriefSchema.parse(file.designBrief)
}

async function loadTrackingPlan(ideaId: string): Promise<TrackingPlan> {
  const file = await readJson<TrackingPlanFile>(`data/tracking/${ideaId}/tracking-plan.json`)
  return TrackingPlanSchema.parse(file.trackingPlan)
}

async function loadCroPlan(ideaId: string): Promise<CroPlan | null> {
  const filePath = `data/cro/${ideaId}/cro-plan.json`
  if (!await fileExists(filePath)) return null

  const file = await readJson<CroPlanFile>(filePath)
  return CroPlanSchema.parse(file.croPlan)
}

function compactText(text: string | null, maxChars: number): string {
  if (!text) return 'Arquivo nao encontrado.'
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[conteudo cortado para caber no contexto]`
}

function buildCheckoutPrompt(
  offer: OfferBrief,
  funnel: FunnelStrategy,
  salesPage: string | null,
  productContent: string | null,
  designBrief: DesignBrief,
  trackingPlan: TrackingPlan,
  croPlan: CroPlan | null,
  skillContent: string,
): string {
  return `Voce e o checkout-ops de uma empresa agenticia low ticket no Brasil/LATAM.
Sua tarefa e garantir que checkout, pagamento, order bump, upsell, entrega, acesso, suporte e tracking estejam prontos antes de liberar trafego.

## SKILL OPERACIONAL
${skillContent}

## OFERTA
${JSON.stringify(offer, null, 2)}

## FUNIL
${JSON.stringify(funnel, null, 2)}

## COPY DA PAGINA
${compactText(salesPage, 6000)}

## CONTEUDO DO PRODUTO
${compactText(productContent, 6000)}

## DESIGN
${JSON.stringify(designBrief, null, 2)}

## TRACKING
readyForTraffic: ${trackingPlan.readyForTraffic ? 'sim' : 'nao'}
${JSON.stringify(trackingPlan, null, 2)}

## CRO
${croPlan ? JSON.stringify(croPlan, null, 2) : 'Nenhum plano CRO encontrado.'}

## REGRAS
- Nao inclua WhatsApp.
- Nao invente link real, plataforma real, taxa, conta, integracao pronta ou compra real.
- Se nao houver link/plataforma de checkout real informada nos arquivos, readiness deve ser "bloqueado".
- Se trackingPlan.readyForTraffic for false, readiness deve ser "bloqueado".
- Se productContent estiver ausente, inclua blocker de entrega do produto.
- Todo item precisa ter owner operacional claro e somente um destes valores: CEO, checkout-ops, tracking-agent, design-brief-agent, product-builder ou suporte.
- Inclua teste de compra em sandbox ou compra de baixo valor, mas nao diga que ja foi feito.
- Responda apenas JSON valido em portugues do Brasil.

Formato:
{
  "ideaId": "${offer.ideaId}",
  "readiness": "bloqueado | pronto-com-pendencias | pronto",
  "summary": "",
  "checkoutPlatformAssumption": "",
  "productDeliveryFlow": [],
  "buyerAccessFlow": [],
  "orderBumpSetup": [],
  "upsellSetup": [],
  "paymentSetup": [],
  "supportSetup": [],
  "legalAndPolicySetup": [],
  "trackingHandoff": [],
  "testPurchaseScript": [],
  "goLiveBlockers": [],
  "checklist": [
    {
      "area": "checkout | pagamento | order-bump | upsell | entrega | acesso | suporte | tracking | legal | qa",
      "item": "",
      "status": "pendente | validar | pronto | bloqueado",
      "owner": "",
      "validation": ""
    }
  ],
  "ceoApprovalRequired": true,
  "riskNotes": []
}`
}

function renderMarkdown(plan: CheckoutOpsPlan): string {
  return `# Checkout Ops Checklist

ideaId: ${plan.ideaId}

readiness: ${plan.readiness}

ceoApprovalRequired: ${plan.ceoApprovalRequired ? 'sim' : 'nao'}

## Resumo
${plan.summary}

## Plataforma de checkout
${plan.checkoutPlatformAssumption}

## Fluxo de entrega do produto
${plan.productDeliveryFlow.map(item => `- ${item}`).join('\n')}

## Fluxo de acesso do comprador
${plan.buyerAccessFlow.map(item => `- ${item}`).join('\n')}

## Order bump
${plan.orderBumpSetup.map(item => `- ${item}`).join('\n')}

## Upsell
${plan.upsellSetup.map(item => `- ${item}`).join('\n')}

## Pagamento
${plan.paymentSetup.map(item => `- ${item}`).join('\n')}

## Suporte
${plan.supportSetup.map(item => `- ${item}`).join('\n')}

## Legal e politicas
${plan.legalAndPolicySetup.map(item => `- ${item}`).join('\n')}

## Handoff para tracking
${plan.trackingHandoff.map(item => `- ${item}`).join('\n')}

## Roteiro de compra teste
${plan.testPurchaseScript.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## Bloqueios antes de liberar trafego
${plan.goLiveBlockers.map(item => `- ${item}`).join('\n')}

## Checklist operacional
${plan.checklist.map(item => `- [${item.status}] ${item.area}: ${item.item} | owner: ${item.owner} | validacao: ${item.validation}`).join('\n')}

## Riscos
${plan.riskNotes.map(item => `- ${item}`).join('\n')}
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemToString(item: unknown): string {
  if (typeof item === 'string') return item
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (Array.isArray(item)) return item.map(itemToString).filter(Boolean).join('; ')
  if (isRecord(item)) {
    return Object.entries(item).map(([key, value]) => `${key}: ${itemToString(value)}`).join('; ')
  }
  return ''
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(itemToString).filter(Boolean)
}

function normalizeCheckoutOpsPlan(response: unknown): unknown {
  if (!isRecord(response)) return response

  return {
    ...response,
    productDeliveryFlow: stringArray(response.productDeliveryFlow),
    buyerAccessFlow: stringArray(response.buyerAccessFlow),
    orderBumpSetup: stringArray(response.orderBumpSetup),
    upsellSetup: stringArray(response.upsellSetup),
    paymentSetup: stringArray(response.paymentSetup),
    supportSetup: stringArray(response.supportSetup),
    legalAndPolicySetup: stringArray(response.legalAndPolicySetup),
    trackingHandoff: stringArray(response.trackingHandoff),
    testPurchaseScript: stringArray(response.testPurchaseScript),
    goLiveBlockers: stringArray(response.goLiveBlockers),
    riskNotes: stringArray(response.riskNotes),
  }
}

export async function runCheckoutOps(input: CheckoutOpsInput): Promise<CheckoutOpsOutput> {
  const startTime = Date.now()

  logger.info('Agente 17 (CheckoutOps) - iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  const ideaId = await resolveIdeaId(input.ideaId)
  const offer = await loadOfferBrief(ideaId)
  const funnel = await loadFunnelStrategy(ideaId)
  const salesPage = await readTextOrNull(`data/funnels/${ideaId}/sales-page.md`)
  const productContent = await readTextOrNull(`data/products/${ideaId}/product-content.md`)
  const designBrief = await loadDesignBrief(ideaId)
  const trackingPlan = await loadTrackingPlan(ideaId)
  const croPlan = await loadCroPlan(ideaId)
  const skillContent = await loadSkillContent('low-ticket-checkout-ops')

  if (!skillContent) {
    throw new CheckoutOpsError('Skill low-ticket-checkout-ops nao encontrada.')
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Voce e especialista em operacao de checkout low ticket. Responda apenas JSON valido.',
      },
      {
        role: 'user',
        content: buildCheckoutPrompt(
          offer,
          funnel,
          salesPage,
          productContent,
          designBrief,
          trackingPlan,
          croPlan,
          skillContent,
        ),
      },
    ],
    response_format: { type: 'json_object' },
  })

  const responseText = completion.choices[0]?.message?.content || ''
  const parsed = JSON.parse(responseText) as unknown
  const checkoutOpsPlan = CheckoutOpsPlanSchema.parse(normalizeCheckoutOpsPlan(parsed))

  const outputDir = input.outputDir ?? `data/implementation/${ideaId}`
  await ensureDir(outputDir)

  const checkoutOpsPath = `${outputDir}/checkout-checklist.json`
  const markdownPath = `${outputDir}/checkout-checklist.md`

  await writeJson(checkoutOpsPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    checkoutOpsPlan,
  })
  await writeText(markdownPath, renderMarkdown(checkoutOpsPlan))

  const durationMs = Date.now() - startTime
  logger.info('Agente 17 (CheckoutOps) - concluido', {
    ideaId,
    checkoutOpsPath,
    markdownPath,
    durationMs,
  })

  return {
    ideaId,
    checkoutOpsPath,
    markdownPath,
    durationMs,
  }
}

export class CheckoutOpsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckoutOpsError'
  }
}
