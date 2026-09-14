# Relatório de Incidente: PEP relacionado não consultado individualmente na Credilink

**Data do reporte:** 2026-09-11

**Severidade:** 🔴 ALTO (risco de apontamento em auditoria PLD/FT — decisões poderiam ter se apoiado numa indicação visual de consulta que não correspondia ao CPF do PEP relacionado)

**Status:** 🟢 RESOLVIDO

**Contexto institucional:** o Pepito não é uma ferramenta oficial de produção da Cora. É um apoio interno usado pelo time de PLD/FT para dar celeridade à triagem de casos PEP na fila de onboarding. Este relatório documenta uma falha de interpretação da API, processamento e exibição nesse apoio interno.

---

## Resumo

Em 2026-09-11, Thay, analista de PLD/FT, reportou que não havia histórico de consulta Credilink para o CPF do PEP relacionado no draft `ca6eac08-e054-4275-886d-c6f909554381`. O token exibido pertencia à titular da conta, Amélia Míriam de Oliveira, e não ao PEP relacionado, Tadeu Barbosa de Oliveira.

A investigação confirmou que o fluxo identificava o vínculo com o PEP a partir da consulta do titular da conta, mas não consultava individualmente o CPF do PEP relacionado para obter antecedentes, processos, sanções, mídias e demais informações de compliance. A interface também colocava o token do titular ao lado do nome e CPF do PEP, criando uma associação incorreta entre pessoas distintas.

---

## Causa raiz

### 1. Leitura incorreta da documentação da API Credilink para PEP não titular

Tivemos um bug na leitura da documentação da API para o PEP não titular da conta. O endpoint `/api/PEP?cpf=X` foi originalmente interpretado como uma consulta com a pergunta “o CPF X é PEP?”. A semântica documentada e efetiva do endpoint é inversa: ele responde “quais PEPs estão relacionados ao CPF X?”.

Essa interpretação levou o fluxo a tratar a identificação de um PEP relacionado ao titular como se também representasse uma consulta individual do próprio PEP. Na prática, o CPF do PEP relacionado não era submetido às consultas de compliance e antecedentes. A identificação do vínculo e a diligência reputacional individual são operações distintas e precisam produzir evidências distintas.

### 2. Fonte upstream limitada ao titular da conta

`token_pf_cred` e `token_pj_cred` vêm da tabela Athena `squad_core.registration_notebook_output_single`, mantida pelo pipeline automático de onboarding. A tabela é vinculada ao titular da conta: existe um registro por `draft_id`, e não um registro por CPF de cada PEP relacionado.

O campo `pep_pf` também vem dessa fonte e registra os vínculos PEP identificados na consulta do titular. Ele não comprova que o CPF do PEP relacionado foi consultado individualmente. O Pepito usava os dados do titular sem uma segunda chamada dedicada ao CPF relacionado.

### 3. Associação incorreta na interface do Check Analista

O card “Consulta Credilink (Tessera)” em `AnalisePrimeiraCamada.tsx` descrevia a consulta como disparada para o CPF do PEP. Ao mesmo tempo, mostrava o nome e CPF do PEP junto do `token_pf_cred`, que pertencia ao titular da conta. Nenhuma validação confirmava que o token correspondia ao CPF exibido.

O comportamento existia desde o commit inicial do projeto (`4e999e5`, de 2026-05-14).

### 4. Associação visual equivalente na Mesa de Decisão

`NovaAnalise.tsx` exibia “Token Credilink” próximo ao CPF do PEP relacionado sem identificar claramente que o token era do titular da conta. Embora o texto fosse menos explícito, o layout permitia a mesma interpretação incorreta.

---

## Correções aplicadas

| Componente | Correção |
|---|---|
| `.tools/consultar-credilink-pep.py` | Implementação da consulta real e individual do CPF do PEP relacionado, com persistência do token e do resultado consolidado em `src/data/credilink-pep-consultas.json`. |
| `server.cjs` e `src/lib/credilink-pep.ts` | Endpoint interno `POST /api/credilink/consultar-pep`, implantado no ambiente operacional do Pepito, e consumo em tempo real pela interface. O retorno é validado quanto ao CPF, token, conclusão do compliance e ausência de campos de erro. |
| `src/pages/AnalisePrimeiraCamada.tsx` | Guardrail de envio: a ação de encaminhar à Mesa fica bloqueada enquanto a consulta real do PEP ou a diligência reputacional estiver pendente, salvo registro explícito de verificação manual. |
| `src/components/RegistrationCaseCard.tsx` | Badges separados para “Credilink Compliance do PEP” e “Diligência reputacional (JusBrasil + Credilink)”, evitando tratar verificações diferentes como duplicadas ou equivalentes. |
| `src/pages/NovaAnalise.tsx` | Exibição do resultado individual do PEP relacionado e identificação correta da pessoa à qual pertence cada token. |
| Batelada retroativa | Consulta dos 281 CPFs pendentes desde abril de 2026. O ledger foi concluído em 281/281, sem entradas `erro_*` pendentes. |

---

## Verificação

- Os 281 CPFs definidos em `.tools/pep_relacionado_pendente_281.json` estão presentes no ledger `src/data/credilink-pep-consultas.json`.
- As 281 entradas têm `compliance.result` consolidado e nenhuma contém campo `erro_*` preenchido.
- O endpoint interno rejeita CPFs que não pertencem a PEPs da fila e reutiliza a mesma execução quando já existe consulta concorrente para o CPF.
- A interface valida se o CPF retornado corresponde ao solicitado e não aceita compliance ausente, incompleto ou ainda em processamento.
- O guardrail da primeira camada considera separadamente o status da consulta individual Credilink e o status da diligência reputacional antes de habilitar o envio à Mesa.
- `npm run typecheck` é a validação automatizada disponível para o frontend. Não foi identificado teste funcional automatizado específico para o endpoint ou para o guardrail na data de encerramento.

---

## Lições aprendidas

| Lição | Medida adotada |
|---|---|
| A semântica de um endpoint de relacionamento não pode ser inferida pelo nome do parâmetro. | Registrar no código o sentido da consulta e validar separadamente identificação do vínculo e diligência do CPF relacionado. |
| Um token real do titular não pode ser apresentado junto aos dados do PEP relacionado sem identificação de titularidade. | Rotular pessoa, CPF, fonte e finalidade de cada consulta e separar os badges de compliance e diligência reputacional. |
| A presença do vínculo PEP na tabela upstream não comprova consulta individual do PEP. | Consultar o CPF relacionado em tempo real e manter ledger próprio por CPF com resultado e token. |
| Pendência de consulta não pode depender apenas de interpretação visual do analista. | Bloquear o envio à Mesa enquanto a consulta estiver pendente, com exceção somente mediante registro explícito de verificação manual. |

---

## Owner & Follow-up

| Item | Responsável | Status |
|---|---|---|
| Corrigir a exibição enganosa do token Credilink no Check Analista e na Mesa | Claude | ✅ Done (2026-09-11) |
| Implementar consulta Credilink real ao CPF do PEP relacionado | Claude | ✅ Done (2026-09-12) |
| Implementar guardrail que bloqueia envio à Mesa sem consulta real ou verificação manual registrada | Claude | ✅ Done (2026-09-12) |
| Consultar retroativamente os 281 CPFs relacionados pendentes desde abril de 2026 | Claude | ✅ Done (2026-09-12) |

---

## Encerramento

O incidente consistiu na ausência de consulta individual da Credilink para PEPs relacionados e na exibição de um token do titular da conta em contexto que permitia associá-lo ao PEP. O comportamento existia desde a primeira versão do Pepito, em 2026-05-14, e foi identificado a partir do reporte da Thay em 2026-09-11.

A causa foi a leitura incorreta da semântica do endpoint `/api/PEP?cpf=X`, combinada com o uso de uma fonte upstream limitada ao titular e com ausência de validação entre CPF exibido e token retornado.

O incidente foi resolvido pelas seguintes ações:

1. implementação da consulta individual do CPF do PEP relacionado;
2. persistência dos resultados em ledger próprio por CPF;
3. consulta em tempo real pela interface, sem depender apenas da tabela `squad_core.registration_notebook_output_single`;
4. validação estrita de CPF, token, status de processamento e campos de erro;
5. bloqueio do envio à Mesa enquanto a consulta estiver pendente, salvo verificação manual registrada;
6. separação dos badges de Credilink Compliance e diligência reputacional JusBrasil + Credilink;
7. reprocessamento retroativo dos 281 CPFs pendentes desde abril de 2026, concluído em 281/281.

As medidas preventivas permanecem incorporadas ao fluxo: ledger por CPF, consulta em tempo real, badge de status na fila, rotulagem explícita da titularidade dos dados e guardrail de bloqueio. A validação automatizada atual inclui o typecheck do frontend; a criação de teste funcional específico para o endpoint e o guardrail permanece uma oportunidade de fortalecimento, sem pendência operacional para o encerramento deste incidente.

Com a correção do fluxo, a conclusão da batelada retroativa e a verificação do ledger, o incidente está encerrado como resolvido e sanado.
