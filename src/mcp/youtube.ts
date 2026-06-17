import { logger } from '../utils/logger'
import { retry } from '../utils/retry'
import type { RawComment } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// MCP: YouTube Data API v3
// Docs: https://developers.google.com/youtube/v3/docs
// ─────────────────────────────────────────────────────────────────────────────

const YT_BASE_URL = 'https://www.googleapis.com/youtube/v3'

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY não configurada no .env')
  return key
}

function getTargetCountry(): string {
  return process.env.TARGET_COUNTRY || 'BR'
}

function getTargetLanguage(): string {
  return getTargetCountry() === 'US' ? 'en' : 'pt'
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos da API do YouTube
// ─────────────────────────────────────────────────────────────────────────────

interface YTSearchItem {
  id: { videoId: string }
  snippet: {
    title: string
    channelId: string
  }
}

interface YTSearchResponse {
  items: YTSearchItem[]
  nextPageToken?: string
}

interface YTCommentThread {
  id: string
  snippet: {
    topLevelComment: {
      id: string
      snippet: {
        textOriginal: string
        likeCount: number
        publishedAt: string
      }
    }
    totalReplyCount: number
    videoId: string
  }
}

interface YTCommentThreadsResponse {
  items: YTCommentThread[]
  nextPageToken?: string
}

interface YTVideoItem {
  id: string
  snippet: {
    title: string
    channelId: string
  }
}

interface YTVideosResponse {
  items: YTVideoItem[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Funções públicas do MCP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca videoIds pelo YouTube Search — retorna até `maxResults` vídeos
 */
export async function searchVideos(
  query: string,
  maxResults: number = 10,
): Promise<Array<{ videoId: string; title: string; channelId: string }>> {
  logger.info('YouTube MCP — buscando vídeos', { query, maxResults })

  const videos: Array<{ videoId: string; title: string; channelId: string }> = []
  let pageToken: string | undefined

  while (videos.length < maxResults) {
    const remaining = maxResults - videos.length
    const pageSize = Math.min(remaining, 50) // max 50 por page

    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: String(pageSize),
      order: 'viewCount',
      relevanceLanguage: getTargetLanguage(),
      regionCode: getTargetCountry(),
      key: getApiKey(),
      ...(pageToken ? { pageToken } : {}),
    })

    const response = await retry<YTSearchResponse>(
      async () => {
        const res = await fetch(`${YT_BASE_URL}/search?${params}`)
        if (!res.ok) {
          const body = await res.text()
          throw new Error(`YouTube Search API erro ${res.status}: ${body}`)
        }
        return res.json() as Promise<YTSearchResponse>
      },
      { maxAttempts: 3, label: 'YouTube Search' },
    )

    for (const item of response.items) {
      if (item.id?.videoId) {
        videos.push({
          videoId: item.id.videoId,
          title: item.snippet.title,
          channelId: item.snippet.channelId,
        })
      }
    }

    pageToken = response.nextPageToken
    if (!pageToken) break
  }

  logger.info('YouTube MCP — vídeos encontrados', { count: videos.length, query })
  return videos.slice(0, maxResults)
}

/**
 * Busca vídeos de um canal específico
 */
export async function getChannelVideos(
  channelId: string,
  maxResults: number = 10,
): Promise<Array<{ videoId: string; title: string; channelId: string }>> {
  logger.info('YouTube MCP — buscando vídeos do canal', { channelId, maxResults })

  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    maxResults: String(Math.min(maxResults, 50)),
    order: 'viewCount',
    key: getApiKey(),
  })

  const response = await retry<YTSearchResponse>(
    async () => {
      const res = await fetch(`${YT_BASE_URL}/search?${params}`)
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`YouTube Channel Search erro ${res.status}: ${body}`)
      }
      return res.json() as Promise<YTSearchResponse>
    },
    { maxAttempts: 3, label: 'YouTube Channel Search' },
  )

  return response.items
    .filter(item => item.id?.videoId)
    .slice(0, maxResults)
    .map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelId: item.snippet.channelId,
    }))
}

/**
 * Busca metadados de vídeos específicos por ID
 */
export async function getVideoMetadata(
  videoIds: string[],
): Promise<Array<{ videoId: string; title: string; channelId: string }>> {
  if (videoIds.length === 0) return []

  const params = new URLSearchParams({
    part: 'snippet',
    id: videoIds.join(','),
    key: getApiKey(),
  })

  const response = await retry<YTVideosResponse>(
    async () => {
      const res = await fetch(`${YT_BASE_URL}/videos?${params}`)
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`YouTube Videos API erro ${res.status}: ${body}`)
      }
      return res.json() as Promise<YTVideosResponse>
    },
    { maxAttempts: 3, label: 'YouTube Videos Metadata' },
  )

  return response.items.map(item => ({
    videoId: item.id,
    title: item.snippet.title,
    channelId: item.snippet.channelId,
  }))
}

/**
 * Busca comentários de um vídeo — respeita rate limit de 1 req/s
 */
export async function getVideoComments(
  videoId: string,
  videoTitle: string,
  channelId: string,
  maxComments: number = 500,
): Promise<RawComment[]> {
  logger.info('YouTube MCP — buscando comentários', { videoId, maxComments })

  const comments: RawComment[] = []
  let pageToken: string | undefined
  let requestCount = 0

  while (comments.length < maxComments) {
    const remaining = maxComments - comments.length
    const pageSize = Math.min(remaining, 100) // max 100 por page

    // Rate limit: 1 request/segundo
    if (requestCount > 0) {
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
    requestCount++

    const params = new URLSearchParams({
      part: 'snippet',
      videoId,
      maxResults: String(pageSize),
      order: 'relevance',
      textFormat: 'plainText',
      key: getApiKey(),
      ...(pageToken ? { pageToken } : {}),
    })

    let response: YTCommentThreadsResponse
    try {
      response = await retry<YTCommentThreadsResponse>(
        async () => {
          const res = await fetch(`${YT_BASE_URL}/commentThreads?${params}`)
          if (!res.ok) {
            const body = await res.text()
            // 403 com commentsDisabled não é erro de rede — não fazer retry
            if (res.status === 403 && body.includes('commentsDisabled')) {
              throw new CommentDisabledError(videoId)
            }
            throw new Error(`YouTube Comments API erro ${res.status}: ${body}`)
          }
          return res.json() as Promise<YTCommentThreadsResponse>
        },
        {
          maxAttempts: 3,
          label: `YouTube Comments ${videoId}`,
          shouldRetry: (e) => !(e instanceof CommentDisabledError),
        },
      )
    } catch (error) {
      if (error instanceof CommentDisabledError) {
        logger.warn('Comentários desabilitados neste vídeo', { videoId })
        break
      }
      throw error
    }

    for (const thread of response.items) {
      const top = thread.snippet.topLevelComment
      comments.push({
        id: top.id,
        videoId,
        videoTitle,
        channelId,
        text: top.snippet.textOriginal,
        likeCount: top.snippet.likeCount ?? 0,
        publishedAt: top.snippet.publishedAt,
        replyCount: thread.snippet.totalReplyCount ?? 0,
      })
    }

    if (comments.length % 100 === 0 && comments.length > 0) {
      logger.debug('Progresso de comentários', { videoId, count: comments.length })
    }

    pageToken = response.nextPageToken
    if (!pageToken) break
  }

  logger.info('YouTube MCP — comentários coletados', { videoId, total: comments.length })
  return comments
}

// ─────────────────────────────────────────────────────────────────────────────
// Erros customizados
// ─────────────────────────────────────────────────────────────────────────────

export class CommentDisabledError extends Error {
  constructor(public readonly videoId: string) {
    super(`Comentários desabilitados no vídeo ${videoId}`)
    this.name = 'CommentDisabledError'
  }
}

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
  ) {
    super(message)
    this.name = 'YouTubeApiError'
  }
}
