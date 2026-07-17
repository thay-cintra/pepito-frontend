# Exportar Fila CHECK_ANALISTA em PDF (fallback offline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão na página CHECK_ANALISTA que exporta os casos filtrados em tela (dados cadastrais + Sugestão de parecer IA + histórico de comentários) para um PDF, via impressão nativa do navegador, como fallback offline caso VPN/aplicação fiquem fora do ar.

**Architecture:** Um componente presentacional novo (`ExportarFilaPrintView`) renderiza uma view "somente impressão" (escondida na tela, visível só em `@media print`) com uma seção por caso. Um botão em `CheckAnalista.tsx` dispara `window.print()`. Um bloco de CSS global usa o truque clássico de `visibility` para esconder todo o resto da aplicação durante a impressão.

**Tech Stack:** React + TypeScript + Tailwind (já usados no projeto). Sem biblioteca nova. **Este projeto não tem test runner configurado** (sem jest/vitest, sem arquivos `*.test.*`) — a verificação de cada task é: `npm run build` (tsc pega erros de tipo) + inspeção manual via preview de impressão do navegador (usaremos o Chrome DevTools MCP para automatizar essa checagem visual quando disponível).

## Global Constraints

- Não adicionar nenhuma dependência nova ao `package.json` (spec exige abordagem `window.print()`, zero libs).
- Reaproveitar funções de dados já existentes (`inferCargoOrgao`, `inferTipoPep`, `vinculoLabel`, `getSugestaoParecer`, `getPldRiskScore`) — não duplicar lógica de derivação de PEP/CNAE.
- O componente de impressão não deve ter estado nem interatividade (sem `useState`, sem `onClick` interno) — é puramente derivado de props.
- Exportar exatamente os casos já filtrados em tela (`filtrados`), nunca a fila inteira sem filtro.
- Rodar `npm run build` ao final de cada task (o projeto usa `tsc -b && vite build` como build; qualquer erro de tipo quebra isso).

---

## Task 1: CSS de impressão global

**Files:**
- Modify: `src/index.css` (adicionar bloco no final do arquivo)

**Interfaces:**
- Produces: seletor `#pepito-print-root` e classe `.print-page-break`, usados pelo componente da Task 2.

- [ ] **Step 1: Adicionar o bloco `@media print` ao final de `src/index.css`**

```css
/* Impressão: usado por ExportarFilaPrintView para exportar a fila em PDF.
   #pepito-print-root é o único elemento visível quando window.print() é chamado. */
@media print {
  body * {
    visibility: hidden;
  }
  #pepito-print-root,
  #pepito-print-root * {
    visibility: visible;
  }
  #pepito-print-root {
    display: block;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  .print-page-break {
    break-after: page;
  }
  .print-page-break:last-child {
    break-after: auto;
  }
}
```

- [ ] **Step 2: Rodar o build para garantir que o CSS é válido**

Run: `npm run build`
Expected: build termina com `✓ built in Xs`, sem erros de CSS/PostCSS.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: adiciona CSS de impressão para exportação de fila em PDF"
```

---

## Task 2: Componente `ExportarFilaPrintView`

**Files:**
- Create: `src/components/ExportarFilaPrintView.tsx`

**Interfaces:**
- Consumes:
  - `RegistrationCase` de `@/types/registration` (campos: `draft_id`, `cnpj`, `rf_nome_oficial`, `full_name_pf`, `cpf`, `status`, `sub_status`, `person_type`, `cnae`, `data_constituicao`, `porte`, `faturamento_presumido`, `endereco_comercial`, `score_pld`, `historico_comentarios: ComentarioHistorico[]`, `parecer_sugerido`).
  - `inferCargoOrgao(c): { cargo, orgao, nomePEP, cpfTitular, vinculo, ... }` de `@/data/registration-enrich`.
  - `inferTipoPep(c): "titular" | "relacionado"` de `@/data/registration-enrich`.
  - `vinculoLabel(ds): string` de `@/data/registration-enrich`.
  - `getSugestaoParecer(draftId): string | null` de `@/data/registration-enrich`.
  - `getPldRiskScore(draftId): PldRiskScore | null` de `@/data/registration-enrich` (campos usados: `probabilidade`, `nivel`).
  - `StatusAnalise` de `@/types/kyc` (para o rótulo do filtro de decisão).
  - `formatDate(iso): string` de `@/lib/utils`.
- Produces: componente `ExportarFilaPrintView({ casos, filtros })`, consumido pela Task 3. Props:
  ```ts
  interface ExportarFilaPrintViewProps {
    casos: RegistrationCase[];
    filtros: {
      status: string;   // já formatado como label, ex: "todos" ou "DOUBLE_CHECK"
      decisao: string;  // já formatado como label, ex: "Todas" ou "Reprovado"
      busca: string;    // texto da busca, ou "" se vazio
    };
  }
  ```

- [ ] **Step 1: Criar o arquivo `src/components/ExportarFilaPrintView.tsx`**

```tsx
import type { RegistrationCase } from "@/types/registration";
import {
  inferCargoOrgao,
  inferTipoPep,
  vinculoLabel,
  getSugestaoParecer,
  getPldRiskScore,
} from "@/data/registration-enrich";
import { formatDate } from "@/lib/utils";

interface ExportarFilaPrintViewProps {
  casos: RegistrationCase[];
  filtros: {
    status: string;
    decisao: string;
    busca: string;
  };
}

const NIVEL_LABEL: Record<string, string> = {
  critico: "CRÍTICO",
  alto: "ALTO",
  medio: "MÉDIO",
  baixo: "BAIXO",
};

export function ExportarFilaPrintView({ casos, filtros }: ExportarFilaPrintViewProps) {
  return (
    <div id="pepito-print-root" className="hidden">
      {/* Página de rosto */}
      <div className="print-page-break p-8">
        <h1 className="text-2xl font-bold mb-4">
          Fila CHECK_ANALISTA — Export PDF (fallback offline)
        </h1>
        <p className="mb-1">Exportado em: {new Date().toLocaleString("pt-BR")}</p>
        <p className="mb-1">Quantidade de casos: {casos.length}</p>
        <p className="mb-1">Filtro de status: {filtros.status}</p>
        <p className="mb-1">Filtro de Sugestão IA: {filtros.decisao}</p>
        <p className="mb-1">Busca aplicada: {filtros.busca || "(nenhuma)"}</p>
        <p className="mt-4 text-sm">
          Este documento é um fallback offline. As Sugestões de parecer IA aqui
          contidas são rascunhos — a decisão final é sempre do analista.
        </p>
      </div>

      {/* Uma seção por caso */}
      {casos.map((caso, idx) => (
        <CasoPrintSection
          key={caso.draft_id}
          caso={caso}
          isLast={idx === casos.length - 1}
        />
      ))}
    </div>
  );
}

function CasoPrintSection({ caso, isLast }: { caso: RegistrationCase; isLast: boolean }) {
  const cargoOrgao = inferCargoOrgao(caso);
  const tipoPep = inferTipoPep(caso);
  const sugestao = getSugestaoParecer(caso.draft_id) ?? caso.parecer_sugerido;
  const riskScore = getPldRiskScore(caso.draft_id);
  const faturamento = (caso.faturamento_presumido || "").replace(/^"|"$/g, "") || "—";

  return (
    <div className={isLast ? "p-8" : "print-page-break p-8"}>
      <h2 className="text-xl font-bold mb-1">{caso.rf_nome_oficial}</h2>
      <p className="text-sm mb-3">
        CNPJ {caso.cnpj} · draft_id {caso.draft_id} · status {caso.status} ·
        sub_status {caso.sub_status} · person_type {caso.person_type}
      </p>

      <h3 className="font-semibold mt-4 mb-1">Pessoa Politicamente Exposta (PEP)</h3>
      <p className="text-sm">
        {caso.full_name_pf} (CPF {caso.cpf}) — PEP {tipoPep}
        {tipoPep === "relacionado" && cargoOrgao.vinculo
          ? ` · ${vinculoLabel(cargoOrgao.vinculo)} de ${cargoOrgao.nomePEP}`
          : ""}
      </p>
      <p className="text-sm">
        {cargoOrgao.cargo}
        {cargoOrgao.orgao ? ` em ${cargoOrgao.orgao}` : ""}
      </p>

      <h3 className="font-semibold mt-4 mb-1">Dados cadastrais (PJ)</h3>
      <p className="text-sm">CNAE: {caso.cnae}</p>
      <p className="text-sm">Constituição: {caso.data_constituicao}</p>
      <p className="text-sm">Porte: {caso.porte || "—"}</p>
      <p className="text-sm">Faturamento presumido: {faturamento}</p>
      <p className="text-sm">Endereço comercial: {caso.endereco_comercial}</p>

      <h3 className="font-semibold mt-4 mb-1">Score PLD</h3>
      <p className="text-sm">
        Score PLD: {caso.score_pld}
        {riskScore ? ` · Risco LD: ${Math.round(riskScore.probabilidade)}% (${NIVEL_LABEL[riskScore.nivel]})` : ""}
      </p>

      <h3 className="font-semibold mt-4 mb-1">Sugestão de parecer IA (rascunho)</h3>
      <p className="text-sm whitespace-pre-wrap">{sugestao || "(sem sugestão gerada)"}</p>

      <h3 className="font-semibold mt-4 mb-1">Histórico de comentários</h3>
      {caso.historico_comentarios.length === 0 ? (
        <p className="text-sm italic">Sem comentários registrados.</p>
      ) : (
        caso.historico_comentarios.map((h, i) => (
          <p key={i} className="text-sm mb-1">
            <span className="font-medium">{formatDate(h.timestamp)}</span> — {h.user_email}: {h.text}
          </p>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rodar o build para checar tipos**

Run: `npm run build`
Expected: build termina sem erros de tipo (`tsc -b` passa, `vite build` completa).

- [ ] **Step 3: Commit**

```bash
git add src/components/ExportarFilaPrintView.tsx
git commit -m "feat: adiciona ExportarFilaPrintView para exportação da fila em PDF"
```

---

## Task 3: Botão de exportação em `CheckAnalista.tsx`

**Files:**
- Modify: `src/pages/CheckAnalista.tsx`

**Interfaces:**
- Consumes: `ExportarFilaPrintView` (Task 2), `filtrados` (já existe no componente, `useMemo` em `src/pages/CheckAnalista.tsx:66-76`), `statusFiltro`, `decisaoFiltro`, `busca` (já existem como state), `DECISAO_LABEL` (já existe em `src/pages/CheckAnalista.tsx:33-38`).

- [ ] **Step 1: Adicionar os imports do novo componente, do ícone e do `Button`**

`src/pages/CheckAnalista.tsx` ainda não importa `Button` (confirmado: só importa `Card`, `CardContent`, `Input`, `Label`, `Select`, `Badge` de `@/components/ui`). No topo do arquivo, aplicar estas duas substituições:

Linha 3, de:
```tsx
import { Users, Filter, Search, Sparkles } from "lucide-react";
```
para:
```tsx
import { Users, Filter, Search, Sparkles, Printer } from "lucide-react";
```

Logo após a linha `import { QueueRefreshHeader } from "@/components/QueueRefreshHeader";` (linha 4), adicionar duas novas linhas:
```tsx
import { Button } from "@/components/ui/button";
import { ExportarFilaPrintView } from "@/components/ExportarFilaPrintView";
```

- [ ] **Step 2: Adicionar o botão de exportação ao lado do `QueueRefreshHeader`**

Localizar (linhas 116-117):

```tsx
        <QueueRefreshHeader onRefresh={() => setRefreshKey((k) => k + 1)} />
      </div>
```

Substituir por:

```tsx
        <div className="flex items-center gap-2">
          <QueueRefreshHeader onRefresh={() => setRefreshKey((k) => k + 1)} />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => window.print()}
            title="Gera um PDF com os casos filtrados na tela, para consulta offline caso a VPN/aplicação fique fora do ar"
          >
            <Printer className="h-3 w-3" /> Exportar PDF (fallback)
          </Button>
        </div>
      </div>
```

(`Button` já foi importado no Step 1 desta task.)

- [ ] **Step 3: Renderizar `ExportarFilaPrintView` com os casos filtrados**

Localizar o fechamento do componente, antes do `</div>` final do `return (...)` de `CheckAnalista`, e adicionar a renderização do print view (fora da árvore visível normal, mas dentro do JSX retornado):

```tsx
      <ExportarFilaPrintView
        casos={filtrados}
        filtros={{
          status: statusFiltro,
          decisao: DECISAO_LABEL[decisaoFiltro],
          busca,
        }}
      />
    </div>
  );
}
```

(O `</div>` final e `);`/`}` já existem no arquivo — o objetivo é inserir `<ExportarFilaPrintView ... />` logo antes do `</div>` de fechamento do container raiz `<div className="p-6 space-y-6 max-w-[1400px]">`.)

- [ ] **Step 4: Rodar o build**

Run: `npm run build`
Expected: build sem erros de tipo/lint.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CheckAnalista.tsx
git commit -m "feat: adiciona botão de exportação PDF fallback na fila CHECK_ANALISTA"
```

---

## Task 4: Verificação manual end-to-end

**Files:** nenhum (task de verificação, sem alteração de código).

- [ ] **Step 1: Rebuild + restart do servidor**

Run:
```bash
cd "/Users/thay/Projetos Thay/pepito-frontend" && npm run build
```
Expected: build ok.

Depois, reiniciar o processo do `server.cjs` (matar o processo atual e subir de novo com `node server.cjs` em background), conforme prática já estabelecida neste projeto (rebuild + restart sempre juntos).

- [ ] **Step 2: Verificar visualmente via Chrome DevTools (se disponível) ou navegador manual**

Abrir a aplicação em `https://192-168-201-67.sslip.io:4173/check-analista`, aplicar um filtro de Sugestão IA (ex. "Reprovado"), clicar em "Exportar PDF (fallback)", e no preview de impressão (`Ctrl+P` / diálogo do navegador) confirmar:
- Só os casos filtrados aparecem no preview.
- Página de rosto mostra data/hora, quantidade de casos e os filtros aplicados corretamente.
- Cada caso está em página própria (quebra de página entre casos).
- A Sugestão de parecer IA aparece por completo (sem corte/truncamento).
- Histórico de comentários aparece listado.
- Nenhum elemento da aplicação normal (sidebar, botões, filtros) aparece no preview.

- [ ] **Step 3: Reportar resultado**

Se algo não bater com o esperado (ex. quebra de página errada, filtro não aplicado), documentar o desvio e voltar para a task correspondente (2 ou 3) para ajuste — não seguir para conclusão sem essa checagem.
