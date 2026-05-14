# Pepito Frontend (Protótipo)

Protótipo funcional do **Pepito** — plataforma de análise KYC/PLD/FTP especializada em
Pessoas Expostas Politicamente (PEPs) — implementado a partir do spec
`pepito_prompt_consolidado.md`.

> **Modo demo**: o backend (Supabase, Edge Functions, Lovable AI Gateway, n8n,
> BrasilAPI) é simulado com **mocks determinísticos** e os dados ficam em
> `localStorage`. A UI e o fluxo de trabalho são reais.

## Pré-requisitos

- **Node.js 18+** (recomendado 20). Esta máquina não tem node instalado;
  você pode instalar via:
  - macOS com Homebrew: `brew install node`
  - via nvm: `nvm install 20 && nvm use 20`
  - direto: <https://nodejs.org>

## Como rodar

```bash
cd "pepito-frontend"
npm install
npm run dev      # http://localhost:5173
npm run build    # produção em ./dist
npm run preview  # serve a build em http://localhost:4173
```

## Fluxo demonstrável

1. **Dashboard** — abre com 3 análises de exemplo já cadastradas (1 reprovada,
   1 sob monitoramento, 1 aguardando 2ª camada).
2. **1ª Camada** — preencha o cadastro, clique em **Pesquisar Fontes Públicas**
   (mock-AI gera 6-7 apontamentos em ~1.4s), redija o parecer técnico,
   selecione o status sugerido e envie à Mesa de Decisão.
3. **Fila de Revisão** — lista os cadastros com `camadaStatus = aguardando_segunda`
   e oferece os mesmos controles da 2ª camada.
4. **2ª Camada (Mesa)** — Liderança revisa, repesquisa, gera **análise
   consolidada** (mock simulando `consolidar-parecer-lideranca`) e o template
   de **parecer final** em Markdown nas 4 categorias obrigatórias:
   - CADASTRO APROVADO
   - CADASTRO REPROVADO
   - CADASTRO APROVADO SOB MONITORAMENTO REFORÇADO
   - FALSO POSITIVO — CADASTRO APROVADO

## Mocks (substituem as Edge Functions)

| Função no spec | Mock local |
|---|---|
| `kyc-due-diligence` | `pesquisarFontesPublicas` (`src/lib/mock-ai.ts`) |
| `gerar-parecer-primeira-camada` | mesmo `pesquisarFontesPublicas` + `parecer.ts` |
| `consolidar-parecer-lideranca` | `consolidarParecerLideranca` |
| `reanalisar-resultado` | `reanalisarResultado` |
| `ocr-extract` | indisponível em demo (modal explicativo no botão OCR) |

A base PEP unificada (Nov/Dez 2025 + Jan 2026) é representada por
`src/lib/pep-data.ts` com 10 nomes de exemplo. O match é **exato** (sem
similaridade) conforme regra de negócio. Para experimentar, use no campo
"Nome do PEP" um destes:

- Carlos Henrique Almeida
- Mariana Souza Lima
- Roberto Pereira da Silva
- Ana Beatriz Cardoso
- Eduardo Martins Ribeiro

## Regras de negócio implementadas

- 4 categorias obrigatórias de decisão.
- Cronômetro independente para 1ª e 2ª camadas (`duracaoPrimeiraCamada`,
  `duracaoSegundos`).
- Cruzamento de fatores: Data de Abertura ⇄ Mandato, CNAE ⇄ Cargo,
  Endereço ⇄ UF do PEP — refletido na `analiseGeral` do mock.
- Reanálise individual com prioridade ao input do analista (heurística:
  "homônimo/descart" descarta, "alto/grave" sobe risco, "baixo" baixa).
- Anti-homônimo via match exato + flag `pendente_verificacao` quando o nome
  PEP não bate na base local.
- Audit trail de exclusões (`pepito.exclusoes` no localStorage).

## O que NÃO está implementado (vs. spec completo)

- Autenticação/RLS (sem Supabase, tudo é local).
- OCR via Gemini Vision (botão exibe modal demo).
- Chamadas reais a BrasilAPI/ReceitaWS/Lovable AI/n8n.
- Combobox dinâmico de CNAE via API IBGE — campo é texto livre.
- Exportação PDF — substituída por CSV + parecer .txt (libs leves).

Para ativar o backend completo, é necessário provisionar Lovable Cloud
(Supabase + secrets) conforme as Seções 4, 9 e 10 de
`pepito_prompt_consolidado.md`.
