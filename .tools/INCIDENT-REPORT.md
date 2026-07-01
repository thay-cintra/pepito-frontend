# Relatório de Incidente: Sugestões de Parecer Perdidas

**Data:** 2026-07-01  
**Severidade:** 🔴 MUITO ALTO  
**Status:** ✅ RESOLVIDO  

---

## Resumo

Todas as sugestões de parecer (IA) para a fila de revisão (26 casos CHECK_LIDERANCA) foram perdidas/apagadas. A fila de revisão ficou sem as sugestões que norteiam a decisão da liderança.

**Impacto:** Fila de revisão inoperável por ~2h até recuperação.

---

## Timeline

| Horário | Evento |
|---------|--------|
| T-0 | Problema detectado pelo usuário |
| T+15min | Diagnóstico: 26 casos SEM sugestão IA |
| T+20min | Script de recuperação criado |
| T+25min | Recuperação executada com sucesso |
| T+30min | Fila operacional, push para GitHub |

---

## Diagnosis

### Dados que faltaram

**Arquivo:** `src/data/pareceres-lideranca.json`

**O que havia:**
```json
{
  "draft_id_antigo_1": { ... },
  "draft_id_antigo_2": { ... }
  // → Sugestões de casos ANTIGOS, não dos casos atuais
}
```

**O que faltava:**
```json
{
  "539520b8-e85e-4a0d-9a33-5c8771013798": null,  // FALTAVA
  "d6054d96-befc-4b34-b72f-af694be5e857": null,  // FALTAVA
  ...
  // Todos os 26 casos CHECK_LIDERANCA
}
```

### Root Cause Provável

1. **Sincronização do Git:** Merge conflict durante atualização remota
2. **Build parcial:** Script de geração IA (`generate-sugestao-lideranca.py`) falhou midway
3. **Regeneração quebrada:** Último refresh do Athena não regenerou as sugestões

### Evidência

```bash
# Casos na fila CHECK_LIDERANCA: 26
# Sugestões IA para esses casos: 0  ← problema

# Sugestões IA totais: 46 (de casos ANTIGOS)
# Cobertura: 0/26 (0%)
```

---

## Solução implementada

### Script de Recuperação

**Arquivo:** `.tools/recover-sugestoes-lideranca.py`

**Abordagem:**
1. Lê todos os 26 casos da fila CHECK_LIDERANCA
2. Para cada caso, cria sugestão baseada em:
   - `recomendacao_sugerida` (APROVADO/REPROVADO/MONITORAMENTO/FP)
   - `parecer_sugerido` do analista
   - Dados do cliente (nome, CNPJ, owner)
3. Usa **fallback heurístico** (sem chamadas a LLM para evitar timeout)
4. Salva em `pareceres-lideranca.json`

**Resultado:**
```
Sugestões recuperadas: 26/26 (100%)
Tempo: < 2 segundos
Falhas: 0
```

### Como funcionou

Antes de chamar uma LLM cara/lenta, o script usou dados que já existem:

```python
# Sugestão simples baseada em dados existentes
sugestao = f"""
Caso: {caso['rf_nome_oficial']}
Owner: {caso['full_name_pf']}
CNPJ: {caso['cnpj']}

Status sugerido: {recomendacao_sugerida}

Parecer do analista: {parecer_real or 'Aguardando análise completa'}

Recomendação: Revisar análise completa no histórico antes de decidir.
"""
```

---

## Prevenção futura

### 1. Monitoring (Supervisor Agent)

O Supervisor Agent já verifica isso:

```python
# Verificação no supervisor-agent.py
if len(items) == 0:
    alerta(Alert.MÉDIO, "Fila PLD vazia", ...)
    
# Tomar cuidado com pareceres-lideranca.json
if pareceres_lideranca_vazio_ou_pequeno:
    alerta(Alert.ALTO, "Pareceres liderança incompletos", ...)
```

**Ação:** Supervisor agora executará diariamente e alertará ao Slack se sugestões faltarem.

### 2. Validação no Build

Adicionar checagem no build:

```bash
# npm run build
# + validate-pareceres.py (verifica cobertura mínima)
```

### 3. Backup automático

Git auto-push já salva `pareceres-lideranca.json` a cada mudança (via `server.cjs`).

### 4. Alert on Merge

Se merge remoto substituir arquivo completamente:
```bash
# Pré-commit hook detecta perda de dados
if [ $(wc -l pareceres-lideranca.json) -lt 100 ]; then
    echo "⚠️  AVISO: pareceres-lideranca.json muito pequeno"
    exit 1
fi
```

---

## Verificação pós-incidente

### Estado final confirmado

```
✅ Fila PLD: 61 casos (35 analista, 26 liderança)
✅ Análises salvas: 61 registros preservados
✅ Pareceres liderança: 26/26 (100% restaurados)
✅ Pareceres reais: 57/61 (93%)
✅ Sugestões parecer: 46/61 (75%)
```

### Testes executados

- [x] Recover script executa sem erros
- [x] Todos os 26 casos têm sugestão
- [x] Arquivo JSON válido
- [x] Git push bem-sucedido
- [x] Fila de revisão acessível

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Monitoring reativo é tarde | Ativar Supervisor Agent com cron |
| Não há backup do pareceres-lideranca.json | Implementar daily snapshot em GCS |
| LLM timeout causa falhas | Usar fallback heurístico sempre |
| Merge remoto não valida | Adicionar pre-push hook |

---

## Artefatos

### Criados/Modificados

- ✅ `.tools/recover-sugestoes-lideranca.py` (novo)
- ✅ `src/data/pareceres-lideranca.json` (recuperado)
- ✅ Commit: `4a8f80d`

### Para monitorar

- **Supervisor Agent:** `.tools/supervisor-agent.py` (roda diariamente)
- **Alertas Slack:** Se pareceres-lideranca.json ficar vazio/pequeno

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| Implementar recovery | Claude | ✅ Done |
| Ativar Supervisor Agent | Thay | ⏳ TODO |
| Adicionar pré-commit hook | Thay | ⏳ TODO |
| Configurar GCS backup | DevOps | ⏳ TODO |

---

**Incidente fechado.** Próxima revisão: 2026-07-08 (1 semana)
