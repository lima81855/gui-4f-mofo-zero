import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import { readAllJson, readJsonOrNull, writeJson, listFiles, ensureDir } from '../mcp/filesystem'
import path from 'path'
import { findByHash, insertPainPoint, incrementFrequency, hashDescription } from '../memory/knowledge'
import { logger } from '../utils/logger'
import { chunk, retry } from '../utils/retry'
import type {
  RawCommentsFile,
  PainPoint,
  PainPointsFile,
  LLMExtractedPain,
  LLMExtractedPainsResponse,
} from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Agente 2 — Extrator de Dores
// Responsabilidade: identificar e agrupar dores reais nos comentários via Claude
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_VERSION = '1.0.0'
const BATCH_SIZE = 50 // comentários por chamada
const MODEL = 'gpt-4o'

export interface PainExtractorInput {
  sessionId: string
  rawCommentsDir?: string
  videoIds?: string[]
}

export interface PainExtractorOutput {
  painPoints: PainPoint[]
  outputFile: string
  durationMs: number
}

const client = new OpenAI()

// ─────────────────────────────────────────────────────────────────────────────
// Prompt base para extração de dores
// ─────────────────────────────────────────────────────────────────────────────

function buildExtractionPrompt(comments: string[]): string {
  const commentList = comments.map((c, i) => `${i + 1}. "${c}"`).join('\n')

  return `Você é um analista de produto especializado em descobrir oportunidades validadas (Micro-SaaS práticos ou ferramentas tangíveis "Low Ticket").
Analise os comentários abaixo e extraia as dores reais que as pessoas expressam.

O foco é encontrar a "Ruminação Mental": aquela dor urgente, irritante, que faz a pessoa querer uma solução prática AGORA. A dor precisa ser algo que, ao ver a solução visualmente (tangível, comer com os olhos), a pessoa compre por impulso.

Uma "dor" é uma frustração profunda, dificuldade ou necessidade não atendida. Exemplos de marcadores de dor:
- "não consigo", "odeio quando", "preciso de", "seria ótimo se", "por que não existe", "é uma dificuldade"
- Reclamações sobre ferramentas complexas, processos ou falta de soluções simples
- Expressões de desespero, cansaço mental ou frustração diária com tarefas específicas

Ignore:
- Elogios e comentários positivos sem queixa
- Perguntas genéricas sem expressão de dor
- Spam, emojis sem contexto, comentários irrelevantes

Para cada dor identificada, retorne:
- description: a dor descrita em linguagem natural clara (1-2 frases)
- category: uma das categorias (produtividade, aprendizado, financas, saude, relacionamentos, negocios, outros)
- examples: os comentários exatos que expressam essa dor (máx 3)

COMENTÁRIOS PARA ANALISAR:
${commentList}

Retorne APENAS um JSON válido no seguinte formato, sem texto adicional:
{
  "pains": [
    {
      "description": "descrição da dor",
      "category": "categoria",
      "examples": ["comentário 1", "comentário 2"]
    }
  ]
}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Extração via Claude
// ─────────────────────────────────────────────────────────────────────────────

async function extractPainsFromBatch(
  comments: string[],
  batchIndex: number,
): Promise<LLMExtractedPain[]> {
  logger.debug('PainExtractor — chamando OpenAI', { batchIndex, commentCount: comments.length })

  let responseText = ''
  try {
    const completion = await retry(
      () => client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: buildExtractionPrompt(comments),
          },
        ],
        response_format: { type: 'json_object' }
      }),
      { maxAttempts: 3, label: `OpenAI Batch ${batchIndex}` }
    )
    responseText = completion.choices[0]?.message?.content || ''
  } catch (error) {
    logger.error('PainExtractor — falha irreversível na API para o batch', {
      batchIndex,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }

  // Parse do JSON retornado pela OpenAI
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    logger.warn('PainExtractor — OpenAI não retornou JSON válido', { batchIndex, responseText })
    return []
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as LLMExtractedPainsResponse
    return parsed.pains ?? []
  } catch (error) {
    logger.error('PainExtractor — erro ao parsear JSON da OpenAI', {
      batchIndex,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrupamento semântico de dores similares
// ─────────────────────────────────────────────────────────────────────────────

async function groupSimilarPains(
  pains: LLMExtractedPain[],
): Promise<LLMExtractedPain[]> {
  if (pains.length <= 5) return pains

  logger.info('PainExtractor — agrupando dores similares', { count: pains.length })

  const BATCH_LIMIT = 50;
  const painBatches: LLMExtractedPain[][] = [];
  for (let i = 0; i < pains.length; i += BATCH_LIMIT) {
    painBatches.push(pains.slice(i, i + BATCH_LIMIT));
  }
  const groupedResults: LLMExtractedPain[] = [];

  for (let i = 0; i < painBatches.length; i++) {
    const batch = painBatches[i];
    logger.debug(`PainExtractor — agrupando lote ${i + 1}/${painBatches.length}`);
    
    const painsJson = JSON.stringify(batch, null, 2)

    try {
      let responseText = ''
      try {
        const completion = await retry(
          () => client.chat.completions.create({
            model: MODEL,
            messages: [
              {
                role: 'user',
                content: `Você é um analista de produto. Abaixo estão dores extraídas de comentários.
Agrupe as dores similares ou redundantes em uma única dor, consolidando os exemplos.
Mantenha dores distintas separadas. Retorne APENAS JSON válido no mesmo formato da entrada.

DORES PARA AGRUPAR:
${painsJson}

Retorne:
{
  "pains": [
    {
      "description": "dor consolidada",
      "category": "categoria",
      "examples": ["exemplo 1", "exemplo 2", "exemplo 3"]
    }
  ]
}`,
              },
            ],
            response_format: { type: 'json_object' }
          }),
          { maxAttempts: 3, label: `OpenAI Grouping ${i + 1}` }
        )
        responseText = completion.choices[0]?.message?.content || ''
      } catch (apiError) {
        throw apiError
      }
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as LLMExtractedPainsResponse
        groupedResults.push(...(parsed.pains ?? batch))
      } else {
        groupedResults.push(...batch)
      }
    } catch (error) {
      logger.warn(`PainExtractor — erro ao agrupar lote ${i + 1}`, { error: String(error) });
      groupedResults.push(...batch);
    }
    
    // Pequena pausa para evitar Rate Limit
    if (i < painBatches.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return groupedResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integração com knowledge.db
// ─────────────────────────────────────────────────────────────────────────────

function upsertPainInKnowledge(
  extracted: LLMExtractedPain,
  frequency: number,
  sourceVideoIds: string[],
): PainPoint {
  const descHash = hashDescription(extracted.description)
  const existing = findByHash(descHash)

  if (existing) {
    logger.debug('PainExtractor — dor já existe no knowledge.db, incrementando', {
      id: existing.id,
      description: existing.description.slice(0, 50),
    })
    incrementFrequency(existing.id, frequency)

    return {
      id: existing.id,
      description: existing.description,
      frequency: existing.frequency + frequency,
      examples: extracted.examples.slice(0, 5),
      category: extracted.category,
      sourceVideoIds,
      extractedAt: new Date().toISOString(),
    }
  }

  const id = uuidv4()
  const now = new Date().toISOString()

  insertPainPoint({
    id,
    description: extracted.description,
    descriptionHash: descHash,
    category: extracted.category,
    firstSeenAt: now,
    frequency,
    status: 'new',
  })

  return {
    id,
    description: extracted.description,
    frequency,
    examples: extracted.examples.slice(0, 5),
    category: extracted.category,
    sourceVideoIds,
    extractedAt: now,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução principal do agente
// ─────────────────────────────────────────────────────────────────────────────

export async function runPainExtractor(input: PainExtractorInput): Promise<PainExtractorOutput> {
  const startTime = Date.now()
  const minFrequency = parseInt(process.env.MIN_PAIN_FREQUENCY ?? '10', 10)
  const rawDir = input.rawCommentsDir ?? 'data/raw-comments'

  logger.info('Agente 2 (PainExtractor) — iniciando', { sessionId: input.sessionId, rawDir })

  await ensureDir('data/pain-points')

  // ── Carrega todos os arquivos de comentários ──────────────────────────────

  let rawFiles: RawCommentsFile[] = []
  if (input.videoIds && input.videoIds.length > 0) {
    logger.info('PainExtractor — processando apenas videoIds específicos', { count: input.videoIds.length })
    for (const videoId of input.videoIds) {
      const filePath = `${rawDir}/${videoId}.json`
      const data = await readJsonOrNull<RawCommentsFile>(filePath)
      if (data) {
        rawFiles.push(data)
      } else {
        logger.warn('PainExtractor — arquivo de comentários não encontrado para o vídeo', { videoId, filePath })
      }
    }
  } else {
    rawFiles = await readAllJson<RawCommentsFile>(rawDir)
  }
  if (rawFiles.length === 0) {
    logger.warn('PainExtractor — nenhum arquivo de comentários encontrado', { rawDir })
    return {
      painPoints: [],
      outputFile: '',
      durationMs: Date.now() - startTime,
    }
  }

  logger.info('PainExtractor — arquivos de comentários carregados', { count: rawFiles.length })

  // Mapeia videoId para sourceVideoIds para rastreabilidade
  const commentToVideoId = new Map<string, string>()
  const allComments: string[] = []

  for (const file of rawFiles) {
    for (const comment of file.comments) {
      allComments.push(comment.text)
      commentToVideoId.set(comment.text, comment.videoId)
    }
  }

  logger.info('PainExtractor — total de comentários a analisar', { total: allComments.length })

  // ── Extração em batches ───────────────────────────────────────────────────

  const batches = chunk(allComments, BATCH_SIZE)
  const allExtractedPains: LLMExtractedPain[] = []

  for (let i = 0; i < batches.length; i++) {
    logger.info(`PainExtractor — processando batch ${i + 1}/${batches.length}`)
    const pains = await extractPainsFromBatch(batches[i], i)
    allExtractedPains.push(...pains)

    // Pequena pausa para não sobrecarregar a API (aumentada para 3s devido ao limite de 30k TPM)
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  logger.info('PainExtractor — dores extraídas antes do agrupamento', { count: allExtractedPains.length })

  // ── Agrupamento semântico ─────────────────────────────────────────────────

  const groupedPains = await groupSimilarPains(allExtractedPains)
  logger.info('PainExtractor — dores após agrupamento', { count: groupedPains.length })

  // ── Calcula frequência e filtra ───────────────────────────────────────────

  // Frequência = quantas vezes a dor foi mencionada nos batches / agrupamentos
  const painFrequency = new Map<string, number>()
  for (const pain of allExtractedPains) {
    const existing = painFrequency.get(pain.description) ?? 0
    painFrequency.set(pain.description, existing + (pain.examples?.length ?? 1))
  }

  // ── Upsert no knowledge.db e construção dos PainPoints ───────────────────

  const sourceVideoIds = rawFiles.map(f => f.metadata.videoId)
  const painPoints: PainPoint[] = []

  for (const extracted of groupedPains) {
    const freq = Math.max(painFrequency.get(extracted.description) ?? 1, extracted.examples.length)

    const painPoint = upsertPainInKnowledge(extracted, freq, sourceVideoIds)

    if (painPoint.frequency >= minFrequency) {
      painPoints.push(painPoint)
    } else {
      logger.debug('PainExtractor — dor abaixo do mínimo de frequência, descartando', {
        description: painPoint.description.slice(0, 60),
        frequency: painPoint.frequency,
        minFrequency,
      })
    }
  }

  logger.info('PainExtractor — pain points após filtro de frequência', {
    total: groupedPains.length,
    passed: painPoints.length,
    minFrequency,
  })

  // ── Persiste resultado ────────────────────────────────────────────────────

  const outputPath = `data/pain-points/${input.sessionId}.json`
  const outputFile: PainPointsFile = {
    metadata: {
      agentVersion: AGENT_VERSION,
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      sessionId: input.sessionId,
      totalPainPoints: painPoints.length,
      sourceFiles: rawFiles.map(f => `data/raw-comments/${f.metadata.videoId}.json`),
    },
    painPoints,
  }

  await writeJson(outputPath, outputFile)

  logger.info('Agente 2 (PainExtractor) — concluído', {
    painPointsFound: painPoints.length,
    outputFile: outputPath,
    durationMs: Date.now() - startTime,
  })

  return {
    painPoints,
    outputFile: outputPath,
    durationMs: Date.now() - startTime,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Erros customizados
// ─────────────────────────────────────────────────────────────────────────────

export class PainExtractorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PainExtractorError'
  }
}
