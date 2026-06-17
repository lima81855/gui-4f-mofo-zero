import { listFiles, readText } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import type { Skill } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Skill Loader — carrega nomes e descrições de skills no contexto
// Apenas name+description (~30 tokens) são carregados por padrão.
// O conteúdo completo só é lido quando explicitamente necessário.
// ─────────────────────────────────────────────────────────────────────────────

const SKILL_DIRS = [
  'skills/pain-patterns',
  'skills/volume-signals',
  'skills/offer-architecture',
  'skills/funnel-strategy',
  'skills/copywriting',
  'skills/creative-copy',
  'skills/video-scripts',
  'skills/content-strategy',
  'skills/design-implementation',
  'skills/ui-conversion',
  'skills/interactive-funnels',
  'skills/tracking',
  'skills/media-buying',
  'skills/metrics-optimization',
  'skills/finance',
  'skills/cro',
  'skills/checkout-ops',
  'skills/funnel-builder',
  'skills/product-quality',
  'skills/creative-analysis',
  'skills/infra',
]

/**
 * Parseia o frontmatter YAML de um arquivo de skill (formato simples)
 */
function parseFrontmatter(content: string): Record<string, string> {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return {}

  const result: Record<string, string> = {}
  const lines = fmMatch[1].split('\n')

  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim().replace(/^"(.*)"$/, '$1')
    if (key && value) result[key] = value
  }

  return result
}

/**
 * Carrega todos os skills disponíveis (apenas metadados — leve)
 */
export async function loadSkillsMetadata(): Promise<Skill[]> {
  const skills: Skill[] = []

  for (const dir of SKILL_DIRS) {
    const files = await listFiles(dir, '.md')

    for (const filePath of files) {
      // Ignora .gitkeep
      if (filePath.endsWith('.gitkeep')) continue

      try {
        const content = await readText(filePath)
        const fm = parseFrontmatter(content)

        if (!fm.id || !fm.name) continue

        skills.push({
          id: fm.id,
          name: fm.name,
          description: fm.description ?? '',
          filePath,
          createdAt: fm.createdAt ?? '',
          usageCount: parseInt(fm.usageCount ?? '0', 10),
          createdByAgent: (fm.createdByAgent as Skill['createdByAgent']) ?? 'pain-extractor',
        })
      } catch (error) {
        logger.warn('SkillLoader — erro ao ler skill, pulando', {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  logger.debug('SkillLoader — skills carregados', { count: skills.length })
  return skills
}

/**
 * Carrega o conteúdo completo de uma skill por nome
 */
export async function loadSkillContent(skillName: string): Promise<string | null> {
  for (const dir of SKILL_DIRS) {
    const files = await listFiles(dir, '.md')

    for (const filePath of files) {
      try {
        const content = await readText(filePath)
        const fm = parseFrontmatter(content)
        const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.md$/, '')

        if (fm.name === skillName || baseName === skillName) {
          logger.debug('SkillLoader — conteúdo da skill carregado', { skillName })
          return content
        }
      } catch {
        // tenta o proximo arquivo
      }
    }
  }

  logger.warn('SkillLoader — skill não encontrada', { skillName })
  return null
}

/**
 * Gera um resumo compacto de todas as skills para incluir no prompt do agente.
 * Formato: "nome: descrição" por linha — muito econômico em tokens.
 */
export async function buildSkillsContext(): Promise<string> {
  const skills = await loadSkillsMetadata()

  if (skills.length === 0) {
    return '(nenhuma skill aprendida ainda)'
  }

  const lines = skills.map(s => `- **${s.name}**: ${s.description}`)
  return `Skills disponíveis (${skills.length}):\n${lines.join('\n')}`
}
