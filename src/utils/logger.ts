// ─────────────────────────────────────────────────────────────────────────────
// Logger estruturado simples
// Sem dependências externas — usa console nativo com formatação e níveis
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogContext = Record<string, unknown>

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: LogContext
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info:  '\x1b[32m', // green
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m', // red
}

const RESET = '\x1b[0m'
const DIM   = '\x1b[2m'
const BOLD  = '\x1b[1m'

function formatEntry(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level]
  const ts    = `${DIM}${entry.timestamp}${RESET}`
  const level = `${color}${BOLD}${entry.level.toUpperCase().padEnd(5)}${RESET}`
  const msg   = `${entry.message}`
  const ctx   = entry.context && Object.keys(entry.context).length > 0
    ? ` ${DIM}${JSON.stringify(entry.context)}${RESET}`
    : ''

  return `${ts} ${level} ${msg}${ctx}`
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  }

  const formatted = formatEntry(entry)

  if (level === 'error') {
    console.error(formatted)
  } else if (level === 'warn') {
    console.warn(formatted)
  } else {
    console.log(formatted)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Controle de nível mínimo de log (via ENV)
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
}

function getMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase()
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env
  }
  return process.env.DEBUG === 'true' ? 'debug' : 'info'
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()]
}

// ─────────────────────────────────────────────────────────────────────────────
// Instância exportada do logger
// ─────────────────────────────────────────────────────────────────────────────

export const logger = {
  debug: (message: string, context?: LogContext): void => {
    if (shouldLog('debug')) log('debug', message, context)
  },

  info: (message: string, context?: LogContext): void => {
    if (shouldLog('info')) log('info', message, context)
  },

  warn: (message: string, context?: LogContext): void => {
    if (shouldLog('warn')) log('warn', message, context)
  },

  error: (message: string, context?: LogContext): void => {
    if (shouldLog('error')) log('error', message, context)
  },

  /** Mede e loga o tempo de execução de uma operação assíncrona */
  time: async <T>(
    label: string,
    fn: () => Promise<T>,
    context?: LogContext,
  ): Promise<T> => {
    const start = Date.now()
    logger.debug(`${label} — iniciando`, context)
    try {
      const result = await fn()
      const ms = Date.now() - start
      logger.info(`${label} — concluído`, { ...context, durationMs: ms })
      return result
    } catch (error) {
      const ms = Date.now() - start
      logger.error(`${label} — falhou`, {
        ...context,
        durationMs: ms,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
}
