import { v4 as uuidv4 } from 'uuid'
import {
  McpEvent,
  McpEventSchema,
  MicroOfferRecord,
  MicroOfferRecordSchema,
} from '../types'
import { ensureDir, readJsonOrNull, writeJson } from './filesystem'
import { logger } from '../utils/logger'

const STATE_DIR = 'data/micro-offer'
const EVENTS_DIR = 'data/mcp-events'

export async function recordMcpEvent(input: Omit<McpEvent, 'id' | 'createdAt'>): Promise<McpEvent> {
  const event = McpEventSchema.parse({
    ...input,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  })

  await ensureDir(EVENTS_DIR)
  await writeJson(`${EVENTS_DIR}/${event.createdAt.replace(/[:.]/g, '-')}-${event.id}.json`, event)

  logger.info('MicroOffer MCP - evento registrado', {
    connector: event.connector,
    agentName: event.agentName,
    action: event.action,
    entityId: event.entityId,
    status: event.status,
  })

  return event
}

export async function upsertMicroOfferRecord(
  record: Omit<MicroOfferRecord, 'updatedAt'>,
): Promise<MicroOfferRecord> {
  const current = await readMicroOfferRecord(record.ideaId)
  const updated = MicroOfferRecordSchema.parse({
    ...current,
    ...record,
    artifactPaths: record.artifactPaths ?? current?.artifactPaths ?? [],
    blockers: record.blockers ?? current?.blockers ?? [],
    updatedAt: new Date().toISOString(),
  })

  await ensureDir(STATE_DIR)
  await writeJson(`${STATE_DIR}/${record.ideaId}.json`, updated)

  await recordMcpEvent({
    connector: 'micro-offer',
    agentName: record.ownerAgent,
    action: 'upsert-record',
    entityType: 'offer-operation',
    entityId: record.ideaId,
    status: 'success',
    payload: {
      stage: updated.stage,
      recordStatus: updated.status,
      artifactCount: updated.artifactPaths.length,
      blockerCount: updated.blockers.length,
    },
  })

  return updated
}

export async function readMicroOfferRecord(ideaId: string): Promise<MicroOfferRecord | null> {
  const raw = await readJsonOrNull<unknown>(`${STATE_DIR}/${ideaId}.json`)
  return raw ? MicroOfferRecordSchema.parse(raw) : null
}

