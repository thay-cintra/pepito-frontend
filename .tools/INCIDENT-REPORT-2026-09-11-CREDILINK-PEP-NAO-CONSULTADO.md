# Relatório de Incidente: PEP Relacionado nunca foi consultado individualmente na Credilink — token exibido pertence ao titular da conta

**Data do reporte:** 2026-09-11
**Severidade:** 🔴 ALTO (risco de apontamento em auditoria PLD/FT — decisão de aprovação pode ter se apoiado em uma "consulta Credilink" que na verdade nunca verificou o CPF do PEP)
**Status:** 🟡 PARCIALMENTE RESOLVIDO — UI corrigida (não mostra mais informação falsa); consulta real ao CPF do PEP relacionado em desenvolvimento (ver "Follow-up")

**Contexto institucional:** o Pepito **não é uma ferramenta implementada em produção pela Cora** — é um apoio interno construído para o time de PLD/FT dar celeridade à triagem de casos PEP na fila de onboarding. Este relatório documenta um problema de dado/exibição encontrado nesse apoio, não numa ferramenta oficial da instituição.

---

## Resumo

Thay (analista PLD/FT) reportou, para o draft `ca6eac08-e054-4275-886d-c6f909554381` (Amélia Míriam De Oliveira, titular da conta; PEP relacionado: Tadeu Barbosa de Oliveira, Prefeito de Araçuaí-MG, irmão da titular): *"Eu não achei histórico de consulta para o PEP mesmo, na Credilink. O token que está trazendo como se fosse do PEP, é do titular da conta."* Junto, o pedido de que a consulta Credilink passe a ser registrada para **todos** os PEPs Titulares e Relacionados, não só para o titular da conta.

A investigação confirmou o relato **e encontrou uma manifestação ainda mais grave do mesmo problema** na tela do Check Analista (1ª Camada), não só na Mesa de Decisão (Liderança).

---

## Causa raiz

### 1. Arquitetura upstream: o token Credilink é sempre do titular da conta

`token_pf_cred`/`token_pj_cred` são colunas da tabela Athena `squad_core.registration_notebook_output_single`, escritas pelo pipeline automático de onboarding (fora deste repositório, em `data-infra`/notebook). Essa tabela é **owner-scoped por design**: um registro por `draft_id`, nunca um registro por CPF de PEP relacionado. `pep_pf` (array de vínculos PEP identificados pela Credilink) também vem dessa mesma tabela — mas identificar QUE alguém é PEP (via CPF do titular da conta) é uma operação diferente de **consultar o CPF do próprio PEP** em busca de antecedentes próprios. O Pepito nunca fez essa segunda consulta.

### 2. `AnalisePrimeiraCamada.tsx` (Check Analista) — o bug mais grave

Este é o problema mais sério encontrado: o card "Consulta Credilink (Tessera)" na tela do Analista **fabricava uma associação falsa explícita**:

- `CardDescription` dizia literalmente: *"Consulta disparada automaticamente via API para o CPF do PEP titular."* — nenhuma chamada de API acontecia; o dado vinha direto da Athena.
- O card mostrava `CPF consultado: {cliente.cpfPepTitular}` (o CPF do PEP) ao lado de `Nome PEP: {credilinkResultado.nomeConsultado}`, onde `nomeConsultado` era populado com `cliente.nomePessoaVinculada` — **o nome do PEP** — mas o `numeroToken` ao lado vinha de `caso.token_pf_cred`, o token real do titular da conta.
- Resultado: a tela pareceria mostrar "consultamos o CPF do PEP Fulano, aqui está o token" quando na verdade nenhuma consulta ao CPF de Fulano jamais ocorreu.

Esse bug existe **desde o commit inicial do projeto** (`4e999e5`, 2026-05-14) — ou seja, desde que o Pepito existe.

### 3. `NovaAnalise.tsx` (Mesa de Decisão / Liderança) — mesmo dado, rótulo menos explícito

O mesmo `token_pf_cred` era exibido como "Token Credilink" logo abaixo de "CPF PEP titular", sem associação textual explícita como no Check Analista, mas com risco visual equivalente de má interpretação — quem olha a tela lê os dois campos como relacionados.

---

## Fix aplicado

### Código

| Arquivo | Mudança |
|---|---|
| `src/pages/AnalisePrimeiraCamada.tsx` | Card "Consulta Credilink" reescrito: título e descrição agora dizem explicitamente "titular da conta"; `nomeConsultado` passa a vir de `cliente.nomeResponsavel` (não mais do nome do PEP); adicionado aviso amarelo explícito: "PEP {nome} (CPF {cpf}) NÃO foi consultado individualmente na Credilink". |
| `src/pages/NovaAnalise.tsx` | Campo relabeled para "Token Credilink (titular da conta)"; adicionado aviso explícito equivalente. |

### Ainda em aberto (ver Follow-up)

O problema de fundo — **o CPF do PEP relacionado nunca é consultado na Credilink/Tesserati para antecedentes próprios** — não está resolvido ainda; a UI só parou de mentir sobre isso. Está em desenvolvimento um script novo (vivendo dentro do Pepito) que dispara essa consulta real para o CPF do PEP quando ele é "relacionado" (não é o titular da conta), usando a mesma API Tesserati/Credilink já integrada no Pepito para JusBrasil.

---

## Verificação

- `npm run typecheck` e `npm run build` OK após cada mudança de frontend.
- Servidor (`com.cora.pepito.server`, launchd) reiniciado e confirmado servindo o bundle novo após o rebuild.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um card de UI que descreve uma ação automática ("consulta disparada via API") sem checar se essa ação de fato ocorreu é, por si, um risco de compliance — a tela vira fonte de falsa confiança para quem decide. | Sempre que um card apresentar o resultado de uma verificação externa, o texto/label deve refletir literalmente a fonte real do dado (owner vs PEP, automático vs pré-existente), nunca a intenção original de design. |
| Um dado real (token do titular) exibido ao lado de um dado de outra pessoa (nome/CPF do PEP) cria uma associação implícita perigosa mesmo sem nenhuma frase falsa — o simples layout lado a lado já basta pra enganar. | Ao exibir dois dados de pessoas diferentes no mesmo card, rotular explicitamente A QUEM cada campo pertence, mesmo quando parecer óbvio pelo contexto. |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| Corrigir exibição enganosa do token Credilink (Check Analista + Mesa) | Claude | ✅ Done (2026-09-11) |
| Script novo de consulta Credilink/Tesserati real ao CPF do PEP relacionado (quando não vier da tabela) | Claude | ⏳ TODO — em desenvolvimento nesta mesma sessão |
| Consultar retroativamente os PEPs relacionados pendentes desde abril/2026 | Claude | ⏳ TODO — escopo definido por Thay (abril/2026 até hoje) |

---

**Incidente aberto — follow-up em andamento.**
