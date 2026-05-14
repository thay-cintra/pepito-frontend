#!/usr/bin/env python
"""Final: tabelas com comentários textuais + audit dos 32 drafts."""
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from coralago.lake import Lake
import awswrangler as wr

lake = Lake()


def q(sql: str, db="dumps"):
    return wr.athena.read_sql_query(
        sql=sql, database=db,
        s3_output=lake.s3_staging_dir,
        boto3_session=lake._session_boto3,
        workgroup=lake.workgroup,
        ctas_approach=False,
    )


# 1. Tentativa em vários candidatos
candidates = [
    "dumps.registration_draft_membership_registration_observation",
    "dumps.registration_observation",
    "dumps.compliance_observation",
    "dumps.audit_compliance_assessment_observation",
    "dumps.audit_compliance_assessment_observation_history",
    "dumps.draft_observation",
    "dumps.draft_observation_history",
    "dumps.compliance_assessment_observation",
    "dumps.audit_compliance_assessment",
    "dumps.compliance_assessment_audit",
]
print("=== Tentando tabelas candidatas ===")
for tbl in candidates:
    try:
        df = q(f"SHOW COLUMNS IN {tbl}")
        cols = list(df.iloc[:, 0])
        print(f"  ✓ {tbl}: {cols[:12]}")
    except Exception as e:
        msg = str(e)[:80]
        print(f"  ✗ {tbl}: {msg}")

# 2. Audit completo dos 32 drafts
draft_ids = [
    "ac873b5c-9783-4a79-b169-c23942c39518", "4bca8825-d5ff-4251-8b86-fc38cf9bbbee",
    "4556104e-cb9a-49e9-ace2-87933ce979ba", "39418459-0314-410d-8c26-23d69dea3561",
    "e1baa8ff-aa5f-4190-9c5c-0c74c22d2ae1", "c5c809f0-9f53-4f0e-ad0e-d0c9946b0ec7",
    "386e9d78-c517-4dee-8317-ae24c3ebab76", "20fbe3e7-9521-4c81-bab7-0e7238d42ebf",
    "f2a4b186-aa2b-4825-b1e0-b92a837e902a", "d5781b4d-3ca6-46e2-9411-9f03ab55236c",
    "41c9bbb4-e083-498f-8877-5ee9375624ca", "fecc8d67-9964-4e68-8f22-5c62a696ada2",
    "3224a5e5-4754-414b-8920-02e25812bf66", "63bd6c5e-8fd0-4f0a-a705-db26168e777c",
    "d6de2fd8-63fe-4ccd-86f0-aacda66df2df", "45c71985-d43d-4a41-bf61-382e7fcfe25c",
    "ffffb49f-2cc0-41d2-925a-742933383886", "b884e1da-2492-4c80-ad16-e242ba63f31d",
    "0f55b0c5-e129-4d2b-b4a7-c60e4fcd1b43", "2840b4e9-59d9-4bed-891b-cc89796b08c0",
    "eaa0e882-3756-427e-b0dd-c15244573e58", "53416d66-03af-4915-9239-5b7c140db4fa",
    "2d093557-a5a0-4a65-a929-92d9b5a35b98", "af1fe938-e0a0-460f-987a-f7b503f0d1d2",
    "86dd1f94-d0df-4064-a036-d083178eee2d", "869dc253-cbb0-4f56-9145-8b6d7e2f1bf4",
    "278fa366-5747-411e-a0c5-1eb4d1489bd3", "9234845d-8b5a-440a-b4e5-bb6a5435578e",
    "0615fb91-2156-4cf8-b08d-4cbfbdd73890", "af5e8d1f-f85c-4b1d-b794-2db52a990d89",
    "cfc443fb-2bf3-4264-a427-876c0683c3c1", "76d4138a-bf93-4674-8b21-49fb25241629",
]
ids_in = ", ".join(repr(d) for d in draft_ids)
print(f"\n\n=== Audit completo dos 32 drafts (todos os emails) ===")
df = q(f"""
SELECT draft_membership_id, email, first_name, team,
       original_status, new_status, created_at
FROM dumps.registration_draft_membership_registration_audit
WHERE draft_membership_id IN ({ids_in})
ORDER BY draft_membership_id, created_at
""")
print(f"Linhas: {len(df)}")
print(f"\nEmails distintos (todos):")
print(df['email'].value_counts().to_string())
print(f"\n=== Linhas por draft_id ===")
print(df.to_string(index=False))
