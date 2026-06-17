import crypto from 'crypto'
import { ensureDir, writeJson } from './filesystem'
import { insertRows } from './supabase'
import { sendMetaCapiEvent } from './meta-ads'
import { logger } from '../utils/logger'

export type HotmartWebhookRecord = {
  id: string
  provider: 'hotmart'
  event: string
  purchaseStatus: string
  transaction: string
  productId: string
  productName: string
  buyerEmail: string
  buyerPhone: string
  buyerFirstName: string
  buyerLastName: string
  buyerDateOfBirth: string
  buyerGender: string
  buyerCity: string
  buyerState: string
  buyerZip: string
  buyerCountry: string
  buyerExternalId: string
  buyerFbLoginId: string
  fbp: string
  fbc: string
  value: number
  currency: string
  receivedAt: string
  validHottok: boolean
  payload: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nestedString(record: Record<string, unknown>, path: string[]): string {
  let current: unknown = record
  for (const key of path) {
    current = asRecord(current)[key]
  }
  return typeof current === 'string' || typeof current === 'number' ? String(current) : ''
}

function nestedRecord(record: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let current: unknown = record
  for (const key of path) {
    current = asRecord(current)[key]
  }
  return asRecord(current)
}

function firstNestedString(record: Record<string, unknown>, paths: string[][]): string {
  for (const path of paths) {
    const value = nestedString(record, path).trim()
    if (value) return value
  }
  return ''
}

function firstNestedRecord(record: Record<string, unknown>, paths: string[][]): Record<string, unknown> {
  for (const path of paths) {
    const value = nestedRecord(record, path)
    if (Object.keys(value).length) return value
  }
  return {}
}

function nestedNumber(record: Record<string, unknown>, path: string[]): number {
  let current: unknown = record
  for (const key of path) {
    current = asRecord(current)[key]
  }
  return typeof current === 'number' ? current : Number(current || 0)
}

function hotmartEvent(payload: Record<string, unknown>): string {
  return nestedString(payload, ['event']) || nestedString(payload, ['event_type']) || 'unknown'
}

function purchaseStatus(payload: Record<string, unknown>): string {
  return nestedString(payload, ['data', 'purchase', 'status']) || nestedString(payload, ['purchase', 'status']) || ''
}

function isApprovedPurchase(record: Pick<HotmartWebhookRecord, 'event' | 'purchaseStatus'>): boolean {
  const event = record.event.toUpperCase()
  const status = record.purchaseStatus.toUpperCase()
  return event === 'PURCHASE_APPROVED' || status === 'APPROVED'
}

function recordId(payload: Record<string, unknown>, receivedAt: string): string {
  const transaction =
    nestedString(payload, ['data', 'purchase', 'transaction']) ||
    nestedString(payload, ['purchase', 'transaction']) ||
    JSON.stringify(payload).slice(0, 500)
  return crypto.createHash('sha256').update(`hotmart:${transaction}:${hotmartEvent(payload)}:${receivedAt}`).digest('hex')
}

function validateHottok(headers: Record<string, string | string[] | undefined>): boolean {
  const expected = process.env.HOTMART_HOTTOK || process.env.CHECKOUT_WEBHOOK_SECRET
  if (!expected) return true

  const received = headers['x-hotmart-hottok']
  const value = Array.isArray(received) ? received[0] : received
  return value === expected
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

function emailDomain(email: string): string {
  const parts = email.split('@')
  return parts.length === 2 ? parts[1].toLowerCase() : ''
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
  }
}

function phoneFromRecord(record: Record<string, unknown>): string {
  const country =
    nestedString(record, ['country_code']) ||
    nestedString(record, ['countryCode']) ||
    nestedString(record, ['ddi'])
  const area =
    nestedString(record, ['area_code']) ||
    nestedString(record, ['areaCode']) ||
    nestedString(record, ['ddd'])
  const number =
    nestedString(record, ['number']) ||
    nestedString(record, ['phone_number']) ||
    nestedString(record, ['phoneNumber'])

  return `${country}${area}${number}`.replace(/\D/g, '')
}

function hotmartBuyerPhone(payload: Record<string, unknown>): string {
  const explicitPhone = firstNestedString(payload, [
    ['data', 'buyer', 'checkout_phone'],
    ['data', 'buyer', 'phone'],
    ['data', 'buyer', 'phone_number'],
    ['data', 'buyer', 'phoneNumber'],
    ['buyer', 'checkout_phone'],
    ['buyer', 'phone'],
    ['buyer', 'phone_number'],
    ['buyer', 'phoneNumber'],
  ])
  if (explicitPhone) return explicitPhone

  const phoneRecord = firstNestedRecord(payload, [
    ['data', 'buyer', 'phone'],
    ['data', 'buyer', 'checkout_phone'],
    ['buyer', 'phone'],
    ['buyer', 'checkout_phone'],
  ])
  return phoneFromRecord(phoneRecord)
}

function hotmartFbc(payload: Record<string, unknown>, receivedAt: string): string {
  const explicitFbc = firstNestedString(payload, [
    ['data', 'purchase', 'tracking', 'fbc'],
    ['data', 'tracking', 'fbc'],
    ['tracking', 'fbc'],
    ['fbc'],
  ])
  if (explicitFbc) return explicitFbc

  const fbclid = firstNestedString(payload, [
    ['data', 'purchase', 'tracking', 'fbclid'],
    ['data', 'tracking', 'fbclid'],
    ['tracking', 'fbclid'],
    ['fbclid'],
  ])
  if (!fbclid) return ''

  const timestampMs = new Date(receivedAt).getTime()
  return `fb.1.${Number.isFinite(timestampMs) ? timestampMs : Date.now()}.${fbclid}`
}

function hotmartFbp(payload: Record<string, unknown>): string {
  return firstNestedString(payload, [
    ['data', 'purchase', 'tracking', 'fbp'],
    ['data', 'tracking', 'fbp'],
    ['tracking', 'fbp'],
    ['fbp'],
  ])
}

function hotmartFbLoginId(payload: Record<string, unknown>): string {
  return firstNestedString(payload, [
    ['data', 'purchase', 'tracking', 'fb_login_id'],
    ['data', 'purchase', 'tracking', 'fbLoginId'],
    ['data', 'tracking', 'fb_login_id'],
    ['data', 'tracking', 'fbLoginId'],
    ['data', 'buyer', 'fb_login_id'],
    ['data', 'buyer', 'fbLoginId'],
    ['buyer', 'fb_login_id'],
    ['buyer', 'fbLoginId'],
    ['tracking', 'fb_login_id'],
    ['tracking', 'fbLoginId'],
    ['fb_login_id'],
    ['fbLoginId'],
  ])
}

function hotmartBuyerFields(payload: Record<string, unknown>, receivedAt: string) {
  const fullName = firstNestedString(payload, [
    ['data', 'buyer', 'name'],
    ['buyer', 'name'],
  ])
  const split = splitName(fullName)
  const email = firstNestedString(payload, [
    ['data', 'buyer', 'email'],
    ['buyer', 'email'],
  ])
  const phone = hotmartBuyerPhone(payload)
  const externalId = firstNestedString(payload, [
    ['data', 'buyer', 'id'],
    ['data', 'buyer', 'ucode'],
    ['data', 'buyer', 'code'],
    ['data', 'buyer', 'document'],
    ['data', 'buyer', 'document_number'],
    ['data', 'buyer', 'documentNumber'],
    ['data', 'buyer', 'cpf'],
    ['data', 'buyer', 'cpf_cnpj'],
    ['data', 'buyer', 'cpfCnpj'],
    ['buyer', 'id'],
    ['buyer', 'ucode'],
    ['buyer', 'code'],
    ['buyer', 'document'],
    ['buyer', 'document_number'],
    ['buyer', 'documentNumber'],
    ['buyer', 'cpf'],
    ['buyer', 'cpf_cnpj'],
    ['buyer', 'cpfCnpj'],
  ]) || email || phone

  return {
    buyerEmail: email,
    buyerPhone: phone,
    buyerFirstName: firstNestedString(payload, [
      ['data', 'buyer', 'first_name'],
      ['data', 'buyer', 'firstName'],
      ['buyer', 'first_name'],
      ['buyer', 'firstName'],
    ]) || split.firstName,
    buyerLastName: firstNestedString(payload, [
      ['data', 'buyer', 'last_name'],
      ['data', 'buyer', 'lastName'],
      ['buyer', 'last_name'],
      ['buyer', 'lastName'],
    ]) || split.lastName,
    buyerDateOfBirth: firstNestedString(payload, [
      ['data', 'buyer', 'birth_date'],
      ['data', 'buyer', 'birthDate'],
      ['data', 'buyer', 'date_of_birth'],
      ['data', 'buyer', 'dateOfBirth'],
      ['data', 'buyer', 'birthday'],
      ['data', 'buyer', 'birth'],
      ['buyer', 'birth_date'],
      ['buyer', 'birthDate'],
      ['buyer', 'date_of_birth'],
      ['buyer', 'dateOfBirth'],
      ['buyer', 'birthday'],
      ['buyer', 'birth'],
    ]),
    buyerGender: firstNestedString(payload, [
      ['data', 'buyer', 'gender'],
      ['data', 'buyer', 'sex'],
      ['buyer', 'gender'],
      ['buyer', 'sex'],
    ]),
    buyerCity: firstNestedString(payload, [
      ['data', 'buyer', 'address', 'city'],
      ['data', 'buyer', 'address', 'city_name'],
      ['data', 'buyer', 'address', 'cityName'],
      ['data', 'buyer', 'address', 'city', 'name'],
      ['data', 'buyer', 'city'],
      ['data', 'buyer', 'city_name'],
      ['data', 'buyer', 'cityName'],
      ['buyer', 'address', 'city'],
      ['buyer', 'address', 'city_name'],
      ['buyer', 'address', 'cityName'],
      ['buyer', 'address', 'city', 'name'],
      ['buyer', 'city'],
      ['buyer', 'city_name'],
      ['buyer', 'cityName'],
    ]),
    buyerState: firstNestedString(payload, [
      ['data', 'buyer', 'address', 'state'],
      ['data', 'buyer', 'address', 'state_code'],
      ['data', 'buyer', 'address', 'stateCode'],
      ['data', 'buyer', 'address', 'state', 'code'],
      ['data', 'buyer', 'address', 'state', 'uf'],
      ['data', 'buyer', 'address', 'state', 'name'],
      ['data', 'buyer', 'address', 'province'],
      ['data', 'buyer', 'address', 'province_code'],
      ['data', 'buyer', 'address', 'provinceCode'],
      ['data', 'buyer', 'state'],
      ['data', 'buyer', 'state_code'],
      ['data', 'buyer', 'stateCode'],
      ['data', 'buyer', 'state', 'code'],
      ['data', 'buyer', 'state', 'uf'],
      ['buyer', 'address', 'state'],
      ['buyer', 'address', 'state_code'],
      ['buyer', 'address', 'stateCode'],
      ['buyer', 'address', 'state', 'code'],
      ['buyer', 'address', 'state', 'uf'],
      ['buyer', 'address', 'state', 'name'],
      ['buyer', 'address', 'province'],
      ['buyer', 'address', 'province_code'],
      ['buyer', 'address', 'provinceCode'],
      ['buyer', 'state'],
      ['buyer', 'state_code'],
      ['buyer', 'stateCode'],
      ['buyer', 'state', 'code'],
      ['buyer', 'state', 'uf'],
    ]),
    buyerZip: firstNestedString(payload, [
      ['data', 'buyer', 'address', 'zipcode'],
      ['data', 'buyer', 'address', 'zip_code'],
      ['data', 'buyer', 'address', 'zipCode'],
      ['data', 'buyer', 'address', 'postal_code'],
      ['data', 'buyer', 'address', 'postalCode'],
      ['data', 'buyer', 'address', 'cep'],
      ['data', 'buyer', 'zipcode'],
      ['data', 'buyer', 'zip_code'],
      ['data', 'buyer', 'zipCode'],
      ['data', 'buyer', 'postal_code'],
      ['data', 'buyer', 'postalCode'],
      ['data', 'buyer', 'cep'],
      ['buyer', 'address', 'zipcode'],
      ['buyer', 'address', 'zip_code'],
      ['buyer', 'address', 'zipCode'],
      ['buyer', 'address', 'postal_code'],
      ['buyer', 'address', 'postalCode'],
      ['buyer', 'address', 'cep'],
      ['buyer', 'zipcode'],
      ['buyer', 'zip_code'],
      ['buyer', 'zipCode'],
      ['buyer', 'postal_code'],
      ['buyer', 'postalCode'],
      ['buyer', 'cep'],
    ]),
    buyerCountry: firstNestedString(payload, [
      ['data', 'buyer', 'address', 'country'],
      ['data', 'buyer', 'address', 'country_code'],
      ['data', 'buyer', 'address', 'countryCode'],
      ['data', 'buyer', 'address', 'country_iso'],
      ['data', 'buyer', 'address', 'countryIso'],
      ['data', 'buyer', 'address', 'countryISO'],
      ['data', 'buyer', 'address', 'country', 'code'],
      ['data', 'buyer', 'address', 'country', 'iso'],
      ['data', 'buyer', 'address', 'country', 'name'],
      ['data', 'buyer', 'country'],
      ['data', 'buyer', 'country_code'],
      ['data', 'buyer', 'countryCode'],
      ['data', 'buyer', 'country_iso'],
      ['data', 'buyer', 'countryIso'],
      ['data', 'buyer', 'countryISO'],
      ['buyer', 'address', 'country'],
      ['buyer', 'address', 'country_code'],
      ['buyer', 'address', 'countryCode'],
      ['buyer', 'address', 'country_iso'],
      ['buyer', 'address', 'countryIso'],
      ['buyer', 'address', 'countryISO'],
      ['buyer', 'address', 'country', 'code'],
      ['buyer', 'address', 'country', 'iso'],
      ['buyer', 'address', 'country', 'name'],
      ['buyer', 'country'],
      ['buyer', 'country_code'],
      ['buyer', 'countryCode'],
      ['buyer', 'country_iso'],
      ['buyer', 'countryIso'],
      ['buyer', 'countryISO'],
    ]) || 'BR',
    buyerExternalId: externalId,
    buyerFbLoginId: hotmartFbLoginId(payload),
    fbp: hotmartFbp(payload),
    fbc: hotmartFbc(payload, receivedAt),
  }
}

function matchingFieldPresence(record: HotmartWebhookRecord): Record<string, boolean> {
  return {
    em: Boolean(record.buyerEmail),
    ph: Boolean(record.buyerPhone),
    fn: Boolean(record.buyerFirstName),
    ln: Boolean(record.buyerLastName),
    db: Boolean(record.buyerDateOfBirth),
    ge: Boolean(record.buyerGender),
    ct: Boolean(record.buyerCity),
    st: Boolean(record.buyerState),
    zp: Boolean(record.buyerZip),
    country: Boolean(record.buyerCountry),
    external_id: Boolean(record.buyerExternalId || record.transaction),
    fb_login_id: Boolean(record.buyerFbLoginId),
    fbp: Boolean(record.fbp),
    fbc: Boolean(record.fbc),
  }
}

function safeRecord(record: HotmartWebhookRecord): Record<string, unknown> {
  const {
    buyerEmail,
    buyerPhone,
    buyerFirstName,
    buyerLastName,
    buyerDateOfBirth,
    buyerGender,
    buyerCity,
    buyerState,
    buyerZip,
    buyerCountry,
    buyerExternalId,
    buyerFbLoginId,
    payload,
    ...safe
  } = record
  return {
    ...safe,
    buyerEmailHash: buyerEmail ? sha256(buyerEmail) : '',
    buyerEmailDomain: buyerEmail ? emailDomain(buyerEmail) : '',
    buyerPhoneHash: buyerPhone ? sha256(buyerPhone) : '',
    buyerFirstNameHash: buyerFirstName ? sha256(buyerFirstName) : '',
    buyerLastNameHash: buyerLastName ? sha256(buyerLastName) : '',
    buyerDateOfBirthHash: buyerDateOfBirth ? sha256(buyerDateOfBirth) : '',
    buyerGenderHash: buyerGender ? sha256(buyerGender) : '',
    buyerCityHash: buyerCity ? sha256(buyerCity) : '',
    buyerStateHash: buyerState ? sha256(buyerState) : '',
    buyerZipHash: buyerZip ? sha256(buyerZip) : '',
    buyerCountryHash: buyerCountry ? sha256(buyerCountry) : '',
    buyerExternalIdHash: buyerExternalId ? sha256(buyerExternalId) : '',
    buyerFbLoginIdPresent: Boolean(buyerFbLoginId),
    matchingFieldPresence: matchingFieldPresence(record),
    payloadSummary: {
      event: record.event,
      purchaseStatus: record.purchaseStatus,
      transaction: record.transaction,
      productId: record.productId,
      productName: record.productName,
      value: record.value,
      currency: record.currency,
    },
  }
}

function isRefundEvent(record: HotmartWebhookRecord): boolean {
  const event = record.event.toUpperCase()
  const status = record.purchaseStatus.toUpperCase()
  return event.includes('REFUND') || event.includes('CHARGEBACK') || status.includes('REFUND') || status.includes('CHARGEBACK')
}

async function syncCheckoutEventToSupabase(record: HotmartWebhookRecord): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return

  await insertRows({
    table: 'checkout_events',
    rows: [{
      id: record.id,
      provider: record.provider,
      event_name: record.event,
      purchase_status: record.purchaseStatus,
      transaction_id: record.transaction || null,
      product_id: record.productId || null,
      product_name: record.productName || null,
      buyer_email_hash: record.buyerEmail ? sha256(record.buyerEmail) : null,
      buyer_phone_hash: record.buyerPhone ? sha256(record.buyerPhone) : null,
      value: record.value || 0,
      currency: record.currency || 'BRL',
      is_approved_purchase: isApprovedPurchase(record),
      is_refund: isRefundEvent(record),
      payload: safeRecord(record),
      received_at: record.receivedAt,
    }],
  })
}

async function syncApprovedPurchaseToMeta(record: HotmartWebhookRecord): Promise<void> {
  if (!isApprovedPurchase(record)) return

  if (process.env.ENABLE_HOTMART_PURCHASE_CAPI !== 'true') {
    logger.info('Hotmart Purchase aprovado sem reenvio CAPI pela agencia; Hotmart e a fonte do Purchase', {
      transaction: record.transaction,
      productId: record.productId,
    })
    return
  }

  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PIXEL_ID || !process.env.META_AD_ACCOUNT_ID) {
    logger.warn('Hotmart Purchase aprovado sem envio CAPI: Meta Ads nao configurado', {
      transaction: record.transaction,
      productId: record.productId,
    })
    return
  }

  try {
    const matchingFields = matchingFieldPresence(record)
    if (!record.buyerEmail && !record.buyerPhone) {
      logger.warn('Hotmart Purchase sem email/telefone no webhook; CAPI sera enviado com identificadores fracos', {
        transaction: record.transaction,
        productId: record.productId,
        matchingFields,
      })
    }

    const response = await sendMetaCapiEvent({
      eventName: 'Purchase',
      eventId: `hotmart_purchase_${record.transaction || record.id}`,
      eventTime: Math.floor(new Date(record.receivedAt).getTime() / 1000),
      eventSourceUrl: process.env.TRACKING_EVENT_SOURCE_URL || process.env.PUBLIC_FUNNEL_URL,
      email: record.buyerEmail,
      phone: record.buyerPhone,
      firstName: record.buyerFirstName,
      lastName: record.buyerLastName,
      dateOfBirth: record.buyerDateOfBirth,
      gender: record.buyerGender,
      city: record.buyerCity,
      state: record.buyerState,
      zip: record.buyerZip,
      country: record.buyerCountry,
      externalId: record.buyerExternalId || record.transaction || record.id,
      fbLoginId: record.buyerFbLoginId,
      fbp: record.fbp,
      fbc: record.fbc,
      value: record.value,
      currency: record.currency || 'BRL',
      contentName: record.productName || 'Hotmart product',
      contentIds: record.productId ? [record.productId] : [],
      orderId: record.transaction,
      testEventCode: process.env.META_TEST_EVENT_CODE,
    })

    logger.info('Hotmart Purchase enviado para Meta CAPI', {
      transaction: record.transaction,
      productId: record.productId,
      matchingFields,
      response,
    })
  } catch (error) {
    logger.error('Falha ao enviar Hotmart Purchase para Meta CAPI', {
      transaction: record.transaction,
      productId: record.productId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function normalizeHotmartWebhook(
  payload: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>,
): HotmartWebhookRecord {
  const receivedAt = new Date().toISOString()
  const buyer = hotmartBuyerFields(payload, receivedAt)

  return {
    id: recordId(payload, receivedAt),
    provider: 'hotmart',
    event: hotmartEvent(payload),
    purchaseStatus: purchaseStatus(payload),
    transaction:
      nestedString(payload, ['data', 'purchase', 'transaction']) ||
      nestedString(payload, ['purchase', 'transaction']),
    productId:
      nestedString(payload, ['data', 'product', 'id']) ||
      nestedString(payload, ['product', 'id']),
    productName:
      nestedString(payload, ['data', 'product', 'name']) ||
      nestedString(payload, ['product', 'name']),
    buyerEmail: buyer.buyerEmail,
    buyerPhone: buyer.buyerPhone,
    buyerFirstName: buyer.buyerFirstName,
    buyerLastName: buyer.buyerLastName,
    buyerDateOfBirth: buyer.buyerDateOfBirth,
    buyerGender: buyer.buyerGender,
    buyerCity: buyer.buyerCity,
    buyerState: buyer.buyerState,
    buyerZip: buyer.buyerZip,
    buyerCountry: buyer.buyerCountry,
    buyerExternalId: buyer.buyerExternalId,
    buyerFbLoginId: buyer.buyerFbLoginId,
    fbp: buyer.fbp,
    fbc: buyer.fbc,
    value:
      nestedNumber(payload, ['data', 'purchase', 'price', 'value']) ||
      nestedNumber(payload, ['data', 'purchase', 'full_price', 'value']) ||
      nestedNumber(payload, ['purchase', 'price', 'value']),
    currency:
      nestedString(payload, ['data', 'purchase', 'price', 'currency_value']) ||
      nestedString(payload, ['data', 'purchase', 'full_price', 'currency_value']) ||
      'BRL',
    receivedAt,
    validHottok: validateHottok(headers),
    payload,
  }
}

export async function persistHotmartWebhook(record: HotmartWebhookRecord): Promise<void> {
  await ensureDir('data/checkout/hotmart')
  await writeJson(`data/checkout/hotmart/${record.id}.json`, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: 0,
    },
    webhook: safeRecord(record),
  })

  await syncApprovedPurchaseToMeta(record)

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await syncCheckoutEventToSupabase(record)
      await insertRows({
        table: 'mcp_events',
        rows: [{
          id: crypto.randomUUID(),
          connector: 'checkout',
          agent_name: 'checkout-ops',
          action: 'hotmart.webhook.received',
          entity_type: 'checkout_event',
          entity_id: record.transaction || record.id,
          status: record.validHottok ? 'success' : 'failed',
          payload: safeRecord(record),
          created_at: record.receivedAt,
        }],
      })
    } catch (error) {
      logger.warn('Hotmart webhook recebido, mas falhou ao sincronizar com Supabase', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
