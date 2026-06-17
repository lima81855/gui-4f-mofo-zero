import OpenAI from 'openai'
import { ensureDir, fileExists, readTextOrNull, writeText, readAllJson } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import Database from 'better-sqlite3'
import path from 'path'
import type {
  ValidatedIdea,
  PainPointsFile,
  PainPoint,
  MisticaCreatorInput,
  MisticaCreatorOutput,
} from '../types'

const AGENT_VERSION = '1.0.0'
const MODEL = 'gpt-4o'
const client = new OpenAI()

// Helper to query the sqlite DB directly if needed
function queryPainPointFromDb(painPointId: string): PainPoint | null {
  try {
    const projectRoot = path.resolve(__dirname, '..', '..')
    const dbPath = path.resolve(projectRoot, process.env.KNOWLEDGE_DB_PATH ?? 'memory/knowledge.db')
    const db = new Database(dbPath, { readonly: true })
    const row = db.prepare('SELECT * FROM pain_points WHERE id = ?').get(painPointId) as any
    db.close()

    if (row) {
      return {
        id: row.id,
        description: row.description,
        frequency: row.frequency,
        examples: [], // Not fully stored in SQLite main columns
        category: row.category,
        sourceVideoIds: [],
        extractedAt: row.first_seen_at,
      }
    }
  } catch (error) {
    logger.debug('MisticaCreator — erro ao consultar SQLite, tentando arquivos', { error: String(error) })
  }
  return null
}

async function findPainPoint(painPointId: string, painPointsDir: string): Promise<PainPoint | null> {
  // First try SQLite
  const dbResult = queryPainPointFromDb(painPointId)
  if (dbResult) return dbResult

  // Fallback to reading JSON files
  try {
    const painFiles = await readAllJson<PainPointsFile>(painPointsDir)
    for (const file of painFiles) {
      const found = file.painPoints.find(p => p.id === painPointId)
      if (found) return found
    }
  } catch (error) {
    logger.warn('MisticaCreator — erro ao ler diretório de pain points', { error: String(error) })
  }
  return null
}

export async function runMisticaCreator(input: MisticaCreatorInput): Promise<MisticaCreatorOutput> {
  const startTime = Date.now()
  const painPointsDir = 'data/pain-points'
  const validatedIdeasPath = 'data/validated-ideas/index.json'

  logger.info('Agente 5 (Criador Mística) — iniciando', {
    sessionId: input.sessionId,
    ideaId: input.ideaId,
  })

  // 1. Carrega a ideia validada
  if (!(await fileExists(validatedIdeasPath))) {
    throw new MisticaCreatorError('Arquivo index.json de ideias validadas não encontrado.')
  }

  const indexContent = await readTextOrNull(validatedIdeasPath)
  if (!indexContent) {
    throw new MisticaCreatorError('Índice de ideias validadas está vazio.')
  }

  const ideas: ValidatedIdea[] = JSON.parse(indexContent)
  const idea = ideas.find(i => i.id === input.ideaId)

  if (!idea) {
    throw new MisticaCreatorError(`Ideia com ID ${input.ideaId} não encontrada no index.json.`)
  }

  // 2. Busca a dor original
  const painPoint = await findPainPoint(idea.painPointId, painPointsDir)
  const painDescription = painPoint ? painPoint.description : '(dor original não encontrada)'

  // 3. Define a persona especialista perfeita
  logger.info('MisticaCreator — definindo persona especialista perfeita')
  const personaResponse = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Você é um definidor de personas especializadas. Retorne apenas uma descrição curta de 3 a 5 palavras da persona perfeita (Ex: "Agrônomo especialista em plantas de interior" ou "Desenvolvedor Full Stack Sênior" ou "Consultor de Organização de Closet"). Não escreva mais nada além disso.',
      },
      {
        role: 'user',
        content: `Produto: ${idea.name}
Descrição: ${idea.description}
Público Alvo: ${idea.targetAudience}
Features Core: ${idea.coreFeatures.join(', ')}`,
      },
    ],
  })

  const specialistRole = (personaResponse.choices[0]?.message?.content || 'Especialista de Nicho').trim()
  logger.info('MisticaCreator — persona definida', { specialistRole })

  // 4. Simula a persona e gera o conteúdo
  logger.info('MisticaCreator — gerando conteúdo do produto como o especialista', { specialistRole })

  const featuresLines = idea.coreFeatures.map(f => `- ${f}`).join('\n')
  const contentPrompt = `Você é ${specialistRole}. Você foi contratado para escrever o conteúdo definitivo, completo e de altíssimo valor (premium) para o produto "${idea.name}".

A ideia do produto é: ${idea.description}
O público-alvo é: ${idea.targetAudience}
A dor original que estamos resolvendo é: ${painDescription}

Você deve escrever em detalhes exaustivos cada um dos seguintes entregáveis chave/funcionalidades do produto:
${featuresLines}

DIRETRIZES DE RIQUEZA DE CONTEÚDO (CRÍTICO):
1. **Profundidade Extrema (Mínimo de 600 a 800 palavras POR entregável)**: Cada um dos entregáveis listados acima deve ser desenvolvido como se fosse um capítulo/artigo completo, denso e aprofundado de um livro ou e-book premium. Explique os "porquês", as razões biológicas, físicas ou práticas, forneça cenários reais de aplicação e faça explicações detalhadas parágrafo por parágrafo. Evite tópicos muito curtos ou tabelas simplistas.
2. **Tabelas, Checklists e Guias Completos**: Não resuma. Escreva todos os itens possíveis. Por exemplo, se for uma tabela de diluição, inclua o máximo de substâncias, proporções, frequência de uso, tipo de borrifador ideal, horário de aplicação e cuidados específicos para cada planta.
3. **Nenhum Placeholder ou Texto Genérico**: Não use termos como "[insira aqui seu texto]", "etc.", "e outros similares". Escreva informações reais, dados exatos, medidas precisas (em ml, gramas, litros) e passo-a-passo detalhados de aplicação.
4. **Tom de Voz**: Profissional de elite, altamente pedagógico, empático e focado na resolução prática de dores reais. Use formatação Markdown rica (tabelas, listas detalhadas, negritos, itálicos, blockquotes, e avisos).

Estruture o produto final exatamente da seguinte forma:
- **Apresentação e Autoridade**: Apresentação detalhada da sua persona de especialista, sua trajetória profissional e autoridade no assunto.
- **Desenvolvimento dos Entregáveis**: Crie um capítulo dedicado, muito longo e extremamente rico para cada um dos entregáveis listados acima.
- **Plano de Ação e Implementação**: Um guia passo a passo cronológico completo (com cronograma sugerido, rotina semanal/mensal e monitoramento) para o usuário aplicar os materiais e salvar/melhorar sua situação.`

  const contentResponse = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Você assume a identidade completa de um especialista profissional. Você deve escrever o conteúdo em Português do Brasil com excelente qualidade, profundidade exaustiva e de forma completa, sem resumos ou placeholders. Cada seção deve ser o próprio produto real, extremamente longo, rico em detalhes práticos, dados reais e explicações aprofundadas.`,
      },
      {
        role: 'user',
        content: contentPrompt,
      },
    ],
  })

  const productContent = contentResponse.choices[0]?.message?.content || ''

  // 5. Salva o conteúdo em disco
  const outputDir = input.outputDir ?? `data/products/${idea.id}`
  await ensureDir(outputDir)

  const contentPath = `${outputDir}/product-content.md`
  await writeText(contentPath, productContent)

  const durationMs = Date.now() - startTime
  logger.info('Agente 5 (Criador Mística) — concluído com sucesso', {
    ideaId: idea.id,
    contentPath,
    durationMs,
  })

  return {
    ideaId: idea.id,
    specialistRole,
    contentPath,
    durationMs,
  }
}

export class MisticaCreatorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MisticaCreatorError'
  }
}
