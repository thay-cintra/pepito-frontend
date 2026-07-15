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
| **Proteção de dados** | **Integrity Guard** — backup automático 2x por dia |
| **Monitoramento** | **Supervisor Agent** — 7 verificações 2x por dia + Slack |
| **Alertas** | **Slack Webhook** — Alertas por nível de risco (🔴🟠🟡🔵) |

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

.tools/
  supervisor-agent.py          — Monitoramento (7 verificações)
  integrity-guard.py           — Proteção de pareceres (backup + auto-restore)
  full-guard-schedule.sh       — Orquestrador (Integrity + Supervisor)
  supervisor-schedule.sh       — Scheduler do Supervisor
  recover-sugestoes-lideranca.py — Recovery de pareceres perdidos
  
  backups/pareceres/           — Backups automáticos (2x por dia)
    ├── pareceres-sugestao.json.*.backup
    ├── pareceres-real.json.*.backup
    ├── pareceres-lideranca.json.*.backup
    ├── analises-salvas.json.*.backup
    └── manifest.json
  
  Documentação:
    SUPERVISOR.md              — Referência técnica completa
    SUPERVISOR-SETUP.md        — Setup rápido (5 minutos)
    SLACK-CONFIG.md            — Configuração Slack passo-a-passo
    SLACK-ALERTAS-SETUP.md     — Status de alertas
    ADD-CRON.md                — Como adicionar ao crontab
    INCIDENT-REPORT.md         — Histórico de incidentes
    DEPLOYMENT-SUMMARY.md      — Resumo do deployment
    CRON-SETUP.sh              — Script para setup de cron
```

---

## Ferramentas & Scripts de Proteção

### Supervisor Agent (`.tools/supervisor-agent.py`)

Monitora **7 componentes críticos** da aplicação, 2x por dia (6h e 14h).

| Verificação | Descrição | Status |
|---|---|---|
| Servidor Node | Porta 4173 respondendo | 🔴 CRÍTICO |
| Fila PLD | /api/queue com dados | 🔴 CRÍTICO |
| Build dist/ | index.html presente | 🔴 CRÍTICO |
| Pareceres | Integridade JSON | 🟠 ALTO |
| Análises | Arquivo íntegro | 🟠 ALTO |
| Git | Sem mudanças pendentes | 🔵 BAIXO |
| TypeScript | Sem erros de tipo | 🟠 ALTO |

**Alertas:** Enviados ao Slack por nível (🔴🟠🟡🔵)

### Integrity Guard (`.tools/integrity-guard.py`)

Protege contra **exclusão acidental de pareceres**, 2x por dia (6h e 14h).

| Proteção | Como funciona |
|---|---|
| Backup | Cria snapshot de todos os pareceres |
| Detecção | Identifica deletions e encolhimento |
| Auto-restore | Restaura automaticamente de backup |
| Alertas | Notifica Slack se houver violação |
| Histórico | Mantém registro em `.tools/backups/pareceres/` |

**Garantia:** Nenhum parecer é perdido permanentemente.

### Full Guard Schedule (`.tools/full-guard-schedule.sh`)

Orquestra Integrity Guard + Supervisor em uma única execução.

```
Full Guard = Integrity Guard (3-5s) + Supervisor Agent (5-10s)
Total: ~15 segundos por execução
Frequência: 2x por dia (6h e 14h)
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

## Supervisor Agent — Monitoramento automático

O **Supervisor Agent** é um agente inteligente que monitora a saúde da aplicação Pepito diariamente, detectando bugs, erros, melhorias e alertando o time via Slack.

### Verificações automáticas

| Verificação | Descrição | Nível crítico |
|---|---|---|
| **Servidor Node** | /api/health — conectividade Express | 🔴 MUITO ALTO |
| **Fila PLD** | /api/queue — dados válidos e não vazio | 🔴 MUITO ALTO |
| **Build dist/** | Arquivo index.html presente e recente | 🔴 MUITO ALTO |
| **analises-salvas.json** | Integridade do arquivo + tamanho | 🟠 ALTO |
| **registration-queue-real.json** | Integridade da fila (Athena snapshot) | 🟠 ALTO |
| **Git status** | Mudanças não commitadas | 🔵 BAIXO |
| **TypeScript** | npm typecheck (opcional) | 🟠 ALTO |

### Níveis de alerta

- **🔴 MUITO ALTO:** Aplicação down, dados corrompidos, perda crítica
- **🟠 ALTO:** Funcionalidade quebrada, erro em fluxo crítico
- **🟡 MÉDIO:** Bug menor, performance degradada, dados inconsistentes
- **🔵 BAIXO:** Sugestão de melhoria, warning, otimização

### Executar manualmente

```bash
# Via API (requer autenticação)
curl -X POST https://192-168-201-67.sslip.io:4173/api/supervisor/run \
  -H "Authorization: Bearer <token>"

# Via CLI direto
python3 .tools/supervisor-agent.py
```

### Agendar execução diária (cron)

```bash
# Adicionar ao crontab (executa 6h da manhã todos os dias)
0 6 * * * cd /Users/thay/Projetos\ Thay/pepito-frontend && ./.tools/supervisor-schedule.sh

# Ver próximas execuções agendadas
crontab -l
```

### Integrar com Slack

1. **Criar webhook no Slack:**
   - Ir para: https://api.slack.com/apps
   - Create New App → From Scratch
   - Incoming Webhooks → Add New Webhook to Workspace
   - Copiar URL do webhook

2. **Adicionar ao `.env` (raiz do monorepo, variável DEDICADA):**
   ```bash
   SLACK_WEBHOOK_URL_PEPITO_SUPERVISOR=https://hooks.slack.com/services/T.../B.../...
   ```
   Não usar `SLACK_WEBHOOK_URL` genérica — essa chave é compartilhada com outros
   projetos no `.env` raiz e aponta para o último bloco parseado no arquivo
   (hoje, o canal do Giro PCC/CV). Ver [SUPERVISOR.md](.tools/SUPERVISOR.md#integração-slack).

3. **Receber alertas:**
   - Supervisor envia blocos formatados para canal
   - Alertas agrupados por nível de risco
   - Timestamp e componente identificado

### Último relatório

O resultado da última execução é salvo em `.tools/supervisor-last-report.json`:

```json
{
  "timestamp": "2026-07-01T10:35:53.122995",
  "checks_executados": 6,
  "checks_falhados": 0,
  "alertas": [
    {
      "nivel": "🔵 BAIXO",
      "titulo": "Mudanças não commitadas",
      "descricao": "2 arquivo(s) modificado(s) sem commit.",
      "componente": "Git Repository",
      "timestamp": "2026-07-01T10:35:53.122995"
    }
  ]
}
```

### API Endpoints

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/api/supervisor/status` | Status atual + último relatório |
| POST | `/api/supervisor/run` | Dispara supervisor manualmente |

---

## Full Guard — Proteção + Monitoramento

O **Full Guard** combina dois sistemas de proteção que executam automaticamente **2x por dia** (6h e 14h) para garantir integridade e disponibilidade da aplicação.

```
Full Guard Schedule
├─ 1. Integrity Guard (3-5s)        — Proteção de dados
│   ├─ Backup automático de pareceres
│   ├─ Detecção de deletions
│   ├─ Auto-restauração
│   └─ Alertas Slack
│
└─ 2. Supervisor Agent (5-10s)      — Monitoramento de saúde
    ├─ 7 verificações críticas
    ├─ Alertas por nível de risco
    └─ Logs estruturados
```

### Integrity Guard — Proteção de Pareceres

**Arquivo:** `.tools/integrity-guard.py`

**Responsabilidade:** Garantir que pareceres nunca sejam perdidos.

**Proteções:**
- ✅ Backup automático 2x por dia (6h e 14h)
- ✅ Detecção de deletions acidentais
- ✅ Detecção de encolhimento > 50%
- ✅ Auto-restauração de backups
- ✅ Alertas Slack imediatos
- ✅ Histórico completo em `.tools/backups/pareceres/`

**Arquivos protegidos:**
| Arquivo | Descrição | Criticidade |
|---------|-----------|-------------|
| `pareceres-sugestao.json` | Sugestões IA do parecer analista | 🔴 CRÍTICO |
| `pareceres-real.json` | Parecer real do analista | 🔴 CRÍTICO |
| `pareceres-lideranca.json` | Decisão da liderança | 🔴 CRÍTICO |
| `analises-salvas.json` | Análises salvas (backup) | 🔴 CRÍTICO |

**Execução:**
```bash
# Via cron (automático 2x por dia)
0 6 * * * full-guard-schedule.sh
0 14 * * * full-guard-schedule.sh

# Manualmente (teste)
python3 .tools/integrity-guard.py
```

**Alertas Slack:**
```
⚠️ Integrity Guard Alert
🔴 DELETADOS: pareceres-sugestao.json
[Auto-restaurado do backup]
```

**Logs:**
```bash
# Ver execuções
tail -f /Users/thay/Projetos Thay/pepito-frontend/.tools/full-guard.log

# Verificar integridade
cat /Users/thay/Projetos Thay/pepito-frontend/.tools/integrity.log
```

### Agendamento automático (Cron)

```bash
# Full Guard executa 2x por dia
CRON_TZ=America/Sao_Paulo
0 6 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh
0 14 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh
```

**Horários:**
- 🕐 **06:00** — Verificação matinal
- 🕮 **14:00** — Verificação à tarde

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

---

## Verificar Status do Full Guard

### Logs em tempo real
```bash
# Ver execuções do Full Guard
tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log

# Ver histórico de integridade
tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/integrity.log

# Ver relatórios do Supervisor
tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log
```

### Backups de pareceres
```bash
# Listar backups
ls -lh /Users/thay/Projetos\ Thay/pepito-frontend/.tools/backups/pareceres/

# Ver manifest de integridade
cat /Users/thay/Projetos\ Thay/pepito-frontend/.tools/backups/pareceres/manifest.json
```

### Testar manualmente
```bash
# Executar Full Guard agora (sem esperar cron)
cd /Users/thay/Projetos\ Thay/pepito-frontend
NODE_ENV=development bash .tools/full-guard-schedule.sh
```

### Crontab
```bash
# Confirmar agendamento
crontab -l | grep "Full Guard" -A 2

# Próximas execuções
crontab -l | grep "^0 [0-9]"
```

---

## Garantias de Operação

| Garantia | Como é feita | Verificação |
|----------|-------------|-------------|
| **Pareceres nunca são perdidos** | Backup automático 2x por dia + auto-restore | Ver `.tools/backups/pareceres/` |
| **Bugs são detectados automaticamente** | Supervisor verifica 7 componentes 2x por dia | Ver `.tools/supervisor.log` |
| **Alertas chegam em tempo real** | Slack webhook integrado | Verificar canal Slack |
| **Histórico é preservado** | Logs estruturados + manifests | Ver `.tools/integrity.log` |

---

## Troubleshooting

### Nenhum alerta no Slack?
1. Verificar webhook em `.env`: `grep SLACK_WEBHOOK /Users/thay/Projetos\ Thay/.env`
2. Verificar crontab: `crontab -l | grep "Full Guard"`
3. Testar manualmente: `bash full-guard-schedule.sh`
4. Ver logs: `tail -20 full-guard.log`

### Parecer foi deletado?
1. Integrity Guard detecta automaticamente
2. Auto-restaura do backup mais recente
3. Alerta enviado ao Slack
4. Consultar histórico: `cat .tools/integrity.log`

### Cron não está rodando?
1. Confirmar agendamento: `crontab -l`
2. Verificar logs: `tail -50 full-guard.log`
3. Re-agendar se necessário: `.tools/ADD-CRON.md`

---

**Última atualização:** 2026-07-01  
**Status:** ✅ Production Ready
