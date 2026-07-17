# Exportar Fila CHECK_ANALISTA em PDF (fallback offline)

## Contexto e motivação

Os analistas de PLD dependem do Pepito (via VPN) para ver a fila CHECK_ANALISTA e a
Sugestão de parecer IA de cada caso. Se a VPN ou a aplicação ficarem fora do ar, eles
perdem acesso a esses pareceres já gerados. Este recurso permite exportar, de forma
preventiva (enquanto tudo está no ar), um PDF com as informações do caso e a Sugestão
IA de parecer, para consulta offline.

## Escopo

- Botão "Exportar PDF (fallback)" na página `CheckAnalista.tsx` (fila CHECK_ANALISTA).
- Exporta os casos **já filtrados na tela** (`filtrados`), respeitando os filtros de
  status, decisão IA e busca aplicados no momento do clique.
- Fora de escopo: fila CHECK_LIDERANCA (não pedida), exportação de links/resultados de
  pesquisa individuais, exportação em ZIP/arquivo por caso, geração no servidor.

## Abordagem técnica

Impressão nativa do navegador (`window.print()`) com uma view de impressão dedicada,
em vez de biblioteca de geração de PDF (jsPDF). Motivo: reaproveita HTML/CSS existente,
zero dependência nova, melhor fidelidade tipográfica. Custo: um clique extra do
analista ("Salvar como PDF" no diálogo de impressão do navegador), aceito como
trade-off.

## Componentes

### `src/components/ExportarFilaPrintView.tsx` (novo)

Componente presentacional puro (sem hooks de interação, sem botões), recebe
`casos: RegistrationCase[]` e `filtrosAplicados: { status, decisao, busca }`. Renderiza:

1. **Página de rosto**: título, data/hora da exportação (`new Date().toLocaleString("pt-BR")`),
   quantidade de casos, resumo dos filtros aplicados.
2. **Uma seção por caso**, com quebra de página entre casos (`break-after: page` via CSS),
   contendo:
   - Cabeçalho: `rf_nome_oficial`, CNPJ, `draft_id`, badges de `status`/`sub_status`/`person_type`.
   - Bloco PEP: `full_name_pf`, CPF, cargo/órgão (via `inferCargoOrgao`), tipo PEP
     (via `inferTipoPep` + `vinculoLabel` quando "relacionado").
   - Dados PJ: CNAE, `data_constituicao`, `porte`, `faturamento_presumido`, `endereco_comercial`.
   - Score PLD (`score_pld`) + nível/probabilidade do risk score (via `getPldRiskScore`,
     omitido se não houver score calculado).
   - **Sugestão de parecer IA**: `getSugestaoParecer(caso.draft_id) ?? caso.parecer_sugerido`,
     texto completo (sem `line-clamp`).
   - Histórico de comentários: lista simples (data, autor, texto) a partir de
     `caso.historico_comentarios`, sem componente interativo (`HistoricoComentarios` é
     collapsível — não serve para impressão estática).

Este componente é montado sempre (não só ao clicar exportar) dentro de um wrapper
`<div className="hidden print:block">`, para garantir que o conteúdo já exista no DOM
no momento do `window.print()` (impressão não espera re-render assíncrono).

### Alterações em `CheckAnalista.tsx`

- Importa `ExportarFilaPrintView` e o renderiza fora da área visível normal, passando
  `filtrados` e os filtros atuais.
- Adiciona botão "Exportar PDF (fallback)" ao lado do `QueueRefreshHeader`, com
  `onClick={() => window.print()}`.

### CSS de impressão

Adicionado a `src/index.css` (ou arquivo de estilos global equivalente), um bloco
`@media print` que:
- Esconde todo o layout normal da aplicação (sidebar, filtros, cards interativos,
  cabeçalhos de página) — só o conteúdo dentro de `.print-only` fica visível.
- Define `break-after: page` nas seções de caso (exceto a última).
- Ajusta tipografia para impressão (fonte menor, preto e branco friendly — sem depender
  de cores para transmitir informação crítica, já que impressoras P&B são comuns).

## Testes / verificação manual

Como é um fluxo puramente client-side sem lib de terceiros, a verificação é manual:
1. Abrir CHECK_ANALISTA com casos carregados.
2. Aplicar um filtro (ex. decisão IA = "reprovado") e clicar em "Exportar PDF (fallback)".
3. Confirmar no preview de impressão que:
   - Só os casos filtrados aparecem.
   - Cada caso está em página própria.
   - A Sugestão de parecer IA aparece por completo, sem corte.
   - O resto da aplicação (sidebar, botões) não aparece no preview.
4. Salvar como PDF e abrir o arquivo gerado para conferir legibilidade.

## Riscos conhecidos

- Fila CHECK_ANALISTA pode ter dezenas de casos → PDF de dezenas de páginas. Aceitável
  para um documento de fallback, mas vale mencionar ao analista que quanto mais filtrado
  o export, mais enxuto o PDF.
- `window.print()` depende do navegador ter uma impressora "Salvar como PDF" instalada
  (padrão em Chrome/Edge/Firefox modernos — não é uma restrição real no ambiente Cora).
