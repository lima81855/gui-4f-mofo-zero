/**
 * Testes de integração — Agente 1 (Scraper)
 *
 * Combina o MCP YouTube com o Scraper para validar o pipeline completo.
 * Exige YOUTUBE_API_KEY no .env
 *
 * Para rodar: npx tsx tests/agents/scraper.test.ts
 */
import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { runScraper } from '../../src/agents/scraper'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.error(`  ❌ FALHOU: ${message}`)
    failed++
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n📋 ${name}`)
  try {
    await fn()
  } catch (e) {
    console.error(`  💥 Exceção não tratada:`, e)
    failed++
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup helper
// ─────────────────────────────────────────────────────────────────────────────

async function cleanupTestFiles(videoIds: string[]): Promise<void> {
  for (const id of videoIds) {
    const filePath = path.join(process.cwd(), 'data', 'raw-comments', `${id}.json`)
    try {
      await fs.unlink(filePath)
    } catch {
      // arquivo pode não existir
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite de testes
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🤖 Agente 1 (Scraper) — Suite de testes de integração\n')

  if (!process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY.startsWith('YOUR_')) {
    console.error('⛔ YOUTUBE_API_KEY não configurada. Configure o .env antes de rodar os testes.')
    process.exit(1)
  }

  // ── Teste 1: Scraper por query ───────────────────────────────────────────
  await test('runScraper — coleta por query', async () => {
    const result = await runScraper({
      query: 'como ganhar dinheiro online',
      maxVideos: 2,
    })

    assert(typeof result.processedVideoIds === 'object', 'processedVideoIds é array')
    assert(result.processedVideoIds.length > 0, `Processou ${result.processedVideoIds.length} vídeo(s)`)
    assert(result.totalComments > 0, `Coletou ${result.totalComments} comentários no total`)
    assert(result.durationMs > 0, 'durationMs registrado')
    assert(result.outputFiles.length === result.processedVideoIds.length, 'Um arquivo por vídeo')

    console.log(`  📊 Vídeos: ${result.processedVideoIds.length} | Comentários: ${result.totalComments} | Tempo: ${result.durationMs}ms`)

    // Verifica se os arquivos foram realmente criados em disco
    for (const file of result.outputFiles) {
      const filePath = path.join(process.cwd(), file)
      const exists = await fs.stat(filePath).then(() => true).catch(() => false)
      assert(exists, `Arquivo existe em disco: ${file}`)

      if (exists) {
        const content = JSON.parse(await fs.readFile(filePath, 'utf-8'))
        assert(Array.isArray(content.comments), `${file} tem campo 'comments' array`)
        assert(typeof content.metadata === 'object', `${file} tem campo 'metadata'`)
        assert(typeof content.metadata.videoId === 'string', `${file} metadata tem videoId`)
      }
    }

    // Cleanup dos arquivos de teste
    await cleanupTestFiles(result.processedVideoIds)
    console.log('  🧹 Arquivos de teste removidos')
  })

  // ── Teste 2: Scraper com skipVideoIds ────────────────────────────────────
  await test('runScraper — respeita skipVideoIds', async () => {
    // Primeiro coleta 1 vídeo
    const first = await runScraper({ query: 'produtividade pessoal', maxVideos: 1 })
    const videoId = first.processedVideoIds[0]
    await cleanupTestFiles(first.processedVideoIds)

    if (!videoId) {
      console.log('  ⚠️  Nenhum vídeo coletado — pulando subtest')
      return
    }

    // Agora tenta coletar o mesmo vídeo com skip
    const second = await runScraper({
      query: 'produtividade pessoal',
      maxVideos: 1,
      skipVideoIds: new Set([videoId]),
    })

    assert(
      !second.processedVideoIds.includes(videoId),
      `Vídeo já processado foi pulado (skipVideoIds funcionou)`,
    )
    await cleanupTestFiles(second.processedVideoIds)
  })

  // ── Teste 3: Scraper com videoIds diretos ────────────────────────────────
  await test('runScraper — coleta por videoIds diretos', async () => {
    // Gangnam Style — vídeo estável, comentários sempre ativos
    const result = await runScraper({
      videoIds: ['9bZkp7q19f0'],
    })

    assert(result.processedVideoIds.length === 1, 'Processou exatamente 1 vídeo')
    assert(result.processedVideoIds[0] === '9bZkp7q19f0', 'videoId correto')
    assert(result.totalComments > 0, `Coletou ${result.totalComments} comentário(s)`)

    await cleanupTestFiles(result.processedVideoIds)
  })

  // ── Teste 4: Scraper sem entrada válida ──────────────────────────────────
  await test('runScraper — lança erro sem input válido', async () => {
    let threw = false
    try {
      await runScraper({})
    } catch {
      threw = true
    }
    assert(threw, 'Lança ScraperError quando nenhuma entrada é fornecida')
  })

  // ── Resultado final ──────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────')
  console.log(`✅ Passou: ${passed} | ❌ Falhou: ${failed}`)
  console.log('─────────────────────────────────────────')

  if (failed > 0) process.exit(1)
}

main().catch(e => {
  console.error('💥 Erro fatal:', e)
  process.exit(1)
})
