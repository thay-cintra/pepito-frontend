#!/usr/bin/env python
"""Procura o campo real que distingue CHECK_LIDERANCA / CHECK_ANALISTA no Retool.

Hipóteses:
  (a) Coluna em squad_core.registration_notebook_output_single (ex: 'compliance', 'decision')
  (b) Tabela auxiliar (audit, tier, queue tracking)
  (c) Lógica baseada em (evaluation_reason × score × outros sinais)
"""
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from coralago.lake import Lake
import awswrangler as wr

lake = Lake()


def q(sql: str, db="squad_core"):
    return wr.athena.read_sql_query(
        sql=sql, database=db,
        s3_output=lake.s3_staging_dir,
        boto3_session=lake._session_boto3,
        workgroup=lake.workgroup,
        ctas_approach=False,
    )


# 1. Inspecionar JSONs `decision` e `compliance` dos 32 casos para ver se
#    contêm algo como "tier", "lideranca", "analista", "level"
print("=== JSONs `decision` e `compliance` dos 32 casos da fila ===")
df = q("""
SELECT draft_id, full_name, legal_name, evaluation_reason,
       compliance, decision, owner_data
FROM squad_core.registration_notebook_output_single
WHERE status IN ('DOUBLE_CHECK','IN_ANALYSIS')
  AND sub_status = 'PLD_SCORE'
""")
print(f"Total: {len(df)} casos")
for _, row in df.iterrows():
    name = row["full_name"]
    print(f"\n--- {name} (draft {row['draft_id'][:12]}) ---")
    for col in ["compliance", "decision", "owner_data"]:
        val = row.get(col)
        if not val or str(val).lower() == "none":
            continue
        try:
            parsed = json.loads(val) if isinstance(val, str) else val
            print(f"  {col}: {json.dumps(parsed, ensure_ascii=False)[:240]}")
        except Exception:
            print(f"  {col} (raw): {str(val)[:240]}")

# 2. Listar tabelas de audit/tracking
print("\n\n=== Tabelas de audit/tracking ===")
df_audit = q("""
SELECT table_schema, table_name
FROM information_schema.tables
WHERE LOWER(table_name) LIKE '%audit%'
   OR LOWER(table_name) LIKE '%tracking%'
   OR LOWER(table_name) LIKE '%history%pld%'
   OR LOWER(table_name) LIKE '%backoffice%'
ORDER BY table_schema, table_name
LIMIT 30
""", db="information_schema")
print(df_audit.to_string(index=False))
