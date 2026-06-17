---
id: ops-creative-001
name: static-ad-creative-copy
description: "Cria angulos, hooks e textos para criativos estaticos de ofertas low ticket"
createdAt: 2026-05-21T00:00:00.000Z
createdByAgent: ad-copywriter
usageCount: 0
---

# Static Ad Creative Copy

## Quando usar
Use para gerar copies, headlines e conceitos de criativos estaticos para Meta Ads, TikTok Ads, Reels e posts organicos de venda.

## Objetivo
Criar anuncios que parecem nativos, simples e claros. O criativo precisa parar a pessoa pela identificacao com a dor, nao por design exagerado.

## Referencias reutilizaveis

Leia apenas quando necessario:

- `references/behavioral-blueprint.md`: estados comportamentais, angulos de dor, erro, alivio, perda e prova visual.
- `references/funnel-creative-bridge.md`: alinhamento entre criativo, funil, pagina e checkout.
- `references/no-brain-stack-creatives.md`: como mostrar stack, bonus, preco, order bump e upsell sem poluir o criativo.
- `../media-buying/meta-322-andromeda-iteration.md`: quando a campanha precisar de matriz 3:2:2, hiperpersonalizacao e variacoes por avatar.

## Angulos obrigatorios

Gerar pelo menos estes angulos:

1. Dor direta: "Sua planta esta morrendo e voce nao sabe por que?"
2. Erro comum: "O erro que mata mais plantas em apartamento."
3. Diagnostico: "Folha amarela, caule mole ou manchas? Comece por aqui."
4. Medo de perda: "Antes de jogar sua planta fora, faca este teste."
5. Solucao visual: "Use o Mapa SOS para descobrir o problema em minutos."
6. Checklist: "Pode ou nao pode usar isso na sua planta?"
7. Prova/demonstracao: mostrar antes/depois, tela, checklist ou pagina do produto.

Para campanhas em modo 3:2:2, a copy deve entregar:

- 3 conceitos criativos realmente diferentes.
- 2 textos principais que mudam o angulo, nao apenas palavras.
- 2 titulos com propostas distintas.
- Um plano de 10 variacoes verticais se um angulo vencer.

Antes de gerar, classifique cada angulo em um estado comportamental:

- reconhecimento
- erro invisivel
- alivio imediato
- perda evitavel
- prova visual

## Saida obrigatoria

```json
{
  "ideaId": "",
  "creativeAngles": [
    {
      "angle": "",
      "hook": "",
      "primaryText": "",
      "headline": "",
      "visualBrief": "",
      "imageText": "",
      "cta": "",
      "objectionHandled": "",
      "landingPageMatch": ""
    }
  ]
}
```

## Regras visuais

- Priorizar imagem real, print, checklist, comparativo, mao segurando material ou cena cotidiana.
- Evitar visual corporativo, banco de imagem e excesso de efeitos.
- Deixar espaco para texto curto no criativo.
- Texto do criativo deve ter 3 a 9 palavras quando possivel.

## Regras de copy

- Uma ideia por criativo.
- Gancho antes da explicacao.
- Falar como o publico fala.
- CTA simples: "Ver o kit", "Diagnosticar agora", "Salvar minha planta".
- Evitar claims absolutos como "garantido", "cura", "nunca mais".
- Nao criar expectativa de atendimento manual ou WhatsApp.
- Se a oferta tiver pagina direta, o criativo deve preparar a headline da pagina.
