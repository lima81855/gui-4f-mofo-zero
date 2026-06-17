import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import { writeText, readText, fileExists } from '../mcp/filesystem'
import { logger } from '../utils/logger'
import type { SkillReflection } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Skill Engine — reflexão pós-tarefa e auto-geração de skills reutilizáveis
// Disparado quando um agente realiza >= SKILL_COMPLEXITY_THRESHOLD tool calls
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'gpt-4o'
const client = new OpenAI()

function getComplexityThreshold(): number {
  const raw = process.env.SKILL_COMPLEXITY_THRESHOLD
  const parsed = raw ? parseInt(raw, 10) : 5
  return isNaN(parsed) ? 5 : parsed
}

// ─────────────────────────────────────────────────────────────────────────────
// Reflexão pós-tarefa
// ─────────────────────────────────────────────────────────────────────────────

async function reflectOnTask(
  agentName: string,
  taskDescription: string,
  toolCallCount: number,
  taskOutput: string,
): Promise<SkillReflection> {
  logger.info('SkillEngine — iniciando reflexão', { agentName, toolCallCount })

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: `Você é um agente de reflexão que decide se um fluxo de análise vale ser salvo como skill reutilizável.

## Contexto da tarefa
Agente: ${agentName}
Número de operações realizadas: ${toolCallCount}
Descrição da tarefa: ${taskDescription}

## Output gerado
${taskOutput.slice(0, 500)}...

## Critérios para salvar como skill
- A lógica é aplicável a casos futuros similares? (não foi específica demais para estes dados)
- O padrão descoberto é algo que aparece com frequência neste tipo de análise?
- O agente descobriu algo não óbvio que merece ser lembrado?

Responda APENAS com JSON válido:
{
  "shouldSave": true | false,
  "reasoning": "por que salvar ou não",
  "suggestedName": "nome-kebab-case da skill (ex: pain-pattern-financeiro)",
  "suggestedDescription": "descrição em ~30 tokens para carregar no contexto",
  "extractedLogic": "o que salvar no arquivo .md da skill — padrões, prompts otimizados, exemplos"
}`,
      },
    ],
    response_format: { type: 'json_object' }
  })

  const responseText = completion.choices[0]?.message?.content || ''

  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      shouldSave: false,
      reasoning: 'OpenAI não retornou JSON válido',
      suggestedName: '',
      suggestedDescription: '',
      extractedLogic: '',
    }
  }

  return JSON.parse(jsonMatch[0]) as SkillReflection
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistência da skill
// ─────────────────────────────────────────────────────────────────────────────

async function saveSkill(
  reflection: SkillReflection,
  agentName: 'pain-extractor' | 'volume-filter',
): Promise<string> {
  const id = `skill-${uuidv4().slice(0, 8)}`
  const now = new Date().toISOString()

  const dir = agentName === 'pain-extractor'
    ? 'skills/pain-patterns'
    : 'skills/volume-signals'

  const filePath = `${dir}/${reflection.suggestedName}.md`

  const content = `---
id: ${id}
name: ${reflection.suggestedName}
description: "${reflection.suggestedDescription}"
createdAt: ${now}
createdByAgent: ${agentName}
usageCount: 0
---

## Quando usar
${reflection.reasoning}

## Lógica extraída
${reflection.extractedLogic}
`

  await writeText(filePath, content)
  logger.info('SkillEngine — skill salva', { filePath, name: reflection.suggestedName })

  return filePath
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface pública
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillEngineInput {
  agentName: 'pain-extractor' | 'volume-filter'
  taskDescription: string
  toolCallCount: number
  taskOutput: string
}

export interface SkillEngineOutput {
  skillSaved: boolean
  filePath?: string
  reflection: SkillReflection
}

/**
 * Avalia se uma tarefa deve gerar uma skill reutilizável.
 * Só dispara se toolCallCount >= SKILL_COMPLEXITY_THRESHOLD.
 */
export async function runSkillEngine(input: SkillEngineInput): Promise<SkillEngineOutput> {
  const threshold = getComplexityThreshold()

  if (input.toolCallCount < threshold) {
    logger.debug('SkillEngine — abaixo do threshold, pulando reflexão', {
      toolCallCount: input.toolCallCount,
      threshold,
    })
    return {
      skillSaved: false,
      reflection: {
        shouldSave: false,
        reasoning: `Abaixo do threshold de complexidade (${input.toolCallCount} < ${threshold})`,
        suggestedName: '',
        suggestedDescription: '',
        extractedLogic: '',
      },
    }
  }

  const reflection = await reflectOnTask(
    input.agentName,
    input.taskDescription,
    input.toolCallCount,
    input.taskOutput,
  )

  if (!reflection.shouldSave || !reflection.suggestedName) {
    logger.info('SkillEngine — reflexão concluída, não salvar', {
      reasoning: reflection.reasoning,
    })
    return { skillSaved: false, reflection }
  }

  const filePath = await saveSkill(reflection, input.agentName)
  return { skillSaved: true, filePath, reflection }
}
