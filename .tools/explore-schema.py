#!/usr/bin/env python
"""Schema completo + filtros extras que o Retool aplica para chegar a 32 casos."""
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from coralago.lake import Lake
import awswrangler as wr

lake = Lake()
print(f"Lake OK · workgroup={lake.workgroup}\n")


def query(sql: str, db: str = "squad_core"):
    return wr.athena.read_sql_query(
        sql=sql, database=db,
        s3_output=lake.s3_staging_dir,
        boto3_session=lake._session_boto3,
        workgroup=lake.workgroup,
        ctas_approach=False,
    )


# Lista completa de colunas
print("=== Lista de colunas (registration_notebook_output) ===")
df0 = query("SELECT * FROM squad_core.registration_notebook_output LIMIT 0")
cols = list(df0.columns)
for c in cols:
    print(f"  {c}")
print(f"Total: {len(cols)} colunas\n")

# Tem 390 casos HIGH_PLD+PLD_SCORE+IN_ANALYSIS — mas a Retool diz 32.
# Hipóteses para chegar em 32:
#  (a) snapshot mais recente por draft_id
#  (b) sem decisão final ainda (não em dumps.registration_draft_membership_registration_status com decisão)
#  (c) intervalo de data (últimos N dias)
#  (d) outra coluna de "ativo na fila"
print("=== Verificando snapshot por draft_id ===")
df_dist = query("""
SELECT COUNT(*) AS total,
       COUNT(DISTINCT draft_id) AS distinct_drafts
FROM squad_core.registration_notebook_output
WHERE evaluation_reason = 'HIGH_PLD'
  AND sub_status = 'PLD_SCORE'
  AND status = 'IN_ANALYSIS'
""")
print(df_dist.to_string(index=False))

# Ver janela de datas
print("\n=== Janela temporal dos casos HIGH_PLD+PLD_SCORE+IN_ANALYSIS ===")
df_dt = query("""
SELECT MIN(created_at) AS min_dt, MAX(created_at) AS max_dt,
       COUNT(*) AS total
FROM squad_core.registration_notebook_output
WHERE evaluation_reason = 'HIGH_PLD'
  AND sub_status = 'PLD_SCORE'
  AND status = 'IN_ANALYSIS'
""")
print(df_dt.to_string(index=False))

# Filtra para cadastros já decididos via tabela de membership
print("\n=== Membership status — quais drafts ainda estão pendentes ===")
try:
    df_mem = query("""
    SELECT m.status, m.sub_status, COUNT(*) AS n
    FROM dumps.registration_draft_membership_registration_status m
    GROUP BY m.status, m.sub_status
    ORDER BY n DESC
    LIMIT 30
    """, db="dumps")
    print(df_mem.to_string(index=False))
except Exception as e:
    print(f"membership query falhou: {e}")

# Tenta filtrar com snapshot mais recente por draft_id
print("\n=== Snapshot mais recente por draft_id (filtrar HIGH_PLD+PLD_SCORE+IN_ANALYSIS) ===")
df_recent = query("""
WITH latest AS (
  SELECT draft_id, MAX(created_at) AS mx
  FROM squad_core.registration_notebook_output
  GROUP BY draft_id
)
SELECT COUNT(*) AS n
FROM squad_core.registration_notebook_output r
JOIN latest l ON r.draft_id = l.draft_id AND r.created_at = l.mx
WHERE r.evaluation_reason = 'HIGH_PLD'
  AND r.sub_status = 'PLD_SCORE'
  AND r.status = 'IN_ANALYSIS'
""")
print(df_recent.to_string(index=False))
