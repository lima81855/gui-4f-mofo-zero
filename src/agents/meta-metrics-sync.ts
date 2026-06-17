import path from 'path'
import { ensureDir, fileExists, readJson, writeJson } from '../mcp/filesystem'
import { getMetaInsights, listMetaCampaigns, MetaInsight } from '../mcp/meta-ads'
import { upsertRows } from '../mcp/supabase'
import { logger } from '../utils/logger'
import {
  CreativePerformance,
  CreativePerformanceSchema,
  DailyMetrics,
  DailyMetricsSchema,
  MetaMetricsSyncInput,
  MetaMetricsSyncOutput,
  OfferBrief,
  OfferBriefSchema,
} from '../types'

type OfferBriefFile = { offer: OfferBrief }

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const fs = await import('fs/promises')
    const projectRoot = path.resolve(__dirname, '..', '..')
    const entries = await fs.readdir(path.join(projectRoot, dirPath), { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => `${dirPath}/${entry.name}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function resolveIdeaId(selector?: string): Promise<string> {
  if (selector && await fileExists(`data/offers/${selector}/offer-brief.json`)) return selector
  const dirs = await listDirectories('data/offers')
  if (!dirs.length) throw new MetaMetricsSyncError('Nenhum offer-brief.json encontrado em data/offers.')
  if (!selector) return path.basename(dirs[0])

  for (const dir of dirs) {
    const file = await readJson<OfferBriefFile>(`${dir}/offer-brief.json`)
    const offer = OfferBriefSchema.parse(file.offer)
    if (offer.ideaId === selector || offer.productName.toLowerCase().includes(selector.toLowerCase())) {
      return offer.ideaId
    }
  }

  throw new MetaMetricsSyncError(`Oferta nao encontrada para seletor: ${selector}`)
}

function numberFrom(value?: string): number {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function actionValue(row: MetaInsight, actionType: string): number {
  const action = row.actions?.find(item => item.action_type === actionType)
  return numberFrom(action?.value)
}

function revenueValue(row: MetaInsight): number {
  const purchase = row.action_values?.find(item => item.action_type === 'purchase')
  return numberFrom(purchase?.value)
}

function aggregateDailyMetrics(ideaId: string, rows: MetaInsight[]): DailyMetrics {
  const totals = rows.reduce((acc, row) => {
    acc.spend += numberFrom(row.spend)
    acc.impressions += Math.round(numberFrom(row.impressions))
    acc.clicks += Math.round(numberFrom(row.clicks))
    acc.viewContent += Math.round(actionValue(row, 'view_content'))
    acc.initiateCheckout += Math.round(actionValue(row, 'initiate_checkout'))
    acc.purchases += Math.round(actionValue(row, 'purchase'))
    acc.revenue += revenueValue(row)
    return acc
  }, {
    spend: 0,
    impressions: 0,
    clicks: 0,
    viewContent: 0,
    initiateCheckout: 0,
    purchases: 0,
    revenue: 0,
  })

  const cpa = totals.purchases > 0 ? totals.spend / totals.purchases : undefined
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : undefined

  return DailyMetricsSchema.parse({
    ideaId,
    date: new Date().toISOString().slice(0, 10),
    spend: totals.spend,
    impressions: totals.impressions,
    clicks: totals.clicks,
    pageViews: totals.viewContent,
    viewContent: totals.viewContent,
    initiateCheckout: totals.initiateCheckout,
    purchases: totals.purchases,
    revenue: totals.revenue,
    refunds: 0,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : undefined,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : undefined,
    cpa,
    roas,
    notes: ['Dados sincronizados da Meta Marketing API em modo leitura.'],
  })
}

function creativeMetricsFromInsights(rows: MetaInsight[]): CreativePerformance[] {
  return rows.map(row => CreativePerformanceSchema.parse({
    creativeName: row.ad_name || row.adset_name || row.campaign_name || row.ad_id || 'criativo-sem-nome',
    spend: numberFrom(row.spend),
    impressions: Math.round(numberFrom(row.impressions)),
    clicks: Math.round(numberFrom(row.clicks)),
    viewContent: Math.round(actionValue(row, 'view_content')),
    initiateCheckout: Math.round(actionValue(row, 'initiate_checkout')),
    purchases: Math.round(actionValue(row, 'purchase')),
    revenue: revenueValue(row),
    ctr: row.ctr ? numberFrom(row.ctr) : undefined,
    cpc: row.cpc ? numberFrom(row.cpc) : undefined,
    cpa: actionValue(row, 'purchase') > 0 ? numberFrom(row.spend) / actionValue(row, 'purchase') : undefined,
    roas: numberFrom(row.spend) > 0 ? revenueValue(row) / numberFrom(row.spend) : undefined,
    notes: [`Meta ad_id: ${row.ad_id || 'n/a'}`, `Periodo: ${row.date_start || '?'} a ${row.date_stop || '?'}`],
  }))
}

async function syncDailyMetricsToSupabase(metrics: DailyMetrics): Promise<void> {
  await upsertRows({
    table: 'daily_metrics',
    onConflict: 'idea_id,metric_date',
    rows: [{
      idea_id: metrics.ideaId,
      metric_date: metrics.date,
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      page_views: metrics.pageViews,
      view_content: metrics.viewContent,
      initiate_checkout: metrics.initiateCheckout,
      purchases: metrics.purchases,
      revenue: metrics.revenue,
      refunds: metrics.refunds,
      payload: metrics,
    }],
  })
}

export async function runMetaMetricsSync(input: MetaMetricsSyncInput): Promise<MetaMetricsSyncOutput> {
  const startTime = Date.now()
  const ideaId = await resolveIdeaId(input.ideaId)
  const datePreset = input.datePreset || 'last_7d'

  logger.info('Agente MetaMetricsSync - iniciando', {
    sessionId: input.sessionId,
    ideaId,
    datePreset,
  })

  const campaigns = await listMetaCampaigns(50)
  const campaignInsights = await getMetaInsights({ level: 'campaign', datePreset, limit: 100 })
  const adInsights = await getMetaInsights({ level: 'ad', datePreset, limit: 200 })

  const dailyMetrics = aggregateDailyMetrics(ideaId, campaignInsights)
  const creativeMetrics = creativeMetricsFromInsights(adInsights)

  const outputDir = input.outputDir ?? `data/metrics/${ideaId}`
  await ensureDir(outputDir)

  const dailyMetricsPath = `${outputDir}/daily-metrics.json`
  const creativeMetricsPath = `${outputDir}/creative-metrics.json`
  const campaignsPath = `${outputDir}/meta-campaigns.json`

  await writeJson(dailyMetricsPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      source: 'meta-ads',
      datePreset,
    },
    metrics: dailyMetrics,
  })
  await writeJson(creativeMetricsPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      source: 'meta-ads',
      datePreset,
    },
    metrics: creativeMetrics,
  })
  await writeJson(campaignsPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      source: 'meta-ads',
      datePreset,
    },
    campaigns,
    campaignInsights,
    adInsights,
  })

  await syncDailyMetricsToSupabase(dailyMetrics)

  const durationMs = Date.now() - startTime
  logger.info('Agente MetaMetricsSync - concluido', {
    ideaId,
    campaigns: campaigns.length,
    campaignInsightRows: campaignInsights.length,
    adInsightRows: adInsights.length,
    dailyMetricsPath,
    durationMs,
  })

  return {
    ideaId,
    dailyMetricsPath,
    creativeMetricsPath,
    campaignsPath,
    durationMs,
  }
}

export class MetaMetricsSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaMetricsSyncError'
  }
}

