import Database from 'better-sqlite3'
import crypto from 'crypto'
import path from 'path'
import { logger } from '../utils/logger'
import type { KnowledgeRecord, PainCategory } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Semantic Tier — memory/knowledge.db (SQLite)
// Deduplica e acumula dores ao longo de todas as sessões
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

function getDbPath(): string {
  const envPath = process.env.KNOWLEDGE_DB_PATH ?? 'memory/knowledge.db'
  return path.resolve(PROJECT_ROOT, envPath)
}

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (_db) return _db

  const dbPath = getDbPath()
  logger.debug('Knowledge — conectando ao SQLite', { dbPath })

  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')  // Write-Ahead Logging para melhor concorrência
  _db.pragma('synchronous = NORMAL')

  initSchema(_db)
  return _db
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pain_points (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      description_hash TEXT NOT NULL,
      category TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      status TEXT DEFAULT 'new'
    );

    CREATE INDEX IF NOT EXISTS idx_hash ON pain_points(description_hash);
    CREATE INDEX IF NOT EXISTS idx_status ON pain_points(status);
    CREATE INDEX IF NOT EXISTS idx_category ON pain_points(category);
  `)

  logger.debug('Knowledge — schema inicializado')
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash para deduplicação rápida (não semântica)
// ─────────────────────────────────────────────────────────────────────────────

export function hashDescription(description: string): string {
  const normalized = description
    .toLowerCase()
    .replace(/[^a-záàãâéêíóôõúüç\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)

  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

// ─────────────────────────────────────────────────────────────────────────────
// Operações CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca uma dor pela hash de descrição.
 * Usado para deduplicação antes de inserir novas dores.
 */
export function findByHash(descriptionHash: string): KnowledgeRecord | null {
  const db = getDb()

  const row = db.prepare(`
    SELECT * FROM pain_points WHERE description_hash = ? AND status != 'discarded' LIMIT 1
  `).get(descriptionHash) as RawRow | undefined

  return row ? mapRow(row) : null
}

/**
 * Insere uma nova dor no banco
 */
export function insertPainPoint(record: Omit<KnowledgeRecord, 'lastSeenAt'>): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO pain_points (id, description, description_hash, category, first_seen_at, last_seen_at, frequency, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.description,
    record.descriptionHash,
    record.category,
    record.firstSeenAt,
    now,
    record.frequency,
    record.status,
  )

  logger.debug('Knowledge — pain point inserido', { id: record.id })
}

/**
 * Incrementa a frequência de uma dor existente
 */
export function incrementFrequency(id: string, additionalFrequency: number = 1): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE pain_points SET frequency = frequency + ?, last_seen_at = ? WHERE id = ?
  `).run(additionalFrequency, now, id)

  logger.debug('Knowledge — frequência incrementada', { id, additionalFrequency })
}

/**
 * Atualiza o status de uma dor (new → validated ou discarded)
 */
export function updateStatus(id: string, status: KnowledgeRecord['status']): void {
  const db = getDb()

  db.prepare(`UPDATE pain_points SET status = ? WHERE id = ?`).run(status, id)
  logger.debug('Knowledge — status atualizado', { id, status })
}

/**
 * Busca todas as dores com frequência mínima e status válido
 */
export function findValidated(minFrequency: number = 1): KnowledgeRecord[] {
  const db = getDb()

  const rows = db.prepare(`
    SELECT * FROM pain_points
    WHERE status != 'discarded' AND frequency >= ?
    ORDER BY frequency DESC
  `).all(minFrequency) as RawRow[]

  return rows.map(mapRow)
}

/**
 * Busca dores por categoria
 */
export function findByCategory(category: PainCategory): KnowledgeRecord[] {
  const db = getDb()

  const rows = db.prepare(`
    SELECT * FROM pain_points WHERE category = ? AND status != 'discarded' ORDER BY frequency DESC
  `).all(category) as RawRow[]

  return rows.map(mapRow)
}

/**
 * Retorna estatísticas do banco
 */
export function getStats(): { total: number; byStatus: Record<string, number>; byCategory: Record<string, number> } {
  const db = getDb()

  const total = (db.prepare('SELECT COUNT(*) as count FROM pain_points').get() as { count: number }).count

  const byStatusRows = db.prepare('SELECT status, COUNT(*) as count FROM pain_points GROUP BY status').all() as Array<{ status: string; count: number }>
  const byStatus: Record<string, number> = {}
  for (const row of byStatusRows) byStatus[row.status] = row.count

  const byCategoryRows = db.prepare('SELECT category, COUNT(*) as count FROM pain_points GROUP BY category').all() as Array<{ category: string; count: number }>
  const byCategory: Record<string, number> = {}
  for (const row of byCategoryRows) byCategory[row.category] = row.count

  return { total, byStatus, byCategory }
}

/**
 * Fecha a conexão com o banco (usar ao encerrar o processo)
 */
export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
    logger.debug('Knowledge — conexão SQLite encerrada')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeamento de rows
// ─────────────────────────────────────────────────────────────────────────────

interface RawRow {
  id: string
  description: string
  description_hash: string
  category: string
  first_seen_at: string
  last_seen_at: string
  frequency: number
  status: string
}

function mapRow(row: RawRow): KnowledgeRecord {
  return {
    id: row.id,
    description: row.description,
    descriptionHash: row.description_hash,
    category: row.category as PainCategory,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    frequency: row.frequency,
    status: row.status as KnowledgeRecord['status'],
  }
}
