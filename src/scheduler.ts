import 'dotenv/config'
import cron from 'node-cron'
import { runOrchestrator } from './orchestrator'
import { logger } from './utils/logger'

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler — executa o pipeline automaticamente via cron
// Por padrão: todo dia às 3h da manhã (configurável via CRON_SCHEDULE)
// ─────────────────────────────────────────────────────────────────────────────

const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? '0 3 * * *'
const DEFAULT_QUERY = process.env.DEFAULT_QUERY ?? 'como ganhar dinheiro online'
const DEFAULT_MAX_VIDEOS = parseInt(process.env.DEFAULT_MAX_VIDEOS ?? '10', 10)

let isRunning = false

async function runPipeline(): Promise<void> {
  if (isRunning) {
    logger.warn('Scheduler — pipeline já em execução, pulando esta rodada')
    return
  }

  isRunning = true
  const now = new Date().toISOString()
  logger.info('Scheduler — iniciando pipeline automático', {
    scheduledAt: now,
    maxVideos: DEFAULT_MAX_VIDEOS,
  })

  try {
    const result = await runOrchestrator({
      query: undefined,
      maxVideos: DEFAULT_MAX_VIDEOS,
      agents: ['all'],
      debug: false,
    })

    if (result.success) {
      logger.info('Scheduler — pipeline concluído com sucesso', {
        sessionId: result.sessionId,
        videosProcessed: result.videosProcessed,
        painPointsFound: result.painPointsFound,
        ideasGenerated: result.ideasGenerated,
        durationMs: result.durationMs,
      })
    } else {
      logger.error('Scheduler — pipeline falhou', { error: result.error })
    }
  } catch (error) {
    logger.error('Scheduler — erro crítico no pipeline', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    isRunning = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inicialização
// ─────────────────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  logger.info('Scheduler — iniciando', {
    cronSchedule: CRON_SCHEDULE,
    defaultQuery: DEFAULT_QUERY,
    defaultMaxVideos: DEFAULT_MAX_VIDEOS,
  })

  if (!cron.validate(CRON_SCHEDULE)) {
    logger.error('Scheduler — CRON_SCHEDULE inválido', { CRON_SCHEDULE })
    process.exit(1)
  }

  // Agenda a execução periódica
  cron.schedule(CRON_SCHEDULE, () => {
    runPipeline().catch(error => {
      logger.error('Scheduler — erro não capturado no pipeline', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })

  logger.info(`Scheduler — aguardando próxima execução (${CRON_SCHEDULE})`)
  logger.info('Scheduler — pressione Ctrl+C para encerrar')

  // Executa uma vez imediatamente se flag --now estiver presente
  if (process.argv.includes('--now')) {
    logger.info('Scheduler — executando imediatamente (--now)')
    runPipeline().catch(error => {
      logger.error('Scheduler — erro na execução imediata', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

// Handlers de graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Scheduler — SIGTERM recebido, encerrando graciosamente')
  process.exit(0)
})

process.on('SIGINT', () => {
  logger.info('Scheduler — SIGINT recebido, encerrando graciosamente')
  process.exit(0)
})

if (require.main === module) {
  startScheduler()
}
