---
id: ops-tracking-001
name: meta-capi-n8n-tracking
description: "Planeja tracking Meta Pixel + CAPI server-side via n8n para ofertas low ticket"
createdAt: 2026-05-22T00:00:00.000Z
createdByAgent: tracking-agent
usageCount: 0
---

# Meta CAPI n8n Tracking

## Quando usar
Use depois que oferta, funil, copy e design brief estiverem prontos, antes de subir trafego pago.

## Objetivo
Criar um plano de rastreamento confiavel para Meta Ads combinando Pixel no navegador com Conversion API server-side via n8n.

## Problema que resolve

- Navegadores como Safari e Firefox, iOS e bloqueadores reduzem a confiabilidade do Pixel no navegador.
- Cookies, pixels e scripts podem ser bloqueados ou expirar rapidamente.
- Atribuicao ruim causa aprendizado fraco, desperdicio de verba e decisao errada de criativo.

## Arquitetura recomendada

```text
Landing page / checkout
  -> dataLayer ou webhook de evento
  -> Pixel Meta no navegador
  -> n8n webhook server-side
  -> normalizacao de dados
  -> hash SHA256 de email e telefone
  -> Meta Conversion API
  -> verificacao no Events Manager
```

## Regra 80/20 da correspondencia

Para low ticket, priorizar dados simples e fortes:

- `em`: email normalizado e hasheado com SHA256.
- `ph`: telefone normalizado e hasheado com SHA256.
- `fbc`: click id do Facebook quando existir.
- `fbp`: browser id quando existir.
- `client_ip_address`: IP do cliente quando capturado de forma permitida.
- `client_user_agent`: user agent quando capturado de forma permitida.

Email e telefone ja elevam muito a chance de correspondencia. FBC/FBP, IP e user agent melhoram o Event Match Quality.

## Normalizacao antes do hash

- Email: trim, lowercase, remover espacos.
- Telefone BR: manter apenas digitos, incluir DDI 55 quando necessario.
- Nome, cidade, estado e pais so entram se coletados com consentimento e utilidade.
- Hash: SHA256 em hexadecimal, sem sal.

## Eventos minimos para oferta low ticket

- `PageView`: visita da pagina.
- `ViewContent`: visualizacao da oferta/produto.
- `AddToCart`: clique no CTA ou escolha do produto, se houver carrinho.
- `InitiateCheckout`: inicio do checkout.
- `Purchase`: compra aprovada.

Eventos opcionais:

- `Lead`: apenas se houver quiz ou lead magnet.
- `Subscribe`: apenas se houver recorrencia.
- `UpsellPurchase`: evento interno ou `Purchase` separado com `content_name` do upsell.

## Deduplicacao

Pixel e CAPI devem enviar o mesmo `event_id` para o mesmo evento. A Meta usa esse ID para deduplicar browser e server.

Formato sugerido:

```text
{eventName}_{ideaId}_{timestamp}_{randomId}
```

## Parametros de valor

Para `Purchase`, sempre incluir:

- `currency`: `BRL`.
- `value`: valor numerico.
- `content_name`: nome do produto.
- `content_ids`: id da oferta ou produto.
- `content_type`: `product`.

Order bump e upsell podem ser eventos de compra separados ou itens adicionais no payload, dependendo do checkout.

## Checklist de n8n

- Criar webhook publico para receber eventos.
- Validar metodo HTTP e secret/token simples.
- Normalizar email e telefone.
- Aplicar SHA256.
- Montar payload Meta CAPI.
- Enviar POST para `https://graph.facebook.com/{version}/{pixel_id}/events`.
- Registrar resposta, `event_id`, status e erros.
- Separar ambiente de teste e producao.

## Portao antes do trafego pago

Nao liberar a oferta para midia paga se:

- Pixel ID nao esta definido.
- Access token da CAPI nao esta definido.
- Purchase nao aparece no Events Manager.
- Deduplicacao entre browser e server nao foi testada.
- Event Match Quality esta baixo por falta de email/telefone.
- UTMs nao foram padronizadas.
- Checkout nao envia valor, moeda e status de pagamento.

## Saida do agente

O tracking-agent deve gerar:

- Mapa de eventos.
- Plano de dataLayer/webhooks.
- Workflow n8n em passos.
- Campos de correspondencia e regras de hash.
- UTMs padrao.
- Checklist de validacao.
- Criterio `readyForTraffic`.
