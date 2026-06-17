import { v4 as uuidv4 } from 'uuid'
import { searchVideos, getChannelVideos, getVideoMetadata, getVideoComments } from '../mcp/youtube'
import { writeJson, ensureDir } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import { processWithRateLimit } from '../utils/retry'
import type { RawComment, RawCommentsFile } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Agente 1 — Scraper
// Responsabilidade: buscar comentários brutos do YouTube e normalizar
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_VERSION = '1.0.0'

export interface ScraperInput {
  query?: string
  videoIds?: string[]
  channelId?: string
  maxVideos?: number
  skipVideoIds?: Set<string> // IDs já processados (do buffer)
}

export interface ScraperOutput {
  processedVideoIds: string[]
  outputFiles: string[]
  totalComments: number
  durationMs: number
}

/**
 * Filtra e normaliza comentários brutos.
 * Remove spam, emojis puros, comentários muito curtos.
 */
function filterAndNormalize(comments: RawComment[]): RawComment[] {
  return comments
    .map(c => ({
      ...c,
      text: c.text
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, '') // remove URLs
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter(c => {
      // Remove comentários muito curtos
      if (c.text.length < 10) return false

      // Remove se for só emojis/símbolos (sem letras)
      if (!/[a-záàãâéêíóôõúüç]/i.test(c.text)) return false

      // Remove spam óbvio (só exclamações, números repetidos)
      if (/^[!?.]+$/.test(c.text)) return false
      if (/^[\d\s]+$/.test(c.text)) return false

      return true
    })
}

/**
 * Executa o Agente 1 — Scraper
 */
export async function runScraper(input: ScraperInput): Promise<ScraperOutput> {
  const startTime = Date.now()
  const maxVideos = input.maxVideos ?? 5
  const maxComments = parseInt(process.env.MAX_COMMENTS_PER_VIDEO ?? '500', 10)

  logger.info('Agente 1 (Scraper) — iniciando', { ...input, maxVideos, maxComments })

  await ensureDir('data/raw-comments')

  // ── Resolução dos vídeos a processar ─────────────────────────────────────

  let videos: Array<{ videoId: string; title: string; channelId: string }> = []

  if (input.videoIds && input.videoIds.length > 0) {
    logger.info('Scraper — usando videoIds fornecidos', { count: input.videoIds.length })
    videos = await getVideoMetadata(input.videoIds)
  } else if (input.channelId) {
    logger.info('Scraper — buscando vídeos do canal', { channelId: input.channelId })
    videos = await getChannelVideos(input.channelId, maxVideos)
  } else if (input.query) {
    logger.info('Scraper — buscando vídeos por query', { query: input.query })
    videos = await searchVideos(input.query, maxVideos)
  } else {
    throw new ScraperError('Nenhuma entrada fornecida: videoIds, channelId ou query são obrigatórios')
  }

  // ── Filtra vídeos já processados ─────────────────────────────────────────

  const skipIds = input.skipVideoIds ?? new Set<string>()
  const newVideos = videos.filter(v => !skipIds.has(v.videoId))

  if (newVideos.length < videos.length) {
    logger.info('Scraper — vídeos pulados (já processados)', {
      skipped: videos.length - newVideos.length,
      toProcess: newVideos.length,
    })
  }

  if (newVideos.length === 0) {
    logger.warn('Scraper — nenhum vídeo novo para processar')
    return { processedVideoIds: [], outputFiles: [], totalComments: 0, durationMs: Date.now() - startTime }
  }

  // ── Coleta comentários (1 vídeo a cada 1s para respeitar rate limit) ─────

  const outputFiles: string[] = []
  const processedVideoIds: string[] = []
  let totalComments = 0

  await processWithRateLimit(
    newVideos.slice(0, maxVideos),
    async (video) => {
      try {
        const t0 = Date.now()
        const rawComments = await getVideoComments(
          video.videoId,
          video.title,
          video.channelId,
          maxComments,
        )

        const filtered = filterAndNormalize(rawComments)
        logger.info('Scraper — comentários filtrados', {
          videoId: video.videoId,
          raw: rawComments.length,
          afterFilter: filtered.length,
        })

        const outputFile: RawCommentsFile = {
          metadata: {
            agentVersion: AGENT_VERSION,
            processedAt: new Date().toISOString(),
            durationMs: Date.now() - t0,
            videoId: video.videoId,
            videoTitle: video.title,
            totalFetched: rawComments.length,
            totalAfterFilter: filtered.length,
          },
          comments: filtered,
        }

        const filePath = `data/raw-comments/${video.videoId}.json`
        await writeJson(filePath, outputFile)

        outputFiles.push(filePath)
        processedVideoIds.push(video.videoId)
        totalComments += filtered.length

        logger.info('Scraper — vídeo processado', {
          videoId: video.videoId,
          comments: filtered.length,
          file: filePath,
        })
      } catch (error) {
        // Logar e continuar (não travar o pipeline por um vídeo com erro)
        logger.error('Scraper — falha ao processar vídeo, pulando', {
          videoId: video.videoId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    1_000, // 1 segundo entre vídeos
  )

  const durationMs = Date.now() - startTime
  logger.info('Agente 1 (Scraper) — concluído', {
    videosProcessed: processedVideoIds.length,
    totalComments,
    durationMs,
  })

  return { processedVideoIds, outputFiles, totalComments, durationMs }
}

// ─────────────────────────────────────────────────────────────────────────────
// Erros customizados
// ─────────────────────────────────────────────────────────────────────────────

export class ScraperError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScraperError'
  }
}
