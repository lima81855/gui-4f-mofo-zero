---
id: ops-media-001
name: low-ticket-meta-launch
description: "Cria plano de lancamento Meta Ads para ofertas low ticket com criterios de teste, pausa e escala"
createdAt: 2026-05-22T00:00:00.000Z
createdByAgent: media-buyer
usageCount: 0
---

# Low Ticket Meta Launch

## Quando usar
Use depois que oferta, funil, criativos, roteiros e tracking plan estiverem prontos.

## Objetivo
Criar um plano de campanha de Meta Ads para testar uma oferta low ticket com controle de risco.

## Regra principal
Se o tracking nao estiver validado, o plano deve ficar em modo pre-lancamento. Nao liberar verba real ate Pixel, CAPI, deduplicacao, UTMs e evento Purchase estarem testados.

Depois que o teste real comecar, a metrica soberana e `Purchase`. PageView, ViewContent, QuizStart, Lead e InitiateCheckout servem apenas para diagnosticar onde o funil vazou; eles nao liberam escala e nao salvam criativo sem compra.

## Estrutura inicial recomendada

- Campanha de vendas/conversoes otimizando para `Purchase`.
- Orcamento baixo de teste por 3 a 5 dias.
- 1 campanha principal.
- 2 a 3 conjuntos de anuncios.
- 3 a 5 criativos por conjunto.
- Separar angulos criativos, nao microsegmentar demais.

## Publicos iniciais

- Aberto amplo Brasil, quando o produto e mass market.
- Interesse amplo do nicho, quando a dor e mais especifica.
- Engajamento ou visitantes apenas se ja houver volume.
- Evitar lookalike sem base de compra suficiente.

## Criativos

Testar angulos diferentes, nao apenas variacoes cosmeticas:

- Reconhecimento da dor.
- Erro invisivel.
- Alivio pratico.
- Perda evitavel.
- Demonstracao visual.

Quando o objetivo for descobrir vencedor rapidamente, consultar tambem:

- `meta-322-andromeda-iteration`: framework 3:2:2, teste horizontal, variacao vertical, colheita de vencedor e escala por dados.

## Orcamento

Para produto entre R$27 e R$97:

- Teste minimo: 1 a 3 vezes o preco do produto por dia.
- Janela inicial: 3 dias, mas precisa vender dentro da janela.
- Para produto de R$47, se o teste gastar 2x o preco sem compra, entra em alerta de corte.
- Para produto de R$47, se o teste gastar 3x o preco sem compra, pausar campanha/variacao e revisar criativo, promessa e checkout antes de novo gasto.
- Nao escalar antes de compra real atribuida.

## Metricas de leitura

- Purchase: indica viabilidade real e decide continuidade.
- CTR link: indica forca do criativo, mas nao decide escala sozinho.
- CPC link: indica eficiencia do criativo/publico, mas nao decide escala sozinho.
- ViewContent, QuizStart, QuizComplete, Lead e InitiateCheckout: indicam alinhamento pagina/oferta e servem para diagnostico.
- CPA: precisa ser comparado com preco, order bump, upsell e margem.
- ROAS: usar com cautela no inicio, pois atribuicao ainda estabiliza.

## Regras de pausa

- Gasto >= 3x preco do produto e zero Purchase: pausar campanha/variacao.
- Gasto >= 2x preco do produto e zero Purchase: manter somente se houver checkout forte e ajuste imediato planejado.
- Muito gasto sem clique: revisar criativo.
- Cliques sem ViewContent: revisar carregamento/pagina/tracking.
- ViewContent sem checkout: revisar promessa, primeira dobra e CTA.
- Checkout sem compra: revisar checkout, preco, garantia e friccao.
- Comentarios negativos ou reclamacoes: pausar criativo e revisar promessa.

## Regras de escala

- Escalar apenas se Purchase estiver validado.
- Aumentar orcamento gradualmente, em blocos de 20% a 30%.
- Duplicar vencedor somente quando houver consistencia por mais de um dia.
- Pedir novas variacoes do angulo vencedor antes de saturar.
- Se varios vencedores independentes por avatar ficarem acima da metrica minima, empilhar orcamento sem matar o que ainda funciona.

## Saida do agente

O media-buyer deve gerar:

- Status de liberacao.
- Objetivo da campanha.
- Estrutura de campanha/ad sets/anuncios.
- Orcamento de teste.
- Matriz de criativos.
- Publicos iniciais.
- UTMs.
- Regras de pausa.
- Regras de escala.
- Checklist antes de publicar.
- Pedidos para o time de criativos.
