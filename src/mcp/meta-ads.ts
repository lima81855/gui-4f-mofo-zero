import crypto from 'crypto'
import { getConnectorHealth } from './registry'
import { logger } from '../utils/logger'

type MetaConfig = {
  accessToken: string
  adAccountId: string
  pixelId: string
  apiVersion: string
}

export type MetaAdAccount = {
  id: string
  name?: string
  account_status?: number
  currency?: string
  timezone_name?: string
}

export type MetaCampaign = {
  id: string
  name: string
  status?: string
  effective_status?: string
  objective?: string
  created_time?: string
  updated_time?: string
}

export type MetaInsight = {
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id?: string
  ad_name?: string
  age?: string
  gender?: string
  country?: string
  region?: string
  publisher_platform?: string
  platform_position?: string
  impression_device?: string
  impressions?: string
  reach?: string
  frequency?: string
  clicks?: string
  inline_link_clicks?: string
  unique_clicks?: string
  spend?: string
  ctr?: string
  cpc?: string
  cpm?: string
  actions?: Array<{ action_type: string; value: string }>
  action_values?: Array<{ action_type: string; value: string }>
  date_start?: string
  date_stop?: string
}

export type MetaCapiEvent = {
  eventName: 'PageView' | 'ViewContent' | 'InitiateCheckout' | 'Purchase' | 'Lead' | 'CompleteRegistration'
  eventId: string
  eventTime?: number
  eventSourceUrl?: string
  actionSource?: 'website'
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  gender?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  externalId?: string
  fbLoginId?: string
  clientIpAddress?: string
  clientUserAgent?: string
  fbp?: string
  fbc?: string
  value?: number
  currency?: string
  contentName?: string
  contentIds?: string[]
  orderId?: string
  testEventCode?: string
}

function getConfig(): MetaConfig {
  const accessToken = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  const pixelId = process.env.META_PIXEL_ID
  const apiVersion = process.env.META_API_VERSION || 'v25.0'

  if (!accessToken || !adAccountId || !pixelId) {
    throw new Error('META_ACCESS_TOKEN, META_AD_ACCOUNT_ID e META_PIXEL_ID precisam estar configurados')
  }

  return {
    accessToken,
    adAccountId: adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`,
    pixelId,
    apiVersion,
  }
}

function graphBase(config: MetaConfig): string {
  return `https://graph.facebook.com/${config.apiVersion}`
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function normalizePhone(value: string): string {
  const digits = normalizeDigits(value)
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) return `55${digits}`
  return digits
}

function normalizeDateOfBirth(value: string): string {
  const trimmed = value.trim()
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0')
    const month = slashMatch[2].padStart(2, '0')
    return `${slashMatch[3]}${month}${day}`
  }

  const digits = normalizeDigits(value)
  if (digits.length !== 8) return ''
  if (digits.startsWith('19') || digits.startsWith('20')) return digits
  return `${digits.slice(4)}${digits.slice(2, 4)}${digits.slice(0, 2)}`
}

function normalizeGender(value: string): string {
  const normalized = normalizeText(value)
  if (['m', 'male', 'masculino', 'homem'].includes(normalized)) return 'm'
  if (['f', 'female', 'feminino', 'mulher'].includes(normalized)) return 'f'
  return ''
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function normalizeCountry(value: string): string {
  const normalized = normalizeText(value)
  if (normalized === 'brasil' || normalized === 'brazil') return 'br'
  return normalized.slice(0, 2)
}

function hashMetaValue(value: string | undefined, normalizer: (input: string) => string): string | undefined {
  if (!value) return undefined
  const normalized = normalizer(value)
  return normalized ? sha256(normalized) : undefined
}

function addAccessToken(params: URLSearchParams, accessToken: string): URLSearchParams {
  params.set('access_token', accessToken)
  return params
}

async function graphGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const config = getConfig()
  const search = addAccessToken(new URLSearchParams(params), config.accessToken)
  const response = await fetch(`${graphBase(config)}/${path}?${search.toString()}`)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Meta Graph GET falhou ${response.status}: ${body}`)
  }

  return response.json() as Promise<T>
}

async function graphPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const config = getConfig()
  const response = await fetch(`${graphBase(config)}/${path}?access_token=${encodeURIComponent(config.accessToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Meta Graph POST falhou ${response.status}: ${body}`)
  }

  return response.json() as Promise<T>
}

export function getMetaAdsHealth() {
  return getConnectorHealth('meta-ads')
}

export async function getMetaAdAccount(): Promise<MetaAdAccount> {
  const config = getConfig()
  logger.info('Meta Ads MCP - validando conta de anuncios')
  return graphGet<MetaAdAccount>(config.adAccountId, {
    fields: 'id,name,account_status,currency,timezone_name',
  })
}

export async function listMetaCampaigns(limit = 25): Promise<MetaCampaign[]> {
  const config = getConfig()
  const result = await graphGet<{ data: MetaCampaign[] }>(`${config.adAccountId}/campaigns`, {
    fields: 'id,name,status,effective_status,objective,created_time,updated_time',
    limit: String(limit),
  })
  return result.data || []
}

export async function getMetaInsights(options: {
  level?: 'campaign' | 'adset' | 'ad'
  datePreset?: string
  timeRange?: { since: string; until: string }
  limit?: number
  breakdowns?: string[]
} = {}): Promise<MetaInsight[]> {
  const config = getConfig()
  const params: Record<string, string> = {
    level: options.level || 'campaign',
    fields: [
      'campaign_id',
      'campaign_name',
      'adset_id',
      'adset_name',
      'ad_id',
      'ad_name',
      'impressions',
      'reach',
      'frequency',
      'clicks',
      'inline_link_clicks',
      'unique_clicks',
      'spend',
      'ctr',
      'cpc',
      'cpm',
      'actions',
      'action_values',
      'date_start',
      'date_stop',
    ].join(','),
    limit: String(options.limit || 50),
  }

  if (options.timeRange) {
    params.time_range = JSON.stringify(options.timeRange)
  } else {
    params.date_preset = options.datePreset || 'last_7d'
  }

  if (options.breakdowns && options.breakdowns.length > 0) {
    params.breakdowns = options.breakdowns.join(',')
  }

  const result = await graphGet<{ data: MetaInsight[] }>(`${config.adAccountId}/insights`, params)
  return result.data || []
}

export async function sendMetaCapiEvent(event: MetaCapiEvent): Promise<unknown> {
  const config = getConfig()
  const userData: Record<string, unknown> = {}

  const email = hashMetaValue(event.email, normalizeEmail)
  const phone = hashMetaValue(event.phone, normalizePhone)
  const firstName = hashMetaValue(event.firstName, normalizeText)
  const lastName = hashMetaValue(event.lastName, normalizeText)
  const dateOfBirth = hashMetaValue(event.dateOfBirth, normalizeDateOfBirth)
  const gender = hashMetaValue(event.gender, normalizeGender)
  const city = hashMetaValue(event.city, normalizeText)
  const state = hashMetaValue(event.state, normalizeText)
  const zip = hashMetaValue(event.zip, normalizeDigits)
  const country = hashMetaValue(event.country, normalizeCountry)
  const externalId = hashMetaValue(event.externalId, normalizeText)

  if (email) userData.em = [email]
  if (phone) userData.ph = [phone]
  if (firstName) userData.fn = [firstName]
  if (lastName) userData.ln = [lastName]
  if (dateOfBirth) userData.db = [dateOfBirth]
  if (gender) userData.ge = [gender]
  if (city) userData.ct = [city]
  if (state) userData.st = [state]
  if (zip) userData.zp = [zip]
  if (country) userData.country = [country]
  if (externalId) userData.external_id = [externalId]
  if (event.fbLoginId) userData.fb_login_id = event.fbLoginId
  if (event.clientIpAddress) userData.client_ip_address = event.clientIpAddress
  if (event.clientUserAgent) userData.client_user_agent = event.clientUserAgent
  if (event.fbp) userData.fbp = event.fbp
  if (event.fbc) userData.fbc = event.fbc

  const customData: Record<string, unknown> = {}
  if (event.value !== undefined) customData.value = event.value
  if (event.currency) customData.currency = event.currency
  if (event.contentName) customData.content_name = event.contentName
  if (event.contentIds?.length) customData.content_ids = event.contentIds
  if (event.contentIds?.length) customData.content_type = 'product'
  if (event.orderId) customData.order_id = event.orderId

  return graphPost(`${config.pixelId}/events`, {
    data: [{
      event_name: event.eventName,
      event_time: event.eventTime || Math.floor(Date.now() / 1000),
      event_id: event.eventId,
      event_source_url: event.eventSourceUrl,
      action_source: event.actionSource || 'website',
      user_data: userData,
      custom_data: customData,
    }],
    ...(event.testEventCode ? { test_event_code: event.testEventCode } : {}),
  })
}

export async function validateMetaAdsConnection(): Promise<{
  account: MetaAdAccount
  campaignCount: number
  insightRows: number
}> {
  const account = await getMetaAdAccount()
  const campaigns = await listMetaCampaigns(10)
  const insights = await getMetaInsights({ level: 'campaign', datePreset: 'last_7d', limit: 10 })

  return {
    account,
    campaignCount: campaigns.length,
    insightRows: insights.length,
  }
}
