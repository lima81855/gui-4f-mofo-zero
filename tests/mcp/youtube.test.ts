/**
 * Testes de integração — MCP YouTube
 *
 * Estes testes fazem chamadas REAIS à API do YouTube.
 * Exigem YOUTUBE_API_KEY configurada no .env
 *
 * Para rodar: npx tsx tests/mcp/youtube.test.ts
 */
import 'dotenv/config'
import { searchVideos, getVideoMetadata, getVideoComments } from '../../src/mcp/youtube'

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
// Suite de testes
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔌 MCP YouTube — Suite de testes de integração\n')
  console.log(`API Key configurada: ${process.env.YOUTUBE_API_KEY ? '✅' : '❌ FALTANDO'}`)

  if (!process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY.startsWith('YOUR_')) {
    console.error('\n⛔ YOUTUBE_API_KEY não configurada. Configure o .env antes de rodar os testes.')
    process.exit(1)
  }

  // ── Teste 1: searchVideos ────────────────────────────────────────────────
  await test('searchVideos — busca básica por query', async () => {
    const videos = await searchVideos('como ganhar dinheiro online', 3)

    assert(Array.isArray(videos), 'Retorna array')
    assert(videos.length > 0, `Encontrou vídeos (${videos.length})`)
    assert(videos.length <= 3, 'Respeita limite de maxResults')
    assert(typeof videos[0].videoId === 'string', 'Cada vídeo tem videoId string')
    assert(typeof videos[0].title === 'string', 'Cada vídeo tem título string')
    assert(typeof videos[0].channelId === 'string', 'Cada vídeo tem channelId string')
    assert(videos[0].videoId.length > 0, 'videoId não vazio')

    console.log(`  📺 Primeiro resultado: "${videos[0].title}"`)
    console.log(`     videoId: ${videos[0].videoId}`)
  })

  // ── Teste 2: getVideoMetadata ────────────────────────────────────────────
  await test('getVideoMetadata — busca por IDs conhecidos', async () => {
    // vídeo público estável: "Gangnam Style" (improvável de ser removido)
    const videoIds = ['9bZkp7q19f0']
    const videos = await getVideoMetadata(videoIds)

    assert(Array.isArray(videos), 'Retorna array')
    assert(videos.length === 1, 'Retorna exatamente 1 vídeo')
    assert(videos[0].videoId === '9bZkp7q19f0', 'VideoId correto')
    assert(typeof videos[0].title === 'string', 'Título presente')
    assert(videos[0].title.length > 0, 'Título não vazio')

    console.log(`  📺 Vídeo: "${videos[0].title}"`)
  })

  // ── Teste 3: getVideoMetadata com array vazio ────────────────────────────
  await test('getVideoMetadata — array vazio retorna vazio', async () => {
    const videos = await getVideoMetadata([])
    assert(videos.length === 0, 'Array vazio retorna array vazio')
  })

  // ── Teste 4: getVideoComments ────────────────────────────────────────────
  await test('getVideoComments — coleta comentários reais', async () => {
    // Pega um vídeo com muitos comentários via search primeiro
    const videos = await searchVideos('como ganhar dinheiro online', 1)
    assert(videos.length > 0, 'Vídeo encontrado para teste de comentários')

    if (videos.length === 0) return

    const { videoId, title, channelId } = videos[0]
    const comments = await getVideoComments(videoId, title, channelId, 20)

    assert(Array.isArray(comments), 'Retorna array')
    assert(comments.length > 0, `Encontrou comentários (${comments.length})`)
    assert(comments.length <= 20, 'Respeita limite de maxComments')
    assert(typeof comments[0].text === 'string', 'Cada comentário tem text string')
    assert(typeof comments[0].id === 'string', 'Cada comentário tem id string')
    assert(typeof comments[0].likeCount === 'number', 'Cada comentário tem likeCount number')
    assert(comments[0].videoId === videoId, 'videoId associado corretamente')

    console.log(`  💬 Comentários coletados: ${comments.length}`)
    console.log(`  📝 Primeiro: "${comments[0].text.slice(0, 60)}..."`)
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
