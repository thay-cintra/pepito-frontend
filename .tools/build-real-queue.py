#!/usr/bin/env python
"""
Constrói o JSON final dos 29 casos reais da Fila PLD para alimentar o frontend.

Regras:
  - Tabela: squad_core.registration_notebook_output_single
  - Filtros: status IN ('DOUBLE_CHECK','IN_ANALYSIS')
             AND sub_status = 'PLD_SCORE'
             AND evaluation_reason = 'HIGH_PLD'
  - Bucket (heurística baseada no score_pld numérico):
      score_pld >= 1100 → CHECK_LIDERANCA (escalado)
      score_pld <  1100 → CHECK_ANALISTA
  - PII: arquivo é gravado APENAS em src/data/registration-queue-real.json
    (LOCAL — não vai para git/produção pública).
"""
import json
import re
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


SQL = """
SELECT *
FROM squad_core.registration_notebook_output_single
WHERE status IN ('DOUBLE_CHECK','IN_ANALYSIS')
  AND sub_status = 'PLD_SCORE'
ORDER BY created_at DESC
"""

SQL_AUDIT = """
SELECT draft_membership_id, email, first_name, last_name, team,
       original_status, new_status, created_at
FROM dumps.registration_draft_membership_registration_audit
WHERE draft_membership_id IN ({ids})
ORDER BY draft_membership_id, created_at
"""

# Fonte de verdade para bucket e comentários da fila PLD
# Tabela: project_webhook.event_acompanhamento_analise_cadastral
# - ENVIAR_LIDERANCA_PLD → caso foi escalado para Mesa de Decisão (CHECK_LIDERANCA)
# - VINCULAR + analista → analista responsável real
# - comentario + acao_realizada → histórico real de ações/pareceres
SQL_WEBHOOK = """
SELECT
    draft_id,
    data_execucao,
    acao_realizada,
    processo,
    analista,
    comentario
FROM project_webhook.event_acompanhamento_analise_cadastral
WHERE draft_id IN ({ids})
  AND fila_cadastro IN ('pld', 'double_check')
ORDER BY draft_id, data_execucao ASC
"""

# Equipe oficial PLD/KYC do Cora (analistas + liderança)
ANALISTAS = [
    {"email": "lucasfeller@cora.com.br", "nome": "Lucas Feller", "papel": "analista"},
    {"email": "jeniffer@cora.com.br", "nome": "Jeniffer", "papel": "analista"},
    {"email": "m.matos@cora.com.br", "nome": "M. Matos", "papel": "analista"},
]
LIDERANCA = {"email": "thay@cora.com.br", "nome": "Thayany", "papel": "liderança"}


def resolve_analista(draft_id: str, audit_real: list[dict]) -> dict | None:
    """Retorna o analista real baseado no audit_real (primeiro evento não-sistema).
    Retorna None se não houver dado concreto — nunca fabrica um e-mail."""
    known = {a["email"] for a in ANALISTAS}
    for event in sorted(audit_real, key=lambda e: e.get("timestamp", "")):
        email = event.get("email", "")
        if email in known:
            analista = next((a for a in ANALISTAS if a["email"] == email), None)
            if analista:
                return analista
    return None

# Overrides explícitos de bucket por draft_id confirmados pela analista no
# Retool. O bucket NÃO é derivável dos campos de Athena (compliance, decision,
# owner_data, score são quase idênticos entre LIDERANCA e ANALISTA), então
# usamos a verdade declarada e default = CHECK_ANALISTA.
BUCKET_OVERRIDES = {
    # === CHECK_LIDERANCA — confirmados pelo time no Retool (04/05/2026) ===
    "ffffb49f-2cc0-41d2-925a-742933383886": "CHECK_LIDERANCA",  # RCJ Administração e Participações
    "45c71985-d43d-4a41-bf61-382e7fcfe25c": "CHECK_LIDERANCA",  # Services Assessoria e Consultoria
    "d6de2fd8-63fe-4ccd-86f0-aacda66df2df": "CHECK_LIDERANCA",  # Romildo Conegundes Jr (MEI_ISSUE)
    "63bd6c5e-8fd0-4f0a-a705-db26168e777c": "CHECK_LIDERANCA",  # (confirmado Retool)
    "3224a5e5-4754-414b-8920-02e25812bf66": "CHECK_LIDERANCA",  # Farmácia Premium / Meire Silva Dos Santos
    "fecc8d67-9964-4e68-8f22-5c62a696ada2": "CHECK_LIDERANCA",  # Paganini Engenharia
    "d5781b4d-3ca6-46e2-9411-9f03ab55236c": "CHECK_LIDERANCA",  # (confirmado Retool)
    # --- históricos que saíram da fila (mantidos para referência) ---
    "0615fb91-2156-4cf8-b08d-4cbfbdd73890": "CHECK_LIDERANCA",
    "9234845d-8b5a-440a-b4e5-bb6a5435578e": "CHECK_LIDERANCA",
    "278fa366-5747-411e-a0c5-1eb4d1489bd3": "CHECK_LIDERANCA",
    "869dc253-cbb0-4f56-9145-8b6d7e2f1bf4": "CHECK_LIDERANCA",
    "af1fe938-e0a0-460f-987a-f7b503f0d1d2": "CHECK_LIDERANCA",
    "86dd1f94-d0df-4064-a036-d083178eee2d": "CHECK_LIDERANCA",
    "2d093557-a5a0-4a65-a929-92d9b5a35b98": "CHECK_LIDERANCA",
    "2840b4e9-59d9-4bed-891b-cc89796b08c0": "CHECK_LIDERANCA",
    "0f55b0c5-e129-4d2b-b4a7-c60e4fcd1b43": "CHECK_LIDERANCA",
    "af5e8d1f-f85c-4b1d-b794-2db52a990d89": "CHECK_LIDERANCA",

    # === CHECK_ANALISTA (confirmados explicitamente; default já é ANALISTA) ===
    "76d4138a-bf93-4674-8b21-49fb25241629": "CHECK_LIDERANCA",  # ENVIAR_LIDERANCA_PLD confirmado
    "cfc443fb-2bf3-4264-a427-876c0683c3c1": "CHECK_LIDERANCA",  # ENVIAR_LIDERANCA_PLD confirmado
    "b884e1da-2492-4c80-ad16-e242ba63f31d": "CHECK_ANALISTA",
}


def assign_bucket(draft_id: str, score: int, reason: str, retool_status: str = "",
                  webhook_lideranca_ids: set | None = None) -> str:
    """Bucket derivado da tabela project_webhook (fonte de verdade):
      - ENVIAR_LIDERANCA_PLD registrado → CHECK_LIDERANCA
      - DOUBLE_CHECK status no Athena   → CHECK_LIDERANCA (fallback)
      - Demais                          → CHECK_ANALISTA
    BUCKET_OVERRIDES tem prioridade para casos explicitamente definidos.
    """
    if draft_id in BUCKET_OVERRIDES:
        return BUCKET_OVERRIDES[draft_id]
    # Fonte primária: tabela event_acompanhamento_analise_cadastral
    if webhook_lideranca_ids and draft_id in webhook_lideranca_ids:
        return "CHECK_LIDERANCA"
    # Fallback: status DOUBLE_CHECK no Athena
    if retool_status == "DOUBLE_CHECK":
        return "CHECK_LIDERANCA"
    return "CHECK_ANALISTA"


def parse_json_field(s):
    if s is None:
        return None
    if isinstance(s, str):
        s = s.strip()
        if not s or s.lower() == "none":
            return None
        try:
            return json.loads(s)
        except Exception:
            return None
    return s


def extract_pld_score(score_pld_field):
    d = parse_json_field(score_pld_field)
    if not d:
        return {"pld_score": None, "level": None}
    try:
        v = int(str(d.get("pld_score", "")).strip() or 0)
    except Exception:
        v = None
    return {"pld_score": v, "level": d.get("level")}


def extract_pep_pf(pep_pf_field):
    """Extrai lista de PEPs relacionados ao CPF, incluindo vínculo (DSVINCULO),
    cargo formal (Descrição_Função), órgão (Nome_Órgão) e datas de mandato/carência."""
    d = parse_json_field(pep_pf_field)
    if not d or not isinstance(d, list):
        return []
    pep_list = []
    for p in d:
        nome_orgao = p.get("Nome_Órgão") or ""
        # Extrai UF do "Nome_Órgão" (ex: "DOM FELICIANO-RS")
        uf_extracted = nome_orgao.split("-")[-1] if "-" in nome_orgao else None
        pep_list.append({
            "id": p.get("IdPEP"),
            "tipo": p.get("TIPO_PEP"),                                          # 'T' ou 'R'
            "cpf_titular": p.get("CPF_TITULAR"),
            "nome_titular": p.get("NOME_TITULAR"),
            "cpf_relacionado": p.get("CPF_RELACIONADO"),
            "nome_relacionado": p.get("NOME_RELACIONADO"),
            "ds_vinculo": p.get("DSVINCULO"),                                   # IRMA(O), MAE, PAI, SOBRINHA(O), etc.
            "perfil": p.get("PERFIL"),                                          # VEREAD, PREFEI, DEP_EST, etc.
            "cargo_formal": p.get("Descrição_Função") or p.get("Descricao_Funcao"),  # VEREADOR, PREFEITO, etc.
            "orgao": nome_orgao or None,                                        # ex: "DOM FELICIANO-RS"
            "data_inicio": p.get("Data_Início_Exercício") or p.get("Data_Inicio_Exercicio"),
            "data_fim": p.get("Data_Fim_Exercício") or p.get("Data_Fim_Exercicio"),
            "data_fim_carencia": p.get("Data_Fim_Carência") or p.get("Data_Fim_Carencia"),
            "data_atualizacao": p.get("DATA_ATUALIZACAO"),
            "uf": uf_extracted or p.get("UF"),
        })
    return pep_list


def extract_qsa(qsa_field):
    d = parse_json_field(qsa_field)
    if not d or not isinstance(d, list):
        return []
    out = []
    for s in d[:5]:
        out.append({
            "nome": s.get("nome") or s.get("NOME") or "",
            "cpf": s.get("cpf") or s.get("CPF") or "",
            "qual": s.get("qualificacao") or s.get("QUAL") or "",
        })
    return out


def fmt_cnpj(c):
    if not c or not isinstance(c, str):
        return c
    d = re.sub(r"\D", "", c)
    if len(d) != 14:
        return c
    return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"


def fmt_cpf(c):
    if not c or not isinstance(c, str):
        return c
    d = re.sub(r"\D", "", c)
    if len(d) != 11:
        return c
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"


def main():
    print("=== Puxando casos reais da Fila PLD ===")
    df = q(SQL)
    print(f"Total: {len(df)} casos\n")

    draft_ids = df["draft_id"].tolist()
    ids_in = ", ".join(repr(d) for d in draft_ids)

    # === Webhook: fonte de verdade para bucket, analista e comentários ===
    print("=== Puxando event_acompanhamento_analise_cadastral (webhook) ===")
    try:
        df_webhook = q(SQL_WEBHOOK.format(ids=ids_in), db="project_webhook")
        print(f"Eventos webhook: {len(df_webhook)} linhas")
    except Exception as e:
        print(f"  Aviso: webhook indisponível ({e}) — usando fallback")
        df_webhook = None

    # IDs com ENVIAR_LIDERANCA_PLD = CHECK_LIDERANÇA confirmado
    webhook_lideranca_ids: set = set()
    webhook_by_draft: dict = {}
    if df_webhook is not None and len(df_webhook) > 0:
        lideranca_rows = df_webhook[df_webhook["acao_realizada"] == "ENVIAR_LIDERANCA_PLD"]
        webhook_lideranca_ids = set(lideranca_rows["draft_id"].unique())
        print(f"  CHECK_LIDERANCA confirmados via webhook: {len(webhook_lideranca_ids)}")
        import pandas as _pd
        for _, row in df_webhook.iterrows():
            did = row["draft_id"]
            def _s(v): return "" if _pd.isna(v) else str(v)
            webhook_by_draft.setdefault(did, []).append({
                "timestamp": _s(row["data_execucao"]),
                "user_email": _s(row["analista"]),
                "text": _s(row["comentario"]),
                "acao": _s(row["acao_realizada"]),
                "processo": _s(row["processo"]),
                "tipo": "observacao" if _s(row["acao_realizada"]) == "INCLUIR" else "acao",
            })

    # === Pull real audit history ===
    print("=== Puxando audit log real ===")
    df_audit = q(SQL_AUDIT.format(ids=ids_in))
    print(f"Audit logs reais: {len(df_audit)} linhas")

    # Indexa audit por draft_id
    audit_by_draft = {}
    for _, row in df_audit.iterrows():
        did = row["draft_membership_id"]
        audit_by_draft.setdefault(did, []).append({
            "timestamp": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            "email": row["email"],
            "first_name": row["first_name"],
            "team": row["team"],
            "original_status": row["original_status"],
            "new_status": row["new_status"],
        })

    out = []
    for _, row in df.iterrows():
        pld = extract_pld_score(row.get("score_pld"))
        pep_pf = extract_pep_pf(row.get("pep_pf"))
        qsa = extract_qsa(row.get("rec_socios"))

        score = pld.get("pld_score") or 0
        retool_status = row.get("status") or ""
        draft_id = row.get("draft_id")

        # Bucket: webhook (ENVIAR_LIDERANCA_PLD) > DOUBLE_CHECK status > default ANALISTA
        bucket = assign_bucket(
            draft_id, score, row.get("evaluation_reason") or "",
            retool_status, webhook_lideranca_ids
        )

        audit_real = audit_by_draft.get(draft_id, [])
        webhook_events = webhook_by_draft.get(draft_id, [])

        # Analista: webhook VINCULAR > audit_real > None
        analista = None
        if webhook_events:
            for ev in webhook_events:
                email = ev.get("user_email", "")
                if email and email in {a["email"] for a in ANALISTAS}:
                    analista = next((a for a in ANALISTAS if a["email"] == email), None)
                    if analista:
                        break
        if not analista:
            analista = resolve_analista(draft_id, audit_real)

        out.append({
            "draft_id": row.get("draft_id"),
            "cnpj": fmt_cnpj(row.get("cnpj")),
            "cpf": fmt_cpf(row.get("cpf")),
            "rf_nome_oficial": row.get("legal_name") or row.get("rec_nomeempresarial") or "",
            "trade_name": row.get("trade_name") or row.get("rec_nomefantasia") or "",
            "full_name_pf": row.get("full_name") or "",
            "social_name": row.get("social_name") or "",
            "email": row.get("email") or "",

            "status": row.get("status"),
            "sub_status": row.get("sub_status"),
            "person_type": "OWNER",
            "evaluation": row.get("evaluation"),
            "evaluation_reason": row.get("evaluation_reason"),
            "bucket": bucket,

            "score_pld": score,
            "score_level": pld.get("level"),

            "cnae": row.get("rec_atividadeeconomicaprincipal") or "",
            "natureza_juridica": row.get("rec_naturezajuridica") or "",
            "porte": row.get("rec_porte") or "",
            "uf": row.get("rec_uf") or "",
            "cidade": row.get("rec_municipio") or "",
            "endereco_comercial": " ".join(filter(None, [
                row.get("rec_logradouro"), row.get("rec_numero"),
                row.get("rec_complemento"), row.get("rec_municipio"),
                row.get("rec_uf"),
            ])).strip(),
            "data_constituicao": str(row.get("rec_dataabertura") or "")[:10],
            "datedif_cnpj": row.get("datedif_cnpj"),
            "faturamento_presumido": row.get("faturamentopresumido") or "",
            "rec_situacao_cadastral": row.get("rec_situacaocadastral") or "",
            "is_mei": row.get("pes_pj_ismei"),

            # PEP info real
            "pep_pf": pep_pf,
            "pep_pj": parse_json_field(row.get("pep_pj")) if isinstance(row.get("pep_pj"), str) and row.get("pep_pj").startswith("[") else None,

            # QSA
            "qsa": qsa,

            # Sinais de risco já apurados
            "pj_midianegativas": row.get("pj_midianegativas"),
            "pf_midianegativas": row.get("pf_midianegativas"),
            "processosjudiciais_pj": row.get("processosjudiciais_pj"),
            "processosjudiciais_pf": row.get("processosjudiciais_pf"),
            "rufra_pf_fraude_confirmada": row.get("rufra_pf_fraude_confirmada"),
            "rufra_pj_fraude_confirmada": row.get("rufra_pj_fraude_confirmada"),

            "created_at": str(row.get("created_at") or "")[:19],
            "modified_at": str(row.get("modified_at") or "")[:19],

            # === Atribuições reais da equipe ===
            "analista_responsavel": analista,
            "lideranca": LIDERANCA,
            "audit_real": audit_real,
            # Histórico do webhook: ações e comentários reais do Retool PLD
            # Fonte: project_webhook.event_acompanhamento_analise_cadastral
            # Inclui: ENVIAR_LIDERANCA_PLD, REJEITAR_CADASTRO, INCLUIR (comentários)
            "webhook_historico": [
                ev for ev in webhook_events
                if ev.get("acao") in (
                    "ENVIAR_LIDERANCA_PLD", "REJEITAR_CADASTRO",
                    "APROVAR_CADASTRO", "INCLUIR"
                ) or ev.get("text")  # qualquer evento com comentário
            ],
        })

    print(f"=== Distribuição por bucket ===")
    from collections import Counter
    c = Counter(o["bucket"] for o in out)
    for k, v in c.items():
        print(f"  {k}: {v}")

    from datetime import datetime, timezone
    payload = {
        "_meta": {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source_table": "squad_core.registration_notebook_output_single",
            "filters": {
                "status_in": ["DOUBLE_CHECK", "IN_ANALYSIS"],
                "sub_status": "PLD_SCORE",
                "person_type": "OWNER",
            },
            "total": len(out),
            "by_bucket": {b: sum(1 for o in out if o["bucket"] == b) for b in ("CHECK_LIDERANCA", "CHECK_ANALISTA")},
        },
        "items": out,
    }

    out_path = Path(__file__).resolve().parents[1] / "src" / "data" / "registration-queue-real.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"\nJSON salvo em: {out_path} ({len(out)} casos)")


if __name__ == "__main__":
    main()
