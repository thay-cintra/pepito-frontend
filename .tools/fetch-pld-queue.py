#!/usr/bin/env python
"""
Puxa os casos REAIS da Fila PLD do Retool:
  squad_core.registration_notebook_output_single
  WHERE status IN ('DOUBLE_CHECK','IN_ANALYSIS')
    AND sub_status = 'PLD_SCORE'
    AND evaluation_reason = 'HIGH_PLD'

Gera: src/data/registration-queue-real.json (com 29-32 casos reais).
"""
import json
import re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from coralago.lake import Lake
import awswrangler as wr

lake = Lake()
print(f"Lake OK · workgroup={lake.workgroup}\n")


def q(sql: str, db="squad_core"):
    return wr.athena.read_sql_query(
        sql=sql, database=db,
        s3_output=lake.s3_staging_dir,
        boto3_session=lake._session_boto3,
        workgroup=lake.workgroup,
        ctas_approach=False,
    )


# Schema completo
print("=== Colunas de registration_notebook_output_single ===")
df0 = q("SELECT * FROM squad_core.registration_notebook_output_single LIMIT 0")
cols = list(df0.columns)
print(f"{len(cols)} colunas: {cols}\n")

# Pull dos 29 casos
print("=== Buscando casos da Fila PLD ===")
df = q("""
SELECT *
FROM squad_core.registration_notebook_output_single
WHERE status IN ('DOUBLE_CHECK','IN_ANALYSIS')
  AND sub_status = 'PLD_SCORE'
  AND evaluation_reason = 'HIGH_PLD'
ORDER BY created_at DESC
""")
print(f"Total: {len(df)} casos\n")

# Distribuição por status (DOUBLE_CHECK vs IN_ANALYSIS)
print("=== Distribuição por status ===")
print(df.groupby("status").size().to_string())

# Mostrar casos de Cristiano Portela se houver
print("\n=== Procurando 'CRISTIANO' no full_name ===")
mask = df["full_name"].str.contains("CRISTIANO|Cristiano|cristiano", na=False)
print(f"{mask.sum()} caso(s) encontrado(s)")
if mask.any():
    sub = df[mask][["draft_id", "cnpj", "full_name", "legal_name", "status", "sub_status"]]
    print(sub.to_string(index=False))

# Salvar JSON
out_path = Path(__file__).resolve().parents[1] / "src" / "data" / "registration-queue-real.json"
out_path.parent.mkdir(parents=True, exist_ok=True)

# Sanitizar — converter NaN para None, garantir strings serializáveis
def sanitize(v):
    if v is None or (isinstance(v, float) and v != v):  # NaN check
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v

records = []
for _, row in df.iterrows():
    rec = {c: sanitize(row[c]) for c in df.columns}
    records.append(rec)

with out_path.open("w", encoding="utf-8") as f:
    json.dump(records, f, ensure_ascii=False, indent=2, default=str)
print(f"\nJSON salvo em: {out_path} ({len(records)} casos)")

# Também imprimir os primeiros 3 casos resumidos para conferência
print("\n=== Primeiros 3 casos ===")
for i, r in enumerate(records[:3]):
    print(f"\n--- Caso {i+1} ---")
    for k in ["draft_id", "cnpj", "cpf", "full_name", "legal_name", "rec_uf",
             "rec_municipio", "rec_atividadeeconomicaprincipal",
             "status", "sub_status", "evaluation_reason", "score_pld", "pep_pf", "pep_pj"]:
        if k in r:
            v = str(r.get(k, ""))[:120]
            print(f"  {k}: {v}")
