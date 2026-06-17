import { fileExists, readJson, writeJson, ensureDir } from '../mcp/filesystem'
import { analyzeTrends, estimateCompetitors } from '../mcp/trends'
import { logger } from '../utils/logger'
import { processWithRateLimit } from '../utils/retry'
import type { PainPointsFile, VolumeReport, VolumeReportFile } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Agente 3 — Filtro de Volume
// Responsabilidade: validar se a dor tem mercado suficiente via Google Trends
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_VERSION = '1.0.0'

export interface VolumeFilterInput {
  sessionId: string
  painPointsDir?: string
}

export interface VolumeFilterOutput {
  approvedPainPointIds: string[]
  outputFiles: string[]
  totalAnalyzed: number
  totalApproved: number
  durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo do marketScore composto
// Pesos: Trends 40% + Frequência normalizada 35% + Tendência 25%
// ─────────────────────────────────────────────────────────────────────────────

function calcMarketScore(
  trendsScore: number,
  frequency: number,
  trendDirection: VolumeReport['trendDirection'],
  maxFrequency: number,
): number {
  // Normaliza frequência para 0-100
  const freqNormalized = maxFrequency > 0
    ? Math.min((frequency / maxFrequency) * 100, 100)
    : 50

  // Score de tendência
  const trendScore =
    trendDirection === 'crescendo' ? 100 :
    trendDirection === 'estavel'   ? 60  : 20

  const marketScore =
    trendsScore * 0.40 +
    freqNormalized * 0.35 +
    trendScore * 0.25

  return Math.round(marketScore)
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução principal do agente
// ─────────────────────────────────────────────────────────────────────────────

export async function runVolumeFilter(input: VolumeFilterInput): Promise<VolumeFilterOutput> {
  const startTime = Date.now()
  const minMarketScore = parseInt(process.env.MIN_MARKET_SCORE ?? '60', 10)
  const painPointsDir = input.painPointsDir ?? 'data/pain-points'

  logger.info('Agente 3 (VolumeFilter) — iniciando', { sessionId: input.sessionId, minMarketScore })

  await ensureDir('data/volume-reports')

  // ── Carrega pain points do agente 2 ──────────────────────────────────────

  const sessionPainFile = `${painPointsDir}/${input.sessionId}.json`
  if (!await fileExists(sessionPainFile)) {
    logger.warn('VolumeFilter — arquivo de pain points da sessao nao encontrado', {
      sessionId: input.sessionId,
      sessionPainFile,
    })
    return {
      approvedPainPointIds: [],
      outputFiles: [],
      totalAnalyzed: 0,
      totalApproved: 0,
      durationMs: Date.now() - startTime,
    }
  }

  const painFile = await readJson<PainPointsFile>(sessionPainFile)
  const allPainPoints = painFile.painPoints
  logger.info('VolumeFilter — pain points carregados', { count: allPainPoints.length })

  if (allPainPoints.length === 0) {
    return {
      approvedPainPointIds: [],
      outputFiles: [],
      totalAnalyzed: 0,
      totalApproved: 0,
      durationMs: Date.now() - startTime,
    }
  }

  // Frequência máxima para normalização
  const maxFrequency = Math.max(...allPainPoints.map(p => p.frequency))

  // ── Análise de volume (rate limit: 1 req a cada 2s) ──────────────────────

  const outputFiles: string[] = []
  const approvedPainPointIds: string[] = []

  await processWithRateLimit(
    allPainPoints,
    async (painPoint) => {
      try {
        const t0 = Date.now()
        logger.info('VolumeFilter — analisando dor', {
          id: painPoint.id,
          description: painPoint.description.slice(0, 60),
        })

        // Busca dados de trends e competidores em paralelo
        const [trendsData, competitorCount] = await Promise.all([
          analyzeTrends(painPoint.description),
          estimateCompetitors(painPoint.description),
        ])

        const marketScore = calcMarketScore(
          trendsData.googleTrendsScore,
          painPoint.frequency,
          trendsData.trendDirection,
          maxFrequency,
        )

        const report: VolumeReport = {
          painPointId: painPoint.id,
          googleTrendsScore: trendsData.googleTrendsScore,
          monthlySearchVolume: trendsData.monthlySearchVolume,
          trendDirection: trendsData.trendDirection,
          topRelatedQueries: trendsData.topRelatedQueries,
          competitorCount,
          marketScore,
        }

        const reportFile: VolumeReportFile = {
          metadata: {
            agentVersion: AGENT_VERSION,
            processedAt: new Date().toISOString(),
            durationMs: Date.now() - t0,
          },
          report,
        }

        const filePath = `data/volume-reports/${painPoint.id}.json`
        await writeJson(filePath, reportFile)
        outputFiles.push(filePath)

        logger.info('VolumeFilter — análise concluída', {
          painPointId: painPoint.id,
          marketScore,
          trendDirection: trendsData.trendDirection,
          passed: marketScore >= minMarketScore,
        })

        if (marketScore >= minMarketScore) {
          approvedPainPointIds.push(painPoint.id)
        }
      } catch (error) {
        logger.error('VolumeFilter — erro ao analisar dor, pulando', {
          painPointId: painPoint.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    2_000, // 2 segundos entre requisições (rate limit SerpAPI)
  )

  const durationMs = Date.now() - startTime
  logger.info('Agente 3 (VolumeFilter) — concluído', {
    totalAnalyzed: allPainPoints.length,
    totalApproved: approvedPainPointIds.length,
    minMarketScore,
    durationMs,
  })

  return {
    approvedPainPointIds,
    outputFiles,
    totalAnalyzed: allPainPoints.length,
    totalApproved: approvedPainPointIds.length,
    durationMs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Erros customizados
// ─────────────────────────────────────────────────────────────────────────────

export class VolumeFilterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VolumeFilterError'
  }
}
