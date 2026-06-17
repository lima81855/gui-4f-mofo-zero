import { logger } from './logger'

// ─────────────────────────────────────────────────────────────────────────────
// Retry com exponential backoff + jitter
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Número máximo de tentativas (inclui a primeira) */
  maxAttempts?: number
  /** Delay inicial em ms (dobra a cada tentativa) */
  initialDelayMs?: number
  /** Delay máximo em ms (teto do backoff) */
  maxDelayMs?: number
  /** Adiciona jitter aleatório para evitar thundering herd */
  jitter?: boolean
  /** Função que decide se o erro deve disparar retry */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  /** Label para logging */
  label?: string
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry' | 'label'>> = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: true,
}

function computeDelay(attempt: number, opts: Required<Omit<RetryOptions, 'shouldRetry' | 'label'>>): number {
  // Exponential backoff: delay = initialDelay * 2^(attempt-1)
  const exponential = opts.initialDelayMs * Math.pow(2, attempt - 1)
  const capped = Math.min(exponential, opts.maxDelayMs)
  if (!opts.jitter) return capped

  // Jitter: valor aleatório entre 50% e 100% do delay calculado
  return Math.floor(capped * (0.5 + Math.random() * 0.5))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Executa `fn` com retry automático e exponential backoff.
 *
 * @example
 * const data = await retry(() => fetch(url), { maxAttempts: 3, label: 'YouTube API' })
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const label = options.label ?? 'operação'
  const shouldRetry = options.shouldRetry ?? (() => true)

  let lastError: unknown

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      const isLast = attempt === opts.maxAttempts
      const willRetry = !isLast && shouldRetry(error, attempt)

      if (isLast || !willRetry) {
        logger.error(`${label} — falhou definitivamente`, {
          attempt,
          maxAttempts: opts.maxAttempts,
          error: error instanceof Error ? error.message : String(error),
        })
        break
      }

      const delayMs = computeDelay(attempt, opts)
      logger.warn(`${label} — tentativa ${attempt} falhou, retry em ${delayMs}ms`, {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      })

      await sleep(delayMs)
    }
  }

  throw lastError
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de rate limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aguarda `ms` milissegundos (util para rate limit manual entre requests)
 */
export async function delay(ms: number): Promise<void> {
  return sleep(ms)
}

/**
 * Processa um array em série com delay entre cada item (para respeitar rate limits)
 *
 * @example
 * const results = await processWithRateLimit(videoIds, processVideo, 1000)
 */
export async function processWithRateLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  delayBetweenMs: number,
): Promise<R[]> {
  const results: R[] = []

  for (let i = 0; i < items.length; i++) {
    if (i > 0) await sleep(delayBetweenMs)
    results.push(await fn(items[i], i))
  }

  return results
}

/**
 * Divide um array em chunks para batch processing
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}
