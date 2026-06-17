import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import { ensureDir, readAllJson, readJson, writeText, fileExists, readTextOrNull } from '../mcp/filesystem'
import { getSessionSummary } from '../memory/buffer'
import { logger } from '../utils/logger'
import type {
  PainPointsFile,
  VolumeReportFile,
  ValidatedIdea,
  LLMValidatedIdeaResponse,
  PainPoint,
  VolumeReport,
} from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Agente 4 — Validador de Ideias
// Responsabilidade: transformar dores validadas em fichas estruturadas de micro-SaaS
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_VERSION = '1.0.0'
const MODEL = 'gpt-4o'

const client = new OpenAI()

export interface IdeaValidatorInput {
  sessionId: string
  approvedPainPointIds: string[]
  painPointsDir?: string
  volumeReportsDir?: string
}

export interface IdeaValidatorOutput {
  ideas: ValidatedIdea[]
  outputFiles: string[]
  durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt para geração de fichas
// ─────────────────────────────────────────────────────────────────────────────

function getTargetCountry(): string {
  return (process.env.TARGET_COUNTRY || 'BR').toUpperCase()
}

function buildValidationPrompt(
  painPoint: PainPoint,
  volumeReport: VolumeReport,
  sessionSummary: string,
): string {
  const isUS = getTargetCountry() === 'US'
  const marketContext = isUS 
    ? 'com foco no mercado dos Estados Unidos' 
    : 'com foco no mercado brasileiro'
  const mrrContext = isUS
    ? 'Meta de receita deve ser realista para o mercado US (ex: $5k-15k/mês em vendas ou assinaturas)'
    : 'Meta de receita deve ser realista para o mercado BR (ex: R$5k-15k/mês em vendas ou assinaturas)'
  const pricingContext = isUS
    ? '"pricingModel": "Ex: $27-$67 Pagamento Único OU $19/mês Assinatura",\n  "estimatedMRR": "Ex: $5k-15k/mo"'
    : '"pricingModel": "Ex: R$47-R$67 Pagamento Único OU R$29/mês Assinatura",\n  "estimatedMRR": "Ex: R$5k-15k/mês"'

  return `Você é um especialista na criação de ofertas irresistíveis ("No Brain") e descoberta de oportunidades ${marketContext}.
Baseado na dor validada abaixo e nos dados de mercado, gere uma ficha completa de oportunidade. O formato pode ser um Micro-SaaS prático ou um produto Low Ticket (Kit, Planilha, Template).

## DOR IDENTIFICADA
${painPoint.description}

**Categoria:** ${painPoint.category}
**Frequência nos comentários:** ${painPoint.frequency} menções
**Exemplos reais:**
${painPoint.examples.slice(0, 3).map(e => `- "${e}"`).join('\n')}

## DADOS DE MERCADO
- Google Trends Score: ${volumeReport.googleTrendsScore}/100
- Tendência: ${volumeReport.trendDirection}
- Volume mensal estimado de busca: ${volumeReport.monthlySearchVolume.toLocaleString('pt-BR')} buscas
- Queries relacionadas: ${volumeReport.topRelatedQueries.join(', ')}
- Competidores estimados: ${volumeReport.competitorCount}
- Score de mercado: ${volumeReport.marketScore}/100

## CONTEXTO DO SISTEMA (sessões anteriores)
${sessionSummary}

## REGRAS (OS PILARES DO PRODUTO)
1. TANGIBILIDADE É A PREMISSA: A solução (SaaS ou Kit) precisa ser altamente visual. O usuário tem que "comer com os olhos". Se for SaaS, tem que ser algo com uma tela onde o usuário aperta um botão e resolve (ex: "Criativo Dedo na Tela").
2. FOCO NA RUMINAÇÃO: O produto deve curar uma dor que a pessoa já está ruminando AGORA. Tem que gerar compra por impulso.
3. FORMATO: Sem cursos longos. Nesta operação v1, priorize produto digital em PDF/kit de consulta, mapa, guia, checklist, protocolo visual ou planilha simples. Não proponha produto físico, estoque, envio, vídeos como entrega principal ou aulas longas, a menos que o CEO peça explicitamente.
4. ${mrrContext}
5. Features: Máximo 3 a 5 entregáveis ou telas/funções chave no MVP.
6. Complexidade técnica: 'baixa' ou 'media' (possível de validar rápido, em dias ou poucas semanas).

Retorne APENAS um JSON válido no seguinte formato, sem texto adicional:
{
  "name": "Nome Fantasia do Produto",
  "description": "Descrição em 3-4 frases (venda o formato visual e a cura da dor)",
  "targetAudience": "Quem são as pessoas com essa dor",
  "coreFeatures": ["Feature/Entregável 1", "Feature/Entregável 2", "Feature/Entregável 3"],
  ${pricingContext},
  "technicalComplexity": "baixa | media | alta",
  "timeToMVP": "Ex: 2 a 5 dias (Planilha) ou 3 semanas (SaaS)"
}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Geração de ficha via Claude
// ─────────────────────────────────────────────────────────────────────────────

async function generateIdeaCard(
  painPoint: PainPoint,
  volumeReport: VolumeReport,
  sessionSummary: string,
): Promise<LLMValidatedIdeaResponse | null> {
  logger.debug('IdeaValidator — gerando ficha', {
    painPointId: painPoint.id,
    description: painPoint.description.slice(0, 60),
  })

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: buildValidationPrompt(painPoint, volumeReport, sessionSummary),
      },
    ],
    response_format: { type: 'json_object' }
  })

  const responseText = completion.choices[0]?.message?.content || ''

  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    logger.warn('IdeaValidator — OpenAI não retornou JSON válido', {
      painPointId: painPoint.id,
    })
    return null
  }

  try {
    return JSON.parse(jsonMatch[0]) as LLMValidatedIdeaResponse
  } catch (error) {
    logger.error('IdeaValidator — erro ao parsear JSON', {
      painPointId: painPoint.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Markdown da ficha
// ─────────────────────────────────────────────────────────────────────────────

function renderIdeaMarkdown(idea: ValidatedIdea, painPoint: PainPoint): string {
  const featuresLines = idea.coreFeatures.map(f => `- ${f}`).join('\n')
  const examplesLines = painPoint.examples.slice(0, 3).map(e => `> "${e}"`).join('\n')

  return `---
id: ${idea.id}
painPointId: ${idea.painPointId}
validatedAt: ${idea.validatedAt}
marketScore: ${idea.marketScore}
ceoDecision: ${idea.ceoDecision}
---

# ${idea.name}

## Dor identificada
${painPoint.description}

## Por que é uma oportunidade
Dor mencionada ${painPoint.frequency} vezes em comentários YouTube. Score de mercado ${idea.marketScore}/100 com tendência ${painPoint.category}.

## Solução proposta
${idea.description}

## Público-alvo
${idea.targetAudience}

## Funcionalidades core (MVP)
${featuresLines}

## Modelo de negócio
${idea.pricingModel}

## Estimativa de receita (MRR)
${idea.estimatedMRR}

## Complexidade técnica
${idea.technicalComplexity}

## Tempo estimado para MVP
${idea.timeToMVP}

## Comentários representativos
${examplesLines}

---
## Decisão CEO
- [ ] Aprovado — partir para validação com usuários
- [ ] Rejeitado
- [ ] Mais pesquisa

**Notas do CEO:**
${idea.ceoNotes || '(em branco)'}
`
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução principal do agente
// ─────────────────────────────────────────────────────────────────────────────

export async function runIdeaValidator(input: IdeaValidatorInput): Promise<IdeaValidatorOutput> {
  const startTime = Date.now()
  const painPointsDir = input.painPointsDir ?? 'data/pain-points'
  const volumeReportsDir = input.volumeReportsDir ?? 'data/volume-reports'

  logger.info('Agente 4 (IdeaValidator) — iniciando', {
    sessionId: input.sessionId,
    approvedPainPoints: input.approvedPainPointIds.length,
  })

  await ensureDir('data/validated-ideas')

  if (input.approvedPainPointIds.length === 0) {
    logger.warn('IdeaValidator — nenhum pain point aprovado para validar')
    return { ideas: [], outputFiles: [], durationMs: Date.now() - startTime }
  }

  // ── Carrega pain points e volume reports ─────────────────────────────────

  const painFiles = await readAllJson<PainPointsFile>(painPointsDir)
  const allPainPoints = painFiles.flatMap(f => f.painPoints)

  const approvedPainPoints = allPainPoints.filter(p =>
    input.approvedPainPointIds.includes(p.id),
  )

  if (approvedPainPoints.length === 0) {
    logger.warn('IdeaValidator — pain points aprovados não encontrados nos arquivos')
  }

  // Contexto de sessões anteriores para o Claude
  const sessionSummary = await getSessionSummary()

  const ideas: ValidatedIdea[] = []
  const outputFiles: string[] = []

  // ── Gera ficha para cada dor aprovada ────────────────────────────────────

  for (const painPoint of approvedPainPoints) {
    try {
      // Carrega volume report correspondente
      let volumeReport: VolumeReport | null = null
      try {
        const reportFile = await readJson<VolumeReportFile>(
          `${volumeReportsDir}/${painPoint.id}.json`,
        )
        volumeReport = reportFile.report
      } catch {
        logger.warn('IdeaValidator — volume report não encontrado, usando fallback', {
          painPointId: painPoint.id,
        })
        volumeReport = {
          painPointId: painPoint.id,
          googleTrendsScore: 65,
          monthlySearchVolume: 50_000,
          trendDirection: 'estavel',
          topRelatedQueries: [],
          competitorCount: 5,
          marketScore: 65,
        }
      }

      const generated = await generateIdeaCard(painPoint, volumeReport, sessionSummary)
      if (!generated) continue

      const idea: ValidatedIdea = {
        id: uuidv4(),
        painPointId: painPoint.id,
        name: generated.name,
        description: generated.description,
        targetAudience: generated.targetAudience,
        coreFeatures: generated.coreFeatures.slice(0, 5),
        pricingModel: generated.pricingModel,
        estimatedMRR: generated.estimatedMRR,
        technicalComplexity: generated.technicalComplexity,
        timeToMVP: generated.timeToMVP,
        marketScore: volumeReport.marketScore,
        validatedAt: new Date().toISOString(),
        ceoDecision: 'pendente',
        ceoNotes: '',
      }

      ideas.push(idea)

      // Persiste como Markdown
      const mdContent = renderIdeaMarkdown(idea, painPoint)
      const filePath = `data/validated-ideas/${idea.id}.md`
      await writeText(filePath, mdContent)
      outputFiles.push(filePath)

      logger.info('IdeaValidator — ficha gerada', {
        id: idea.id,
        name: idea.name,
        marketScore: idea.marketScore,
        complexity: idea.technicalComplexity,
      })

      // Pausa entre chamadas à OpenAI
      await new Promise(r => setTimeout(r, 1_000))
    } catch (error) {
      logger.error('IdeaValidator — erro ao gerar ficha, pulando', {
        painPointId: painPoint.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const durationMs = Date.now() - startTime
  logger.info('Agente 4 (IdeaValidator) — concluído', {
    durationMs,
  })

  // Salva o index.json consolidado para o Dashboard
  try {
    const indexPath = 'data/validated-ideas/index.json'
    let existingIdeas: ValidatedIdea[] = []
    if (await fileExists(indexPath)) {
      const content = await readTextOrNull(indexPath)
      if (content) existingIdeas = JSON.parse(content)
    }
    
    // Adiciona as novas ideias no início da lista
    const mergedIdeas = [...ideas, ...existingIdeas]
    await writeText(indexPath, JSON.stringify(mergedIdeas, null, 2))
    logger.info('IdeaValidator — index.json atualizado', { totalIdeas: mergedIdeas.length })
  } catch (err) {
    logger.error('IdeaValidator — erro ao salvar index.json do dashboard', { error: String(err) })
  }

  return { ideas, outputFiles, durationMs }
}

// ─────────────────────────────────────────────────────────────────────────────
// Erros customizados
// ─────────────────────────────────────────────────────────────────────────────

export class IdeaValidatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdeaValidatorError'
  }
}
