import type { ConnectorHealth, ConnectorName } from '../types'

type ConnectorDefinition = {
  name: ConnectorName
  requiredEnv: string[]
  capabilities: string[]
  notes: string[]
}

const CONNECTORS: ConnectorDefinition[] = [
  {
    name: 'micro-offer',
    requiredEnv: [],
    capabilities: [
      'registrar eventos internos dos agentes',
      'salvar estado operacional por ideia/oferta',
      'centralizar artefatos e bloqueios',
    ],
    notes: ['Base interna pronta em sistema de arquivos; pode migrar para Postgres sem mudar agentes.'],
  },
  {
    name: 'openai',
    requiredEnv: ['OPENAI_API_KEY'],
    capabilities: [
      'gerar analises e artefatos com IA',
      'operar agentes criativos e analiticos',
      'transformar dores em ofertas, copy, produto e planos',
    ],
    notes: ['Ja usado pelos agentes atuais via OpenAI SDK.'],
  },
  {
    name: 'serpapi-trends',
    requiredEnv: ['SERP_API_KEY'],
    capabilities: [
      'consultar Google Trends',
      'estimar volume e tendencia',
      'apoiar validacao de mercado',
    ],
    notes: ['Ja existe no projeto em src/mcp/trends.ts.'],
  },
  {
    name: 'supabase-postgres',
    requiredEnv: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    capabilities: [
      'persistir entidades em banco relacional',
      'consultar historico operacional',
      'virar memoria transacional da empresa',
    ],
    notes: ['Conector preparado por REST; falta criar tabelas e informar variaveis.'],
  },
  {
    name: 'youtube-research',
    requiredEnv: ['YOUTUBE_API_KEY'],
    capabilities: [
      'buscar videos por query/canal',
      'extrair comentarios',
      'alimentar pesquisa de dores e desejos',
    ],
    notes: ['Ja existe via YouTube Data API v3.'],
  },
  {
    name: 'browser-playwright',
    requiredEnv: [],
    capabilities: [
      'validar paginas locais',
      'inspecionar funis renderizados',
      'testar fluxos de checkout quando Playwright estiver instalado',
    ],
    notes: ['Sem dependencia obrigatoria por enquanto; usar como conector de QA controlado.'],
  },
  {
    name: 'firecrawl-reference',
    requiredEnv: ['FIRECRAWL_API_KEY'],
    capabilities: [
      'raspar referencias de paginas e funis',
      'extrair markdown limpo de landing pages, VSLs, quizzes e advertoriais',
      'alimentar design, UI e arquitetura visual sem copiar concorrentes',
    ],
    notes: ['Usa Firecrawl API v2 /scrape. Referencias devem virar padroes, nao copia.'],
  },
  {
    name: 'meta-ads',
    requiredEnv: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PIXEL_ID'],
    capabilities: [
      'ler campanhas e criativos',
      'enviar eventos CAPI',
      'alimentar media buyer e creative analyst',
    ],
    notes: ['Proximo conector externo depois dos 4 iniciais.'],
  },
  {
    name: 'checkout',
    requiredEnv: ['CHECKOUT_PROVIDER', 'HOTMART_HOTTOK'],
    capabilities: [
      'receber webhooks da Hotmart',
      'validar Hottok do postback',
      'confirmar compras e reembolsos',
      'alimentar financeiro e tracking',
    ],
    notes: ['Webhook Hotmart disponivel em /api/webhooks/hotmart. API de checkout pode entrar depois para conciliacao avancada.'],
  },
  {
    name: 'email-crm',
    requiredEnv: ['CRM_PROVIDER', 'CRM_API_KEY'],
    capabilities: [
      'registrar leads/clientes',
      'ativar pos-venda',
      'organizar suporte e relacionamento',
    ],
    notes: ['Pode ficar para depois do checkout e Meta.'],
  },
]

function missingEnv(requiredEnv: string[]): string[] {
  return requiredEnv.filter(name => !process.env[name])
}

export function listConnectorHealth(): ConnectorHealth[] {
  return CONNECTORS.map(connector => {
    const missing = missingEnv(connector.requiredEnv)
    const configured = missing.length === 0
    const status =
      connector.name === 'micro-offer'
        ? 'ready'
        : connector.name === 'openai' || connector.name === 'serpapi-trends' || connector.name === 'youtube-research'
          ? configured ? 'ready' : 'missing-config'
        : configured
          ? 'partial'
          : connector.name === 'meta-ads' || connector.name === 'checkout' || connector.name === 'email-crm'
            ? 'planned'
            : 'missing-config'

    return {
      name: connector.name,
      status,
      configured,
      requiredEnv: connector.requiredEnv,
      missingEnv: missing,
      capabilities: connector.capabilities,
      notes: connector.notes,
    }
  })
}

export function getConnectorHealth(name: ConnectorName): ConnectorHealth {
  const connector = listConnectorHealth().find(item => item.name === name)
  if (!connector) throw new Error(`Conector nao registrado: ${name}`)
  return connector
}
