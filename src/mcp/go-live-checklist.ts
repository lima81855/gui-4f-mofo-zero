import crypto from 'crypto'
import { getPerformanceActionPlan, PerformanceActionPlan } from './performance-controller'
import { insertRows, checkSupabaseTables } from './supabase'
import { getActiveOfferReadiness } from './offer-registry'
import { logger } from '../utils/logger'

export type GoLiveStatus = 'bloqueado' | 'validar' | 'pronto-com-pendencias' | 'pronto'
export type GoLiveItemStatus = 'ok' | 'atencao' | 'bloqueado'

export type GoLiveChecklistItem = {
  area: string
  status: GoLiveItemStatus
  title: string
  detail: string
  requiredBeforeTraffic: boolean
}

export type GoLiveReadinessReport = {
  id: string
  generatedAt: string
  period: string
  status: GoLiveStatus
  summary: string
  items: GoLiveChecklistItem[]
  blockers: string[]
  nextActions: string[]
  performance: PerformanceActionPlan['snapshot']
  actionPlan: Omit<PerformanceActionPlan, 'snapshot'>
}

function addItem(items: GoLiveChecklistItem[], item: GoLiveChecklistItem): void {
  items.push(item)
}

function withoutSnapshot(plan: PerformanceActionPlan): Omit<PerformanceActionPlan, 'snapshot'> {
  const { snapshot: _snapshot, ...planWithoutSnapshot } = plan
  return planWithoutSnapshot
}

function resolveStatus(items: GoLiveChecklistItem[], plan: PerformanceActionPlan): GoLiveStatus {
  const hasRequiredBlocker = items.some(item => item.requiredBeforeTraffic && item.status === 'bloqueado')
  if (hasRequiredBlocker || plan.operationalStatus === 'bloqueado') return 'bloqueado'

  const hasRequiredAttention = items.some(item => item.requiredBeforeTraffic && item.status === 'atencao')
  if (plan.snapshot.spend <= 0 || plan.snapshot.purchases <= 0) return 'validar'
  if (hasRequiredAttention || plan.ceoApprovalRequired) return 'pronto-com-pendencias'
  return 'pronto'
}

function summarize(status: GoLiveStatus): string {
  if (status === 'bloqueado') {
    return 'A oferta ainda nao deve receber trafego real; existe bloqueio em etapa obrigatoria.'
  }
  if (status === 'validar') {
    return 'A infraestrutura principal esta conectada, mas a operacao ainda precisa de teste controlado antes de escala.'
  }
  if (status === 'pronto-com-pendencias') {
    return 'A oferta pode entrar em operacao controlada, mantendo aprovacao do CEO e teto de verba.'
  }
  return 'A operacao esta pronta para rodar com monitoramento diario.'
}

function nextActionsFor(items: GoLiveChecklistItem[], plan: PerformanceActionPlan): string[] {
  const actions = items
    .filter(item => item.status !== 'ok')
    .map(item => item.detail)

  return [
    ...actions,
    ...plan.trackingActions,
    ...plan.mediaActions,
    ...plan.financeActions,
  ].filter((action, index, all) => action && all.indexOf(action) === index)
}

async function syncGoLiveReport(report: GoLiveReadinessReport): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return

  try {
    await insertRows({
      table: 'go_live_reports',
      rows: [{
        id: report.id,
        status: report.status,
        summary: report.summary,
        blockers: report.blockers,
        next_actions: report.nextActions,
        payload: report,
        generated_at: report.generatedAt,
      }],
    })
  } catch (error) {
    logger.warn('Falha ao sincronizar go-live report no Supabase', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getGoLiveChecklist(options: { datePreset?: string } = {}): Promise<GoLiveReadinessReport> {
  const period = options.datePreset || 'last_7d'
  const generatedAt = new Date().toISOString()
  const items: GoLiveChecklistItem[] = []
  const plan = await getPerformanceActionPlan({ datePreset: period })
  const snapshot = plan.snapshot
  const activeOffer = await getActiveOfferReadiness()

  try {
    const tables = await checkSupabaseTables()
    const missingTables = tables.filter(table => table.status !== 'ok').map(table => table.table)
    addItem(items, {
      area: 'infra',
      status: missingTables.length > 0 ? 'bloqueado' : 'ok',
      title: 'Supabase operacional',
      detail: missingTables.length > 0
        ? `Criar ou corrigir tabelas obrigatorias no Supabase: ${missingTables.join(', ')}.`
        : 'Supabase acessivel e tabelas principais disponiveis.',
      requiredBeforeTraffic: true,
    })
  } catch (error) {
    addItem(items, {
      area: 'infra',
      status: 'bloqueado',
      title: 'Supabase operacional',
      detail: error instanceof Error ? error.message : 'Falha desconhecida ao validar Supabase.',
      requiredBeforeTraffic: true,
    })
  }

  addItem(items, {
    area: 'checkout',
    status: snapshot.source.startsWith('supabase') && snapshot.purchases > 0 ? 'ok' : 'atencao',
    title: 'Checkout Hotmart recebendo eventos',
    detail: snapshot.purchases > 0
      ? `Foram encontradas ${snapshot.purchases} compra(s) aprovada(s) no periodo.`
      : 'Enviar uma compra teste aprovada antes de liberar trafego real.',
    requiredBeforeTraffic: true,
  })

  addItem(items, {
    area: 'tracking',
    status: snapshot.source.includes('meta') ? 'ok' : 'bloqueado',
    title: 'Meta Ads com leitura conectada',
    detail: snapshot.source.includes('meta')
      ? 'Meta Ads esta respondendo leitura de performance.'
      : 'Validar token/permissoes de Meta Ads antes de qualquer escala.',
    requiredBeforeTraffic: true,
  })

  addItem(items, {
    area: 'tracking',
    status: snapshot.purchases > 0 ? 'ok' : 'atencao',
    title: 'Evento Purchase validado',
    detail: snapshot.purchases > 0
      ? 'Purchase ja apareceu na esteira de checkout/tracking.'
      : 'Confirmar Purchase no Events Manager com test_event_code antes de rodar a oferta real.',
    requiredBeforeTraffic: true,
  })

  addItem(items, {
    area: 'midia',
    status: snapshot.spend > 0 ? 'ok' : 'atencao',
    title: 'Primeiro gasto real da Meta',
    detail: snapshot.spend > 0
      ? `Gasto lido no periodo: R$ ${snapshot.spend.toFixed(2)}.`
      : 'Ainda nao ha gasto real; manter como teste-controlado e nao escalar.',
    requiredBeforeTraffic: false,
  })

  addItem(items, {
    area: 'financeiro',
    status: plan.operationalStatus === 'bloqueado' ? 'bloqueado' : 'ok',
    title: 'Teto financeiro e stop loss',
    detail: `${plan.dailyBudgetCap} ${plan.maxLossAllowed}`,
    requiredBeforeTraffic: true,
  })

  addItem(items, {
    area: 'ceo',
    status: plan.ceoApprovalRequired ? 'atencao' : 'ok',
    title: 'Aprovacao do CEO',
    detail: plan.ceoApprovalRequired
      ? 'CEO precisa aprovar qualquer aumento de verba ou escala.'
      : 'Plano atual nao exige aprovacao adicional para manter operacao.',
    requiredBeforeTraffic: false,
  })

  addItem(items, {
    area: 'oferta',
    status: activeOffer.status,
    title: 'Oferta real cadastrada',
    detail: activeOffer.status === 'ok'
      ? activeOffer.detail
      : `${activeOffer.detail} ${activeOffer.missing.join(' ')}`.trim(),
    requiredBeforeTraffic: true,
  })

  const status = resolveStatus(items, plan)
  const blockers = items
    .filter(item => item.requiredBeforeTraffic && item.status === 'bloqueado')
    .map(item => item.detail)
  const report: GoLiveReadinessReport = {
    id: crypto.createHash('sha256').update(`${period}:${generatedAt}:go-live`).digest('hex').slice(0, 32),
    generatedAt,
    period,
    status,
    summary: summarize(status),
    items,
    blockers,
    nextActions: nextActionsFor(items, plan),
    performance: snapshot,
    actionPlan: withoutSnapshot(plan),
  }

  await syncGoLiveReport(report)
  return report
}
