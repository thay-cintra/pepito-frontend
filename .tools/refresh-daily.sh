#!/usr/bin/env bash
# Refresh diário da Fila PLD a partir do Athena (notebook coralago) +
# pesquisa obrigatória de mídia externa + regeneração dos pareceres.
#
# Disparado pelo LaunchAgent com.cora.pepito.refresh (~/Library/LaunchAgents).
# Logs: pepito-frontend/.tools/refresh-daily.log
set -euo pipefail

ROOT="/Users/thay/Projetos Thay"
LOG="$ROOT/pepito-frontend/.tools/refresh-daily.log"

{
  echo ""
  echo "=== $(date -Iseconds) refresh start ==="
  cd "$ROOT"

  # Ativa venv (coralago + openai + dotenv vivem aqui)
  # shellcheck disable=SC1091
  source "$ROOT/.venv/bin/activate"

  echo "[1/5] build-real-queue.py — pulling Athena ..."
  python pepito-frontend/.tools/build-real-queue.py

  echo "[1b] Sincronizando token_pf_cred e pareceres-real.json ..."
  python - << 'PYEOF'
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path.home() / "Projetos Thay"))
from dotenv import load_dotenv; load_dotenv(Path.home() / "Projetos Thay/.env")
from coralago.lake import Lake; import awswrangler as wr
lake = Lake()
root = Path.home() / "Projetos Thay/pepito-frontend/src/data"
with open(root / "registration-queue-real.json") as f: d = json.load(f)
items = d["items"] if isinstance(d, dict) else d
ids_in = ",".join(f"'{i['draft_id']}'" for i in items)
df = wr.athena.read_sql_query(
    f"SELECT draft_id, token_pf_cred, token_pj_cred FROM squad_core.registration_notebook_output_single WHERE draft_id IN ({ids_in})",
    database="squad_core", s3_output=lake.s3_staging_dir,
    boto3_session=lake._session_boto3, workgroup=lake.workgroup, ctas_approach=False)
tm = {r["draft_id"]: (r["token_pf_cred"], r["token_pj_cred"]) for _, r in df.iterrows()}
for item in items:
    tf, tj = tm.get(item["draft_id"], (None, None))
    item["token_pf_cred"] = tf; item["token_pj_cred"] = tj
with open(root / "registration-queue-real.json", "w") as f: json.dump(d, f, ensure_ascii=False, indent=2)
emails = {"jeniffer@cora.com.br","lucasfeller@cora.com.br","m.matos@cora.com.br"}
pr_path = root / "pareceres-real.json"
pr = json.loads(pr_path.read_text()) if pr_path.exists() else {}
added = 0
for item in items:
    did = item["draft_id"]; webhook = item.get("webhook_historico") or []
    envio = next((h for h in webhook if h.get("user_email") in emails and h.get("acao")=="ENVIAR_LIDERANCA_PLD" and h.get("text","").strip()), None)
    if envio:
        entry = pr.setdefault(did, {"comentarios": []})
        if not any(c.get("acao")=="ENVIAR_LIDERANCA_PLD" for c in entry["comentarios"]):
            entry["comentarios"].insert(0, {"timestamp": envio.get("timestamp",""), "user_email": envio.get("user_email",""), "acao": "ENVIAR_LIDERANCA_PLD", "tipo": "parecer", "text": envio["text"]}); added += 1
pr_path.write_text(json.dumps(pr, ensure_ascii=False, indent=2))
print(f"  tokens: {sum(1 for i in items if i.get('token_pf_cred'))}/{len(items)} | pareceres-real +{added}")
PYEOF

  echo "[2/5] fetch-media-findings.py — pesquisa obrigatória de mídia + JusBrasil API (CHECK_LIDERANCA + CHECK_ANALISTA) ..."
  python pepito-frontend/.tools/fetch-media-findings.py

  echo "[3/5] build-pep-history.py — historical PEP analyses ..."
  python pepito-frontend/.tools/build-pep-history.py

  echo "[3b] fetch-pep-planilha.py — mesclar planilha PEP ONB (falsos positivos + rotas compliance) ..."
  python pepito-frontend/.tools/fetch-pep-planilha.py || echo "  ⚠️  Planilha não disponível (credenciais ausentes) — pulando"

  echo "[4/5] generate-sugestao-parecer.py — ANALISTA pareceres ..."
  python pepito-frontend/.tools/generate-sugestao-parecer.py

  echo "[5/5] generate-sugestao-lideranca.py — LIDERANCA pareceres ..."
  python pepito-frontend/.tools/generate-sugestao-lideranca.py

  echo "[6/6] generate-pld-risk-scores.py — scores de probabilidade de LD ..."
  python pepito-frontend/.tools/generate-pld-risk-scores.py

  echo "[upload] Sincronizando JSONs para GCS (pepito-data-stage) ..."
  DATA="$ROOT/pepito-frontend/src/data"
  gsutil cp "$DATA/registration-queue-real.json" gs://pepito-data-stage/registration-queue-real.json
  gsutil cp "$DATA/analises-salvas.json"         gs://pepito-data-stage/analises-salvas.json 2>/dev/null || true

  echo "=== $(date -Iseconds) refresh done ==="
} >> "$LOG" 2>&1
