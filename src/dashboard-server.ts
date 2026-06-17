import http, { IncomingMessage, Server, ServerResponse } from 'http'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { URL } from 'url'
import { CeoDecisionSchema, ValidatedIdea, ValidatedIdeaSchema } from './types'
import { logger } from './utils/logger'
import { ensureDir, readJson, readTextOrNull, writeJson, writeText } from './mcp/filesystem'
import { normalizeHotmartWebhook, persistHotmartWebhook } from './mcp/hotmart'
import { getCheckoutMetricsSummary } from './mcp/checkout-metrics'
import { getPerformanceSnapshot } from './mcp/performance-decision'
import { getPerformanceActionPlan } from './mcp/performance-controller'
import { getGoLiveChecklist } from './mcp/go-live-checklist'
import { getLiveMediaReport } from './mcp/live-media-report'
import { getValueRulesBreakdownReport } from './mcp/value-rules-breakdown'
import { MetaCapiEvent, sendMetaCapiEvent } from './mcp/meta-ads'

const PROJECT_ROOT = path.resolve(__dirname, '..')
const INDEX_PATH = 'data/validated-ideas/index.json'

type DashboardDecisionPayload = {
  ceoDecision: string
  ceoNotes?: string
}

type DashboardDecisionResponse = {
  ok: boolean
  idea?: ValidatedIdea
  webhookId?: string
  status?: string
  error?: string
}

type MetaBrowserEventPayload = {
  eventName?: string
  eventId?: string
  eventSourceUrl?: string
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
  fbp?: string
  fbc?: string
  value?: number
  currency?: string
  contentName?: string
  contentIds?: string[]
  testEventCode?: string
  trafficQuality?: TrafficQualitySignal
}

type TrafficQualitySignal = {
  sessionId?: string
  landingAt?: number
  timeOnPageMs?: number
  maxScrollPercent?: number
  interactionCount?: number
  checkoutIntentCount?: number
  visibilityChanges?: number
  pageHidden?: boolean
  hasFocus?: boolean
  language?: string
  timezone?: string
  screenWidth?: number
  screenHeight?: number
  colorDepth?: number
  devicePixelRatio?: number
  referrer?: string
  hasJavascript?: boolean
}

type TrafficQualityDecision = {
  mode: 'off' | 'monitor' | 'filter'
  score: number
  bucket: 'real' | 'suspect' | 'bot_like'
  reasons: string[]
  capiEligible: boolean
  wouldFilter: boolean
}

const META_BROWSER_EVENT_NAMES = new Set<MetaCapiEvent['eventName']>([
  'PageView',
  'ViewContent',
  'InitiateCheckout',
  'Lead',
  'CompleteRegistration',
])

const TRACKING_ALLOWED_ORIGINS = new Set([
  'https://www.doutorplanta.com',
  'https://doutorplanta.com',
])

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: DashboardDecisionResponse | Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function shortHash(value: string | undefined): string {
  return value ? sha256(value).slice(0, 16) : ''
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function trackingCorsHeaders(originHeader: string | undefined): Record<string, string> {
  const origin = originHeader || ''
  const allowedOrigin = TRACKING_ALLOWED_ORIGINS.has(origin) || origin.startsWith('http://localhost:')
    ? origin
    : 'https://www.doutorplanta.com'

  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'Origin',
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function getClientIp(req: IncomingMessage): string | undefined {
  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for'])
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim()
  return firstHeaderValue(req.headers['cf-connecting-ip'])
    || firstHeaderValue(req.headers['x-real-ip'])
    || req.socket.remoteAddress
}

function numberField(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : value !== undefined ? Number(value) : undefined
  return Number.isFinite(parsed) ? parsed : undefined
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeTrafficQualitySignal(value: unknown): TrafficQualitySignal | undefined {
  const signal = asRecord(value)
  if (!Object.keys(signal).length) return undefined

  const screen = asRecord(signal.screen)

  return {
    sessionId: typeof signal.sessionId === 'string' ? signal.sessionId.slice(0, 120) : undefined,
    landingAt: numberField(signal.landingAt),
    timeOnPageMs: numberField(signal.timeOnPageMs),
    maxScrollPercent: numberField(signal.maxScrollPercent),
    interactionCount: numberField(signal.interactionCount),
    checkoutIntentCount: numberField(signal.checkoutIntentCount),
    visibilityChanges: numberField(signal.visibilityChanges),
    pageHidden: booleanField(signal.pageHidden),
    hasFocus: booleanField(signal.hasFocus),
    language: typeof signal.language === 'string' ? signal.language.slice(0, 40) : undefined,
    timezone: typeof signal.timezone === 'string' ? signal.timezone.slice(0, 80) : undefined,
    screenWidth: numberField(signal.screenWidth) || numberField(screen.width),
    screenHeight: numberField(signal.screenHeight) || numberField(screen.height),
    colorDepth: numberField(signal.colorDepth),
    devicePixelRatio: numberField(signal.devicePixelRatio),
    referrer: typeof signal.referrer === 'string' ? signal.referrer.slice(0, 240) : undefined,
    hasJavascript: booleanField(signal.hasJavascript),
  }
}

function trafficQualityMode(): TrafficQualityDecision['mode'] {
  const mode = (process.env.TRAFFIC_QUALITY_GATE_MODE || 'monitor').toLowerCase()
  if (mode === 'off' || mode === 'filter') return mode
  return 'monitor'
}

function safeUrlHost(value: string | undefined): string {
  if (!value) return ''
  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

function scoreTrafficQuality(
  payload: MetaBrowserEventPayload,
  req: IncomingMessage,
): TrafficQualityDecision {
  const mode = trafficQualityMode()
  const signal = payload.trafficQuality
  const userAgent = firstHeaderValue(req.headers['user-agent']) || ''
  const reasons: string[] = []
  let score = 50

  const eventName = payload.eventName || 'unknown'
  const hasFbc = Boolean(payload.fbc)
  const hasFbp = Boolean(payload.fbp)
  const hasMetaClick = hasFbc || Boolean(payload.eventSourceUrl?.includes('fbclid='))
  const maxScroll = signal?.maxScrollPercent || 0
  const timeOnPageMs = signal?.timeOnPageMs || 0
  const interactions = signal?.interactionCount || 0
  const checkoutIntentCount = signal?.checkoutIntentCount || 0
  const screenWidth = signal?.screenWidth || 0
  const screenHeight = signal?.screenHeight || 0

  if (!userAgent) {
    score -= 30
    reasons.push('user_agent_ausente')
  } else if (/(bot|crawl|spider|headless|phantom|selenium|python|curl|wget|httpclient|scrapy)/i.test(userAgent)) {
    score -= 35
    reasons.push('user_agent_automatizado')
  } else {
    score += 8
    reasons.push('user_agent_plausivel')
  }

  if (signal?.hasJavascript) {
    score += 8
    reasons.push('javascript_executado')
  }

  if (hasMetaClick) {
    score += 14
    reasons.push('identificacao_clique_meta')
  }

  if (hasFbp) {
    score += 8
    reasons.push('identificacao_navegador_meta')
  }

  if (payload.externalId) {
    score += 6
    reasons.push('external_id_presente')
  }

  if (screenWidth >= 280 && screenHeight >= 480) {
    score += 6
    reasons.push('viewport_plausivel')
  } else if (screenWidth || screenHeight) {
    score -= 12
    reasons.push('viewport_suspeito')
  }

  if (signal?.language?.toLowerCase().startsWith('pt')) {
    score += 4
    reasons.push('idioma_pt')
  }

  if (signal?.timezone?.toLowerCase().includes('sao_paulo')) {
    score += 4
    reasons.push('timezone_brasil')
  }

  if (eventName !== 'PageView') {
    if (timeOnPageMs >= 3000) {
      score += 8
      reasons.push('tempo_minimo_ok')
    } else {
      score -= 12
      reasons.push('tempo_muito_curto')
    }

    if (maxScroll >= 10) {
      score += 8
      reasons.push('scroll_real')
    } else {
      score -= 10
      reasons.push('sem_scroll')
    }

    if (interactions > 0 || checkoutIntentCount > 0) {
      score += 8
      reasons.push('interacao_real')
    } else {
      score -= 8
      reasons.push('sem_interacao')
    }
  }

  if (eventName === 'InitiateCheckout') {
    if (checkoutIntentCount > 0) {
      score += 8
      reasons.push('intencao_checkout_confirmada')
    }

    if (timeOnPageMs < 1500 && maxScroll < 5) {
      score -= 20
      reasons.push('checkout_rapido_demais')
    }
  }

  if (!hasFbp && !hasFbc && eventName !== 'PageView') {
    score -= 12
    reasons.push('sem_fbp_fbc')
  }

  if (signal?.pageHidden === true && eventName !== 'PageView') {
    score -= 5
    reasons.push('pagina_oculta_no_evento')
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const bucket = score >= 65 ? 'real' : score >= 40 ? 'suspect' : 'bot_like'
  const wouldFilter = bucket === 'bot_like' && eventName !== 'PageView'
  const capiEligible = mode !== 'filter' || !wouldFilter

  return {
    mode,
    score,
    bucket,
    reasons,
    capiEligible,
    wouldFilter,
  }
}

async function persistTrafficQualityLog(
  payload: MetaBrowserEventPayload,
  req: IncomingMessage,
  quality: TrafficQualityDecision,
): Promise<void> {
  if (quality.mode === 'off') return

  const date = todayKey()
  const dir = 'data/tracking/traffic-quality'
  await ensureDir(dir)

  const entry = {
    recordedAt: new Date().toISOString(),
    eventName: payload.eventName,
    eventId: payload.eventId,
    sessionIdHash: shortHash(payload.trafficQuality?.sessionId),
    externalIdHash: shortHash(payload.externalId),
    ipHash: shortHash(getClientIp(req)),
    userAgentHash: shortHash(firstHeaderValue(req.headers['user-agent'])),
    sourceHost: safeUrlHost(payload.eventSourceUrl),
    referrerHost: safeUrlHost(payload.trafficQuality?.referrer),
    origin: firstHeaderValue(req.headers.origin) || '',
    quality,
    signals: {
      hasFbp: Boolean(payload.fbp),
      hasFbc: Boolean(payload.fbc),
      hasMetaClick: Boolean(payload.fbc || payload.eventSourceUrl?.includes('fbclid=')),
      timeOnPageMs: payload.trafficQuality?.timeOnPageMs || 0,
      maxScrollPercent: payload.trafficQuality?.maxScrollPercent || 0,
      interactionCount: payload.trafficQuality?.interactionCount || 0,
      checkoutIntentCount: payload.trafficQuality?.checkoutIntentCount || 0,
      language: payload.trafficQuality?.language || '',
      timezone: payload.trafficQuality?.timezone || '',
      screenWidth: payload.trafficQuality?.screenWidth || 0,
      screenHeight: payload.trafficQuality?.screenHeight || 0,
    },
  }

  await fs.appendFile(path.join(PROJECT_ROOT, dir, `${date}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf-8')
}

async function readTrafficQualitySummary(date = todayKey()): Promise<Record<string, unknown>> {
  const filePath = path.join(PROJECT_ROOT, 'data/tracking/traffic-quality', `${date}.jsonl`)
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  const lines = content.split(/\r?\n/).filter(Boolean)
  const byBucket: Record<string, number> = { real: 0, suspect: 0, bot_like: 0 }
  const byEvent: Record<string, number> = {}
  let scoreSum = 0
  let wouldFilter = 0

  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { eventName?: string; quality?: { bucket?: string; score?: number; wouldFilter?: boolean } }
      const bucket = row.quality?.bucket || 'unknown'
      byBucket[bucket] = (byBucket[bucket] || 0) + 1
      const eventName = row.eventName || 'unknown'
      byEvent[eventName] = (byEvent[eventName] || 0) + 1
      scoreSum += Number(row.quality?.score || 0)
      if (row.quality?.wouldFilter) wouldFilter++
    } catch {
      continue
    }
  }

  return {
    date,
    totalEvents: lines.length,
    averageScore: lines.length ? Math.round(scoreSum / lines.length) : 0,
    mode: trafficQualityMode(),
    byBucket,
    byEvent,
    wouldFilter,
    note: trafficQualityMode() === 'filter'
      ? 'Modo filter ativo: eventos bot_like nao sao enviados pela CAPI, exceto PageView.'
      : 'Modo monitor ativo: nenhum evento e bloqueado; apenas medimos a qualidade.',
  }
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  }
  return types[ext] || 'application/octet-stream'
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  return raw ? JSON.parse(raw) : {}
}

async function handleHotmartWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = asRecord(await readBody(req))
    const webhook = normalizeHotmartWebhook(body, req.headers)

    if (!webhook.validHottok) {
      logger.warn('Webhook Hotmart rejeitado por Hottok invalido', {
        event: webhook.event,
        transaction: webhook.transaction,
      })
      sendJson(res, 401, { ok: false, error: 'Hottok invalido' })
      return
    }

    await persistHotmartWebhook(webhook)
    logger.info('Webhook Hotmart recebido', {
      webhookId: webhook.id,
      event: webhook.event,
      purchaseStatus: webhook.purchaseStatus,
      transaction: webhook.transaction,
    })
    sendJson(res, 200, { ok: true, webhookId: webhook.id, status: 'received' })
  } catch (error) {
    logger.error('Falha ao processar webhook Hotmart', {
      error: error instanceof Error ? error.message : String(error),
    })
    sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Payload invalido',
    })
  }
}

function normalizeMetaBrowserPayload(body: Record<string, unknown>): MetaBrowserEventPayload {
  const contentIds = Array.isArray(body.contentIds)
    ? body.contentIds.map(String).filter(Boolean)
    : undefined

  const value = typeof body.value === 'number'
    ? body.value
    : body.value !== undefined
      ? Number(body.value)
      : undefined

  return {
    eventName: typeof body.eventName === 'string' ? body.eventName : undefined,
    eventId: typeof body.eventId === 'string' ? body.eventId : undefined,
    eventSourceUrl: typeof body.eventSourceUrl === 'string' ? body.eventSourceUrl : undefined,
    email: typeof body.email === 'string' ? body.email : undefined,
    phone: typeof body.phone === 'string' ? body.phone : undefined,
    firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
    lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
    dateOfBirth: typeof body.dateOfBirth === 'string' ? body.dateOfBirth : undefined,
    gender: typeof body.gender === 'string' ? body.gender : undefined,
    city: typeof body.city === 'string' ? body.city : undefined,
    state: typeof body.state === 'string' ? body.state : undefined,
    zip: typeof body.zip === 'string' ? body.zip : undefined,
    country: typeof body.country === 'string' ? body.country : undefined,
    externalId: typeof body.externalId === 'string' ? body.externalId : undefined,
    fbLoginId: typeof body.fbLoginId === 'string' ? body.fbLoginId : undefined,
    fbp: typeof body.fbp === 'string' ? body.fbp : undefined,
    fbc: typeof body.fbc === 'string' ? body.fbc : undefined,
    value: Number.isFinite(value) ? value : undefined,
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    contentName: typeof body.contentName === 'string' ? body.contentName : undefined,
    contentIds,
    testEventCode: typeof body.testEventCode === 'string' ? body.testEventCode : undefined,
    trafficQuality: normalizeTrafficQualitySignal(body.trafficQuality),
  }
}

async function handleMetaBrowserEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const corsHeaders = trackingCorsHeaders(firstHeaderValue(req.headers.origin))

  try {
    const payload = normalizeMetaBrowserPayload(asRecord(await readBody(req)))

    if (!payload.eventName || !META_BROWSER_EVENT_NAMES.has(payload.eventName as MetaCapiEvent['eventName'])) {
      sendJson(res, 400, { ok: false, error: 'Evento Meta invalido' }, corsHeaders)
      return
    }

    if (!payload.eventId) {
      sendJson(res, 400, { ok: false, error: 'eventId obrigatorio para deduplicacao' }, corsHeaders)
      return
    }

    const quality = scoreTrafficQuality(payload, req)
    await persistTrafficQualityLog(payload, req, quality)

    if (!quality.capiEligible) {
      logger.warn('Evento browser medido como bot_like e nao enviado para Meta CAPI', {
        eventName: payload.eventName,
        eventId: payload.eventId,
        quality,
      })
      sendJson(res, 200, { ok: true, status: 'skipped_by_quality_gate', quality }, corsHeaders)
      return
    }

    const result = await sendMetaCapiEvent({
      eventName: payload.eventName as MetaCapiEvent['eventName'],
      eventId: payload.eventId,
      eventSourceUrl: payload.eventSourceUrl,
      email: payload.email,
      phone: payload.phone,
      firstName: payload.firstName,
      lastName: payload.lastName,
      dateOfBirth: payload.dateOfBirth,
      gender: payload.gender,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      country: payload.country,
      externalId: payload.externalId,
      fbLoginId: payload.fbLoginId,
      clientIpAddress: getClientIp(req),
      clientUserAgent: firstHeaderValue(req.headers['user-agent']),
      fbp: payload.fbp,
      fbc: payload.fbc,
      value: payload.value,
      currency: payload.currency,
      contentName: payload.contentName,
      contentIds: payload.contentIds,
      testEventCode: payload.testEventCode || process.env.META_TEST_EVENT_CODE,
    })

    logger.info('Evento browser espelhado para Meta CAPI', {
      eventName: payload.eventName,
      eventId: payload.eventId,
      quality,
      matchingFields: {
        em: Boolean(payload.email),
        ph: Boolean(payload.phone),
        fn: Boolean(payload.firstName),
        ln: Boolean(payload.lastName),
        db: Boolean(payload.dateOfBirth),
        ge: Boolean(payload.gender),
        ct: Boolean(payload.city),
        st: Boolean(payload.state),
        zp: Boolean(payload.zip),
        country: Boolean(payload.country),
        external_id: Boolean(payload.externalId),
        fb_login_id: Boolean(payload.fbLoginId),
      },
      hasFbp: Boolean(payload.fbp),
      hasFbc: Boolean(payload.fbc),
    })
    sendJson(res, 200, { ok: true, status: 'sent', quality, result: result as Record<string, unknown> }, corsHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Falha ao espelhar evento browser para Meta CAPI', {
      error: message,
    })
    sendJson(res, 500, { ok: false, error: 'Falha ao enviar evento para Meta CAPI', detail: message }, corsHeaders)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function updateMarkdownDecision(content: string, ceoDecision: string, ceoNotes: string): string {
  let updated = content
  if (/^---[\s\S]*?\n---/.test(updated)) {
    updated = updated.replace(/ceoDecision:\s*.*/m, `ceoDecision: ${ceoDecision}`)
  }

  const notesBlock = `**Notas do CEO:**\n${ceoNotes || '(em branco)'}`
  if (/\*\*Notas do CEO:\*\*[\s\S]*$/m.test(updated)) {
    return updated.replace(/\*\*Notas do CEO:\*\*[\s\S]*$/m, notesBlock)
  }

  return `${updated.trim()}\n\n${notesBlock}\n`
}

export async function updateCeoDecision(
  ideaId: string,
  payload: DashboardDecisionPayload,
): Promise<ValidatedIdea> {
  const ceoDecision = CeoDecisionSchema.parse(payload.ceoDecision)
  const ceoNotes = String(payload.ceoNotes || '').trim()
  const ideas = await readJson<ValidatedIdea[]>(INDEX_PATH)
  const index = ideas.findIndex(idea => idea.id === ideaId)

  if (index === -1) {
    throw new Error(`Ideia nao encontrada: ${ideaId}`)
  }

  const updatedIdea = ValidatedIdeaSchema.parse({
    ...ideas[index],
    ceoDecision,
    ceoNotes,
  })

  const updatedIdeas = [...ideas]
  updatedIdeas[index] = updatedIdea
  await writeJson(INDEX_PATH, updatedIdeas)

  const markdownPath = `data/validated-ideas/${ideaId}.md`
  const currentMarkdown = await readTextOrNull(markdownPath)
  if (currentMarkdown) {
    await writeText(markdownPath, updateMarkdownDecision(currentMarkdown, ceoDecision, ceoNotes))
  }

  await ensureDir('data/decisions')
  await writeJson(`data/decisions/${ideaId}.json`, {
    ideaId,
    ceoDecision,
    ceoNotes,
    decidedAt: new Date().toISOString(),
    source: 'dashboard',
  })

  logger.info('Decisao do CEO persistida', { ideaId, ceoDecision })
  return updatedIdea
}

async function handleDecision(req: IncomingMessage, res: ServerResponse, ideaId: string): Promise<void> {
  try {
    const body = await readBody(req)
    const payload = body as DashboardDecisionPayload
    const idea = await updateCeoDecision(ideaId, payload)
    sendJson(res, 200, { ok: true, idea })
  } catch (error) {
    logger.error('Falha ao persistir decisao do dashboard', {
      ideaId,
      error: error instanceof Error ? error.message : String(error),
    })
    sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    })
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, requestUrl: URL): Promise<void> {
  const pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/dashboard/' : requestUrl.pathname)
  const candidate = path.normalize(path.join(PROJECT_ROOT, pathname))

  if (!candidate.startsWith(PROJECT_ROOT)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const stat = await fs.stat(candidate).catch(() => null)
  const filePath = stat?.isDirectory() ? path.join(candidate, 'index.html') : candidate
  const content = await fs.readFile(filePath).catch(() => null)

  if (!content) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  res.writeHead(200, { 'content-type': contentType(filePath) })
  res.end(content)
}

export function createDashboardServer(): Server {
  return http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url || '/', 'http://localhost')
      const decisionMatch = requestUrl.pathname.match(/^\/api\/ideas\/([^/]+)\/decision$/)

      if (req.method === 'POST' && decisionMatch) {
        await handleDecision(req, res, decisionMatch[1])
        return
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/webhooks/hotmart') {
        await handleHotmartWebhook(req, res)
        return
      }

      if (req.method === 'OPTIONS' && requestUrl.pathname === '/api/meta/events') {
        res.writeHead(204, trackingCorsHeaders(firstHeaderValue(req.headers.origin)))
        res.end()
        return
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/meta/events') {
        await handleMetaBrowserEvent(req, res)
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(res, 200, { ok: true, status: 'operational' })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/checkout/summary') {
        const datePreset = requestUrl.searchParams.get('datePreset') || requestUrl.searchParams.get('period') || undefined
        const summary = await getCheckoutMetricsSummary({ datePreset })
        sendJson(res, 200, { ok: true, summary })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/tracking/traffic-quality') {
        const date = requestUrl.searchParams.get('date') || undefined
        const summary = await readTrafficQualitySummary(date)
        sendJson(res, 200, { ok: true, summary })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/performance/summary') {
        const datePreset = requestUrl.searchParams.get('datePreset') || requestUrl.searchParams.get('period') || undefined
        const summary = await getPerformanceSnapshot({ datePreset })
        sendJson(res, 200, { ok: true, summary })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/media/live-report') {
        const datePreset = requestUrl.searchParams.get('datePreset') || requestUrl.searchParams.get('period') || undefined
        const campaignName = requestUrl.searchParams.get('campaignName') || undefined
        const report = await getLiveMediaReport({ campaignName, datePreset })
        sendJson(res, 200, { ok: true, report })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/media/value-rules-breakdown') {
        const datePreset = requestUrl.searchParams.get('datePreset') || requestUrl.searchParams.get('period') || undefined
        const campaignName = requestUrl.searchParams.get('campaignName') || undefined
        const report = await getValueRulesBreakdownReport({ campaignName, datePreset })
        sendJson(res, 200, { ok: true, report })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/performance/action-plan') {
        const datePreset = requestUrl.searchParams.get('datePreset') || requestUrl.searchParams.get('period') || undefined
        const plan = await getPerformanceActionPlan({ datePreset })
        sendJson(res, 200, { ok: true, plan })
        return
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/go-live/checklist') {
        const datePreset = requestUrl.searchParams.get('datePreset') || undefined
        const report = await getGoLiveChecklist({ datePreset })
        sendJson(res, 200, { ok: true, report })
        return
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, requestUrl)
        return
      }

      res.writeHead(405)
      res.end('Method not allowed')
    })().catch(error => {
      logger.error('Erro no servidor do dashboard', {
        error: error instanceof Error ? error.message : String(error),
      })
      sendJson(res, 500, { ok: false, error: 'Erro interno do dashboard' })
    })
  })
}

export function startDashboardServer(port = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3000)): Server {
  const server = createDashboardServer()
  server.listen(port, () => {
    logger.info('Dashboard operacional iniciado', {
      url: `http://localhost:${port}/dashboard/`,
    })
  })
  return server
}

if (require.main === module) {
  startDashboardServer()
}
