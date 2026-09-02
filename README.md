# LAN4 — Preview do teste A/B do formulário

Preview para validação **antes** de mexer no código de produção (`lan4.com.br`).
Nada aqui envia lead real: o modo `LAN4_PREVIEW` (detecta hostname ≠ `lan4.com.br`)
desliga GTM, simula o POST ao RD e marca as páginas como `noindex`.

## O que está sendo testado

O formulário do site regrediu em 17/08/2026: a 1ª etapa virou um paredão de 7 campos
obrigatórios. Conclusão caiu para ~4% (home) e ~1–2% (LPs). Este teste A/B compara:

| | Variante A | Variante B |
|---|---|---|
| **Estrutura** | qualificação + contato numa etapa (como hoje) + serviço na 2ª | 3 micro-etapas: qualificação → contato → serviço |
| **Avanço** | "Continuar" manual entre as 2 etapas | autoavanço nas etapas 1 e 2 |
| **UX (igual nas duas)** | radio-cards em faturamento/cargo, validação de typo de e-mail, microcopy revisada, `enterkeyhint`, 1 campo/linha no mobile | idem |

A **única** variável testada é a estrutura de etapas. As melhorias de UX entram nas duas
variantes de propósito, para não confundir "estrutura" com "UX nova".

## Como navegar

- **`?fv=A`** ou **`?fv=B`** na URL força a variante (não grava cookie) — para inspecionar as duas.
- Sem parâmetro: sorteio determinístico 50/50 por visitante (hash do `lan4_vid`, cookie 90d).
- Um seletor **A | B** aparece no canto inferior esquerdo (só no preview).

## Páginas incluídas

| Página | Caminho | Observação |
|---|---|---|
| Home | `/` | referência |
| Engine | `/engine/` | na B ganha lead parcial (precisa 1 trigger novo no GTM — ver comentário no HTML) |
| LP Marketing Digital | `/s/marketing-digital/` | representa as 7 LPs de serviço (lógica idêntica) |

Quando aprovado, a mesma estrutura vai para as outras 6 LPs de serviço
(`vendas-e-crm`, `midia-paga`, `gestao-de-redes-sociais`, `recrutamento-e-selecao`,
`eventos-corporativos`, `audiovisual`). `/s/diagnostico/` e `/s/vsl/` ficam de fora
(tratadas em rodada própria pelo landing-page-optimizer + ga4-insights-squad).

## Arquivos do mecanismo (novos, não existem em produção)

- **`form-ab.js`** — sorteio da variante, `form_variant` no dataLayer, poda do DOM da
  variante não sorteada antes do `main.js`, validação de typo de e-mail.
- **`form-ab.css`** — componentes de radio-card (que só existiam no `<style>` inline das LPs)
  + ajustes mobile.
- **`main.js`** — 2 alterações mínimas:
  1. `lan4SetupSubstepTracking` procura faturamento/cargo na etapa `qualificacao` (B) ou `contato` (A).
  2. o disparo do `lead_partial_submit` respeita um flag `[data-no-partial]` (não usado aqui,
     mas disponível para casos futuros).

## Amarração de tracking

Documentada em `cerebro/clientes/lan4/cro-site/ga4/R2-tracking-amarracao.md` (comprovada via
MCP RD Marketing/CRM). Resumo: a etapa que junta nome+email+telefone se chama
`data-step-name="contato"` nas duas variantes → o `lead_partial_submit` dispara no mesmo
momento lógico, com o mesmo `identificador`, com o mesmo payload ao RD. Nenhuma mudança de
GTM necessária, exceto: (1) dimensão `form_variant` no GA4, (2) trigger de lead parcial para
o Engine na B.

## Deploy (GitHub Pages)

Settings → Pages → branch `main` → `/ (root)`.
