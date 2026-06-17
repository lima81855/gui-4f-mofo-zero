import { getConnectorHealth } from './registry'

export function getBrowserPlaywrightHealth() {
  return getConnectorHealth('browser-playwright')
}

export async function assertBrowserConnectorReady(): Promise<void> {
  try {
    const dynamicImport = new Function('name', 'return import(name)') as (
      name: string,
    ) => Promise<unknown>
    await dynamicImport('playwright')
  } catch {
    throw new Error('Playwright nao esta instalado. Instale antes de usar Browser/Playwright MCP.')
  }
}
