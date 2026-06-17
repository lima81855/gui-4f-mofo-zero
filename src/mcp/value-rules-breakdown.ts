import crypto from 'crypto'
import { getCheckoutMetricsSummary, CheckoutMetricsSummary } from './checkout-metrics'
import { getMetaInsights, MetaInsight } from './meta-ads'
import { logger } from '../utils/logger'

const DEFAULT_CAMPAIGN_NAME = 'all'

const BREAKDOWNS = [
  'age',
  'gender',
  'publisher_platform',
  'impression_device',
  'region',
] as const

type BreakdownName = typeof BREAKDOWNS[number]

export type ValueRuleSegmentRow = {
  breakdown: BreakdownName
  segment: string
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  initiateCheckout: number
  metaPurchaseEvents: number
  metaPurchaseValue: number
  purchase: number
  purchaseValue: number
  ctr?: number
  linkCpc?: number
  initiateCheckoutRate?: number
  cpa?: number
  roas?: number
  signal: 'comprador' | 'checkout' | 'clique' | 'desperdicio' | 'baixo-volume'
  recommendation: 'considerar_aumento' | 'observar' | 'considerar_reducao' | 'sem_regra'
  reason: string
}

export type ValueRulesBreakdownReport = {
  id: string
  source: 'meta-ads'
  campaignName: string
  datePreset: string
  generatedAt: string
  metaAvailable: boolean
  metaError?: string
  status: 'pronto_para_regra' | 'leitura_parcial' | 'sem_dados' | 'meta_indisponivel'
  summary: string
  guardrail: string
  totals: {
    spend: number
    impressions: number
    clicks: number
    linkClicks: number
    initiateCheckout: number
    metaPurchaseEvents: number
    metaPurchaseValue: number
    purchase: number
    purchaseValue: number
    cpa?: number
    roas?: number
  }
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
  buyerSignals: ValueRuleSegmentRow[]
  wasteSignals: ValueRuleSegmentRow[]
  breakdowns: Record<BreakdownName, {
    rows: ValueRuleSegmentRow[]
    error?: string
  }>
}

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

function segmentFor(row: MetaInsight, breakdown: BreakdownName): string {
  return row[breakdown] || 'sem-segmento'
}

function buildSegmentRow(
  breakdown: BreakdownName,
  segment: string,
  rows: MetaInsight[],
  allowMetaPurchaseAttribution: boolean,
): ValueRuleSegmentRow {
  const purchaseActionTypes = [
    'purchase',
    'omni_purchase',
    'offsite_conversion.fb_pixel_purchase',
    'onsite_conversion.purchase',
  ]
  const initiateCheckoutActionTypes = [
    'initiate_checkout',
    'omni_initiated_checkout',
    'offsite_conversion.fb_pixel_initiate_checkout',
  ]

  const spend = rows.reduce((sum, row) => sum + numberFrom(row.spend), 0)
  const impressions = rows.reduce((sum, row) => sum + numberFrom(row.impressions), 0)
  const clicks = rows.reduce((sum, row) => sum + numberFrom(row.clicks), 0)
  const linkClicks = rows.reduce((sum, row) => sum + (numberFrom(row.inline_link_clicks) || actionValue(row, ['link_click', 'omni_link_click'])), 0)
  const initiateCheckout = rows.reduce((sum, row) => sum + primaryActionValue(row, initiateCheckoutActionTypes), 0)
  const metaPurchaseEvents = rows.reduce((sum, row) => sum + primaryActionValue(row, purchaseActionTypes), 0)
  const metaPurchaseValue = rows.reduce((sum, row) => sum + primaryActionRevenue(row, purchaseActionTypes), 0)
  const purchase = allowMetaPurchaseAttribution ? metaPurchaseEvents : 0
  const purchaseValue = allowMetaPurchaseAttribution ? metaPurchaseValue : 0
  const ctr = impressions > 0 ? round((clicks / impressions) * 100) : undefined
  const linkCpc = linkClicks > 0 ? round(spend / linkClicks) : undefined
  const initiateCheckoutRate = linkClicks > 0 ? round((initiateCheckout / linkClicks) * 100) : undefined
  const cpa = purchase > 0 ? round(spend / purchase) : undefined
  const roas = spend > 0 ? round(purchaseValue / spend) : undefined

  let signal: ValueRuleSegmentRow['signal'] = 'baixo-volume'
  let recommendation: ValueRuleSegmentRow['recommendation'] = 'sem_regra'
  let reason = 'Volume ainda baixo para criar regra de valor sem risco.'

  if (purchase > 0) {
    signal = 'comprador'
    recommendation = cpa !== undefined && cpa <= 35 ? 'considerar_aumento' : 'observar'
    reason = cpa !== undefined
      ? `Segmento gerou compra com CPA aproximado de R$ ${cpa}.`
      : 'Segmento gerou compra, mas CPA ainda nao esta confiavel.'
  } else if (!allowMetaPurchaseAttribution && metaPurchaseEvents > 0) {
    signal = 'checkout'
    recommendation = 'observar'
    reason = 'Meta reportou Purchase, mas nao ha compra aprovada na Hotmart no periodo; nao usar como comprador.'
  } else if (initiateCheckout >= 2) {
    signal = 'checkout'
    recommendation = 'observar'
    reason = 'Segmento gerou checkout, mas ainda nao gerou compra; usar apenas como proxy.'
  } else if (spend >= 23.5 && initiateCheckout === 0) {
    signal = 'desperdicio'
    recommendation = 'considerar_reducao'
    reason = 'Segmento consumiu verba relevante sem checkout nem compra.'
  } else if (linkClicks >= 8) {
    signal = 'clique'
    recommendation = 'observar'
    reason = 'Segmento trouxe cliques, mas falta evento profundo para regra.'
  }

  return {
    breakdown,
    segment,
    spend: round(spend),
    impressions: Math.round(impressions),
    clicks: Math.round(clicks),
    linkClicks: Math.round(linkClicks),
    initiateCheckout: Math.round(initiateCheckout),
    metaPurchaseEvents: Math.round(metaPurchaseEvents),
    metaPurchaseValue: round(metaPurchaseValue),
    purchase: Math.round(purchase),
    purchaseValue: round(purchaseValue),
    ctr,
    linkCpc,
    initiateCheckoutRate,
    cpa,
    roas,
    signal,
    recommendation,
    reason,
  }
}

function aggregateTotals(rows: ValueRuleSegmentRow[]): ValueRulesBreakdownReport['totals'] {
  const sourceBreakdown = BREAKDOWNS.find(breakdown => rows.some(row => row.breakdown === breakdown))
  const sourceRows = sourceBreakdown ? rows.filter(row => row.breakdown === sourceBreakdown) : rows
  const totals = sourceRows.reduce((acc, row) => {
    acc.spend += row.spend
    acc.impressions += row.impressions
    acc.clicks += row.clicks
    acc.linkClicks += row.linkClicks
    acc.initiateCheckout += row.initiateCheckout
    acc.metaPurchaseEvents += row.metaPurchaseEvents
    acc.metaPurchaseValue += row.metaPurchaseValue
    acc.purchase += row.purchase
    acc.purchaseValue += row.purchaseValue
    return acc
  }, {
    spend: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    initiateCheckout: 0,
    metaPurchaseEvents: 0,
    metaPurchaseValue: 0,
    purchase: 0,
    purchaseValue: 0,
  })

  return {
    ...totals,
    spend: round(totals.spend),
    metaPurchaseValue: round(totals.metaPurchaseValue),
    purchaseValue: round(totals.purchaseValue),
    cpa: totals.purchase > 0 ? round(totals.spend / totals.purchase) : undefined,
    roas: totals.spend > 0 ? round(totals.purchaseValue / totals.spend) : undefined,
  }
}

function groupBySegment(rows: MetaInsight[], breakdown: BreakdownName, allowMetaPurchaseAttribution: boolean): ValueRuleSegmentRow[] {
  const grouped = new Map<string, MetaInsight[]>()

  for (const row of rows) {
    const segment = segmentFor(row, breakdown)
    const existing = grouped.get(segment) || []
    existing.push(row)
    grouped.set(segment, existing)
  }

  return Array.from(grouped.entries())
    .map(([segment, segmentRows]) => buildSegmentRow(breakdown, segment, segmentRows, allowMetaPurchaseAttribution))
    .sort((a, b) => b.spend - a.spend)
}

function reconcile(totals: ValueRulesBreakdownReport['totals'], checkout: CheckoutMetricsSummary): ValueRulesBreakdownReport['reconciliation'] {
  const metaPurchaseEvents = Math.round(totals.metaPurchaseEvents)
  const approvedPurchases = checkout.approvedPurchases
  const unconfirmedMetaPurchases = Math.max(0, metaPurchaseEvents - approvedPurchases)

  let status: ValueRulesBreakdownReport['reconciliation']['status'] = 'sem-compra'
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

export async function getValueRulesBreakdownReport(options: {
  campaignName?: string
  datePreset?: string
} = {}): Promise<ValueRulesBreakdownReport> {
  const campaignName = options.campaignName || process.env.ACTIVE_META_CAMPAIGN_NAME || DEFAULT_CAMPAIGN_NAME
  const datePreset = options.datePreset || 'today'
  const generatedAt = new Date().toISOString()
  const checkout = await getCheckoutMetricsSummary({ datePreset })
  const allowMetaPurchaseAttribution = checkout.approvedPurchases > 0
  const breakdowns = {} as ValueRulesBreakdownReport['breakdowns']
  let metaAvailable = true
  let metaError: string | undefined

  for (const breakdown of BREAKDOWNS) {
    try {
      const rows = await getMetaInsights({
        level: 'ad',
        datePreset,
        limit: 500,
        breakdowns: [breakdown],
      })
      const filtered = rows.filter(row => includesCampaign(row, campaignName))
      breakdowns[breakdown] = { rows: groupBySegment(filtered, breakdown, allowMetaPurchaseAttribution) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Falha ao ler breakdown Meta Ads', { breakdown, error: message })
      breakdowns[breakdown] = { rows: [], error: message }
      metaAvailable = false
      metaError = metaError || message
    }
  }

  const allRows = BREAKDOWNS.flatMap(breakdown => breakdowns[breakdown]?.rows || [])
  const buyerSignals = allRows
    .filter(row => row.signal === 'comprador' || row.signal === 'checkout')
    .sort((a, b) => b.purchase - a.purchase || b.initiateCheckout - a.initiateCheckout || b.spend - a.spend)
    .slice(0, 12)
  const wasteSignals = allRows
    .filter(row => row.signal === 'desperdicio')
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 12)
  const totals = aggregateTotals(allRows)
  const reconciliation = reconcile(totals, checkout)

  const status: ValueRulesBreakdownReport['status'] = !metaAvailable && allRows.length === 0
    ? 'meta_indisponivel'
    : totals.spend <= 0 && totals.impressions <= 0
      ? 'sem_dados'
      : checkout.approvedPurchases >= 3
        ? 'pronto_para_regra'
        : 'leitura_parcial'

  const summary = status === 'pronto_para_regra'
    ? 'Ja ha compras suficientes para avaliar regra de valor com mais confianca.'
    : status === 'leitura_parcial'
      ? 'Leitura por segmento disponivel, mas ainda com pouca compra; usar como diagnostico antes de aplicar regra.'
      : status === 'sem_dados'
        ? 'Nao houve dados de entrega no periodo consultado.'
        : 'Meta Ads indisponivel para leitura completa de breakdown.'

  return {
    id: crypto.createHash('sha256').update(`${campaignName}:${datePreset}:${generatedAt}:value-rules`).digest('hex').slice(0, 32),
    source: 'meta-ads',
    campaignName,
    datePreset,
    generatedAt,
    metaAvailable,
    metaError,
    status,
    summary,
    guardrail: 'Nao criar regra de valor baseada apenas em clique ou Purchase nao conciliado da Meta. Compra real e PURCHASE_APPROVED da Hotmart; InitiateCheckout e proxy fraco.',
    totals,
    checkout: {
      source: checkout.source,
      approvedPurchases: checkout.approvedPurchases,
      revenue: checkout.revenue,
      totalEvents: checkout.totalEvents,
      lastEventAt: checkout.lastEventAt,
    },
    reconciliation,
    buyerSignals,
    wasteSignals,
    breakdowns,
  }
}
