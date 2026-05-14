#!/usr/bin/env python
"""
Constrói o histórico COMPLETO de análises PEP/PLD da Cora a partir do Athena.

Universo: todo draft_membership_id que em algum momento teve sub_status='PLD_SCORE'
no histórico de status do registration. São os cadastros que de fato passaram
pela fila de análise PLD/PEP.

Para cada draft, captura o estado FINAL (latest row em registration_status):
  - FINALIZED              → status_pepito = "aprovado"
  - REJECTED               → status_pepito = "reprovado"  (motivo = sub_status no momento da rejeição)
  - WAITING_EMAIL_RESPONSE → status_pepito = "aguardando_cliente"  (saiu da fila PLD; aguarda cliente)
  - IN_ANALYSIS / IN_PROCESS → status_pepito = "em_andamento"      (efetivamente na fila PLD)

Saída: src/data/pep-history.json
  {
    "_meta": {fetched_at, total, by_status: {...}, by_motivo: {...}},
    "items": [
      {draft_membership_id, status_pepito, motivo, motivo_label,
       created_at, decision_at}
    ]
  }
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from coralago.lake import Lake
import awswrangler as wr

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "src" / "data" / "pep-history.json"

lake = Lake()


def q(sql: str, db: str = "dumps"):
    return wr.athena.read_sql_query(
        sql=sql, database=db,
        s3_output=lake.s3_staging_dir,
        boto3_session=lake._session_boto3,
        workgroup=lake.workgroup,
        ctas_approach=False,
    )


# Mapeia sub_status técnico para descrição em PT-BR
MOTIVO_LABEL = {
    # Rejeições
    "PLD_SCORE": "Score PLD elevado",
    "COMPLIANCE_PLD_SCORE": "Score PLD elevado (compliance)",
    "COMPLIANCE": "Análise de compliance reprovada",
    "COMPLIANCE_HAS_DICT_CONFIRMED_REPORT": "Mídia adversa confirmada (DICT)",
    "COMPLIANCE_HAS_RUFRA_CONFIRMED_REPORT": "Fraude confirmada (RUFRA)",
    "COMPLIANCE_SUS_NAME_FAIL": "Nome em lista suspeita",
    "COMPLIANCE_BACEN_PROTEGE_OWNER": "Bacen Protege — owner",
    "COMPLIANCE_DATA_CHECK_PASS": "Falha em verificação de dados",
    "COMPLIANCE_PJ_STATUS": "Status PJ inválido",
    "COMPLIANCE_CNAE_ALLOWED": "CNAE não permitido",
    "COMPLIANCE_NAT_JUD_ALLOWED": "Natureza jurídica não permitida",
    "COMPLIANCE_HAS_TOO_MANY_ACCOUNTS": "Excesso de contas",
    "CNPJ_INAPT": "CNPJ inapto",
    "CNPJ_CLOSED": "CNPJ encerrado",
    "CNPJ_INACTIVE": "CNPJ inativo",
    "CNPJ_NOT_EXISTS": "CNPJ inexistente",
    "CNPJ_ALREADY_REGISTERED": "CNPJ já cadastrado",
    "CPF_ALREADY_REGISTERED": "CPF já cadastrado",
    "CPF_IRREGULAR": "CPF irregular",
    "NOT_IN_QSA": "PEP/sócio fora do QSA",
    "FACEMATCH_FAILED": "Facematch falhou",
    "FAKE_DATA": "Dados falsos",
    "FAKE_NAME": "Nome falso",
    "INVALID_DOCS": "Documentos inválidos",
    "MISSING_DOCS": "Documentos faltantes",
    "ILEGIBLE_PHOTO": "Foto ilegível",
    "UNDER_AGE": "Menor de idade",
    "REQUESTED_BY_CUSTOMER": "Solicitado pelo cliente",
    "QSA_EVIDENCE_DOCS": "Documentos de evidência QSA",
    "REJECTED_LEGACY": "Rejeição (legado)",
    "LEILAO": "Leilão",
    # Aprovações / em andamento
    "BACEN_PROTEGE_OK": "Bacen Protege — aprovado",
    "PENDING_DOCS": "Documentos pendentes",
    "READABLE_DOCS": "Aguardando leitura de documentos",
    "MEI_ISSUE": "Inconsistência MEI",
    "SUS_NAME": "Nome suspeito",
    "HAS_QSA": "Possui QSA",
}


def motivo_label(sub_status: str | None) -> str:
    if not sub_status:
        return ""
    return MOTIVO_LABEL.get(sub_status, sub_status.replace("_", " ").title())


# Universo: drafts que passaram pela fila PLD em algum momento (sub_status='PLD_SCORE').
# Casos via COMPLIANCE_PLD_SCORE ou COMPLIANCE_BACEN/NOT_IN_QSA são importados
# separadamente da planilha de controle (Google Sheets) — ver fetch-pep-planilha.py.
SQL_UNIVERSE = """
WITH pld_universe AS (
  SELECT DISTINCT draft_membership_id
  FROM dumps.registration_draft_membership_registration_status
  WHERE sub_status='PLD_SCORE'
),
latest AS (
  SELECT draft_membership_id, status, sub_status, created_at,
         ROW_NUMBER() OVER (PARTITION BY draft_membership_id ORDER BY created_at DESC) AS rn
  FROM dumps.registration_draft_membership_registration_status
),
first_pld AS (
  SELECT draft_membership_id, MIN(created_at) AS first_pld_at
  FROM dumps.registration_draft_membership_registration_status
  WHERE sub_status='PLD_SCORE'
  GROUP BY draft_membership_id
)
SELECT
  u.draft_membership_id,
  l.status        AS final_status,
  l.sub_status    AS final_sub_status,
  l.created_at    AS decision_at,
  fp.first_pld_at AS pld_entered_at
FROM pld_universe u
JOIN latest l ON l.draft_membership_id = u.draft_membership_id AND l.rn = 1
JOIN first_pld fp ON fp.draft_membership_id = u.draft_membership_id
ORDER BY l.created_at DESC
"""


# pep_pf JSON por draft (latest snapshot em registration_notebook_output).
# Usamos LEFT JOIN porque drafts antigos podem ter sido podados desta tabela.
SQL_PEP_PF = """
WITH latest_nb AS (
  SELECT draft_id, pep_pf,
         ROW_NUMBER() OVER (PARTITION BY draft_id ORDER BY created_at DESC) AS rn
  FROM squad_core.registration_notebook_output
)
SELECT draft_id, pep_pf
FROM latest_nb
WHERE rn = 1
"""


def parse_pep_pf(raw):
    """Recebe o JSON-string de pep_pf da Credilink e retorna (tipo_pep, ds_vinculo).
    Regra: se houver qualquer registro TIPO_PEP='T' o draft é classificado 'titular',
    senão 'relacionado'. ds_vinculo só faz sentido em RELACIONADO; pegamos o
    DSVINCULO mais frequente entre os relacionamentos."""
    if raw is None:
        return None, None
    s = raw if not isinstance(raw, str) else raw.strip()
    if not s or s == "None" or s == "null":
        return None, None
    try:
        data = s if isinstance(s, list) else json.loads(s)
    except Exception:
        return None, None
    if not isinstance(data, list) or not data:
        return None, None

    tipos = [str(p.get("TIPO_PEP") or "").upper() for p in data]
    is_titular = any(t == "T" for t in tipos)
    tipo_pep = "titular" if is_titular else "relacionado"

    if tipo_pep == "titular":
        return "titular", None

    vincs = [(p.get("DSVINCULO") or "").strip().upper() for p in data if p.get("DSVINCULO")]
    if not vincs:
        return "relacionado", None
    most_common = Counter(vincs).most_common(1)[0][0]
    return "relacionado", most_common


def map_status_pepito(final_status: str) -> str:
    if final_status == "FINALIZED":
        return "aprovado"
    if final_status == "REJECTED":
        return "reprovado"
    if final_status == "WAITING_EMAIL_RESPONSE":
        return "aguardando_cliente"
    return "em_andamento"


# Sub_status usados quando um caso de PLD é aprovado via rota de compliance
# (falsos positivos reprocessados que saíram da fila com outro caminho)
COMPLIANCE_APPROVED_SUBSTATUS = frozenset({
    "COMPLIANCE_BACEN_PROTEGE_OWNER",
    "COMPLIANCE_BACEN_PROTEGE_PARTNER",
    "NOT_IN_QSA",
})


def main():
    print("=== Puxando histórico PEP/PLD ===")
    df = q(SQL_UNIVERSE)
    print(f"Total drafts no universo PLD: {len(df)}")

    print("=== Puxando pep_pf (latest notebook snapshot) ===")
    df_pep = q(SQL_PEP_PF)
    print(f"Snapshots pep_pf: {len(df_pep)}")
    pep_by_draft: dict[str, tuple[str | None, str | None]] = {}
    for _, r in df_pep.iterrows():
        pep_by_draft[r["draft_id"]] = parse_pep_pf(r["pep_pf"])

    items = []
    for _, r in df.iterrows():
        final_status = r["final_status"] or ""
        sub_status = r["final_sub_status"]
        status_pepito = map_status_pepito(final_status)
        motivo = sub_status if status_pepito == "reprovado" else None
        tipo_pep, ds_vinculo = pep_by_draft.get(r["draft_membership_id"], (None, None))
        items.append({
            "draft_membership_id": r["draft_membership_id"],
            "status_pepito": status_pepito,
            "raw_status": final_status,
            "motivo": motivo,
            "motivo_label": motivo_label(motivo) if motivo else "",
            "tipo_pep": tipo_pep,
            "ds_vinculo": ds_vinculo,
            "decision_at": str(r["decision_at"]) if r["decision_at"] is not None else None,
            "pld_entered_at": str(r["pld_entered_at"]) if r["pld_entered_at"] is not None else None,
        })

    # Estatísticas
    by_status = {}
    by_motivo = {}
    by_tipo_pep = {}
    by_vinculo = {}
    for it in items:
        by_status[it["status_pepito"]] = by_status.get(it["status_pepito"], 0) + 1
        if it["motivo"]:
            by_motivo[it["motivo"]] = by_motivo.get(it["motivo"], 0) + 1
        tp = it["tipo_pep"] or "(desconhecido)"
        by_tipo_pep[tp] = by_tipo_pep.get(tp, 0) + 1
        if it["ds_vinculo"]:
            by_vinculo[it["ds_vinculo"]] = by_vinculo.get(it["ds_vinculo"], 0) + 1

    print(f"  aprovado:           {by_status.get('aprovado', 0)}")
    print(f"  reprovado:          {by_status.get('reprovado', 0)}")
    print(f"  em_andamento:       {by_status.get('em_andamento', 0)}")
    print(f"  aguardando_cliente: {by_status.get('aguardando_cliente', 0)}")
    print()
    print("Top 10 motivos de rejeição:")
    for k, v in sorted(by_motivo.items(), key=lambda x: -x[1])[:10]:
        print(f"  {v:5d}  {k}  ({motivo_label(k)})")
    print()
    print("Distribuição por tipo de PEP:")
    for k, v in sorted(by_tipo_pep.items(), key=lambda x: -x[1]):
        print(f"  {v:5d}  {k}")
    print("Top 10 vínculos (DSVINCULO) entre relacionados:")
    for k, v in sorted(by_vinculo.items(), key=lambda x: -x[1])[:10]:
        print(f"  {v:5d}  {k}")

    payload = {
        "_meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source_table": "dumps.registration_draft_membership_registration_status + squad_core.registration_notebook_output (pep_pf)",
            "universe_filter": "sub_status='PLD_SCORE' (em algum momento da história)",
            "total": len(items),
            "by_status": by_status,
            "by_motivo": by_motivo,
            "by_tipo_pep": by_tipo_pep,
            "by_vinculo": by_vinculo,
        },
        "items": items,
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✓ JSON salvo em {OUT_PATH} ({len(items)} items)")


if __name__ == "__main__":
    main()
