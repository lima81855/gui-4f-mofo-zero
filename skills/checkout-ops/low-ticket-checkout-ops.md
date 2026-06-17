---
id: ops-checkout-001
name: low-ticket-checkout-ops
description: "Garante checkout, pagamento, entrega, order bump, upsell, suporte e teste de compra em low ticket"
createdAt: 2026-05-23T00:00:00.000Z
createdByAgent: checkout-ops
usageCount: 0
---

# Low Ticket Checkout Ops

## Quando usar
Use depois de oferta, funil, copy, produto, design, tracking, midia, financeiro e CRO existirem.

## Objetivo
Evitar que a empresa compre trafego para um funil que ainda nao recebe pagamento, nao entrega produto, nao libera acesso ou nao mede compra.

## Regras de ouro
- Se nao houver link real de checkout, status deve ser bloqueado.
- Se nao houver fluxo de entrega definido, status deve ser bloqueado.
- Se o tracking de `Purchase` nao estiver validado, status deve ser bloqueado para trafego.
- Nao incluir WhatsApp como etapa operacional.
- Nao inventar plataforma, taxa, integracao pronta ou link real.
- Separar o que depende do CEO, do designer, do tracking e do operador de checkout.

## Areas obrigatorias
- Checkout principal: produto, preco, nome, descricao curta, imagem, garantia e metodo de pagamento.
- Order bump: promessa, preco, checkbox, compatibilidade com produto principal e tracking.
- Upsell: pagina pos-compra, oferta, botao de aceitar, botao de recusar e entrega.
- Entrega: e-mail de confirmacao, link do produto, area de membros ou arquivo, prazo e contingencia.
- Acesso: usuario, senha, recuperacao de senha, suporte e teste em mobile.
- Legal: termos, politica de privacidade, politica de reembolso e identificacao do vendedor.
- Tracking: `InitiateCheckout`, `Purchase`, deduplicacao, UTMs e teste com compra simulada.

## Teste de compra minimo
1. Abrir pagina como usuario novo em janela anonima.
2. Clicar no CTA da pagina.
3. Confirmar que abriu checkout correto.
4. Marcar/desmarcar order bump e verificar preco.
5. Concluir compra de teste ou modo sandbox.
6. Confirmar upsell pos-compra.
7. Confirmar e-mail, entrega e acesso.
8. Confirmar eventos no Events Manager, CAPI/n8n e arquivo de metricas.

## Saida esperada
Gerar um plano operacional com readiness, blockers, fluxo de entrega, fluxo de acesso, checklist e roteiro de compra teste.
