#!/usr/bin/env python
"""Verifica distribuição de pld_score nos 29 casos para inferir o discriminador
LIDERANCA vs ANALISTA (analista informou 11 LID + 21 ANL ≈ 32)."""
from pathlib import Path
import json
import re
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


df = q("""
SELECT draft_id, cnpj, cpf, full_name, legal_name, rec_uf,
       rec_atividadeeconomicaprincipal, score_pld
FROM squad_core.registration_notebook_output_single
WHERE status IN ('DOUBLE_CHECK','IN_ANALYSIS')
  AND sub_status = 'PLD_SCORE'
  AND evaluation_reason = 'HIGH_PLD'
ORDER BY created_at DESC
""")
print(f"Total: {len(df)} casos\n")

# Parse score_pld JSON
def parse_score(s):
    if s is None or (isinstance(s, float) and s != s):
        return None, None
    try:
        d = json.loads(s)
        return int(d.get("pld_score", 0)), d.get("level")
    except Exception:
        return None, None

df["pld_score_num"] = df["score_pld"].map(lambda x: parse_score(x)[0])
df["pld_level"] = df["score_pld"].map(lambda x: parse_score(x)[1])

print("=== Distribuição por level ===")
print(df["pld_level"].value_counts().to_string())

print("\n=== Distribuição por score numérico (faixa) ===")
import pandas as pd
bins = [0, 300, 500, 700, 800, 900, 950, 980, 990, 999, 1500]
df["faixa"] = pd.cut(df["pld_score_num"], bins=bins)
print(df.groupby("faixa", observed=True).size().to_string())

print("\n=== Score completo (ordenado desc) ===")
sorted_df = df.sort_values("pld_score_num", ascending=False)[
    ["pld_score_num", "pld_level", "rec_uf", "full_name", "legal_name"]
]
print(sorted_df.to_string(index=False))
