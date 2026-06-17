import { logger } from '../utils/logger'
import { retry, delay } from '../utils/retry'
import type { VolumeReport, TrendDirection } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// MCP: Google Trends via SerpAPI
// Docs: https://serpapi.com/google-trends-api
// Rate limit: 1 request a cada 2 segundos (plano gratuito)
// ─────────────────────────────────────────────────────────────────────────────

const SERP_BASE_URL = 'https://serpapi.com/search'
const RATE_LIMIT_MS = 2_000 // 1 req / 2s

// Cache simples em memória — válido por 24h
interface CacheEntry {
  data: SerpTrendsResult
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000 // 24 horas

function getFromCache(key: string): SerpTrendsResult | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: SerpTrendsResult): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

function getApiKey(): string {
  const key = process.env.SERP_API_KEY
  if (!key) throw new Error('SERP_API_KEY não configurada no .env')
  return key
}

function getTargetCountry(): string {
  return (process.env.TARGET_COUNTRY || 'BR').toUpperCase()
}

function getTargetLanguageGeo(): string {
  return getTargetCountry() === 'US' ? 'en-US' : 'pt-BR'
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos da SerpAPI
// ─────────────────────────────────────────────────────────────────────────────

interface SerpTimeline {
  date: string
  value: Array<{ query: string; value: string; extracted_value: number }>
}

interface SerpRelatedQuery {
  query: string
  value: string
  extracted_value: number
}

interface SerpTrendsResult {
  interest_over_time?: {
    timeline_data?: SerpTimeline[]
  }
  related_queries?: {
    rising?: SerpRelatedQuery[]
    top?: SerpRelatedQuery[]
  }
  search_metadata?: {
    status: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Funções públicas do MCP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca dados do Google Trends para uma query.
 * Usa cache de 24h para não desperdiçar quota da API.
 */
async function fetchTrends(query: string): Promise<SerpTrendsResult> {
  const cacheKey = query.toLowerCase().trim()
  const cached = getFromCache(cacheKey)

  if (cached) {
    logger.debug('Trends MCP — cache hit', { query })
    return cached
  }

  logger.info('Trends MCP — buscando dados', { query })

  const params = new URLSearchParams({
    engine: 'google_trends',
    q: query,
    date: 'today 12-m', // últimos 12 meses
    geo: getTargetCountry(),
    hl: getTargetLanguageGeo(),
    data_type: 'TIMESERIES,RELATED_QUERIES',
    api_key: getApiKey(),
  })

  const result = await retry<SerpTrendsResult>(
    async () => {
      const res = await fetch(`${SERP_BASE_URL}?${params}`)
      if (!res.ok) {
        const body = await res.text()
        throw new TrendsApiError(`SerpAPI erro ${res.status}: ${body}`, res.status)
      }
      return res.json() as Promise<SerpTrendsResult>
    },
    {
      maxAttempts: 3,
      initialDelayMs: 2_000,
      label: `Google Trends "${query}"`,
      shouldRetry: (e) => {
        if (e instanceof TrendsApiError && e.statusCode === 429) return true
        if (e instanceof TrendsApiError && e.statusCode >= 400 && e.statusCode < 500) return false
        return true
      },
    },
  )

  setCache(cacheKey, result)
  return result
}

/**
 * Calcula o score de tendência (0-100) a partir dos dados do Google Trends.
 * Analisa os últimos 12 meses e extrai:
 * - Score médio normalizado
 * - Direção da tendência (crescendo/estavel/caindo)
 * - Queries relacionadas populares
 */
export async function analyzeTrends(
  description: string,
): Promise<Pick<VolumeReport, 'googleTrendsScore' | 'trendDirection' | 'topRelatedQueries' | 'monthlySearchVolume'>> {
  // Extrai palavras-chave da descrição para a query
  const query = extractKeywords(description)

  await delay(RATE_LIMIT_MS) // respeita rate limit antes de cada chamada real

  let data: SerpTrendsResult
  try {
    data = await fetchTrends(query)
  } catch (error) {
    logger.warn('Trends MCP — falha ao buscar, usando score neutro', {
      query,
      error: error instanceof Error ? error.message : String(error),
    })
    return { googleTrendsScore: 50, trendDirection: 'estavel', topRelatedQueries: [], monthlySearchVolume: 0 }
  }

  // Extrai timeline de valores
  const timeline = data.interest_over_time?.timeline_data ?? []
  const values = timeline
    .flatMap(t => t.value)
    .map(v => v.extracted_value)
    .filter(v => typeof v === 'number' && !isNaN(v))

  if (values.length === 0) {
    logger.warn('Trends MCP — sem dados de timeline', { query })
    return { googleTrendsScore: 50, trendDirection: 'estavel', topRelatedQueries: [], monthlySearchVolume: 0 }
  }

  // Score médio dos últimos 12 meses (já está em escala 0-100 do Google)
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const googleTrendsScore = Math.round(avg)

  // Direção da tendência: compara última metade com primeira metade
  const half = Math.floor(values.length / 2)
  const firstHalfAvg = values.slice(0, half).reduce((a, b) => a + b, 0) / half
  const secondHalfAvg = values.slice(half).reduce((a, b) => a + b, 0) / (values.length - half)

  let trendDirection: TrendDirection
  const diff = secondHalfAvg - firstHalfAvg
  if (diff > 5) trendDirection = 'crescendo'
  else if (diff < -5) trendDirection = 'caindo'
  else trendDirection = 'estavel'

  // Queries relacionadas (top 5 rising + top)
  const rising = (data.related_queries?.rising ?? []).slice(0, 3).map(q => q.query)
  const top = (data.related_queries?.top ?? []).slice(0, 3).map(q => q.query)
  const topRelatedQueries = [...new Set([...rising, ...top])].slice(0, 5)

  // Estimativa de volume mensal (heurística baseada no score do Trends)
  // Score 100 ≈ 100k buscas/mês no mercado alvo; ajustado pela escala
  const monthlySearchVolume = Math.round(googleTrendsScore * 1_000)

  logger.info('Trends MCP — análise concluída', {
    query,
    googleTrendsScore,
    trendDirection,
    monthlySearchVolume,
  })

  return { googleTrendsScore, trendDirection, topRelatedQueries, monthlySearchVolume }
}

/**
 * Estima o número de competidores fazendo uma busca simples no Google
 */
export async function estimateCompetitors(description: string): Promise<number> {
  const query = `saas ${extractKeywords(description)}`

  logger.debug('Trends MCP — estimando competidores', { query })

  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      num: '10',
      gl: getTargetCountry().toLowerCase(),
      hl: getTargetLanguageGeo().toLowerCase(),
      api_key: getApiKey(),
    })

    await delay(RATE_LIMIT_MS)

    const res = await fetch(`${SERP_BASE_URL}?${params}`)
    if (!res.ok) return 0

    const data = (await res.json()) as { search_information?: { total_results?: number } }
    const total = data.search_information?.total_results ?? 0

    // Normaliza para um número razoável de competidores diretos
    if (total > 1_000_000) return 50
    if (total > 100_000) return 20
    if (total > 10_000) return 10
    return Math.floor(total / 1_000) || 1
  } catch {
    return 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

function extractKeywords(text: string): string {
  // Remove stopwords e pega as palavras mais relevantes
  const stopwords = new Set([
    // PT
    'de', 'da', 'do', 'em', 'no', 'na', 'para', 'com', 'que', 'um', 'uma',
    'os', 'as', 'e', 'ou', 'mas', 'por', 'como', 'quando', 'onde', 'não',
    'ser', 'ter', 'usar', 'fazer', 'dificuldade', 'problema', 'falta',
    'precisar', 'querer', 'conseguir', 'dor', 'frustração',
    // EN
    'the', 'is', 'in', 'at', 'of', 'on', 'and', 'a', 'to', 'for', 'with',
    'that', 'this', 'it', 'not', 'be', 'have', 'do', 'how', 'what', 'why',
    'problem', 'need', 'want', 'pain', 'frustration', 'hard', 'difficult'
  ])

  const words = text
    .toLowerCase()
    .replace(/[^a-záàãâéêíóôõúüç\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
    .slice(0, 4)

  return words.join(' ') || text.slice(0, 50)
}

// ─────────────────────────────────────────────────────────────────────────────
// Erros customizados
// ─────────────────────────────────────────────────────────────────────────────

export class TrendsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'TrendsApiError'
  }
}
