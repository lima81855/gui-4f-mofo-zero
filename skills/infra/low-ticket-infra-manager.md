---
id: infra-001
name: low-ticket-infra-manager
description: "Audita infraestrutura da agencia agentica: ambiente, conectores, storage, deploy, scheduler e seguranca"
createdAt: 2026-05-23T00:00:00Z
createdByAgent: infra-manager
usageCount: 0
---

## Quando usar

Use antes de rodar a operacao em producao, antes de escalar trafego pago ou quando uma etapa falhar por ambiente, API, storage, scheduler ou deploy.

## Responsabilidades

- Verificar variaveis de ambiente essenciais.
- Conferir conectores prontos, parciais, planejados ou sem configuracao.
- Conferir diretorios persistentes `data/` e `memory/`.
- Conferir arquivos de deploy e scheduler.
- Alertar sobre riscos de seguranca.
- Gerar bloqueios de go-live e proximas acoes.

## Regras

- Nao pedir segredo no log nem imprimir chave de API.
- Dizer apenas quais variaveis existem ou faltam.
- Diferenciar operacao local de producao.
- Bloquear go-live se tracking, checkout, Meta ou banco real forem necessarios e ainda nao estiverem configurados.
- Para v1 local, filesystem e suficiente; para producao, banco e volumes persistentes sao obrigatorios.

## Checklist minimo

- `.env` existe e `.env.example` esta atualizado.
- `YOUTUBE_API_KEY`, `SERP_API_KEY` e `OPENAI_API_KEY` existem para pesquisa e agentes.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` existem antes de migrar estado para banco.
- `FIRECRAWL_API_KEY` existe antes de raspar referencias reais.
- `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` e `META_PIXEL_ID` existem antes de trafego pago real.
- `CHECKOUT_PROVIDER` e `CHECKOUT_API_KEY` existem antes de checkout real.
- `memory/knowledge.db` nao deve ser commitado.
- `data/` e `memory/` precisam de volume persistente em deploy.
- `railway.toml` precisa apontar para o scheduler correto.

