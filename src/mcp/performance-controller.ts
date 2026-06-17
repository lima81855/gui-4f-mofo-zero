import crypto from 'crypto'
import { getPerformanceSnapshot, PerformanceSnapshot } from './performance-decision'
import { insertRows } from './supabase'
import { logger } from '../utils/logger'

export type PerformanceActionPlan = {
  id: string
  snapshotId: string
  period: string
  generatedAt: string
  operationalStatus: 'bloqueado' | 'teste-controlado' | 'otimizacao' | 'escala-controlada'
  mediaBuyerCommand: 'nao-subir' | 'pausar' | 'manter' | 'otimizar' | 'escalar'
  financeCommand: 'verba-zero' | 'manter-teto' | 'reduzir-teto' | 'liberar-aumento-controlado'
  ceoApprovalRequired: boolean
  dailyBudgetCap: string
  maxLossAllowed: string
  stopLossRules: string[]
  mediaActions: string[]
  creativeActions: string[]
  funnelActions: string[]
  trackingActions: string[]
  financeActions: string[]
  nextReviewTrigger: string
  riskNotes: string[]
  snapshot: PerformanceSnapshot
}

function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(Math.max(0, value))
}

function currentDailySpend(snapshot: PerformanceSnapshot): number {
  if (snapshot.period === 'last_7d') return snapshot.spend / 7
  if (snapshot.period === 'yesterday' || snapshot.period === 'today') return snapshot.spend
  return snapshot.spend > 0 ? snapshot.spend / 7 : 0
}

function basePlan(snapshot: PerformanceSnapshot): Omit<PerformanceActionPlan, 'id' | 'generatedAt' | 'snapshot'> {
  return {
    snapshotId: snapshot.id,
    period: snapshot.period,
    operationalStatus: 'bloqueado',
    mediaBuyerCommand: 'nao-subir',
    financeCommand: 'verba-zero',
    ceoApprovalRequired: true,
    dailyBudgetCap: 'R$0 ate leitura confiavel de checkout e Meta Ads.',
    maxLossAllowed: 'R$0 sem aprovacao do CEO.',
    stopLossRules: ['Nao liberar verba real enquanto tracking, checkout e leitura Meta nao estiverem conciliados.'],
    mediaActions: [],
    creativeActions: [],
    funnelActions: [],
    trackingActions: [],
    financeActions: [],
    nextReviewTrigger: 'Revisar apos novo evento de compra, gasto Meta ou ajuste de tracking.',
    riskNotes: [...snapshot.riskNotes],
  }
}

function buildPlan(snapshot: PerformanceSnapshot): Omit<PerformanceActionPlan, 'id' | 'generatedAt' | 'snapshot'> {
  const plan = basePlan(snapshot)
  const dailySpend = currentDailySpend(snapshot)

  if (snapshot.decision === 'sem-dados' || snapshot.decision === 'aguardando-trafego') {
    return {
      ...plan,
      operationalStatus: 'teste-controlado',
      mediaBuyerCommand: snapshot.source === 'supabase-meta' ? 'manter' : 'nao-subir',
      financeCommand: 'manter-teto',
      dailyBudgetCap: dailySpend > 0 ? money(dailySpend) : 'R$0 ate liberar primeiro teste real.',
      maxLossAllowed: 'Somente o limite de teste aprovado pelo CEO.',
      stopLossRules: [
        'Se houver gasto sem compra aprovada, voltar para pausa imediata.',
        'Se Purchase parar de aparecer no Events Manager, bloquear trafego.',
      ],
      mediaActions: [
        'Preparar ou manter teste pequeno de campanha otimizando para Purchase.',
        'Nao aumentar verba antes de CPA e ROAS aparecerem no resumo de performance.',
      ],
      trackingActions: ['Conferir Purchase no Events Manager e webhook Hotmart apos cada teste.'],
      financeActions: ['Manter caixa protegido; sem escala automatica.'],
      nextReviewTrigger: 'Revisar apos primeira janela com gasto real e pelo menos uma compra aprovada.',
    }
  }

  if (snapshot.decision === 'cortar') {
    return {
      ...plan,
      operationalStatus: 'bloqueado',
      mediaBuyerCommand: 'pausar',
      financeCommand: 'verba-zero',
      dailyBudgetCap: 'R$0 ate diagnostico.',
      maxLossAllowed: 'Nenhuma perda adicional autorizada.',
      stopLossRules: [
        'Pausar campanhas/conjuntos com gasto e zero compras.',
        'Nao religar antes de revisar evento Purchase, pagina e checkout.',
      ],
      mediaActions: ['Pausar o trafego responsavel pelo gasto improdutivo.'],
      funnelActions: ['Revisar primeira dobra, CTA e transicao para checkout.'],
      trackingActions: ['Separar problema de evento, checkout ou pagina antes de novo teste.'],
      financeActions: ['Bloquear verba ate o CEO aprovar novo ciclo de teste.'],
      nextReviewTrigger: 'Revisar depois de ajuste de funil/tracking e compra teste validada.',
    }
  }

  if (snapshot.decision === 'otimizar') {
    return {
      ...plan,
      operationalStatus: 'otimizacao',
      mediaBuyerCommand: 'otimizar',
      financeCommand: 'reduzir-teto',
      dailyBudgetCap: dailySpend > 0 ? money(dailySpend * 0.7) : 'Manter teto minimo de teste.',
      maxLossAllowed: 'No maximo 1 ciclo curto de teste antes de nova leitura.',
      stopLossRules: [
        'Se ROAS liquido continuar abaixo de 1, nao escalar.',
        'Se reembolso aumentar, pausar e revisar promessa/produto.',
      ],
      mediaActions: ['Manter apenas conjuntos/criativos com melhor sinal de compra.'],
      creativeActions: ['Criar novas variacoes para os angulos com clique, mas sem compra suficiente.'],
      funnelActions: ['Revisar oferta, prova e checkout para reduzir atrito.'],
      financeActions: ['Reduzir teto ate ROAS liquido voltar ao minimo aceitavel.'],
      nextReviewTrigger: 'Revisar apos nova rodada com pelo menos mais uma compra ou gasto relevante.',
    }
  }

  if (snapshot.decision === 'escalar-controlado') {
    return {
      ...plan,
      operationalStatus: 'escala-controlada',
      mediaBuyerCommand: 'escalar',
      financeCommand: 'liberar-aumento-controlado',
      ceoApprovalRequired: true,
      dailyBudgetCap: dailySpend > 0 ? money(dailySpend * 1.2) : 'Aumento maximo de 20% sobre o teto atual aprovado.',
      maxLossAllowed: 'Nao aumentar se o caixa nao aceitar perder um ciclo completo de teste.',
      stopLossRules: [
        'Se CPA subir acima do alvo definido pelo CEO, voltar para manter.',
        'Se ROAS cair abaixo de 1 em nova janela, cancelar escala.',
      ],
      mediaActions: ['Escalar apenas em incremento pequeno e manter leitura diaria.'],
      creativeActions: ['Duplicar vencedores e preparar novas variacoes do mesmo angulo.'],
      financeActions: ['Liberar aumento apenas com aprovacao do CEO e caixa disponivel.'],
      nextReviewTrigger: 'Revisar diariamente durante a escala.',
    }
  }

  return {
    ...plan,
    operationalStatus: 'teste-controlado',
    mediaBuyerCommand: 'manter',
    financeCommand: 'manter-teto',
    dailyBudgetCap: dailySpend > 0 ? money(dailySpend) : 'Manter teto atual sem aumento.',
    maxLossAllowed: 'Limite atual do teste; sem verba extra.',
    stopLossRules: [
      'Nao aumentar antes de mais compras ou gasto suficiente.',
      'Se houver gasto adicional sem compra, pausar para diagnostico.',
    ],
    mediaActions: ['Manter campanha em teste controlado.'],
    creativeActions: ['Preparar variacoes, mas aguardar leitura antes de trocar tudo.'],
    financeActions: ['Manter teto atual e registrar nova leitura de performance.'],
    nextReviewTrigger: 'Revisar apos mais gasto ou mais compras.',
  }
}

async function syncPerformanceActionPlan(plan: PerformanceActionPlan): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return

  try {
    await insertRows({
      table: 'performance_action_plans',
      rows: [{
        id: plan.id,
        snapshot_id: plan.snapshotId,
        period: plan.period,
        operational_status: plan.operationalStatus,
        media_buyer_command: plan.mediaBuyerCommand,
        finance_command: plan.financeCommand,
        ceo_approval_required: plan.ceoApprovalRequired,
        daily_budget_cap: plan.dailyBudgetCap,
        max_loss_allowed: plan.maxLossAllowed,
        stop_loss_rules: plan.stopLossRules,
        media_actions: plan.mediaActions,
        creative_actions: plan.creativeActions,
        funnel_actions: plan.funnelActions,
        tracking_actions: plan.trackingActions,
        finance_actions: plan.financeActions,
        next_review_trigger: plan.nextReviewTrigger,
        risk_notes: plan.riskNotes,
        payload: plan,
        generated_at: plan.generatedAt,
      }],
    })
  } catch (error) {
    logger.warn('Falha ao sincronizar performance action plan no Supabase', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getPerformanceActionPlan(options: { datePreset?: string } = {}): Promise<PerformanceActionPlan> {
  const snapshot = await getPerformanceSnapshot(options)
  const generatedAt = new Date().toISOString()
  const planCore = buildPlan(snapshot)
  const plan: PerformanceActionPlan = {
    id: crypto.createHash('sha256').update(`${snapshot.id}:${generatedAt}:action-plan`).digest('hex').slice(0, 32),
    generatedAt,
    snapshot,
    ...planCore,
  }

  await syncPerformanceActionPlan(plan)
  return plan
}
