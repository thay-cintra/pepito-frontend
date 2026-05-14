#!/usr/bin/env python
"""Procura DOUBLE_CHECK e a tabela com person_type."""
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


# 1. Existe DOUBLE_CHECK em algum registro de registration_notebook_output?
print("=== DOUBLE_CHECK em registration_notebook_output ===")
df = q("""
SELECT status, sub_status, COUNT(*) AS n
FROM squad_core.registration_notebook_output
WHERE status = 'DOUBLE_CHECK'
   OR sub_status = 'DOUBLE_CHECK'
GROUP BY status, sub_status
""")
print(df.to_string(index=False) if len(df) else "(0 linhas)")

# 2. Existe DOUBLE_CHECK em registration_notebook_output_single?
print("\n=== DOUBLE_CHECK em registration_notebook_output_single ===")
df = q("""
SELECT status, sub_status, COUNT(*) AS n
FROM squad_core.registration_notebook_output_single
WHERE status = 'DOUBLE_CHECK'
   OR sub_status = 'DOUBLE_CHECK'
GROUP BY status, sub_status
""")
print(df.to_string(index=False) if len(df) else "(0 linhas)")

# 3. Schema do _single
print("\n=== Schema registration_notebook_output_single ===")
df = q("DESCRIBE squad_core.registration_notebook_output_single")
print(df.head(60).to_string(index=False))

# 4. Schema do _v2
print("\n=== Schema registration_notebook_output_v2 ===")
try:
    df = q("DESCRIBE squad_core.registration_notebook_output_v2")
    print(df.head(60).to_string(index=False))
except Exception as e:
    print(f"Falhou: {e}")

# 5. Quantos casos com filtros do user no _single
print("\n=== Filtros do user (registration_notebook_output_single) ===")
try:
    df = q("""
    SELECT COUNT(*) AS n
    FROM squad_core.registration_notebook_output_single
    WHERE status IN ('DOUBLE_CHECK', 'IN_ANALYSIS')
      AND sub_status = 'PLD_SCORE'
      AND evaluation_reason = 'HIGH_PLD'
    """)
    print(df.to_string(index=False))
except Exception as e:
    print(f"Falhou: {e}")
