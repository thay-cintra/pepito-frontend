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

## Governança

### Processo de aprovação em duas camadas

O Pepito implementa o fluxo regulamentado pela Circular BCB nº 4.001/2020:

1. **CHECK_ANALISTA (1ª Camada)** — Análise técnica obrigatória
   - **Responsabilidade:** 3 analistas de Compliance
   - **Atribuição:** automática via snapshot da fila Retool (`bucket = CHECK_ANALISTA`)
   - **Entrega:** parecer técnico + status sugerido + resultados de pesquisa
   - **SLA:** não regulado; prioridade por score PLD e data

2. **CHECK_LIDERANÇA (2ª Camada)** — Decisão final da Mesa
   - **Responsabilidade:** Liderança de Compliance (responsável final)
   - **Entrada:** apenas casos derivados via Pepito (`camadaStatus = aguardando_segunda`) + escalações manuais no Retool (`ENVIAR_LIDERANCA_PLD`)
   - **Saída:** decisão em uma de 4 categorias regulamentares:
     - **CADASTRO APROVADO** — prosseguimento normal
     - **CADASTRO REPROVADO** — cliente rejeitado
     - **CADASTRO APROVADO SOB MONITORAMENTO REFORÇADO** — aprovação condicionada
     - **FALSO POSITIVO — CADASTRO APROVADO** — score PLD cancelado
   - **Rastreabilidade:** comentários e decisões persistidos em `webhook_historico` (Retool) e `historicoComentarios` (Pepito)

### Fonte de verdade para buckets

| Fonte | Precedência | Quando usar |
|---|---|---|
| `webhook_historico` (Retool) | 1ª | Ação `ENVIAR_LIDERANCA_PLD` = escalação confirmada pela mesa |
| Status Athena (`DOUBLE_CHECK`) | 2ª | Fallback: casos em revisão dupla |
| Derivação Pepito (`derivadosPepito`) | 3ª | Casos trabalhados localmente que sobem automaticamente |
| `registration-queue-real.json` | Última | Default = `CHECK_ANALISTA` |

**Regra crítica:** Nunca promover para CHECK_LIDERANCA via estado local (`Analise.camadaStatus`). Apenas via webhook do Retool ou status DOUBLE_CHECK do Athena.

### Auditoria e trilha de mudanças

- **Cronômetro por camada:** `duracaoPrimeiraCamada` (analista) e `duracaoSegundos` (liderança) registram esforço real
- **Email do analista:** salvo em cada análise para rastreabilidade da 1ª camada
- **Histórico de comentários:** todos os pareceres, observações e mudanças persistem em `historicoComentarios`
- **Exclusões:** registradas em `pepito.exclusoes` com motivo, data e responsável
- **Git audit:** `analises-salvas.json` sincronizado com GitHub via auto-push (commit atribuído a `req.user.email`)

---

## Guardrails

### Validações obrigatórias

#### 1. Filtros de elegibilidade da fila PLD

Antes de incluir um caso na fila, `passesPLDFilters()` valida:

```typescript
if (!VALID_STATUS.includes(c.status)) return false;              // IN_ANALYSIS ou DOUBLE_CHECK
if (c.sub_status !== "PLD_SCORE") return false;                 // Fila viva (não preliminar)
if (c.person_type !== "OWNER") return false;                    // Apenas proprietários
```

**Impacto:** Casos que não atendem critérios regulamentares nunca entram na fila Pepito.

#### 2. Deduplicação por draft_id

Múltiplas análises do mesmo draft são consolidadas por `latestByDraftId()`:

- Apenas a análise mais recente (`updatedAt` ou `createdAt`) é considerada
- Estados antigos (ex: `aguardando_segunda` desatualizado) não afetam a fila
- **Benefício:** evita cases duplicados na UI

#### 3. Status de conclusão auto-exclusão

Casos com `camadaStatus` em estado terminal são removidos da fila ativa:

```typescript
if (a.camadaStatus === "concluido") result.add(draftId);                  // Excluir conclusões
if (bucket === "CHECK_LIDERANCA" && a.camadaStatus === "devolvido") ...  // Devolvidos voltam a ANALISTA
```

**Proteção:** impossível revisar um caso já decidido ou editá-lo após conclusão.

#### 4. Persistência com fallback

Dados de análise persistem em **dois níveis**:

1. **localStorage** (sessão ativa do browser)
2. **src/data/analises-salvas.json** (backup em disco, sincronizado com GitHub)

Na recarga da página, o app restaura:
```
localStorage vazio? → lê analises-salvas.json do servidor → restaura estado anterior
```

**Proteção:** perda de conexão não resulta em perda de dados.

#### 5. Atribuição de analista obrigatória

Antes de enviar para CHECK_LIDERANCA, o sistema valida:

```typescript
analistaEmail = extrairEmailAnalista(case) || analistaEmail_fallback
```

**Proteção:** toda análise tem proprietário rastreável.

#### 6. Credilink + PEP validation

Queries ao Credilink + conferência manual:

- Se Credilink retorna vazio em `token_pf_cred` → sinaliza falso positivo
- PEP insuficiente (Professor, Administrador, "apenas relacionado") → marcar como FP
- **Proteção:** evitar reprovações indevidas por dados incompletos

### Limites operacionais

| Limite | Valor | Razão |
|---|---|---|
| Análises simultâneas por analista | 1 | evitar divisão de atenção; só 1 caso aberto por sessão |
| Histórico de comentários | 50+ linhas | documentar toda deliberação; não há limite de tamanho |
| Tempo máximo de análise (1ª camada) | Não regulado | cronômetro é informativo, não impõe deadline |
| Cache de queue em memória | ~5 minutos | refresh automático via `QUEUE_UPDATED_EVENT` ao mudar dados |
| Tamanho máximo do bundle | 640 kB gzip | com staticGzip no server.cjs; acima = timeout 30s para analistas |

### Proteções contra erros comuns

#### Problema: Draft aparece/desaparece da fila

**Guardrail:** Endpoint `/api/queue/debug/:draftId` para diagnosticar.

Causas e mitigações:
- Status `devolvido` em localStorage → remover entrada
- Status `concluido` → mudar para `aguardando_segunda`
- Bucket mismatch → verificar webhook Retool para `ENVIAR_LIDERANCA_PLD`

#### Problema: Sugestão IA contradiz parecer do analista

**Guardrail:** Mesa lê **sempre** o comentário do analista (`ENVIAR_LIDERANCA_PLD`), nunca apenas o `status` sugerido.

Validação em código:
```typescript
// Fonte primária: webhook_historico com ação real ENVIAR_LIDERANCA_PLD
const envio = webhook.find(h => h.acao === "ENVIAR_LIDERANCA_PLD" && h.text?.trim());
return envio?.text || parecer_sugerido;  // Comentário real > sugestão IA
```

#### Problema: Falsos positivos por nome fuzzy

**Guardrail:** Match por CNPJ/CPF apenas (exato), **nunca** fuzzy por nome.

Exemplo bloqueado:
- "João Silva LTDA" ≠ "João Silvério LTDA" (mesmo que 95% similar)
- Requer CNPJ ou CPF idêntico

#### Problema: Processo civil/trabalhista com badge alto

**Guardrail:** Classificação de natureza antes de rodar analytics.

Badge alto (crítico) reservado para:
- Criminal (AML, fraude, tráfico)
- Penal (estelionato, falsidade)
- Eleitoral (crime + crime)

Civil/TRT → badge baixo

#### Problema: PEP com mandato expirado marcado como "ex"

**Guardrail:** Data fim do mandato comparada com data atual (via `data_fim` e `data_fim_carencia`).

Ainda "ativo" se:
- `data_fim_carencia` > hoje (carência de 3-5 anos pós-mandato)
- OU `data_fim` > hoje (mandato ainda em exercício)

### Cascata de validação (checklist)

Antes de enviar para CHECK_LIDERANCA:

1. ✓ Draft passa em `passesPLDFilters` (status, sub_status, person_type)
2. ✓ `analistaEmail` preenchido (rastreabilidade)
3. ✓ Parecer técnico não vazio (mínimo 30 caracteres)
4. ✓ Status sugerido é um de: APROVADO, REPROVADO, MONITORAMENTO, FP
5. ✓ Sem conflito de interesses (PEP não pode ser analista do próprio caso)
6. ✓ Credilink consultado (token_pf_cred, token_pj_cred preenchidos ou ausência justificada)
7. ✓ Tempo de 1ª camada registrado (`duracaoPrimeiraCamada > 0`)

**Resultado:** impossível enviar análise incompleta.
