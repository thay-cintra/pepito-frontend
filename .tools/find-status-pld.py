#!/usr/bin/env python
"""Procura coluna 'Status Análise PLD' ou similar (pld_score_v4_status, etc.)
e cruza com a lista de 11 LIDERANCA fornecida pela analista."""
from pathlib import Path
import json
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


# 1. Verifica os 32 casos com TODOS os campos possíveis de "status análise PLD"
print("=== Campos de status PLD nos 32 casos ===")
df = q("""
SELECT draft_id, full_name, legal_name, cnpj, cpf,
       pld_score_solicitado, pld_score_v4, score_band_v4, pld_score_v4_status,
       evaluation_reason, status, sub_status,
       evaluation_notebook
FROM squad_core.registration_notebook_output_single
WHERE status IN ('DOUBLE_CHECK','IN_ANALYSIS')
  AND sub_status = 'PLD_SCORE'
ORDER BY full_name
""")
print(f"Total: {len(df)} casos\n")
for col in df.columns:
    if col not in ("draft_id", "full_name", "legal_name", "cnpj", "cpf"):
        print(f"\n  {col} — distinct values:")
        print(df[col].value_counts(dropna=False).head(15).to_string())

# 2. Lista CNPJs específicos que a analista deu (11 LIDERANCA)
print("\n\n=== Cruzando com a lista de 11 LIDERANCA ===")
cnpjs_lid = [
    "58753691000184",  # Vivian
    "66183130000115",  # Luciano
    "65999482000180",  # Rita
    "37354995000107",  # Sandro
    "66216187000173",  # Gustavo
    "60526692000138",  # Cristiano
    "66269744000114",  # Ana Paula
    "33278692000193",  # Levi
    "61783207000174",  # Luciana Valverde
    "42235850000119",  # Cicero (CENTRO EDUCACIONAL FILADELFIA, MEI_ISSUE)
    "30305332000145",  # Romildo
]

cnpjs_in = ", ".join(repr(c) for c in cnpjs_lid)
df_lid = q(f"""
SELECT draft_id, cnpj, cpf, full_name, legal_name, evaluation_reason,
       pld_score_v4_status, evaluation_notebook
FROM squad_core.registration_notebook_output_single
WHERE cnpj IN ({cnpjs_in})
ORDER BY full_name
""")
print(df_lid.to_string(index=False))

# 3. Os que NÃO aparecem em registration_notebook_output_single — buscar em outras tabelas
print("\n\n=== Casos não-encontrados em _single (buscar em outras tabelas) ===")
encontrados = set(df_lid["cnpj"].astype(str).tolist())
faltantes = [c for c in cnpjs_lid if c not in encontrados]
print(f"Faltantes: {faltantes}")
if faltantes:
    cnpjs_falt = ", ".join(repr(c) for c in faltantes)
    df_full = q(f"""
    SELECT draft_id, cnpj, cpf, full_name, legal_name,
           evaluation_reason, status, sub_status, created_at
    FROM squad_core.registration_notebook_output
    WHERE cnpj IN ({cnpjs_falt})
    ORDER BY created_at DESC
    """)
    print(df_full.to_string(index=False))
