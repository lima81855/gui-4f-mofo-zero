import { getConnectorHealth } from './registry'
import { logger } from '../utils/logger'

type SupabaseInsertOptions<T extends Record<string, unknown>> = {
  table: string
  rows: T[]
}

export const REQUIRED_SUPABASE_TABLES = [
  'mcp_events',
  'operational_records',
  'ceo_decisions',
  'validated_ideas',
  'artifacts',
  'infra_audits',
  'daily_metrics',
  'checkout_events',
  'performance_snapshots',
  'performance_action_plans',
  'go_live_reports',
] as const

export type SupabaseTableName = typeof REQUIRED_SUPABASE_TABLES[number]

export type SupabaseTableHealth = {
  table: SupabaseTableName
  exists: boolean
  status: 'ok' | 'missing' | 'error'
  detail: string
}

export function getSupabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configuradas')
  }
  return {
    url: url.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, ''),
    serviceRoleKey: serviceRoleKey.trim(),
  }
}

export function getSupabaseHealth() {
  return getConnectorHealth('supabase-postgres')
}

function authHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  }
}

function supabaseFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? ` | cause: ${error.cause.message}` : ''
  return `${error.message}${cause}`
}

export async function insertRows<T extends Record<string, unknown>>(
  options: SupabaseInsertOptions<T>,
): Promise<void> {
  const { url, serviceRoleKey } = getSupabaseConfig()
  let response: Response

  try {
    response = await fetch(`${url}/rest/v1/${options.table}`, {
      method: 'POST',
      headers: {
        ...authHeaders(serviceRoleKey),
        prefer: 'return=minimal',
      },
      body: JSON.stringify(options.rows),
    })
  } catch (error) {
    throw new Error(`Supabase insert nao conseguiu conectar em ${options.table}: ${supabaseFetchError(error)}`)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Supabase insert falhou em ${options.table}: ${response.status} ${body}`)
  }

  logger.info('Supabase MCP - linhas inseridas', {
    table: options.table,
    count: options.rows.length,
  })
}

export async function upsertRows<T extends Record<string, unknown>>(
  options: SupabaseInsertOptions<T> & { onConflict: string },
): Promise<void> {
  const { url, serviceRoleKey } = getSupabaseConfig()
  const endpoint = `${url}/rest/v1/${options.table}?on_conflict=${encodeURIComponent(options.onConflict)}`
  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...authHeaders(serviceRoleKey),
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(options.rows),
    })
  } catch (error) {
    throw new Error(`Supabase upsert nao conseguiu conectar em ${options.table}: ${supabaseFetchError(error)}`)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Supabase upsert falhou em ${options.table}: ${response.status} ${body}`)
  }

  logger.info('Supabase MCP - linhas sincronizadas', {
    table: options.table,
    count: options.rows.length,
  })
}

export async function selectRows<T = unknown>(
  table: string,
  query = 'select=*&limit=100',
): Promise<T[]> {
  const { url, serviceRoleKey } = getSupabaseConfig()
  let response: Response

  try {
    response = await fetch(`${url}/rest/v1/${table}?${query}`, {
      method: 'GET',
      headers: authHeaders(serviceRoleKey),
    })
  } catch (error) {
    throw new Error(`Supabase select nao conseguiu conectar em ${table}: ${supabaseFetchError(error)}`)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Supabase select falhou em ${table}: ${response.status} ${body}`)
  }

  return response.json() as Promise<T[]>
}

export async function checkSupabaseTables(): Promise<SupabaseTableHealth[]> {
  const { url, serviceRoleKey } = getSupabaseConfig()
  const results: SupabaseTableHealth[] = []

  for (const table of REQUIRED_SUPABASE_TABLES) {
    try {
      const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
        method: 'GET',
        headers: authHeaders(serviceRoleKey),
      })

      if (response.ok) {
        results.push({ table, exists: true, status: 'ok', detail: 'Tabela acessivel via REST.' })
        continue
      }

      const body = await response.text()
      results.push({
        table,
        exists: false,
        status: response.status === 404 ? 'missing' : 'error',
        detail: `HTTP ${response.status}: ${body.slice(0, 240)}`,
      })
    } catch (error) {
      results.push({
        table,
        exists: false,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}
