import { readJsonOrNull, writeJson } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import type { SessionBuffer, PipelineSession } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Conversational Buffer — memory/buffer.json
// Mantém as últimas N sessões do pipeline para contexto histórico
// ─────────────────────────────────────────────────────────────────────────────

const BUFFER_PATH = 'memory/buffer.json'

function getMaxSessions(): number {
  const raw = process.env.MEMORY_BUFFER_MAX_SESSIONS
  const parsed = raw ? parseInt(raw, 10) : 3
  return isNaN(parsed) || parsed < 1 ? 3 : parsed
}

/**
 * Lê o buffer de sessões atual
 */
export async function readBuffer(): Promise<SessionBuffer> {
  logger.debug('Buffer — lendo sessões')

  const data = await readJsonOrNull<SessionBuffer>(BUFFER_PATH)
  if (!data || !Array.isArray(data.sessions)) {
    return { sessions: [] }
  }

  return data
}

/**
 * Adiciona uma nova sessão ao buffer, mantendo apenas as últimas N sessões
 */
export async function addSession(session: PipelineSession): Promise<void> {
  logger.info('Buffer — registrando nova sessão', { sessionId: session.sessionId })

  const maxSessions = getMaxSessions()
  const current = await readBuffer()

  const sessions = [session, ...current.sessions].slice(0, maxSessions)

  await writeJson<SessionBuffer>(BUFFER_PATH, { sessions })

  logger.debug('Buffer — sessões no buffer', { count: sessions.length, maxSessions })
}

/**
 * Retorna IDs de vídeos já processados nas últimas N sessões.
 * Usado pelo Scraper para evitar reprocessar o mesmo conteúdo.
 */
export async function getRecentlyProcessedVideoIds(): Promise<Set<string>> {
  const buffer = await readBuffer()
  const allIds = new Set<string>()

  for (const session of buffer.sessions) {
    if (session.processedVideoIds) {
      for (const id of session.processedVideoIds) {
        allIds.add(id)
      }
    }
  }

  return allIds
}

/**
 * Retorna um resumo das últimas sessões para dar contexto ao Agente 4
 */
export async function getSessionSummary(): Promise<string> {
  const buffer = await readBuffer()

  if (buffer.sessions.length === 0) {
    return 'Nenhuma sessão anterior registrada. Esta é a primeira execução do sistema.'
  }

  const lines = buffer.sessions.map((s, i) => {
    const date = new Date(s.ranAt).toLocaleDateString('pt-BR')
    return `- Sessão ${i + 1} (${date}): query="${s.query}", ${s.videosProcessed} vídeos, ${s.painPointsFound} dores, ${s.ideasGenerated} ideias, ${s.ideasApproved} aprovadas`
  })

  return `Histórico das últimas ${buffer.sessions.length} sessão(ões):\n${lines.join('\n')}`
}

