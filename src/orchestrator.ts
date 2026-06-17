import 'dotenv/config'
import { v4 as uuidv4 } from 'uuid'
import { readSoul, addExploredNiche, updateNextNiches } from './memory/soul'
import { addSession, getRecentlyProcessedVideoIds } from './memory/buffer'
import { closeDb } from './memory/knowledge'
import { runScraper } from './agents/scraper'
import { runPainExtractor } from './agents/pain-extractor'
import { runVolumeFilter } from './agents/volume-filter'
import { runIdeaValidator } from './agents/idea-validator'
import { runSkillEngine } from './skills/skill-engine'
import { logger } from './utils/logger'
import OpenAI from 'openai'
import type { OrchestratorOptions, ValidatedIdea } from './types'
import { runMisticaCreator } from './agents/mistica-creator'
import { runOfferArchitect } from './agents/offer-architect'
import { runFunnelDirector } from './agents/funnel-director'
import { runSalesPageCopywriter } from './agents/sales-page-copywriter'
import { runAdCopywriter } from './agents/ad-copywriter'
import { runVideoScriptwriter } from './agents/video-scriptwriter'
import { runDesignBriefAgent } from './agents/design-brief-agent'
import { runTrackingAgent } from './agents/tracking-agent'
import { runMediaBuyer } from './agents/media-buyer'
import { runMetricsAnalyst } from './agents/metrics-analyst'
import { runFinanceAgent } from './agents/finance-agent'
import { runCroAgent } from './agents/cro-agent'
import { runCheckoutOps } from './agents/checkout-ops'
import { runFunnelBuilder } from './agents/funnel-builder'
import { runProductQualityReviewer } from './agents/product-quality-reviewer'
import { runOrganicContentPlanner } from './agents/organic-content-planner'
import { runCreativeAnalyst } from './agents/creative-analyst'
import { runReferenceMiner } from './agents/reference-miner'
import { runVisualFunnelArchitect } from './agents/visual-funnel-architect'
import { runInfraManager } from './agents/infra-manager'
import { runMetaMetricsSync } from './agents/meta-metrics-sync'
import readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'

// ─────────────────────────────────────────────────────────────────────────────
// Orquestrador — coordena os 4 agentes em sequência
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorResult {
  sessionId: string
  query: string
  videosProcessed: number
  painPointsFound: number
  ideasGenerated: number
  ideasApproved: number
  durationMs: number
  success: boolean
  error?: string
}

async function askCeoForIdeaSelection(ideas: ValidatedIdea[]): Promise<string> {
  const rl = readline.createInterface({ input, output })
  try {
    console.log('\n================================================================================')
    console.log('🤖 Mística: CEO, qual destas ideias da rodada você deseja que eu escreva o conteúdo?')
    ideas.forEach((idea, index) => {
      console.log(`[${index + 1}] ${idea.name} (Score: ${idea.marketScore})`)
      console.log(`    Descrição: ${idea.description}`)
    })
    console.log('================================================================================')
    
    while (true) {
      const answer = await rl.question('Digite o número da ideia escolhida: ')
      const selectedIndex = parseInt(answer.trim(), 10) - 1
      if (selectedIndex >= 0 && selectedIndex < ideas.length) {
        return ideas[selectedIndex].id
      }
      console.log('Opção inválida. Digite um número da lista.')
    }
  } finally {
    rl.close()
  }
}

/**
 * Executa o pipeline completo ou agentes específicos
 */
export async function runOrchestrator(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const startTime = Date.now()
  const sessionId = uuidv4()
  
  // ── Lê memória principal para decidir o nicho se não foi passado ───────
  const soul = await readSoul()
  logger.info('Orquestrador — soul carregado', {
    exploredNiches: soul.exploredNiches.length,
    ceoPreferences: soul.ceoPreferences.length,
  })

  const runAll = options.agents.includes('all')
  const needsDiscoveryQuery = runAll || options.agents.some(agent =>
    ['scraper', 'extractor', 'volume', 'validator'].includes(agent),
  )

  let query = options.query
  if (query === 'indiferente') {
    query = undefined // Força a geração autônoma de nicho diversificado
  }

  if (!query && needsDiscoveryQuery) {
    if (soul.nichosParaProximaSessao && soul.nichosParaProximaSessao.length > 0) {
      query = soul.nichosParaProximaSessao[0]
      await updateNextNiches(soul.nichosParaProximaSessao.slice(1))
      logger.info('Orquestrador — usando nicho da fila', { query })
    } else {
      logger.info('Orquestrador — fila de nichos vazia, gerando um novo nicho autônomo...')
      query = await generateAutonomousNiche(soul.exploredNiches)
    }
  }
  query = query ?? 'operacao-low-ticket'

  const maxVideos = options.maxVideos ?? 5

  const shouldRun = (agent: 'scraper' | 'extractor' | 'volume' | 'validator' | 'offer' | 'funnel' | 'copy' | 'ads' | 'videos' | 'design' | 'reference' | 'visual' | 'tracking' | 'media' | 'meta-sync' | 'metrics' | 'finance' | 'cro' | 'checkout' | 'builder' | 'quality' | 'organic' | 'creative-analysis' | 'infra' | 'mistica') =>
    runAll || options.agents.includes(agent)

  logger.info('Orquestrador — iniciando sessão', {
    sessionId,
    query,
    maxVideos,
    agents: options.agents,
  })

  // ── Obtém IDs de vídeos já processados (do buffer) ─────────────────────

  const skipVideoIds = await getRecentlyProcessedVideoIds()
  logger.info('Orquestrador — IDs a pular', { count: skipVideoIds.size })

  let videosProcessed = 0
  let painPointsFound = 0
  let ideasGenerated = 0
  let ideasApproved = 0
  let approvedPainPointIds: string[] = []
  let currentIdeas: ValidatedIdea[] = []

  try {
    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 1 — SCRAPER
    // ──────────────────────────────────────────────────────────────────────

    let processedVideoIds: string[] = []

    if (shouldRun('scraper')) {
      logger.info('Orquestrador — executando Agente 1 (Scraper)')

      const scraperResult = await runScraper({
        query: options.videoIds ? undefined : query,
        videoIds: options.videoIds,
        channelId: options.channelId,
        maxVideos,
        skipVideoIds,
      })

      videosProcessed = scraperResult.processedVideoIds.length
      processedVideoIds = scraperResult.processedVideoIds

      logger.info('Orquestrador — Agente 1 concluído', {
        videosProcessed,
        totalComments: scraperResult.totalComments,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 2 — EXTRATOR DE DORES
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('extractor')) {
      logger.info('Orquestrador — executando Agente 2 (PainExtractor)')

      const extractorResult = await runPainExtractor({
        sessionId,
        videoIds: processedVideoIds.length > 0 ? processedVideoIds : undefined,
      })
      painPointsFound = extractorResult.painPoints.length

      logger.info('Orquestrador — Agente 2 concluído', { painPointsFound })

      // Reflexão de skill (se complexo o suficiente)
      const estimatedToolCalls = Math.ceil(painPointsFound / 10)
      await runSkillEngine({
        agentName: 'pain-extractor',
        taskDescription: `Extração de dores para query "${query}"`,
        toolCallCount: estimatedToolCalls,
        taskOutput: `${painPointsFound} dores identificadas`,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 3 — FILTRO DE VOLUME
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('volume')) {
      logger.info('Orquestrador — executando Agente 3 (VolumeFilter)')

      const volumeResult = await runVolumeFilter({ sessionId })
      approvedPainPointIds = volumeResult.approvedPainPointIds

      logger.info('Orquestrador — Agente 3 concluído', {
        analyzed: volumeResult.totalAnalyzed,
        approved: volumeResult.totalApproved,
      })

      // Reflexão de skill
      await runSkillEngine({
        agentName: 'volume-filter',
        taskDescription: `Análise de volume para ${volumeResult.totalAnalyzed} dores`,
        toolCallCount: volumeResult.totalAnalyzed,
        taskOutput: `${volumeResult.totalApproved} dores aprovadas de ${volumeResult.totalAnalyzed}`,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 4 — VALIDADOR DE IDEIAS
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('validator')) {
      logger.info('Orquestrador — executando Agente 4 (IdeaValidator)')

      const validatorResult = await runIdeaValidator({
        sessionId,
        approvedPainPointIds,
      })

      ideasGenerated = validatorResult.ideas.length
      currentIdeas = validatorResult.ideas
      ideasApproved = validatorResult.ideas.filter(i => i.ceoDecision === 'aprovado').length

      logger.info('Orquestrador — Agente 4 concluído', { ideasGenerated, ideasApproved })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 6 — ARQUITETO DE OFERTA
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('offer')) {
      logger.info('Orquestrador — executando Agente 6 (OfferArchitect)')

      const offerResult = await runOfferArchitect({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador — Agente 6 concluído', {
        ideaId: offerResult.ideaId,
        offerPath: offerResult.offerPath,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 7 — DIRETOR DE FUNIL
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('funnel')) {
      logger.info('Orquestrador — executando Agente 7 (FunnelDirector)')

      const funnelResult = await runFunnelDirector({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador — Agente 7 concluído', {
        ideaId: funnelResult.ideaId,
        funnelPath: funnelResult.funnelPath,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 8 — COPYWRITER DA PÁGINA
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('copy')) {
      logger.info('Orquestrador — executando Agente 8 (SalesPageCopywriter)')

      const copyResult = await runSalesPageCopywriter({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador — Agente 8 concluído', {
        ideaId: copyResult.ideaId,
        copyPath: copyResult.copyPath,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 9 — COPYWRITER DE CRIATIVOS
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('ads')) {
      logger.info('Orquestrador — executando Agente 9 (AdCopywriter)')

      const adResult = await runAdCopywriter({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador — Agente 9 concluído', {
        ideaId: adResult.ideaId,
        creativePath: adResult.creativePath,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 10 — ROTEIRISTA DE VÍDEO
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('videos')) {
      logger.info('Orquestrador — executando Agente 10 (VideoScriptwriter)')

      const videoResult = await runVideoScriptwriter({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador — Agente 10 concluído', {
        ideaId: videoResult.ideaId,
        scriptsPath: videoResult.scriptsPath,
        markdownPath: videoResult.markdownPath,
      })
    }

    // ──────────────────────────────────────────────────────────────────────
    // AGENTE 5 — CRIADOR MÍSTICA
    // ──────────────────────────────────────────────────────────────────────

    if (shouldRun('design')) {
      logger.info('Orquestrador - executando Agente 11 (DesignBriefAgent)')

      const designResult = await runDesignBriefAgent({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 11 concluido', {
        ideaId: designResult.ideaId,
        designPath: designResult.designPath,
        markdownPath: designResult.markdownPath,
      })
    }

    if (shouldRun('reference')) {
      logger.info('Orquestrador - executando Agente 11.5 (ReferenceMiner)')

      const referenceResult = await runReferenceMiner({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 11.5 concluido', {
        ideaId: referenceResult.ideaId,
        reportPath: referenceResult.reportPath,
        markdownPath: referenceResult.markdownPath,
      })
    }

    if (shouldRun('visual')) {
      logger.info('Orquestrador - executando Agente 11.6 (VisualFunnelArchitect)')

      const visualResult = await runVisualFunnelArchitect({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 11.6 concluido', {
        ideaId: visualResult.ideaId,
        architecturePath: visualResult.architecturePath,
        markdownPath: visualResult.markdownPath,
      })
    }

    if (shouldRun('tracking')) {
      logger.info('Orquestrador - executando Agente 12 (TrackingAgent)')

      const trackingResult = await runTrackingAgent({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 12 concluido', {
        ideaId: trackingResult.ideaId,
        trackingPath: trackingResult.trackingPath,
        markdownPath: trackingResult.markdownPath,
      })
    }

    if (shouldRun('media')) {
      logger.info('Orquestrador - executando Agente 13 (MediaBuyer)')

      const mediaResult = await runMediaBuyer({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 13 concluido', {
        ideaId: mediaResult.ideaId,
        mediaPlanPath: mediaResult.mediaPlanPath,
        markdownPath: mediaResult.markdownPath,
      })
    }

    if (shouldRun('meta-sync')) {
      logger.info('Orquestrador - executando Agente 13.5 (MetaMetricsSync)')

      const metaSyncResult = await runMetaMetricsSync({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 13.5 concluido', {
        ideaId: metaSyncResult.ideaId,
        dailyMetricsPath: metaSyncResult.dailyMetricsPath,
        creativeMetricsPath: metaSyncResult.creativeMetricsPath,
      })
    }

    if (shouldRun('metrics')) {
      logger.info('Orquestrador - executando Agente 14 (MetricsAnalyst)')

      const metricsResult = await runMetricsAnalyst({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 14 concluido', {
        ideaId: metricsResult.ideaId,
        decisionPath: metricsResult.decisionPath,
        markdownPath: metricsResult.markdownPath,
      })
    }

    if (shouldRun('finance')) {
      logger.info('Orquestrador - executando Agente 15 (FinanceAgent)')

      const financeResult = await runFinanceAgent({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 15 concluido', {
        ideaId: financeResult.ideaId,
        budgetRulesPath: financeResult.budgetRulesPath,
        markdownPath: financeResult.markdownPath,
      })
    }

    if (shouldRun('cro')) {
      logger.info('Orquestrador - executando Agente 16 (CroAgent)')

      const croResult = await runCroAgent({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 16 concluido', {
        ideaId: croResult.ideaId,
        croPlanPath: croResult.croPlanPath,
        markdownPath: croResult.markdownPath,
      })
    }

    if (shouldRun('checkout')) {
      logger.info('Orquestrador - executando Agente 17 (CheckoutOps)')

      const checkoutResult = await runCheckoutOps({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 17 concluido', {
        ideaId: checkoutResult.ideaId,
        checkoutOpsPath: checkoutResult.checkoutOpsPath,
        markdownPath: checkoutResult.markdownPath,
      })
    }

    if (shouldRun('builder')) {
      logger.info('Orquestrador - executando Agente 18 (FunnelBuilder)')

      const builderResult = await runFunnelBuilder({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 18 concluido', {
        ideaId: builderResult.ideaId,
        pageChecklistPath: builderResult.pageChecklistPath,
        markdownPath: builderResult.markdownPath,
      })
    }

    if (shouldRun('quality')) {
      logger.info('Orquestrador - executando Agente 19 (ProductQualityReviewer)')

      const qualityResult = await runProductQualityReviewer({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 19 concluido', {
        ideaId: qualityResult.ideaId,
        qualityReviewPath: qualityResult.qualityReviewPath,
        markdownPath: qualityResult.markdownPath,
      })
    }

    if (shouldRun('organic')) {
      logger.info('Orquestrador - executando Agente 20 (OrganicContentPlanner)')

      const organicResult = await runOrganicContentPlanner({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 20 concluido', {
        ideaId: organicResult.ideaId,
        calendarPath: organicResult.calendarPath,
        markdownPath: organicResult.markdownPath,
      })
    }

    if (shouldRun('creative-analysis')) {
      logger.info('Orquestrador - executando Agente 21 (CreativeAnalyst)')

      const creativeAnalysisResult = await runCreativeAnalyst({
        sessionId,
        ideaId: options.selectIdea,
      })

      logger.info('Orquestrador - Agente 21 concluido', {
        ideaId: creativeAnalysisResult.ideaId,
        analysisPath: creativeAnalysisResult.analysisPath,
        markdownPath: creativeAnalysisResult.markdownPath,
      })
    }

    if (shouldRun('infra')) {
      logger.info('Orquestrador - executando Agente 22 (InfraManager)')

      const infraResult = await runInfraManager({
        sessionId,
      })

      logger.info('Orquestrador - Agente 22 concluido', {
        auditPath: infraResult.auditPath,
        markdownPath: infraResult.markdownPath,
      })
    }

    if (shouldRun('mistica')) {
      logger.info('Orquestrador — executando Agente 5 (Criador Mística)')

      let chosenIdea: ValidatedIdea | undefined

      // Se não temos ideias na sessão atual, tenta carregar do index.json
      let candidateIdeas = currentIdeas
      if (candidateIdeas.length === 0) {
        try {
          const { readTextOrNull, fileExists } = require('./mcp/filesystem')
          if (await fileExists('data/validated-ideas/index.json')) {
            const content = await readTextOrNull('data/validated-ideas/index.json')
            if (content) {
              candidateIdeas = JSON.parse(content)
            }
          }
        } catch (err) {
          logger.warn('Orquestrador — falha ao ler index.json', { error: String(err) })
        }
      }

      if (candidateIdeas.length === 0) {
        logger.warn('Orquestrador — Criador Mística abortado: nenhuma ideia encontrada para processar.')
      } else {
        // 1. Filtra pela opção de selectIdea (CLI/parâmetro)
        if (options.selectIdea) {
          chosenIdea = candidateIdeas.find(i => i.id === options.selectIdea || i.name.toLowerCase().includes(options.selectIdea!.toLowerCase()))
        }

        // 2. Tenta encontrar alguma já aprovada pelo CEO na rodada
        if (!chosenIdea) {
          chosenIdea = candidateIdeas.find(i => i.ceoDecision === 'aprovado')
        }

        // 3. Se ainda não temos uma escolhida, pergunta ao CEO se for console interativo, senão pega a de maior score
        if (!chosenIdea) {
          const isInteractive = process.stdin.isTTY
          if (isInteractive) {
            const selectedId = await askCeoForIdeaSelection(candidateIdeas)
            chosenIdea = candidateIdeas.find(i => i.id === selectedId)
          } else {
            // Fallback para a de maior score de mercado
            chosenIdea = [...candidateIdeas].sort((a, b) => b.marketScore - a.marketScore)[0]
            logger.warn('Orquestrador — console não-interativo. Selecionando automaticamente a ideia de maior marketScore para o Criador Mística', {
              autoSelectedName: chosenIdea.name,
              score: chosenIdea.marketScore,
            })
          }
        }

        if (chosenIdea) {
          logger.info('Orquestrador — rodando Agente Mística para a ideia', {
            id: chosenIdea.id,
            name: chosenIdea.name,
          })

          const misticaResult = await runMisticaCreator({
            sessionId,
            ideaId: chosenIdea.id,
          })

          logger.info('Orquestrador — Agente 5 concluído', {
            specialistRole: misticaResult.specialistRole,
            contentPath: misticaResult.contentPath,
          })
        } else {
          logger.warn('Orquestrador — nenhuma ideia pôde ser selecionada para o Agente Mística.')
        }
      }
    }

    // ── Atualiza memória ──────────────────────────────────────────────────

    if (needsDiscoveryQuery) {
      await addSession({
      sessionId,
      query,
      ranAt: new Date().toISOString(),
      videosProcessed,
      painPointsFound,
      ideasGenerated,
      ideasApproved,
      processedVideoIds,
      } as Parameters<typeof addSession>[0])

      await addExploredNiche(
      query,
      `${videosProcessed} vídeos, ${painPointsFound} dores, ${ideasGenerated} ideias — ${new Date().toLocaleDateString('pt-BR')}`,
      )
    }

    const durationMs = Date.now() - startTime
    logger.info('Orquestrador — sessão concluída', {
      sessionId,
      videosProcessed,
      painPointsFound,
      ideasGenerated,
      durationMs,
    })

    return {
      sessionId,
      query,
      videosProcessed,
      painPointsFound,
      ideasGenerated,
      ideasApproved,
      durationMs,
      success: true,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : String(error)

    logger.error('Orquestrador — sessão falhou', { sessionId, error: errorMsg, durationMs })

    return {
      sessionId,
      query,
      videosProcessed,
      painPointsFound,
      ideasGenerated,
      ideasApproved,
      durationMs,
      success: false,
      error: errorMsg,
    }
  } finally {
    closeDb()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gerador de Nicho Autônomo
// ─────────────────────────────────────────────────────────────────────────────

async function generateAutonomousNiche(exploredNiches: string[]): Promise<string> {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const country = process.env.TARGET_COUNTRY || 'BR'
    const context = country === 'US' ? 'o mercado dos Estados Unidos' : 'o mercado Brasileiro'
    const lang = country === 'US' ? 'inglês' : 'português'
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: `Você é um diretor de pesquisa de mercado focado em micro-SaaS para ${context}.
Sua missão é sugerir um ÚNICO nicho inexplorado (uma frase curta de pesquisa para o YouTube) para procurarmos dores.
REGRA DE OURO: NÃO use nichos de finanças, ganhar dinheiro online, renda extra ou investimentos. Seja criativo e diversificado (ex: saúde, hobbies, negócios locais, produtividade, pets, educação, etc).
REGRA 2: A frase de pesquisa deve ser AMPLA E POPULAR o suficiente para retornar vídeos com MUITOS comentários. Evite coisas hiper-específicas.
Não repita nichos parecidos com estes que já exploramos:
${exploredNiches.map(n => '- ' + n).join('\n')}

Responda APENAS com a string de pesquisa em ${lang}. Exemplo: "gestão de clínicas odontológicas" ou "automação para advogados". Não use aspas na resposta.`
        }
      ]
    })
    
    return response.choices[0]?.message?.content?.trim() || 'gestão de pequenos negócios'
  } catch (error) {
    logger.error('Falha ao gerar nicho autônomo, usando fallback', { error })
    return 'ferramentas para advogados'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI — execução direta via ts-node
// npx ts-node src/orchestrator.ts --query "produtividade" --maxVideos 10
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : undefined
  }
  const hasFlag = (flag: string): boolean => args.includes(flag)

  const query = getArg('--query') ?? process.env.DEFAULT_QUERY
  const videoIdsRaw = getArg('--videoIds')
  const videoIds = videoIdsRaw?.split(',').map(s => s.trim())
  const channelId = getArg('--channelId')
  const maxVideos = parseInt(getArg('--maxVideos') ?? '5', 10)
  const agentsRaw = getArg('--agents') ?? 'all'
  const agents = agentsRaw.split(',').map(s => s.trim()) as OrchestratorOptions['agents']
  const debug = hasFlag('--debug')
  const selectIdea = getArg('--selectIdea')

  if (debug) {
    process.env.LOG_LEVEL = 'debug'
  }

  const result = await runOrchestrator({
    query,
    videoIds,
    channelId,
    maxVideos,
    agents,
    debug,
    selectIdea,
  })

  if (!result.success) {
    logger.error('Pipeline falhou', { error: result.error })
    process.exit(1)
  }

  logger.info('Pipeline concluído com sucesso', { ...result })
}

// Executa CLI apenas quando chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('Erro fatal:', error)
    process.exit(1)
  })
}
