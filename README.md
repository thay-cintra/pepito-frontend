# Pepito — Plataforma de Análise PLD/KYC

**Pepito** é o frontend interno do time de Compliance/PLD da Cora para análise de cadastros com suspeita de Pessoas Expostas Politicamente (PEPs). Substitui o uso direto do Retool para o fluxo de análise em duas camadas exigido pela Circular BCB nº 4.001/2020.

> **Status:** em uso diário pelo time de Compliance (Liderança + 3 analistas).  
> **Acesso interno:** `https://192-168-201-67.sslip.io:4173` (VPN Cora obrigatória)

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Estilos | Tailwind CSS + shadcn/ui |
| Gráficos | Recharts |
| Servidor | Express (Node.js) — `server.cjs` |
| Autenticação | Google SSO via OAuth2 (apenas `@cora.com.br`) |
| Persistência | `localStorage` + `src/data/analises-salvas.json` (backup em disco) |
| Fonte de dados | Snapshot JSON da fila PLD do Retool/Athena |
| Deploy | Docker + Kubernetes (ArgoCD) — ver `platform/` |

---

## Arquitetura de dados

```
Athena (squad_core.registration_notebook_output_single)
  └─► snapshot JSON (src/data/registration-queue-real.json)
        └─► Pepito lê no boot e mantém em memória
              └─► Analista trabalha → Analise salva em localStorage
                    └─► persistToDisk() → src/data/analises-salvas.json (backup)
```

Não há banco de dados externo. A persistência é `localStorage` (por sessão de browser) com backup fire-and-forget em arquivo local via API Express (`/api/analises`). Ao recarregar a página, o app restaura do JSON em disco caso o localStorage esteja vazio.

---

## Fluxo de trabalho

### 1. CHECK_ANALISTA — 1ª Camada

O analista acessa a fila PLD (`/check-analista`), que exibe cadastros com `bucket = CHECK_ANALISTA` do snapshot Retool. Ao abrir um caso:

- Dados do cadastro são pré-carregados (nome, CNPJ/CPF, CNAE, endereço, QSA, score PLD)
- Resultados de pesquisa já mapeados pelo pipeline KYC (8 fontes: PEP, sanções, mídia, processos, endereço, QSA, CNAE×Cargo, TCE/TJ/MP)
- Sugestão de parecer pré-preenchida (LLM conciso ou heurística)
- Consulta ao Credilink/Tessera para dossier PEP
- Cronômetro inicia no primeiro acesso e persiste via `localStorage` (`pepito.timer.<key>`)
- Analista revisa, edita o parecer, seleciona status sugerido e clica **Enviar à Mesa**
- Email do analista (`analistaEmail`) é salvo na análise para rastreabilidade

### 2. CHECK_LIDERANÇA — 2ª Camada (Mesa de Decisão)

A Liderança acessa a Fila de Revisão (`/fila-revisao`) com os casos `camadaStatus = aguardando_segunda`. Ao abrir:

- Parecer do analista + resultados de pesquisa já disponíveis
- Liderança pode repesquisar, adicionar fontes, gerar análise consolidada
- Decisão final em uma das 4 categorias regulamentares:
  - **CADASTRO APROVADO**
  - **CADASTRO REPROVADO**
  - **CADASTRO APROVADO SOB MONITORAMENTO REFORÇADO**
  - **FALSO POSITIVO — CADASTRO APROVADO**
- `duracaoSegundos` registra o tempo da 2ª camada

### 3. Dashboard

Métricas operacionais do time:

- KPIs: total de análises, concluídas, aguardando Mesa, rascunhos
- Tempo médio de análise (1ª e 2ª camada separados)
- Distribuição por status (pizza) e volume por dia (barras)
- **Análises por analista** — agrupa por `analistaEmail` (casos Pepito) ou por email no `historicoComentarios` com ação `ENVIAR_LIDERANCA_PLD` (casos Retool)
- Tabela completa com filtros de período, status e busca
- Exportação CSV

---

## Buckets da fila PLD

| Bucket | Descrição | Página Pepito |
|---|---|---|
| `CHECK_ANALISTA` | Análise manual pelo time de PLD (1ª camada) | `/check-analista` |
| `CHECK_LIDERANCA` | Revisão e decisão final pela Liderança (2ª camada) | `/fila-revisao` |

A lógica de `listByBucket` em `src/lib/registration-queue.ts` aplica os filtros do Retool: `status ∈ {DOUBLE_CHECK, IN_ANALYSIS}`, `sub_status = PLD_SCORE`, `person_type = OWNER`. Casos já trabalhados no Pepito são removidos da fila original e redirecionados para o bucket correto via `derivadosPepito`.

---

## Rodando localmente (desenvolvimento)

**Pré-requisito:** Node 20+. O projeto inclui um binário portável em `.tools/node/bin/`.

```bash
# Com Node do sistema
npm install
npm run dev          # http://localhost:5173 (sem SSO, sem HTTPS)

# Com o Node portável incluso (sem instalar Node no sistema)
export PATH=".tools/node/bin:$PATH"
npm install
npm run dev
```

O Vite em modo dev não exige `server.cjs`. O SSO Google é ignorado — qualquer e-mail acessa.

---

## Rodando em modo produção (local / VPN)

```bash
# Build + servidor Express com HTTPS
./start-local.sh
```

Isso executa `npm run build` e sobe o `server.cjs` em modo `LOCAL_MODE=true` (sem SSO obrigatório). HTTPS usa os certificados em `certs/`.

Para ativar SSO obrigatório (apenas `@cora.com.br`):

```bash
export PATH=".tools/node/bin:$PATH"
npm run build
node server.cjs      # VITE_SSO_ATIVO=true via .env
```

---

## Deploy (Kubernetes / ArgoCD)

O Dockerfile produz uma imagem com SSO obrigatório (`VITE_SSO_ATIVO=true`):

```bash
docker build -t pepito-frontend .
```

Os manifestos Kubernetes e a configuração ArgoCD estão em `platform/`. Ver `DEPLOY_REQUEST.md` para contexto do provisionamento.

---

## Estrutura de arquivos relevantes

```
src/
  pages/
    CheckAnalista.tsx         — Fila CHECK_ANALISTA (1ª camada)
    AnalisePrimeiraCamada.tsx — Formulário de análise + cronômetro analista
    FilaRevisao.tsx           — Fila de revisão para Liderança
    NovaAnalise.tsx           — Mesa de Decisão (2ª camada)
    Dashboard.tsx             — Métricas e histórico
  lib/
    registration-queue.ts     — Lógica de filas, buckets, synthesizeAnalise
    storage.ts                — localStorage + persistToDisk + timer persistente
    mock-ai.ts                — Pesquisa de fontes públicas (Credilink, PEP, mídia)
    auth.ts                   — Google SSO (/auth/me)
  types/
    kyc.ts                    — Tipos: Analise, ComentarioAnalise, StatusAnalise…
    registration.ts           — RegistrationCase, CheckBucket…
  data/
    registration-queue-real.json — Snapshot da fila PLD do Retool
    analises-salvas.json         — Backup das análises (gerado automaticamente)
    pareceres-llm.json           — Sugestões de parecer por draft_id
server.cjs                    — Express: HTTPS, SSO Google, /api/analises
```

---

## Regras de negócio implementadas

- **Cronômetro por camada:** `duracaoPrimeiraCamada` (1ª) e `duracaoSegundos` (2ª) persistem em `localStorage` e sobrevivem a reload/navegação. Limpos após envio/conclusão.
- **analistaEmail:** salvo em cada `Analise` para rastreabilidade de quem fez a 1ª camada.
- **Buckets derivados:** caso trabalhado no Pepito sai da fila CHECK_ANALISTA e entra em CHECK_LIDERANCA automaticamente (sem depender do Retool atualizar o bucket).
- **Sugestão LLM vs heurística:** parecer pré-preenchido prioriza `pareceres-llm.json` (estilo Josinalva); fallback para heurística de `parecer_sugerido` do pipeline.
- **Cruzamento de fatores:** Data de Abertura ⇄ Mandato, CNAE ⇄ Cargo, Endereço ⇄ UF do PEP refletidos na `analiseGeral`.
- **Anti-homônimo:** match exato por CPF/CNPJ; fuzzy por nome não é usado para evitar falsos positivos operacionais.
- **Audit trail:** exclusões registradas em `pepito.exclusoes` com motivo e data.
- **Fila de Revisão:** exibe apenas `bucket = CHECK_LIDERANCA` do snapshot; nunca promove via `Analise` local para evitar ruído de IA.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `VITE_SSO_ATIVO` | `false` | Se `true`, exige Google SSO `@cora.com.br` |
| `LOCAL_MODE` | `false` | Desativa SSO no servidor Express (modo VPN) |
| `GOOGLE_CLIENT_ID` | — | OAuth2 Client ID (produção) |
| `GOOGLE_CLIENT_SECRET` | — | OAuth2 Client Secret (produção) |
| `SESSION_SECRET` | — | Secret para cookie de sessão |
| `GCS_BUCKET` | — | Bucket GCS para persistência distribuída (opcional) |

Em desenvolvimento Vite (`npm run dev`), nenhuma variável é obrigatória.
