import { readAllJson } from './filesystem'
import { selectRows } from './supabase'
import { logger } from '../utils/logger'

type CheckoutEventRow = {
  id: string
  provider: string
  event_name: string
  purchase_status: string
  transaction_id: string | null
  product_id: string | null
  product_name: string | null
  value: number
  currency: string
  is_approved_purchase: boolean
  is_refund: boolean
  received_at: string
}

type LocalCheckoutEventFile = {
  webhook?: {
    id?: string
    provider?: string
    event?: string
    purchaseStatus?: string
    transaction?: string
    productId?: string
    productName?: string
    value?: number
    currency?: string
    receivedAt?: string
  }
}

export type CheckoutMetricsSummary = {
  source: 'supabase' | 'local'
  datePreset?: string
  totalEvents: number
  ignoredEvents: number
  approvedPurchases: number
  revenue: number
  refunds: number
  refundValue: number
  currency: string
  lastEventAt: string
  recentEvents: Array<{
    event: string
    purchaseStatus: string
    transaction: string
    productName: string
    value: number
    receivedAt: string
  }>
}

function isRefund(eventName: string, purchaseStatus: string): boolean {
  const event = eventName.toUpperCase()
  const status = purchaseStatus.toUpperCase()
  return event.includes('REFUND') || event.includes('CHARGEBACK') || status.includes('REFUND') || status.includes('CHARGEBACK')
}

function isLikelyTestCheckoutRow(row: CheckoutEventRow): boolean {
  const productName = (row.product_name || '').toLowerCase()
  const transaction = (row.transaction_id || '').toLowerCase()
  const maxValidValue = Number(process.env.CHECKOUT_MAX_VALID_VALUE || 300)
  const value = Number(row.value || 0)

  if (productName.includes('test') || productName.includes('postback')) return true
  if (transaction === 'hp16015479281022') return true
  if (value > maxValidValue) return true
  return false
}

function saoPauloDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  return {
    year: Number(parts.find(part => part.type === 'year')?.value),
    month: Number(parts.find(part => part.type === 'month')?.value),
    day: Number(parts.find(part => part.type === 'day')?.value),
  }
}

function utcStartForSaoPauloDate(parts: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 3, 0, 0, 0))
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function dateRangeForPreset(datePreset?: string): { start?: Date; end?: Date } {
  if (!datePreset) return {}

  const todayStart = utcStartForSaoPauloDate(saoPauloDateParts(new Date()))
  const normalized = datePreset.toLowerCase()

  if (normalized === 'today') {
    return { start: todayStart, end: addDays(todayStart, 1) }
  }

  if (normalized === 'yesterday') {
    return { start: addDays(todayStart, -1), end: todayStart }
  }

  const match = normalized.match(/^last_(\d+)d$/)
  if (match) {
    const days = Math.max(1, Number(match[1]))
    return { start: addDays(todayStart, -(days - 1)), end: addDays(todayStart, 1) }
  }

  return {}
}

function isInsideRange(row: CheckoutEventRow, range: { start?: Date; end?: Date }): boolean {
  if (!range.start && !range.end) return true

  const receivedAt = new Date(row.received_at)
  if (Number.isNaN(receivedAt.getTime())) return false
  if (range.start && receivedAt < range.start) return false
  if (range.end && receivedAt >= range.end) return false
  return true
}

function summarize(rows: CheckoutEventRow[], source: CheckoutMetricsSummary['source'], datePreset?: string): CheckoutMetricsSummary {
  const range = dateRangeForPreset(datePreset)
  const validRows = rows
    .filter(row => !isLikelyTestCheckoutRow(row))
    .filter(row => isInsideRange(row, range))
  const approved = validRows.filter(row => row.is_approved_purchase)
  const refunded = validRows.filter(row => row.is_refund)
  const recent = [...validRows].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 12)

  return {
    source,
    datePreset,
    totalEvents: validRows.length,
    ignoredEvents: rows.length - validRows.length,
    approvedPurchases: approved.length,
    revenue: approved.reduce((sum, row) => sum + Number(row.value || 0), 0),
    refunds: refunded.length,
    refundValue: refunded.reduce((sum, row) => sum + Number(row.value || 0), 0),
    currency: approved[0]?.currency || validRows[0]?.currency || 'BRL',
    lastEventAt: recent[0]?.received_at || '',
    recentEvents: recent.map(row => ({
      event: row.event_name,
      purchaseStatus: row.purchase_status,
      transaction: row.transaction_id || '',
      productName: row.product_name || '',
      value: Number(row.value || 0),
      receivedAt: row.received_at,
    })),
  }
}

function localFileToRow(file: LocalCheckoutEventFile): CheckoutEventRow | null {
  const webhook = file.webhook
  if (!webhook?.id) return null
  const eventName = webhook.event || ''
  const purchaseStatus = webhook.purchaseStatus || ''

  return {
    id: webhook.id,
    provider: webhook.provider || 'hotmart',
    event_name: eventName,
    purchase_status: purchaseStatus,
    transaction_id: webhook.transaction || null,
    product_id: webhook.productId || null,
    product_name: webhook.productName || null,
    value: Number(webhook.value || 0),
    currency: webhook.currency || 'BRL',
    is_approved_purchase: eventName.toUpperCase() === 'PURCHASE_APPROVED' || purchaseStatus.toUpperCase() === 'APPROVED',
    is_refund: isRefund(eventName, purchaseStatus),
    received_at: webhook.receivedAt || '',
  }
}

async function readLocalCheckoutEvents(): Promise<CheckoutEventRow[]> {
  const files = await readAllJson<LocalCheckoutEventFile>('data/checkout/hotmart')
  return files.map(localFileToRow).filter((row): row is CheckoutEventRow => Boolean(row))
}

export async function getCheckoutMetricsSummary(options: { datePreset?: string } = {}): Promise<CheckoutMetricsSummary> {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const rows = await selectRows<CheckoutEventRow>(
        'checkout_events',
        'select=id,provider,event_name,purchase_status,transaction_id,product_id,product_name,value,currency,is_approved_purchase,is_refund,received_at&order=received_at.desc&limit=500',
      )
      return summarize(rows, 'supabase', options.datePreset)
    } catch (error) {
      logger.warn('Falha ao ler checkout_events no Supabase; usando fallback local', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return summarize(await readLocalCheckoutEvents(), 'local', options.datePreset)
}
