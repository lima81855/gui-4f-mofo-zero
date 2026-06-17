---
id: ops-media-002
name: meta-322-andromeda-iteration
description: "Framework 3:2:2 para testes Meta Ads, hiperpersonalizacao criativa e escala por dados"
createdAt: 2026-06-10T00:00:00.000Z
createdByAgent: media-buyer
usageCount: 0
---

# Meta 3:2:2 Andromeda Iteration

## Quando usar
Use quando o setor de midia buyer, trafego, copy ou analise criativa precisar montar, ler ou escalar testes no Meta Ads.

Este framework e repertorio operacional. Nao e uma regra cega. Se dados reais, caixa, tracking ou oferta contradizem o framework, a decisao deve seguir a leitura operacional da agencia.

## Principio central
Em 2026, a mensagem e uma parte do direcionamento. O anuncio filtra o publico pelo conceito, pela dor, pelo avatar e pelo angulo. A operacao deve reduzir dependencia de segmentacao manual e aumentar volume de criativos com variacoes inteligentes.

## Andromeda 2.0: jornada do sinal
O algoritmo deve ser treinado por sinais especificos ao longo da jornada, nao apenas por publico amplo ou interesse manual.

Sinais prioritarios:

- Novo cliente.
- Evento especifico de funil.
- Conversao.
- Compra com parametros limpos via CAPI.
- Criativo com conceito claro o bastante para filtrar o proprio publico.

Regras praticas:

- Otimizar para o evento principal quando ja existe volume minimo de compra.
- Usar eventos intermediarios apenas como diagnostico, nao como vitoria final.
- Se a campanha tem cliques mas nao tem checkout, o problema pode estar em promessa, pagina, trafego ruim ou friccao, nao necessariamente no publico.
- Se a campanha tem checkout e nao compra, chamar CRO, checkout e oferta antes de culpar o criativo.
- CAPI com alta qualidade e condicao de escala; nao substitui oferta, pagina e criativo, mas permite o algoritmo aprender com compradores reais.

## Regras de valor pos-Andromeda

Use regras de valor para orientar o Meta a dar mais ou menos peso de lance/entrega para segmentos que demonstram maior ou menor valor dentro do conjunto. Isto nao substitui o 3:2:2, nao substitui CAPI e nao deve virar segmentacao manual antiga disfarçada.

### Quando considerar

- Depois que o tracking de compra estiver confiavel.
- Depois de ter sinais por etapa do funil: clique, ViewContent, InitiateCheckout e Purchase.
- Quando existir uma diferenca clara por recorte de entrega: genero, idade, dispositivo, posicionamento, regiao ou plataforma.
- Quando o objetivo for reduzir desperdicio sem quebrar a consolidacao da campanha.

### O que a regra deve usar como fonte

Prioridade de decisao:

1. `Purchase` com valor e parametros limpos via CAPI.
2. `InitiateCheckout` quando ainda ha poucas compras, tratado apenas como proxy fraco.
3. Clique e CTR apenas como diagnostico de criativo, nunca como regra de valor isolada.
4. Reembolso, compra tardia e qualidade de cliente quando estiverem disponiveis.

### Protocolo antes de criar regra

O media buyer deve primeiro pedir/levar a leitura por breakdown:

- Genero.
- Idade.
- Dispositivo/plataforma.
- Posicionamento.
- Regiao.
- Criativo/post.
- Gasto, cliques, InitiateCheckout, Purchase, CPA e ROAS por recorte.

Sem breakdown, qualquer regra de valor e chute operacional e deve ser bloqueada.

### Exemplos de acao

- Aumentar valor/lance para o segmento que concentra compras ou checkout qualificado com CPA melhor.
- Reduzir valor/lance para posicionamento com clique barato mas sem checkout/compra.
- Reduzir Audience Network quando houver trafego barato, baixa qualidade e nenhum sinal de compra.
- Aumentar iOS ou Android somente se o recorte provar checkout/compra melhor, nao por intuicao.
- Aumentar genero/idade somente se o recorte provar comprador real ou checkout forte.

### Guardrails

- Com poucas compras, usar ajuste conservador ou apenas monitorar; nao aplicar +80%/-50% sem evidencia forte.
- Nao fragmentar a campanha em varios conjuntos pequenos se o objetivo e consolidacao.
- Nao usar regra de valor para compensar pagina, checkout ou oferta fraca.
- Se a regra piorar CPA/ROAS nas proximas 24-48h, desfazer.
- Toda regra criada precisa ter: hipotese, recorte, ajuste, metrica de sucesso, limite de perda e data de revisao.

### Saida obrigatoria

Quando o CEO pedir regras de valor, o setor deve entregar:

- `status`: `bloqueada_por_dados`, `pronta_para_teste` ou `ativa`.
- Breakdown usado.
- Regra proposta.
- Justificativa por sinal de compra/funil.
- Risco.
- Janela de validacao.
- Criterio de reversao.

## Marca como fosso
Em mercados competitivos e instaveis, marca, conceito e consistencia visual protegem a oferta contra mudancas de plataforma.

Aplicacao na agencia:

- Manter uma identidade reconhecivel por produto, sem depender de um unico criativo.
- Criar um conceito proprietario simples de lembrar: diagnostico, mapa, checklist, plano, kit, guia, protocolo ou biblioteca.
- Evitar paginas e anuncios genericos que poderiam vender qualquer produto.
- Usar prova visual do produto para construir confianca e memoria de marca.
- Criadores e UGC podem ampliar autenticidade, desde que mantenham liberdade de linguagem e nao virem roteiro engessado.

## Orcamento de R&D
Reservar parte da verba para experimentos controlados, sem comprometer o caixa principal.

Diretriz:

- Ate 10% do budget pode ir para ideias novas, angulos estranhos, criativos experimentais e testes de conceito.
- O R&D nao deve roubar verba do controle vencedor.
- Ideia experimental precisa ter hipotese clara: qual avatar, qual dor, qual sinal e qual criterio de corte.
- Experimentos que chamam atencao mas nao geram sinal de compra voltam para copy/criativo, nao para escala.

## Metodo 3:2:2
Estrutura base para teste dinamico:

- 3 criativos.
- 2 textos principais.
- 2 titulos.
- Resultado: ate 12 combinacoes para o algoritmo testar.

Regras de uso:

- Usar criativos do mesmo formato no mesmo teste: apenas videos ou apenas imagens.
- Consolidar aprendizado em um unico pool quando o objetivo for descobrir combinacao vencedora.
- Separar IDs/posts vencedores depois da leitura para levar ao conjunto de controle.
- Nao confundir variacao cosmetica com angulo novo. O teste precisa comparar conceitos.
- No formato flexivel, a colheita precisa identificar a combinacao vencedora: post/ID existente, texto principal, titulo, criativo e evento de compra.
- Controle nao significa "anuncio solto sem metodo"; significa isolar a combinacao vencedora para confirmar estabilidade com menor ruido.

## Sistema de escala em 3 passos

1. Teste dinamico: identificar qual combinacao atrai gasto de forma eficiente.
2. Colheita: extrair o ID/post vencedor e mover para controle.
3. Escala baseada em dados: aumentar orcamento apenas quando o novo anuncio melhora a performance geral da campanha.

### Colheita para controle em campanha CBO

Quando o teste 3:2:2 roda dentro de campanha CBO, o conjunto de controle pode ficar na mesma campanha, mas a decisao de verba precisa respeitar o aprendizado compartilhado:

- Nao aumentar a verba da campanha apenas porque o controle foi criado.
- Criar o conjunto controle com o post existente vencedor e a combinacao vencedora colhida.
- Manter o conjunto de teste ativo se ele ainda estiver gerando aprendizado util, desde que exista limite de gasto e nao esteja drenando verba sem compra.
- Se a CBO concentrar verba no teste antigo e negar entrega ao controle, ajustar estrutura ou pausar apenas os elementos que desperdicam verba.
- Se o controle repetir compra com CPA/ROAS melhor que o teste, ele vira referencia para escala gradual.
- Se o controle nao repetir, voltar para iteracao vertical do angulo vencedor antes de aumentar verba.
- A leitura correta compara caixa real, compras Meta, custo por InitiateCheckout e distribuicao de verba entre conjuntos.

Escala estavel:

- Preferir aumento gradual de 20% a 50%, conforme estabilidade, janela de dados e caixa.
- Nao aumentar verba porque o CTR e bonito se nao existe compra ou sinal forte de funil.
- Vencedor nao deve substituir automaticamente todos os outros. Se varios conceitos por avatar geram retorno acima do minimo, empilhar orcamentos e manter independencia.
- Em CBO, aumentar orcamento so depois que a campanha provar que o controle melhora a performance geral, nao apenas depois de criar o controle.

## Checklist tatico do media buyer

1. Mapear pelo menos 3 angulos radicalmente diferentes para o mesmo produto.
2. Testar horizontalmente para encontrar avatar/angulo/conceito com eficiencia.
3. Desligar angulos que nao atingem a metrica minima definida para o teste.
4. Criar 10 variacoes do angulo que funcionou, mudando gancho, persona, prova, objecao ou situacao.
5. Auditar conteudo organico: encontrar picos de atencao, inserir CTA e transformar em anuncio quando houver sinal.

## Matriz de iteracao

Horizontal:

- Objetivo: encontrar o avatar ou angulo com resposta inicial.
- Exemplo generico: digestao vs cabelo vs pele.
- Na agencia low-ticket: folha amarela vs pragas vs vaso/drenagem vs mofo em roupa vs mofo em parede.

Vertical:

- Objetivo: aprofundar o vencedor.
- Criar fatias menores da vida do mesmo avatar.
- Em vez de um unico anuncio generico, criar 10 anuncios com variacoes ligeiramente diferentes do mesmo problema.

Exemplos de variacao vertical:

- Persona: iniciante, dona de casa, apartamento pequeno, pessoa sem tempo, comprador cetico.
- Gancho: erro comum, perda evitavel, diagnostico rapido, prova visual, economia de dinheiro.
- Situacao: primeira folha amarela, planta recem-comprada, armario com cheiro, sapato mofado, parede com mancha.
- Prova: mockup, checklist, tela do guia, comentario real, demonstracao do produto.

## Produtos unicos, avatares multiplos
Um mesmo produto pode ser vendido por varios avatares, desde que a comunicacao pareca uma solucao separada para cada problema.

Regra pratica:

- Produto unico no backend.
- Anuncios e paginas podem enfatizar caminhos diferentes.
- O algoritmo tende a entregar o conceito para quem demonstra aquele problema.
- Evitar sobrepor tudo em uma promessa generica.

## Flywheel criativo

1. Publicacao massiva: soltar organico em alto volume.
2. Validacao natural: analisar sinais reais do algoritmo e dos comentarios.
3. Injecao de CTA: adicionar banner, oferta ou chamada nos conteudos que demonstram atencao.
4. Injecao no trafego: subir o conteudo validado como anuncio e cozinhar novas variacoes.

Filtro de validade:

- Conteudo viral nem sempre converte.
- Nao deixar video organico improdutivo consumir verba so porque chamou atencao.
- Virou anuncio apenas se existe coerencia com oferta, pagina e checkout.

## Limites de seguranca

- Definir minimo e maximo de gasto para cada angulo receber verba suficiente, sem desperdicio.
- Ter metrica minima antes de ampliar: CPA, ROAS, compra, checkout qualificado ou outro criterio definido pelo financeiro/CEO.
- Pausar quando o gasto ultrapassar a regra de caixa sem compra.
- Nao escalar sem tracking confiavel e sem leitura por campanha/ad/creative.

## Saida esperada do setor

Quando usar este framework, o media buyer deve entregar:

- Estrutura 3:2:2 ou justificativa para nao usar.
- 3 angulos horizontais.
- 10 variacoes verticais do angulo vencedor ou do melhor candidato.
- Regra de gasto minimo/maximo.
- Criterio de corte.
- Criterio de colheita para controle.
- Plano de escala gradual.
- Pedidos para copy, criativo, CRO e tracking.
- Quando houver controle em CBO: decisao explicita sobre manter/pausar teste antigo, limite de gasto por conjunto e criterio de aumento da campanha.
