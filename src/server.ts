import 'dotenv/config'
import { startDashboardServer } from './dashboard-server'
import { logger } from './utils/logger'

const server = startDashboardServer()

if (process.env.ENABLE_SCHEDULER === 'true') {
  import('./scheduler')
    .then(({ startScheduler }) => startScheduler())
    .catch(error => {
      logger.error('Servidor operacional - falha ao iniciar scheduler', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
} else {
  logger.info('Servidor operacional - scheduler desativado', {
    enableScheduler: process.env.ENABLE_SCHEDULER || 'false',
  })
}

process.on('SIGTERM', () => {
  logger.info('Servidor operacional - SIGTERM recebido, encerrando')
  server.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  logger.info('Servidor operacional - SIGINT recebido, encerrando')
  server.close(() => process.exit(0))
})
