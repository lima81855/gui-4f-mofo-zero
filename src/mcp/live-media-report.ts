import crypto from 'crypto'
import { getCheckoutMetricsSummary, CheckoutMetricsSummary } from './checkout-metrics'
import { getMetaInsights, MetaInsight } from './meta-ads'
import { insertRows } from './supabase'
import { logger } from '../utils/logger'

export type LiveMediaCreativeRow = {
  adId: string
  adName: string
  adsetName: string
  campaignName: string
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  ctr?: number
  cpc?: number
  cpm?: number
  pageView: number
  viewContent: number
  quizStart: number
  quizAnswer: number
  quizComplete: number
  lead: number
  completeRegistration: number
  initiateCheckout: number
  checkoutButtonClick: number
  purchase: number
  purchaseValue: number
  cpa?: number
  roas?: number
}

export type LiveMediaReport = {
  id: string
  source: 'meta-ads'
  campaignName: string
  datePreset: string
  generatedAt: string
  totals: Omit<LiveMediaCreativeRow, 'adId' | 'adName' | 'adsetName' | 'campaignName'>
  checkout: {
    source: CheckoutMetricsSummary['source']
    approvedPurchases: number
    revenue: number
    totalEvents: number
    lastEventAt: string
  }
  reconciliation: {
    metaPurchaseEvents: number
    approvedPurchases: number
    unconfirmedMetaPurchases: number
    status: 'conciliado' | 'meta-sem-hotmart' | 'hotmart-sem-meta' | 'sem-compra'
  }
  creativeRows: LiveMediaCreativeRow[]
  metaAvailable: boolean
  metaError?: string
  diagnosis: {
    status: 'sem-dados' | 'aprendendo' | 'sem-compra' | 'compra-detectada' | 'compra-meta-nao-conciliada' | 'cortar-candidato'
    summary: string
    primaryMetric: 'purchase'
    actions: string[]
  }
}

const DEFAULT_CAMPAIGN_NAME = '01[UNBOXING DO PRODUTO]'

function numberFrom(value?: string): number {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function actionValue(row: MetaInsight, actionTypes: string[]): number {
  return (row.actions || [])
    .filter(item => actionTypes.includes(item.action_type))
    .reduce((sum, item) => sum + numberFrom(item.value), 0)
}

function actionRevenue(row: MetaInsight, actionTypes: string[]): number {
  return (row.action_values || [])
    .filter(item => actionTypes.includes(item.action_type))
    .reduce((sum, item) => sum + numberFrom(item.value), 0)
}

function primaryActionValue(row: MetaInsight, actionTypes: string[]): number {
  for (const actionType of actionTypes) {
    const value = numberFrom(row.actions?.find(item => item.action_type === actionType)?.value)
    if (value > 0) return value
  }
  return 0
}

function primaryActionRevenue(row: MetaInsight, actionTypes: string[]): number {
  for (const actionType of actionTypes) {
    const value = numberFrom(row.action_values?.find(item => item.action_type === actionType)?.value)
    if (value > 0) return value
  }
  return 0
}

function includesCampaign(row: MetaInsight, campaignName: string): boolean {
  if (!campaignName) return true
  if (campaignName.toLowerCase() === 'all') return true
  return (row.campaign_name || '').toLowerCase().includes(campaignName.toLowerCase())
}

function rowToCreative(row: MetaInsight): LiveMediaCreativeRow {
  const spend = numberFrom(row.spend)
  const purchaseActionTypes = [
    'purchase',
    'omni_purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_conversion.purchase',
  ]
  const purchase = primaryActionValue(row, purchaseActionTypes)
  const purchaseValue = primaryActionRevenue(row, purchaseActionTypes)
  const linkClicks = numberFrom(row.inline_link_clicks) || actionValue(row, ['link_click', 'omni_link_click'])

  return {
    adId: row.ad_id || '',
    adName: row.ad_name || 'criativo-sem-nome',
    adsetName: row.adset_name || '',
    campaignName: row.campaign_name || '',
    spend: round(spend),
    impressions: Math.round(numberFrom(row.impressions)),
    clicks: Math.round(numberFrom(row.clicks)),
    linkClicks: Math.round(linkClicks),
    ctr: row.ctr ? round(numberFrom(row.ctr)) : undefined,
    cpc: row.cpc ? round(numberFrom(row.cpc)) : undefined,
    cpm: row.cpm ? round(numberFrom(row.cpm)) : undefined,
    pageView: Math.round(primaryActionValue(row, [
      'page_view',
      'omni_page_view',
      'offsite_conversion.fb_pixel_page_view',
    ])),
    viewContent: Math.round(primaryActionValue(row, [
      'view_content',
      'omni_view_content',
      'offsite_conversion.fb_pixel_view_content',
    ])),
    quizStart: Math.round(actionValue(row, ['QuizStart', 'offsite_conversion.fb_pixel_custom'])),
    quizAnswer: Math.round(actionValue(row, ['QuizAnswer'])),
    quizComplete: Math.round(actionValue(row, ['QuizComplete'])),
    lead: Math.round(primaryActionValue(row, [
      'lead',
      'omni_lead',
      'offsite_conversion.fb_pixel_lead',
    ])),
    completeRegistration: Math.round(primaryActionValue(row, [
      'complete_registration',
      'omni_complete_registration',
      'offsite_conversion.fb_pixel_complete_registration',
    ])),
    initiateCheckout: Math.round(primaryActionValue(row, [
      'initiate_checkout',
      'omni_initiated_checkout',
      'offsite_conversion.fb_pixel_initiate_checkout',
    ])),
    checkoutButtonClick: Math.round(actionValue(row, ['CheckoutButtonClick'])),
    purchase: Math.round(purchase),
    purchaseValue: round(purchaseValue),
    cpa: purchase > 0 ? round(spend / purchase) : undefined,
    roas: spend > 0 ? round(purchaseValue / spend) : undefined,
  }
}

function aggregate(rows: LiveMediaCreativeRow[]): LiveMediaReport['totals'] {
  const totals = rows.reduce((acc, row) => {
    acc.spend += row.spend
    acc.impressions += row.impressions
    acc.clicks += row.clicks
    acc.linkClicks += row.linkClicks
    acc.pageView += row.pageView
    acc.viewContent += row.viewContent
    acc.quizStart += row.quizStart
    acc.quizAnswer += row.quizAnswer
    acc.quizComplete += row.quizComplete
    acc.lead += row.lead
    acc.completeRegistration += row.completeRegistration
    acc.initiateCheckout += row.initiateCheckout
    acc.checkoutButtonClick += row.checkoutButtonClick
    acc.purchase += row.purchase
    acc.purchaseValue += row.purchaseValue
    return acc
  }, {
    spend: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    pageView: 0,
    viewContent: 0,
    quizStart: 0,
    quizAnswer: 0,
    quizComplete: 0,
    lead: 0,
    completeRegistration: 0,
    initiateCheckout: 0,
    checkoutButtonClick: 0,
    purchase: 0,
    purchaseValue: 0,
  })

  return {
    ...totals,
    spend: round(totals.spend),
    purchaseValue: round(totals.purchaseValue),
    ctr: totals.impressions > 0 ? round((totals.clicks / totals.impressions) * 100) : undefined,
    cpc: totals.clicks > 0 ? round(totals.spend / totals.clicks) : undefined,
    cpm: totals.impressions > 0 ? round((totals.spend / totals.impressions) * 1000) : undefined,
    cpa: totals.purchase > 0 ? round(totals.spend / totals.purchase) : undefined,
    roas: totals.spend > 0 ? round(totals.purchaseValue / totals.spend) : undefined,
  }
}

function reconcile(totals: LiveMediaReport['totals'], checkout: CheckoutMetricsSummary): LiveMediaReport['reconciliation'] {
  const metaPurchaseEvents = Math.round(totals.purchase)
  const approvedPurchases = checkout.approvedPurchases
  const unconfirmedMetaPurchases = Math.max(0, metaPurchaseEvents - approvedPurchases)

  let status: LiveMediaReport['reconciliation']['status'] = 'sem-compra'
  if (metaPurchaseEvents > 0 && approvedPurchases > 0) status = 'conciliado'
  if (metaPurchaseEvents > 0 && approvedPurchases <= 0) status = 'meta-sem-hotmart'
  if (metaPurchaseEvents <= 0 && approvedPurchases > 0) status = 'hotmart-sem-meta'

  return {
    metaPurchaseEvents,
    approvedPurchases,
    unconfirmedMetaPurchases,
    status,
  }
}

function diagnose(totals: LiveMediaReport['totals'], checkout: CheckoutMetricsSummary): LiveMediaReport['diagnosis'] {
  if (totals.spend <= 0 && totals.impressions <= 0) {
    return {
      status: 'sem-dados',
      primaryMetric: 'purchase',
      summary: 'A campanha ainda nao retornou dados da Meta para o periodo consultado.',
      actions: ['Confirmar se a campanha ja entregou e se o periodo esta correto.'],
    }
  }

  if (checkout.approvedPurchases > 0) {
    const cpa = totals.spend > 0 ? round(totals.spend / checkout.approvedPurchases) : 0
    return {
      status: 'compra-detectada',
      primaryMetric: 'purchase',
      summary: `Compra aprovada na Hotmart detectada. CPA real: R$ ${cpa}.`,
      actions: [
        'Identificar criativo responsavel pela compra.',
        'Nao escalar antes de estabilidade; levar vencedor para controle se repetir sinal.',
      ],
    }
  }

  if (totals.purchase > 0) {
    return {
      status: 'compra-meta-nao-conciliada',
      primaryMetric: 'purchase',
      summary: 'Meta reportou Purchase, mas a Hotmart nao confirmou compra aprovada no periodo.',
      actions: [
        'Nao validar como venda real sem PURCHASE_APPROVED da Hotmart.',
        'Tratar como intencao/atribuicao nao conciliada ate o checkout aprovar.',
        'Auditar se boleto, evento nativo da Hotmart ou duplicidade esta gerando Purchase antes do pagamento.',
      ],
    }
  }

  if (totals.spend >= 94) {
    return {
      status: 'cortar-candidato',
      primaryMetric: 'purchase',
      summary: 'Gasto acima de 2x o preco do produto sem compra atribuida.',
      actions: [
        'Pausar ou trocar criativo/oferta antes de novo gasto.',
        'Diagnosticar se houve checkout sem compra para separar problema de oferta e criativo.',
      ],
    }
  }

  if (totals.spend >= 47) {
    return {
      status: 'sem-compra',
      primaryMetric: 'purchase',
      summary: 'Gasto chegou perto de 1x o preco do produto sem compra atribuida.',
      actions: [
        'Manter apenas se houver sinais fortes de checkout.',
        'Nao escalar; aguardar leitura curta ou preparar variacao de criativo.',
      ],
    }
  }

  return {
    status: 'aprendendo',
    primaryMetric: 'purchase',
    summary: 'Teste ainda em fase inicial. A metrica principal segue sendo compra.',
    actions: [
      'Manter rodando dentro da janela de 3 dias.',
      'Usar PageView, QuizStart, Lead e Checkout apenas como diagnostico, nao como vitoria.',
    ],
  }
}

async function syncReport(report: LiveMediaReport): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return

  try {
    await insertRows({
      table: 'performance_snapshots',
      rows: [{
        id: report.id,
        source: 'meta-live',
        period: report.datePreset,
        spend: report.totals.spend,
        revenue: report.checkout.revenue,
        refund_value: 0,
        net_revenue: report.checkout.revenue,
        purchases: report.checkout.approvedPurchases,
        refunds: 0,
        cpa: report.checkout.approvedPurchases > 0 ? round(report.totals.spend / report.checkout.approvedPurchases) : null,
        roas: report.totals.spend > 0 ? round(report.checkout.revenue / report.totals.spend) : null,
        refund_rate: null,
        decision: report.diagnosis.status === 'cortar-candidato' ? 'cortar' : report.diagnosis.status === 'compra-detectada' ? 'manter-teste' : 'aguardando-trafego',
        summary: report.diagnosis.summary,
        actions: report.diagnosis.actions,
        budget_guardrail: 'Compra e a metrica principal; sinais intermediarios sao apenas diagnostico.',
        risk_notes: [],
        payload: report,
        generated_at: report.generatedAt,
      }],
    })
  } catch (error) {
    logger.warn('Falha ao sincronizar live media report no Supabase', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getLiveMediaReport(options: {
  campaignName?: string
  datePreset?: string
} = {}): Promise<LiveMediaReport> {
  const campaignName = options.campaignName || process.env.ACTIVE_META_CAMPAIGN_NAME || DEFAULT_CAMPAIGN_NAME
  const datePreset = options.datePreset || 'today'
  const generatedAt = new Date().toISOString()
  let rows: MetaInsight[] = []
  let metaAvailable = true
  let metaError: string | undefined

  try {
    rows = await getMetaInsights({ level: 'ad', datePreset, limit: 500 })
  } catch (error) {
    metaAvailable = false
    metaError = error instanceof Error ? error.message : String(error)
    logger.warn('Live media report sem leitura Meta Ads', { error: metaError })
  }

  const creativeRows = rows
    .filter(row => includesCampaign(row, campaignName))
    .map(rowToCreative)
    .sort((a, b) => b.spend - a.spend)
  const totals = aggregate(creativeRows)
  const checkout = await getCheckoutMetricsSummary({ datePreset })
  const reconciliation = reconcile(totals, checkout)
  const diagnosis = metaAvailable
    ? diagnose(totals, checkout)
    : {
        status: 'sem-dados' as const,
        primaryMetric: 'purchase' as const,
        summary: 'Meta Ads indisponivel para leitura automatica neste momento.',
        actions: [
          'Validar token/permissoes de Meta Ads no Railway.',
          'Usar System User Token estavel para evitar expiracao recorrente.',
          'Nao considerar print como fonte definitiva depois que o conector voltar.',
        ],
      }
  const report: LiveMediaReport = {
    id: crypto.createHash('sha256').update(`${campaignName}:${datePreset}:${generatedAt}`).digest('hex').slice(0, 32),
    source: 'meta-ads',
    campaignName,
    datePreset,
    generatedAt,
    totals,
    checkout: {
      source: checkout.source,
      approvedPurchases: checkout.approvedPurchases,
      revenue: checkout.revenue,
      totalEvents: checkout.totalEvents,
      lastEventAt: checkout.lastEventAt,
    },
    reconciliation,
    metaAvailable,
    metaError,
    creativeRows,
    diagnosis,
  }

  await syncReport(report)
  return report
}
