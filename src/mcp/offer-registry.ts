import { readJsonOrNull } from './filesystem'

export type ActiveOffer = {
  id: string
  slug: string
  name: string
  status: 'draft' | 'ready-for-test' | 'live' | 'paused'
  sourcePath?: string
  repositoryUrl?: string
  publicUrl?: string
  product: {
    format: string
    mainAsset: string
    modules: string[]
    assetsReady: boolean
  }
  funnel: {
    type: 'quiz-sales-page' | 'direct-page' | 'vsl' | 'other'
    quizReady: boolean
    salesPageReady: boolean
    checkoutReady: boolean
    checkoutUrl?: string
    utmPatternReady: boolean
  }
  economics: {
    frontEndPrice: string
    orderBump?: string
    upsell?: string
    testBudgetLimit: string
    maxLossAllowed: string
  }
  tracking: {
    provider: 'hotmart-meta-capi'
    purchaseValidated: boolean
    metaReadValidated: boolean
  }
  creatives: {
    minimumStaticCreatives: number
    minimumVideoScripts: number
    ready: boolean
  }
  notes: string[]
}

export type ActiveOfferReadiness = {
  exists: boolean
  offer?: ActiveOffer
  status: 'ok' | 'atencao' | 'bloqueado'
  detail: string
  missing: string[]
}

export async function readActiveOffer(): Promise<ActiveOffer | null> {
  return readJsonOrNull<ActiveOffer>('data/offers/active-offer.json')
}

export async function getActiveOfferReadiness(): Promise<ActiveOfferReadiness> {
  const offer = await readActiveOffer()

  if (!offer) {
    return {
      exists: false,
      status: 'atencao',
      detail: 'Nenhuma oferta real ativa cadastrada em data/offers/active-offer.json.',
      missing: ['Cadastrar oferta ativa.'],
    }
  }

  const missing = [
    offer.product.assetsReady ? '' : 'Produto e entregaveis precisam estar prontos.',
    offer.funnel.quizReady ? '' : 'Quiz precisa estar pronto.',
    offer.funnel.salesPageReady ? '' : 'Pagina de vendas precisa estar pronta.',
    offer.funnel.checkoutReady ? '' : 'Checkout precisa estar pronto.',
    offer.funnel.utmPatternReady ? '' : 'Padrao de UTMs precisa estar definido.',
    offer.tracking.purchaseValidated ? '' : 'Purchase precisa estar validado.',
    offer.tracking.metaReadValidated ? '' : 'Leitura Meta Ads precisa estar validada.',
    offer.creatives.ready ? '' : 'Criativos minimos precisam estar prontos.',
  ].filter(Boolean)

  if (offer.status === 'paused') {
    return {
      exists: true,
      offer,
      status: 'bloqueado',
      detail: `Oferta ${offer.name} esta pausada.`,
      missing: ['Remover pausa operacional antes de trafego.'],
    }
  }

  if (!offer.product.assetsReady || !offer.funnel.quizReady || !offer.funnel.salesPageReady || !offer.funnel.checkoutReady) {
    return {
      exists: true,
      offer,
      status: 'bloqueado',
      detail: `Oferta ${offer.name} cadastrada, mas ainda nao pode receber trafego real.`,
      missing,
    }
  }

  if (missing.length > 0) {
    return {
      exists: true,
      offer,
      status: 'atencao',
      detail: `Oferta ${offer.name} cadastrada, mas ainda tem pendencias operacionais.`,
      missing,
    }
  }

  return {
    exists: true,
    offer,
    status: 'ok',
    detail: `Oferta ativa cadastrada: ${offer.name} (${offer.funnel.type}, ${offer.economics.frontEndPrice}).`,
    missing: [],
  }
}
