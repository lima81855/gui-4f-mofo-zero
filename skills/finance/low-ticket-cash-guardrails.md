---
id: ops-finance-001
name: low-ticket-cash-guardrails
description: "Define regras de caixa, margem, limite de teste e verba de escala para ofertas low ticket"
createdAt: 2026-05-22T00:00:00.000Z
createdByAgent: finance-agent
usageCount: 0
---

# Low Ticket Cash Guardrails

## Quando usar
Use antes de liberar verba de trafego e depois de cada leitura de metricas.

## Objetivo
Proteger o caixa da operacao low ticket enquanto a oferta ainda esta em validacao.

## Principios

- Caixa vem antes de escala.
- Sem tracking confiavel, nao existe decisao financeira confiavel.
- Sem dados reais, verba deve ficar bloqueada ou simulada.
- Escala so acontece depois de venda validada, margem conhecida e risco de reembolso controlado.
- Low ticket precisa considerar AOV, order bump, upsell, taxa de plataforma, reembolso e custo de trafego.

## Regras de teste inicial

- Definir teto de perda por oferta antes de subir campanha.
- Definir verba diaria maxima de teste.
- Nao ultrapassar o teto de perda sem decisao humana do CEO.
- Para produto de R$47, teste conservador ate validar checkout e compra.
- Se tracking estiver bloqueado, a verba real deve ser zero.

## Regras de margem

- Calcular margem usando receita, taxa de plataforma, reembolso, custo de trafego e custo operacional.
- Se nao houver taxa real, usar estimativa conservadora e marcar como pendencia.
- Order bump e upsell entram como potencial de AOV, nao como certeza.
- Se reembolso subir, pausar escala e revisar promessa/entrega.

## Regras de escala

- Escalar apenas se houver compras reais, tracking validado e CPA abaixo do limite aceitavel.
- Aumentar verba em degraus pequenos.
- Nao dobrar orcamento em oferta sem historico.
- Preservar uma reserva de caixa antes de ampliar testes.

## Saida obrigatoria

```json
{
  "ideaId": "",
  "cashStatus": "bloqueado | teste-controlado | escala-permitida",
  "summary": "",
  "testBudgetLimit": "",
  "dailyBudgetCap": "",
  "maxLossAllowed": "",
  "breakEvenCpa": "",
  "targetCpa": "",
  "marginAssumptions": [],
  "releaseConditions": [],
  "stopLossRules": [],
  "scaleRules": [],
  "cashProtectionActions": [],
  "ceoApprovalRequired": true,
  "riskNotes": []
}
```
