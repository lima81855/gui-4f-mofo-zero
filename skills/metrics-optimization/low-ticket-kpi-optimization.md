---
id: ops-metrics-001
name: low-ticket-kpi-optimization
description: "Analisa KPIs de low ticket e decide pausar, ajustar, escalar ou criar novos testes"
createdAt: 2026-05-21T00:00:00.000Z
createdByAgent: metrics-analyst
usageCount: 0
---

# Low Ticket KPI Optimization

## Quando usar
Use quando houver dados de campanha, pagina, checkout, vendas, reembolso ou caixa.

## KPIs minimos

- Gasto.
- Impressões.
- CPM.
- CTR.
- CPC.
- Visualizacoes de pagina.
- Initiate Checkout.
- Purchases.
- CPA.
- Receita.
- ROAS.
- Conversao da pagina.
- Conversao do checkout.
- Conversao de order bump.
- Conversao de upsell.
- Reembolso.

## Decisoes

```text
Sem tracking validado -> nao escalar.
Gasto >= 3x preco do produto e 0 compra -> pausar e criar nova rodada.
Gasto >= 2x preco do produto e 0 compra -> alerta de corte; so manter com ajuste imediato.
CTR baixo -> revisar hook/criativo.
CPC alto com CTR baixo -> novo angulo.
PageView alto sem checkout -> revisar pagina e promessa.
Checkout alto sem compra -> revisar preco, garantia, checkout e meios de pagamento.
Compra com ROAS positivo -> aumentar verba gradualmente.
Reembolso alto -> revisar promessa, entrega e expectativa.
```

## Regra Kit SOS

Para o Kit SOS Planta Morrendo, com front-end de R$47:

- R$94 gastos e 0 compra: alerta de corte.
- R$141 gastos e 0 compra: pausar a campanha atual.
- R$146 gastos e 0 compra em dois dias: decisao operacional = pausar `01[UNBOXING DO PRODUTO]` e rodar nova rodada com angulos de dor urgente, nao continuar o mesmo teste.
- Eventos intermediarios explicam o vazamento, mas nao substituem venda.

## Saida obrigatoria

```json
{
  "ideaId": "",
  "summary": "",
  "decision": "pausar | ajustar | escalar | manter | criar-novo-teste",
  "reason": "",
  "actions": [],
  "budgetChange": "",
  "creativeRequests": [],
  "funnelRequests": [],
  "riskNotes": []
}
```

## Regras financeiras

- Proteger caixa antes de escalar.
- Nao aumentar orcamento com dados incompletos.
- Escalar em degraus pequenos enquanto a oferta ainda nao tem historico.
- Separar problema de criativo, pagina, checkout e produto.
