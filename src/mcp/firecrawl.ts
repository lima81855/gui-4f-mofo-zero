import { getConnectorHealth } from './registry'
import { logger } from '../utils/logger'

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2'

type FirecrawlScrapeOptions = {
  url: string
  mobile?: boolean
  waitFor?: number
}

type FirecrawlScrapeResult = {
  url: string
  title: string
  markdown: string
  html?: string
  screenshot?: string
}

type FirecrawlResponse = {
  success?: boolean
  data?: {
    markdown?: string
    html?: string
    screenshot?: string
    metadata?: {
      title?: string
      sourceURL?: string
      url?: string
    }
  }
  error?: string
}

function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) throw new Error('FIRECRAWL_API_KEY nao configurada no .env')
  return key
}

export function getFirecrawlHealth() {
  return getConnectorHealth('firecrawl-reference')
}

export async function scrapeFunnelReference(
  options: FirecrawlScrapeOptions,
): Promise<FirecrawlScrapeResult> {
  logger.info('Firecrawl MCP - raspando referencia', { url: options.url })

  const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${getApiKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      url: options.url,
      formats: ['markdown'],
      onlyMainContent: true,
      mobile: options.mobile ?? true,
      waitFor: options.waitFor ?? 1000,
      timeout: 60000,
    }),
  })

  const body = await response.json() as FirecrawlResponse

  if (!response.ok || body.success === false || !body.data?.markdown) {
    throw new Error(`Firecrawl scrape falhou: ${response.status} ${body.error || 'sem markdown'}`)
  }

  return {
    url: body.data.metadata?.sourceURL || body.data.metadata?.url || options.url,
    title: body.data.metadata?.title || options.url,
    markdown: body.data.markdown,
    html: body.data.html,
    screenshot: body.data.screenshot,
  }
}

