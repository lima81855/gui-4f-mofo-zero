import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger'

// ─────────────────────────────────────────────────────────────────────────────
// MCP: Filesystem — leitura e escrita de fichas estruturadas
// Todas as operações são relativas à raiz do projeto
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

function resolvePath(...parts: string[]): string {
  return path.join(PROJECT_ROOT, ...parts)
}

/**
 * Garante que um diretório existe (cria recursivamente se necessário)
 */
export async function ensureDir(dirPath: string): Promise<void> {
  const resolved = resolvePath(dirPath)
  try {
    await fs.mkdir(resolved, { recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
}

/**
 * Escreve um objeto JSON com formatação legível
 */
export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const resolved = resolvePath(filePath)
  await ensureDir(path.dirname(filePath))

  const content = JSON.stringify(data, null, 2)
  await fs.writeFile(resolved, content, 'utf-8')
  logger.debug('Filesystem MCP — arquivo JSON escrito', { filePath, bytes: content.length })
}

/**
 * Lê e parseia um arquivo JSON
 */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const resolved = resolvePath(filePath)
  const content = await fs.readFile(resolved, 'utf-8')
  return JSON.parse(content) as T
}

/**
 * Lê um arquivo JSON e retorna null se não existir
 */
export async function readJsonOrNull<T = unknown>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Escreve um arquivo de texto (Markdown, etc.)
 */
export async function writeText(filePath: string, content: string): Promise<void> {
  const resolved = resolvePath(filePath)
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(resolved, content, 'utf-8')
  logger.debug('Filesystem MCP — arquivo texto escrito', { filePath, bytes: content.length })
}

/**
 * Lê um arquivo de texto
 */
export async function readText(filePath: string): Promise<string> {
  const resolved = resolvePath(filePath)
  return fs.readFile(resolved, 'utf-8')
}

/**
 * Lê um arquivo de texto e retorna null se não existir
 */
export async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await readText(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Lista todos os arquivos em um diretório (não recursivo)
 */
export async function listFiles(
  dirPath: string,
  extension?: string,
): Promise<string[]> {
  const resolved = resolvePath(dirPath)

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && (!extension || e.name.endsWith(extension)))
      .map(e => path.join(dirPath, e.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Verifica se um arquivo existe
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(resolvePath(filePath))
    return true
  } catch {
    return false
  }
}

/**
 * Apaga um arquivo (sem erro se não existir)
 */
export async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(resolvePath(filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Lê todos os arquivos JSON de um diretório e retorna array de objetos parseados
 */
export async function readAllJson<T = unknown>(dirPath: string): Promise<T[]> {
  const files = await listFiles(dirPath, '.json')
  const results: T[] = []

  for (const file of files) {
    try {
      const data = await readJson<T>(file)
      results.push(data)
    } catch (error) {
      logger.warn('Filesystem MCP — erro ao ler JSON, pulando', {
        file,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

/**
 * Atualiza um arquivo JSON de forma atômica (lê → modifica → escreve)
 */
export async function updateJson<T>(
  filePath: string,
  updater: (current: T | null) => T,
): Promise<void> {
  const current = await readJsonOrNull<T>(filePath)
  const updated = updater(current)
  await writeJson(filePath, updated)
}
