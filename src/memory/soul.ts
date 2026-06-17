import { readText, readTextOrNull, writeText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import type { SoulMemory } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Core Memory — memory/soul.md
// Identidade e preferências persistentes do sistema
// ─────────────────────────────────────────────────────────────────────────────

const SOUL_PATH = 'memory/soul.md'

/**
 * Lê e parseia o soul.md em runtime.
 * Extrai as seções de forma simples baseada nos headings markdown.
 */
export async function readSoul(): Promise<SoulMemory> {
  logger.debug('Soul — lendo memória principal')

  const content = await readTextOrNull(SOUL_PATH)
  if (!content) {
    logger.warn('Soul — arquivo não encontrado, retornando memória vazia')
    return {
      exploredNiches: [],
      ceoPreferences: [],
      systemVersion: '1.0.0',
      lastUpdatedAt: new Date().toISOString(),
      nichosParaProximaSessao: [],
    }
  }

  return parseSoulMd(content)
}

/**
 * Adiciona um nicho ao histórico de nichos explorados
 */
export async function addExploredNiche(niche: string, sessionInfo: string): Promise<void> {
  logger.info('Soul — adicionando nicho explorado', { niche })

  const content = await readTextOrNull(SOUL_PATH) ?? ''

  // Substitui a seção de nichos já explorados
  const entry = `- ${niche} (${sessionInfo})`
  const updated = appendToSection(content, '## Nichos já explorados', entry)

  await writeLastUpdated(updated)
}

/**
 * Adiciona uma preferência de CEO aprendida
 */
export async function addCeoPreference(preference: string): Promise<void> {
  logger.info('Soul — registrando preferência do CEO', { preference })

  const content = await readTextOrNull(SOUL_PATH) ?? ''
  const updated = appendToSection(content, '## Padrões de aprovação do CEO', `- ${preference}`)

  await writeLastUpdated(updated)
}

/**
 * Atualiza a lista de nichos para próxima sessão
 */
export async function updateNextNiches(niches: string[]): Promise<void> {
  logger.info('Soul — atualizando nichos para próxima sessão', { count: niches.length })

  const content = await readTextOrNull(SOUL_PATH) ?? ''

  // Reconstrói a seção de próxima sessão
  const nicheLines = niches.map(n => `- ${n}`).join('\n')
  const updated = replaceSection(
    content,
    '## Nichos para próxima sessão',
    nicheLines,
  )

  await writeLastUpdated(updated)
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários de parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseSoulMd(content: string): SoulMemory {
  const exploredNiches = extractBulletList(content, '## Nichos já explorados')
  const ceoPreferences = extractBulletList(content, '## Padrões de aprovação do CEO')
  const nichosParaProximaSessao = extractBulletList(content, '## Nichos para próxima sessão')
  const lastUpdatedAt = extractLine(content, '## Última atualização') ?? new Date().toISOString()

  return {
    exploredNiches,
    ceoPreferences,
    systemVersion: '1.0.0',
    lastUpdatedAt,
    nichosParaProximaSessao,
  }
}

function extractBulletList(content: string, heading: string): string[] {
  const headingIdx = content.indexOf(heading)
  if (headingIdx === -1) return []

  const afterHeading = content.slice(headingIdx + heading.length)
  const nextHeadingMatch = afterHeading.match(/\n## /)
  const section = nextHeadingMatch
    ? afterHeading.slice(0, nextHeadingMatch.index)
    : afterHeading

  return section
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(Boolean)
}

function extractLine(content: string, heading: string): string | null {
  const headingIdx = content.indexOf(heading)
  if (headingIdx === -1) return null

  const afterHeading = content.slice(headingIdx + heading.length)
  const lines = afterHeading.split('\n').map(l => l.trim()).filter(Boolean)
  return lines[0] ?? null
}

function appendToSection(content: string, heading: string, newLine: string): string {
  const headingIdx = content.indexOf(heading)
  if (headingIdx === -1) return content + `\n\n${heading}\n${newLine}\n`

  const afterHeading = content.slice(headingIdx + heading.length)
  const nextHeadingMatch = afterHeading.match(/\n## /)
  const sectionEnd = nextHeadingMatch
    ? headingIdx + heading.length + (nextHeadingMatch.index ?? 0)
    : content.length

  // Remove marcador de "nenhum ainda" se existir
  const before = content.slice(0, sectionEnd)
  const cleaned = before.replace('(nenhum ainda — primeira execução)', '').trimEnd()
  const after = content.slice(sectionEnd)

  return `${cleaned}\n${newLine}${after}`
}

function replaceSection(content: string, heading: string, newContent: string): string {
  const headingIdx = content.indexOf(heading)
  if (headingIdx === -1) return content + `\n\n${heading}\n${newContent}\n`

  const afterHeading = content.slice(headingIdx + heading.length)
  const nextHeadingMatch = afterHeading.match(/\n## /)
  const sectionEnd = nextHeadingMatch
    ? headingIdx + heading.length + (nextHeadingMatch.index ?? 0)
    : content.length

  const before = content.slice(0, headingIdx + heading.length)
  const after = content.slice(sectionEnd)

  return `${before}\n${newContent}\n${after}`
}

async function writeLastUpdated(content: string): Promise<void> {
  const now = new Date().toISOString()
  const updated = content.replace(
    /## Última atualização\n.*/,
    `## Última atualização\n${now}`,
  )
  await writeText(SOUL_PATH, updated)
}
