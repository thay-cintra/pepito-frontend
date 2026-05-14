#!/usr/bin/env python
"""Verifica filtros corretos para pegar TODOS os casos da Fila PLD do Retool,
incluindo MEI_ISSUE, SUS_NAME, HAS_QSA etc."""
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


# 1. Status × evaluation_reason × sub_status para sub_status=PLD_SCORE
print("=== sub_status=PLD_SCORE — combinações de status/evaluation_reason ===")
df = q("""
SELECT status, evaluation_reason, COUNT(*) AS n
FROM squad_core.registration_notebook_output_single
WHERE sub_status = 'PLD_SCORE'
GROUP BY status, evaluation_reason
ORDER BY n DESC
""")
print(df.to_string(index=False))

# 2. Verificar se os 3 casos faltando aparecem
print("\n=== Buscando CPFs específicos ===")
cpfs = ["05138670409", "96660872000", "13122706830"]
df = q(f"""
SELECT draft_id, cnpj, cpf, full_name, legal_name, status, sub_status,
       evaluation, evaluation_reason
FROM squad_core.registration_notebook_output_single
WHERE cpf IN ({",".join(repr(c) for c in cpfs)})
""")
print(df.to_string(index=False))

# 3. Total casos com sub_status=PLD_SCORE em qualquer status análise
print("\n=== Filtro proposto: sub_status=PLD_SCORE & status IN ('DOUBLE_CHECK','IN_ANALYSIS','WAITING_EMAIL_RESPONSE') ===")
df = q("""
SELECT status, COUNT(*) AS n
FROM squad_core.registration_notebook_output_single
WHERE sub_status = 'PLD_SCORE'
  AND status IN ('DOUBLE_CHECK','IN_ANALYSIS','WAITING_EMAIL_RESPONSE')
GROUP BY status
""")
print(df.to_string(index=False))

# 4. Apenas IN_ANALYSIS + DOUBLE_CHECK (o que a usuária descreveu)
print("\n=== sub_status=PLD_SCORE & status IN ('DOUBLE_CHECK','IN_ANALYSIS') ===")
df = q("""
SELECT status, evaluation_reason, COUNT(*) AS n
FROM squad_core.registration_notebook_output_single
WHERE sub_status = 'PLD_SCORE'
  AND status IN ('DOUBLE_CHECK','IN_ANALYSIS')
GROUP BY status, evaluation_reason
ORDER BY n DESC
""")
print(df.to_string(index=False))
print(f"\nTotal: {df['n'].sum()}")
