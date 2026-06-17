/**
 * Smoke Test — Valida o pipeline completo end-to-end sem chamar APIs reais
 *
 * Verifica que todos os módulos importam corretamente e as instâncias
 * respondem às interfaces esperadas. Não requer chaves de API.
 *
 * Para rodar: npx tsx tests/smoke.ts
 */
import 'dotenv/config'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.error(`  ❌ FALHOU: ${message}`)
    failed++
  }
}

async function section(name: string, fn: () => void | Promise<void>): Promise<void> {
  console.log(`\n📦 ${name}`)
  try {
    await fn()
  } catch (e) {
    console.error(`  💥 Falha ao importar/inicializar:`, e)
    failed++
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Smoke tests — sem chamadas de rede
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 MicroSaaS Discovery — Smoke Test\n')
  console.log('Verificando que todos os módulos carregam corretamente...')

  // ── Utilitários ───────────────────────────────────────────────────────────

  await section('utils/logger', async () => {
    const { logger } = await import('../src/utils/logger')
    check(typeof logger === 'object', 'logger é objeto')
    check(typeof logger.info === 'function', 'logger.info é função')
    check(typeof logger.error === 'function', 'logger.error é função')
    check(typeof logger.warn === 'function', 'logger.warn é função')
    check(typeof logger.debug === 'function', 'logger.debug é função')
    // Smoke: não deve lançar exceção
    logger.info('smoke test', { module: 'logger' })
  })

  await section('utils/retry', async () => {
    const { retry, delay, processWithRateLimit } = await import('../src/utils/retry')
    check(typeof retry === 'function', 'retry é função')
    check(typeof delay === 'function', 'delay é função')
    check(typeof processWithRateLimit === 'function', 'processWithRateLimit é função')

    // Smoke: retry com sucesso imediato
    const result = await retry(() => Promise.resolve(42), { maxAttempts: 1, label: 'smoke' })
    check(result === 42, 'retry retorna valor da função')

    // Smoke: delay não deve lançar
    await delay(10)
  })

  // ── MCPs ──────────────────────────────────────────────────────────────────

  await section('mcp/filesystem', async () => {
    const { readJsonOrNull, writeJson, fileExists, ensureDir } = await import('../src/mcp/filesystem')
    check(typeof readJsonOrNull === 'function', 'readJsonOrNull é função')
    check(typeof writeJson === 'function', 'writeJson é função')
    check(typeof fileExists === 'function', 'fileExists é função')
    check(typeof ensureDir === 'function', 'ensureDir é função')

    // Smoke: escrever e ler arquivo temporário
    const tmpPath = '.smoke-test-tmp.json'
    await writeJson(tmpPath, { ok: true, ts: Date.now() })
    const read = await readJsonOrNull<{ ok: boolean }>(tmpPath)
    check(read?.ok === true, 'writeJson + readJsonOrNull funcionam')

    // Limpeza
    const { unlink } = await import('fs/promises')
    await unlink(tmpPath).catch(() => {})
  })

  await section('mcp/youtube', async () => {
    const { searchVideos, getVideoMetadata, getVideoComments } = await import('../src/mcp/youtube')
    check(typeof searchVideos === 'function', 'searchVideos é função')
    check(typeof getVideoMetadata === 'function', 'getVideoMetadata é função')
    check(typeof getVideoComments === 'function', 'getVideoComments é função')

    // Smoke sem API key: getVideoMetadata com array vazio não acessa a rede
    const empty = await getVideoMetadata([])
    check(Array.isArray(empty) && empty.length === 0, 'getVideoMetadata([]) retorna []')
  })

  await section('mcp/trends', async () => {
    const { analyzeTrends, estimateCompetitors } = await import('../src/mcp/trends')
    check(typeof analyzeTrends === 'function', 'analyzeTrends é função')
    check(typeof estimateCompetitors === 'function', 'estimateCompetitors é função')
  })

  await section('mcp/registry', async () => {
    const { listConnectorHealth, getConnectorHealth } = await import('../src/mcp/registry')
    const health = listConnectorHealth()
    check(Array.isArray(health) && health.length >= 4, 'listConnectorHealth retorna conectores')
    check(getConnectorHealth('micro-offer').status === 'ready', 'MicroOffer MCP esta pronto')
  })

  await section('mcp/micro-offer', async () => {
    const { recordMcpEvent, upsertMicroOfferRecord, readMicroOfferRecord } = await import('../src/mcp/micro-offer')
    check(typeof recordMcpEvent === 'function', 'recordMcpEvent é função')
    check(typeof upsertMicroOfferRecord === 'function', 'upsertMicroOfferRecord é função')
    check(typeof readMicroOfferRecord === 'function', 'readMicroOfferRecord é função')
  })

  await section('mcp/supabase', async () => {
    const { getSupabaseHealth, insertRows, upsertRows, checkSupabaseTables } = await import('../src/mcp/supabase')
    check(typeof getSupabaseHealth === 'function', 'getSupabaseHealth é função')
    check(typeof insertRows === 'function', 'insertRows é função')
    check(typeof upsertRows === 'function', 'upsertRows é função')
    check(typeof checkSupabaseTables === 'function', 'checkSupabaseTables é função')
  })

  await section('mcp/youtube-research', async () => {
    const { getYoutubeResearchHealth, researchYoutubeComments } = await import('../src/mcp/youtube-research')
    check(typeof getYoutubeResearchHealth === 'function', 'getYoutubeResearchHealth é função')
    check(typeof researchYoutubeComments === 'function', 'researchYoutubeComments é função')
  })

  await section('mcp/browser-playwright', async () => {
    const { getBrowserPlaywrightHealth, assertBrowserConnectorReady } = await import('../src/mcp/browser-playwright')
    check(typeof getBrowserPlaywrightHealth === 'function', 'getBrowserPlaywrightHealth é função')
    check(typeof assertBrowserConnectorReady === 'function', 'assertBrowserConnectorReady é função')
  })

  await section('mcp/firecrawl', async () => {
    const { getFirecrawlHealth, scrapeFunnelReference } = await import('../src/mcp/firecrawl')
    check(typeof getFirecrawlHealth === 'function', 'getFirecrawlHealth é função')
    check(typeof scrapeFunnelReference === 'function', 'scrapeFunnelReference é função')
  })

  await section('mcp/meta-ads', async () => {
    const {
      getMetaAdsHealth,
      getMetaAdAccount,
      listMetaCampaigns,
      getMetaInsights,
      sendMetaCapiEvent,
      validateMetaAdsConnection,
    } = await import('../src/mcp/meta-ads')
    check(typeof getMetaAdsHealth === 'function', 'getMetaAdsHealth é função')
    check(typeof getMetaAdAccount === 'function', 'getMetaAdAccount é função')
    check(typeof listMetaCampaigns === 'function', 'listMetaCampaigns é função')
    check(typeof getMetaInsights === 'function', 'getMetaInsights é função')
    check(typeof sendMetaCapiEvent === 'function', 'sendMetaCapiEvent é função')
    check(typeof validateMetaAdsConnection === 'function', 'validateMetaAdsConnection é função')
  })

  await section('mcp/performance-decision', async () => {
    const { getPerformanceSnapshot } = await import('../src/mcp/performance-decision')
    check(typeof getPerformanceSnapshot === 'function', 'getPerformanceSnapshot é função')
  })

  await section('mcp/performance-controller', async () => {
    const { getPerformanceActionPlan } = await import('../src/mcp/performance-controller')
    check(typeof getPerformanceActionPlan === 'function', 'getPerformanceActionPlan é função')
  })

  await section('mcp/go-live-checklist', async () => {
    const { getGoLiveChecklist } = await import('../src/mcp/go-live-checklist')
    check(typeof getGoLiveChecklist === 'function', 'getGoLiveChecklist é função')
  })

  await section('mcp/offer-registry', async () => {
    const { readActiveOffer, getActiveOfferReadiness } = await import('../src/mcp/offer-registry')
    check(typeof readActiveOffer === 'function', 'readActiveOffer é função')
    check(typeof getActiveOfferReadiness === 'function', 'getActiveOfferReadiness é função')
  })

  // ── Memória ───────────────────────────────────────────────────────────────

  await section('memory/buffer', async () => {
    const { readBuffer, addSession, getRecentlyProcessedVideoIds } = await import('../src/memory/buffer')
    check(typeof readBuffer === 'function', 'readBuffer é função')
    check(typeof addSession === 'function', 'addSession é função')
    check(typeof getRecentlyProcessedVideoIds === 'function', 'getRecentlyProcessedVideoIds é função')
  })

  await section('memory/soul', async () => {
    const { readSoul, addExploredNiche, addCeoPreference } = await import('../src/memory/soul')
    check(typeof readSoul === 'function', 'readSoul é função')
    check(typeof addExploredNiche === 'function', 'addExploredNiche é função')
    check(typeof addCeoPreference === 'function', 'addCeoPreference é função')
  })

  await section('memory/knowledge', async () => {
    const { getStats, hashDescription, findByHash, closeDb } = await import('../src/memory/knowledge')
    check(typeof getStats === 'function', 'getStats é função')
    check(typeof hashDescription === 'function', 'hashDescription é função')
    check(typeof findByHash === 'function', 'findByHash é função')
    check(typeof closeDb === 'function', 'closeDb é função')

    // Smoke: hash deve ser determinístico
    const h1 = hashDescription('dor de cabeça constante com planilhas')
    const h2 = hashDescription('dor de cabeça constante com planilhas')
    check(h1 === h2 && h1.length === 16, 'hashDescription é determinístico (SHA-256 trunctado 16 chars)')
  })

  // ── Agentes ───────────────────────────────────────────────────────────────

  await section('agents/scraper', async () => {
    const { runScraper, ScraperError } = await import('../src/agents/scraper')
    check(typeof runScraper === 'function', 'runScraper é função')
    check(typeof ScraperError === 'function', 'ScraperError é classe')
  })

  await section('agents/pain-extractor', async () => {
    const { runPainExtractor } = await import('../src/agents/pain-extractor')
    check(typeof runPainExtractor === 'function', 'runPainExtractor é função')
  })

  await section('agents/volume-filter', async () => {
    const { runVolumeFilter } = await import('../src/agents/volume-filter')
    check(typeof runVolumeFilter === 'function', 'runVolumeFilter é função')
  })

  await section('agents/idea-validator', async () => {
    const { runIdeaValidator } = await import('../src/agents/idea-validator')
    check(typeof runIdeaValidator === 'function', 'runIdeaValidator é função')
  })

  await section('agents/mistica-creator', async () => {
    const { runMisticaCreator } = await import('../src/agents/mistica-creator')
    check(typeof runMisticaCreator === 'function', 'runMisticaCreator é função')
  })

  await section('agents/reference-miner', async () => {
    const { runReferenceMiner } = await import('../src/agents/reference-miner')
    check(typeof runReferenceMiner === 'function', 'runReferenceMiner é função')
  })

  await section('agents/visual-funnel-architect', async () => {
    const { runVisualFunnelArchitect } = await import('../src/agents/visual-funnel-architect')
    check(typeof runVisualFunnelArchitect === 'function', 'runVisualFunnelArchitect é função')
  })

  await section('agents/infra-manager', async () => {
    const { runInfraManager } = await import('../src/agents/infra-manager')
    check(typeof runInfraManager === 'function', 'runInfraManager é função')
  })

  await section('agents/meta-metrics-sync', async () => {
    const { runMetaMetricsSync } = await import('../src/agents/meta-metrics-sync')
    check(typeof runMetaMetricsSync === 'function', 'runMetaMetricsSync é função')
  })

  // ── Skills ────────────────────────────────────────────────────────────────

  await section('skills/skill-engine', async () => {
    const { runSkillEngine } = await import('../src/skills/skill-engine')
    check(typeof runSkillEngine === 'function', 'runSkillEngine é função')
  })

  await section('skills/skill-loader', async () => {
    const { buildSkillsContext, loadSkillsMetadata } = await import('../src/skills/skill-loader')
    check(typeof buildSkillsContext === 'function', 'buildSkillsContext é função')
    check(typeof loadSkillsMetadata === 'function', 'loadSkillsMetadata é função')
  })

  // ── Core ──────────────────────────────────────────────────────────────────

  await section('orchestrator', async () => {
    const { runOrchestrator } = await import('../src/orchestrator')
    check(typeof runOrchestrator === 'function', 'runOrchestrator é função')
  })

  await section('dashboard-server', async () => {
    const { createDashboardServer, updateCeoDecision } = await import('../src/dashboard-server')
    check(typeof createDashboardServer === 'function', 'createDashboardServer é função')
    check(typeof updateCeoDecision === 'function', 'updateCeoDecision é função')
  })

  // ── Resultado ─────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════')
  const total = passed + failed
  console.log(`📊 Resultado: ${passed}/${total} verificações passaram`)
  if (failed === 0) {
    console.log('🎉 Todos os módulos carregam corretamente!')
  } else {
    console.log(`⚠️  ${failed} verificação(ões) falharam — revise os erros acima`)
  }
  console.log('═══════════════════════════════════════════')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('💥 Erro fatal no smoke test:', e)
  process.exit(1)
})
