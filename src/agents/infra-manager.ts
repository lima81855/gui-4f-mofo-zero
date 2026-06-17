import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import cron from 'node-cron'
import { listConnectorHealth } from '../mcp/registry'
import { checkSupabaseTables, getSupabaseHealth } from '../mcp/supabase'
import { ensureDir, fileExists, readTextOrNull, writeJson, writeText } from '../mcp/filesystem'
import { loadSkillContent } from '../skills/skill-loader'
import { logger } from '../utils/logger'
import {
  InfraAudit,
  InfraAuditSchema,
  InfraCheck,
  InfraManagerInput,
  InfraManagerOutput,
} from '../types'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

function envExists(name: string): boolean {
  return Boolean(process.env[name])
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(PROJECT_ROOT, relativePath))
    return true
  } catch {
    return false
  }
}

function check(
  area: InfraCheck['area'],
  status: InfraCheck['status'],
  title: string,
  detail: string,
  recommendation: string,
): InfraCheck {
  return { area, status, title, detail, recommendation }
}

function renderMarkdown(audit: InfraAudit, skillContent: string | null): string {
  return `# Infra Audit

auditId: ${audit.auditId}
auditedAt: ${audit.auditedAt}
overallStatus: ${audit.overallStatus}

## Conectores
${audit.connectorSummary.map(connector => `- [${connector.status}] ${connector.name} | configured: ${connector.configured} | missing: ${connector.missingEnv.join(', ') || 'nenhuma'}`).join('\n')}

## Checks
${audit.checks.map(item => `### [${item.status}] ${item.title}
Area: ${item.area}

${item.detail}

Recomendacao: ${item.recommendation}
`).join('\n')}

## Bloqueios de go-live
${audit.goLiveBlockers.length ? audit.goLiveBlockers.map(item => `- ${item}`).join('\n') : '- Nenhum bloqueio critico para v1 local.'}

## Proximas acoes
${audit.nextActions.map(item => `- ${item}`).join('\n')}

## Skill usada
${skillContent ? 'low-ticket-infra-manager' : 'Skill nao encontrada'}
`
}

async function buildAudit(): Promise<InfraAudit> {
  const checks: InfraCheck[] = []
  const connectorSummary = listConnectorHealth()

  const envFileExists = await fileExists('.env')
  checks.push(check(
    'environment',
    envFileExists ? 'ok' : 'fail',
    '.env local',
    envFileExists ? '.env encontrado no projeto.' : '.env nao encontrado.',
    envFileExists ? 'Manter .env fora do git.' : 'Criar .env com as variaveis essenciais.',
  ))

  const requiredLocalEnv = ['OPENAI_API_KEY', 'YOUTUBE_API_KEY', 'SERP_API_KEY']
  const missingLocalEnv = requiredLocalEnv.filter(name => !envExists(name))
  checks.push(check(
    'environment',
    missingLocalEnv.length ? 'fail' : 'ok',
    'APIs essenciais da v1 local',
    missingLocalEnv.length ? `Faltam: ${missingLocalEnv.join(', ')}` : 'OpenAI, YouTube e SerpAPI estao configuradas.',
    missingLocalEnv.length ? 'Configurar as variaveis faltantes antes de rodar descoberta/agentes.' : 'Nenhuma acao necessaria.',
  ))

  const missingExternal = connectorSummary
    .filter(connector => connector.status === 'missing-config')
    .flatMap(connector => connector.missingEnv)
  checks.push(check(
    'connectors',
    missingExternal.length ? 'warn' : 'ok',
    'Conectores estruturais',
    missingExternal.length ? `Ainda faltam variaveis: ${missingExternal.join(', ')}` : 'Conectores estruturais configurados.',
    missingExternal.length ? 'Priorizar Supabase/Postgres e Firecrawl conforme a proxima fase.' : 'Manter monitoramento.',
  ))

  if (getSupabaseHealth().configured) {
    const tableHealth = await checkSupabaseTables()
    const missingTables = tableHealth.filter(table => table.status !== 'ok')
    checks.push(check(
      'storage',
      missingTables.length ? 'warn' : 'ok',
      'Tabelas Supabase',
      missingTables.length
        ? `Tabelas ainda nao acessiveis: ${missingTables.map(table => `${table.table} (${table.status})`).join(', ')}`
        : 'Todas as tabelas Supabase obrigatorias estao acessiveis.',
      missingTables.length
        ? 'Rodar docs/SUPABASE_SCHEMA.sql no Supabase SQL Editor e executar nova auditoria.'
        : 'Supabase pronto para receber estado operacional.',
    ))
  }

  const dataExists = await pathExists('data')
  const memoryExists = await pathExists('memory')
  checks.push(check(
    'storage',
    dataExists && memoryExists ? 'ok' : 'fail',
    'Diretorios de estado',
    `data/: ${dataExists ? 'ok' : 'ausente'} | memory/: ${memoryExists ? 'ok' : 'ausente'}`,
    'Garantir que data/ e memory/ existam localmente e virem volumes persistentes no deploy.',
  ))

  const knowledgeIgnored = (await readTextOrNull('.gitignore'))?.includes('memory/knowledge.db') ?? false
  checks.push(check(
    'security',
    knowledgeIgnored ? 'ok' : 'warn',
    'SQLite fora do git',
    knowledgeIgnored ? 'memory/knowledge.db esta no .gitignore.' : 'memory/knowledge.db nao foi encontrado no .gitignore.',
    knowledgeIgnored ? 'Nenhuma acao necessaria.' : 'Adicionar memory/knowledge.db ao .gitignore.',
  ))

  const cronSchedule = process.env.CRON_SCHEDULE || '0 3 * * *'
  checks.push(check(
    'scheduler',
    cron.validate(cronSchedule) ? 'ok' : 'fail',
    'CRON_SCHEDULE',
    `Valor atual: ${cronSchedule}`,
    cron.validate(cronSchedule) ? 'Scheduler pode usar esta agenda.' : 'Corrigir CRON_SCHEDULE antes de deploy.',
  ))

  const railway = await readTextOrNull('railway.toml')
  const railwayOk = Boolean(railway?.includes('node dist/scheduler.js'))
  checks.push(check(
    'deploy',
    railwayOk ? 'ok' : 'warn',
    'Railway start command',
    railwayOk ? 'railway.toml aponta para dist/scheduler.js.' : 'railway.toml nao aponta para o scheduler compilado.',
    'Antes do deploy, rodar build e garantir volumes /app/data e /app/memory.',
  ))

  const dashboardExists = await pathExists('dashboard/index.html')
  const dashboardServerExists = await pathExists('src/dashboard-server.ts')
  checks.push(check(
    'dashboard',
    dashboardExists && dashboardServerExists ? 'ok' : 'fail',
    'Dashboard operacional',
    `dashboard/index.html: ${dashboardExists ? 'ok' : 'ausente'} | src/dashboard-server.ts: ${dashboardServerExists ? 'ok' : 'ausente'}`,
    'Rodar npm.cmd run dashboard para operar decisoes do CEO localmente.',
  ))

  const goLiveBlockers = checks
    .filter(item => item.status === 'fail')
    .map(item => `${item.area}: ${item.title}`)

  if (!envExists('SUPABASE_URL')) {
    goLiveBlockers.push('producao: Supabase/Postgres ainda nao configurado para fonte de verdade real')
  }
  if (!envExists('META_ACCESS_TOKEN')) {
    goLiveBlockers.push('trafego real: Meta Ads ainda nao configurado')
  }
  if (!envExists('CHECKOUT_API_KEY')) {
    goLiveBlockers.push('venda real: checkout ainda nao configurado')
  }

  const failCount = checks.filter(item => item.status === 'fail').length
  const warnCount = checks.filter(item => item.status === 'warn').length

  const overallStatus = failCount > 0 ? 'bloqueado' : warnCount > 0 ? 'atencao' : 'operacional'

  return InfraAuditSchema.parse({
    auditId: uuidv4(),
    auditedAt: new Date().toISOString(),
    overallStatus,
    connectorSummary,
    checks,
    goLiveBlockers,
    nextActions: [
      'Configurar Supabase/Postgres para estado operacional em producao.',
      'Configurar Firecrawl para referencias reais de paginas e funis.',
      'Configurar Meta Ads e checkout antes de qualquer escala real.',
      'Garantir volumes persistentes para data/ e memory/ no deploy.',
    ],
  })
}

export async function runInfraManager(input: InfraManagerInput): Promise<InfraManagerOutput> {
  const startTime = Date.now()
  logger.info('Agente InfraManager - iniciando', { sessionId: input.sessionId })

  const skillContent = await loadSkillContent('low-ticket-infra-manager')
  const audit = await buildAudit()
  const outputDir = input.outputDir ?? 'data/infra'
  await ensureDir(outputDir)

  const auditPath = `${outputDir}/infra-audit.json`
  const markdownPath = `${outputDir}/infra-audit.md`

  await writeJson(auditPath, {
    metadata: {
      agentVersion: '1.0.0',
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
    audit,
  })
  await writeText(markdownPath, renderMarkdown(audit, skillContent))

  const durationMs = Date.now() - startTime
  logger.info('Agente InfraManager - concluido', {
    auditPath,
    markdownPath,
    overallStatus: audit.overallStatus,
    durationMs,
  })

  return { auditPath, markdownPath, durationMs }
}

export class InfraManagerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InfraManagerError'
  }
}
