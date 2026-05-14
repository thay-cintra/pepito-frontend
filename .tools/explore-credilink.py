#!/usr/bin/env python
"""Verifica pep_pf detalhado em registration_notebook_output_single."""
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


# Vamos olhar o pep_pf RAW completo dos 5 primeiros casos
draft_ids = [
    "af1fe938-e0a0-460f-987a-f7b503f0d1d2",  # Cristiano
    "ac873b5c-9783-4a79-b169-c23942c39518",  # Kaique
    "4bca8825-d5ff-4251-8b86-fc38cf9bbbee",  # Pollyana
    "9234845d-8b5a-440a-b4e5-bb6a5435578e",  # Luciano
    "278fa366-5747-411e-a0c5-1eb4d1489bd3",  # Rita
]
ids_in = ", ".join(repr(d) for d in draft_ids)

print("=== pep_pf RAW completo ===")
df = q(f"""
SELECT draft_id, full_name, cpf, pep_pf
FROM squad_core.registration_notebook_output_single
WHERE draft_id IN ({ids_in})
""")
for _, row in df.iterrows():
    print(f"\n--- {row['full_name']} (CPF {row['cpf']}) ---")
    pep_str = row.get('pep_pf') or ""
    if pep_str:
        try:
            pep = json.loads(pep_str)
            print(json.dumps(pep, ensure_ascii=False, indent=2)[:3000])
        except Exception:
            print(f"raw: {pep_str[:500]}")

# Também participacoesempresariais
print("\n\n=== participacoesempresariais (sócios em outras empresas) ===")
df2 = q(f"""
SELECT draft_id, full_name, participacoesempresariais
FROM squad_core.registration_notebook_output_single
WHERE draft_id IN ({ids_in})
""")
for _, row in df2.iterrows():
    print(f"\n--- {row['full_name']} ---")
    pe = row.get('participacoesempresariais')
    if pe:
        try:
            print(str(pe)[:1500])
        except Exception:
            print("(erro parse)")
