import crypto from 'crypto'
import { getCheckoutMetricsSummary } from './checkout-metrics'
import { getMetaInsights, MetaInsight } from './meta-ads'
import { insertRows } from './supabase'
import { logger } from '../utils/logger'

export type PerformanceSnapshot = {
  id: string
  source: 'supabase-meta' | 'local-meta' | 'supabase' | 'local'
  period: string
  generatedAt: string
  spend: number
  revenue: number
  refundValue: number
  netRevenue: number
  purchases: number
  refunds: number
  metaPurchaseEvents: number
  unconfirmedMetaPurchases: number
  checkoutSource: string
  metaReadOk: boolean
  cpa?: number
  roas?: number
  refundRate?: number
  decision: 'sem-dados' | 'aguardando-trafego' | 'bloqueado' | 'cortar' | 'otimizar' | 'manter-teste' | 'escalar-controlado'
  summary: string
  actions: string[]
  budgetGuardrail: string
  riskNotes: string[]
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

function sumMetaSpend(rows: MetaInsight[]): number {
  return rows.reduce((sum, row) => sum + numberFrom(row.spend), 0)
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function safeRatio(numerator: number, denominator: number): number | undefined {
  if (denominator <= 0) return undefined
  return roundMoney(numerator / denominator)
}

function decide(input: {
  spend: number
  revenue: number
  refundValue: number
  purchases: number
  refunds: number
  metaPurchaseEvents: number
  checkoutSource: string
  metaAvailable: boolean
}): Pick<PerformanceSnapshot, 'decision' | 'summary' | 'actions' | 'budgetGuardrail' | 'riskNotes'> {
  const netRevenue = input.revenue - input.refundValue
  const roas = safeRatio(netRevenue, input.spend)
  const refundRate = safeRatio(input.refunds, input.purchases)
  const riskNotes: string[] = []

  if (input.checkoutSource !== 'supabase') {
    riskNotes.push('Checkout ainda esta usando fallback local; validar persistencia no Supabase antes de decisao de escala.')
  }

  if (input.metaPurchaseEvents > input.purchases) {
    riskNotes.push('Meta Ads reportou Purchase acima das compras aprovadas na Hotmart; tratar como evento nao conciliado, nao como caixa.')
  }

  if (!input.metaAvailable) {
    return {
      decision: input.purchases > 0 ? 'aguardando-trafego' : 'sem-dados',
      summary: 'Ha dados de checkout, mas ainda nao foi possivel ler gasto real da Meta Ads.',
      actions: [
        'Validar permissao de leitura da conta Meta Ads.',
        'Sincronizar insights de campanha antes de liberar escala.',
        'Manter qualquer aumento de verba bloqueado ate existir gasto e receita conciliados.',
      ],
      budgetGuardrail: 'Sem aumento de verba ate gasto Meta e checkout estarem conciliados.',
      riskNotes,
    }
  }

  if (input.spend <= 0 && input.purchases <= 0) {
    return {
      decision: 'sem-dados',
      summary: 'Ainda nao existe gasto nem compra suficiente para decidir.',
      actions: [
        'Aguardar primeira rodada de trafego controlado.',
        'Confirmar se Purchase segue processado no Events Manager.',
        'Nao mexer em copy, pagina ou criativos sem amostra minima.',
      ],
      budgetGuardrail: 'Verba real bloqueada ou limitada ao teste previamente aprovado.',
      riskNotes,
    }
  }

  if (input.spend > 0 && input.purchases <= 0) {
    return {
      decision: 'cortar',
      summary: input.metaPurchaseEvents > 0
        ? 'Existe gasto e Purchase na Meta, mas nenhuma compra aprovada no checkout.'
        : 'Existe gasto registrado e nenhuma compra aprovada no checkout.',
      actions: [
        'Nao validar venda sem PURCHASE_APPROVED da Hotmart.',
        'Checar se ha InitiateCheckout sem Purchase para separar problema de checkout de problema de criativo.',
        input.metaPurchaseEvents > 0
          ? 'Investigar se boleto, evento nativo da Hotmart ou duplicidade esta sendo contado como Purchase na Meta.'
          : 'Criar nova hipotese de criativo somente depois de validar pagina e checkout.',
      ],
      budgetGuardrail: 'Cortar gasto ate existir sinal de compra aprovada ou ajuste validado.',
      riskNotes,
    }
  }

  if (roas !== undefined && roas < 1) {
    return {
      decision: 'otimizar',
      summary: 'Ha compras, mas a receita liquida ainda nao cobre o gasto.',
      actions: [
        'Manter teste apenas com verba controlada.',
        'Priorizar novos criativos e revisao da primeira dobra da pagina.',
        'Verificar qualidade dos eventos e possivel atraso de atribuicao antes de pausar tudo.',
      ],
      budgetGuardrail: 'Sem escala; manter ou reduzir verba ate ROAS liquido melhorar.',
      riskNotes: refundRate && refundRate > 0.2 ? [...riskNotes, 'Taxa de reembolso alta para uma oferta low ticket.'] : riskNotes,
    }
  }

  if (roas !== undefined && roas >= 1.5 && input.purchases >= 3) {
    return {
      decision: 'escalar-controlado',
      summary: 'A oferta tem sinais positivos de compra e ROAS liquido acima do piso operacional.',
      actions: [
        'Escalar em pequenos incrementos, mantendo leitura diaria.',
        'Duplicar os criativos/conjuntos vencedores antes de aumentar agressivamente.',
        'Monitorar reembolsos e estabilidade do CPA por mais uma janela de dados.',
      ],
      budgetGuardrail: 'Permitir aumento conservador condicionado a CEO e caixa.',
      riskNotes,
    }
  }

  return {
    decision: 'manter-teste',
    summary: 'Ha dados iniciais, mas a amostra ainda pede cautela antes de corte ou escala.',
    actions: [
      'Manter teste ativo com limite de perda definido.',
      'Aguardar mais compras ou mais gasto antes de conclusao forte.',
      'Separar leitura por criativo assim que houver volume minimo.',
    ],
    budgetGuardrail: 'Manter verba atual; sem aumento automatico.',
    riskNotes,
  }
}

async function readMetaSpend(datePreset: string): Promise<{ spend: number; purchaseEvents: number; available: boolean }> {
  try {
    const rows = await getMetaInsights({ level: 'campaign', datePreset, limit: 100 })
    return {
      spend: sumMetaSpend(rows),
      purchaseEvents: rows.reduce((sum, row) => sum + actionValue(row, 'purchase'), 0),
      available: true,
    }
  } catch (error) {
    logger.warn('Performance decision sem leitura Meta Ads; usando apenas checkout', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { spend: 0, purchaseEvents: 0, available: false }
  }
}

async function syncPerformanceSnapshot(snapshot: PerformanceSnapshot): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return

  try {
    await insertRows({
      table: 'performance_snapshots',
      rows: [{
        id: snapshot.id,
        source: snapshot.source,
        period: snapshot.period,
        spend: snapshot.spend,
        revenue: snapshot.revenue,
        refund_value: snapshot.refundValue,
        net_revenue: snapshot.netRevenue,
        purchases: snapshot.purchases,
        refunds: snapshot.refunds,
        cpa: snapshot.cpa ?? null,
        roas: snapshot.roas ?? null,
        refund_rate: snapshot.refundRate ?? null,
        decision: snapshot.decision,
        summary: snapshot.summary,
        actions: snapshot.actions,
        budget_guardrail: snapshot.budgetGuardrail,
        risk_notes: snapshot.riskNotes,
        payload: snapshot,
        generated_at: snapshot.generatedAt,
      }],
    })
  } catch (error) {
    logger.warn('Falha ao sincronizar performance snapshot no Supabase', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getPerformanceSnapshot(options: { datePreset?: string } = {}): Promise<PerformanceSnapshot> {
  const period = options.datePreset || 'last_7d'
  const checkout = await getCheckoutMetricsSummary({ datePreset: period })
  const meta = await readMetaSpend(period)
  const revenue = checkout.revenue
  const refundValue = checkout.refundValue
  const netRevenue = revenue - refundValue
  const cpa = safeRatio(meta.spend, checkout.approvedPurchases)
  const roas = safeRatio(netRevenue, meta.spend)
  const refundRate = safeRatio(checkout.refunds, checkout.approvedPurchases)
  const source = `${checkout.source}${meta.available ? '-meta' : ''}` as PerformanceSnapshot['source']
  const unconfirmedMetaPurchases = Math.max(0, meta.purchaseEvents - checkout.approvedPurchases)
  const generatedAt = new Date().toISOString()
  const decision = decide({
    spend: meta.spend,
    revenue,
    refundValue,
    purchases: checkout.approvedPurchases,
    refunds: checkout.refunds,
    metaPurchaseEvents: meta.purchaseEvents,
    checkoutSource: checkout.source,
    metaAvailable: meta.available,
  })

  const snapshot: PerformanceSnapshot = {
    id: crypto.createHash('sha256').update(`${period}:${generatedAt}`).digest('hex').slice(0, 32),
    source,
    period,
    generatedAt,
    spend: roundMoney(meta.spend),
    revenue: roundMoney(revenue),
    refundValue: roundMoney(refundValue),
    netRevenue: roundMoney(netRevenue),
    purchases: checkout.approvedPurchases,
    refunds: checkout.refunds,
    metaPurchaseEvents: meta.purchaseEvents,
    unconfirmedMetaPurchases,
    checkoutSource: checkout.source,
    metaReadOk: meta.available,
    cpa,
    roas,
    refundRate,
    ...decision,
  }

  await syncPerformanceSnapshot(snapshot)
  return snapshot
}
