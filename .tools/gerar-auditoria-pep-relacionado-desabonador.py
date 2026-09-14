#!/usr/bin/env python3
"""Gera auditorias locais dos 281 PEPs relacionados consultados na Credilink."""

import csv
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LEDGER_PATH = ROOT / "src" / "data" / "credilink-pep-consultas.json"
PENDING_PATH = ROOT / ".tools" / "pep_relacionado_pendente_281.json"
DECISIONS_PATH = ROOT / ".tools" / "decididos_pep_abril2026.json"
ADVERSE_OUT = ROOT / ".tools" / "auditoria-pep-relacionado-DESABONADOR.csv"
DECISIONS_OUT = ROOT / ".tools" / "auditoria-pep-relacionado-DECISOES-CRUZADAS.csv"

ADVERSE_FIELDS = (
    "antecedentesCriminais",
    "mandadosPrisao",
    "processosJudiciais",
    "midiaNegativas",
    "midiasAdversas",
    "cnepEmpresasPunidas",
    "ceisEmpresasInidoneasSuspensas",
    "sancoesAdministrativasBACEN",
    "trabalhoEscravo",
    "csnu",
    "interpol",
    "fbi",
    "ofac",
    "onu",
    "uk",
    "eu",
    "score",
    "isPossivelAssociacaoCompulsao",
    "historicoInadimplencia",
    "dividasAtivas",
)

BENIGN_TEXT_MARKERS = (
    "nenhum",
    "nao encontrad",
    "nao foi encontrad",
    "nao foram encontrad",
    "nao existem",
    "nao foram localizad",
    "nao foi localizad",
    "registro nao encontrad",
    "consulta nao elegivel",
    "nao foi possivel encontrar sancoes",
)

PASSIVE_PROCESS_ROLES = (
    "REU",
    "RECLAMADO",
    "EXECUTADO",
    "INVESTIGADO",
    "DENUNCIADO",
    "ACUSADO",
    "INDICIADO",
    "REQUERIDO",
)

ADVERSE_COLUMNS = (
    "draft_id",
    "nome_pep",
    "cpf_pep",
    "campo_desabonador",
    "resumo",
)

DECISION_COLUMNS = (
    "draft_id",
    "nome_pep",
    "cpf_pep",
    "campos_desabonadores",
    "resumo_achados",
    "current_status",
    "approved_at",
    "approved_at_preenchido",
    "rejected_at",
    "finalized_at",
)


def _nonempty(value: Any) -> bool:
    return value not in (None, "", False, 0, [], {})


def _normalize_text(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()


def _contains_error(value: Any) -> bool:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key.startswith("erro_") and _nonempty(nested):
                return True
            if _contains_error(nested):
                return True
    elif isinstance(value, list):
        return any(_contains_error(item) for item in value)
    return False


def _adverse_value(field: str, value: Any) -> Any:
    """Retorna apenas a parcela efetivamente desabonadora, ou None."""
    if field == "score":
        return value if isinstance(value, dict) and str(value.get("Descricao", "")).upper() in {
            "ALTO",
            "ALTISSIMO",
        } else None
    if field == "midiaNegativas" and isinstance(value, dict):
        sentimento = (value.get("resumo") or {}).get("sentimento") or {}
        try:
            negativos = float(sentimento.get("negativo") or 0)
        except (TypeError, ValueError):
            negativos = 0
        return value if negativos > 0 and _nonempty(value.get("noticias")) else None
    if field == "processosJudiciais" and isinstance(value, list):
        passive = []
        for process in value:
            if not isinstance(process, dict):
                continue
            roles = _normalize_text(str(process.get("Partes") or "")).upper()
            if any(role in roles for role in PASSIVE_PROCESS_ROLES):
                passive.append(process)
        return passive or None
    if isinstance(value, str):
        normalized = _normalize_text(value)
        return value if bool(value.strip()) and not any(
            marker in normalized for marker in BENIGN_TEXT_MARKERS
        ) else None
    return value if _nonempty(value) else None


def _compact_json(value: Any, limit: int = 700) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _summarize(field: str, value: Any) -> str:
    if field == "score" and isinstance(value, dict):
        return f"Descrição={value.get('Descricao')}; número={value.get('Numero')}"

    if field == "midiaNegativas" and isinstance(value, dict):
        resumo = value.get("resumo") or {}
        consulta = value.get("consulta") or {}
        noticias = value.get("noticias") or []
        titulos = [str(n.get("titulo", "")) for n in noticias[:3] if isinstance(n, dict)]
        return (
            f"totais={_compact_json(resumo.get('totais', {}), 220)}; "
            f"sentimento={_compact_json(resumo.get('sentimento', {}), 180)}; "
            f"risco_homonimo={_compact_json(consulta.get('risco_homonimo', {}), 180)}; "
            f"títulos={'; '.join(titulos) or 'não informados'}"
        )[:1000]

    if isinstance(value, list):
        return f"{len(value)} registro(s); amostra={_compact_json(value[:3])}"
    if isinstance(value, dict):
        return _compact_json(value)
    return re.sub(r"\s+", " ", str(value)).strip()[:1000]


def build_adverse_rows(ledger: dict, pending: dict) -> tuple[list[dict], list[str]]:
    rows = []
    ignored_errors = []

    for cpf, pending_entry in pending.items():
        ledger_entry = ledger.get(cpf)
        if not isinstance(ledger_entry, dict):
            raise ValueError(f"CPF {cpf} ausente do ledger Credilink")
        if _contains_error(ledger_entry):
            ignored_errors.append(cpf)
            continue

        compliance = ledger_entry.get("compliance")
        result = compliance.get("result") if isinstance(compliance, dict) else None
        if not isinstance(result, dict):
            raise ValueError(f"CPF {cpf} sem compliance.result válido")

        nome = ledger_entry.get("nome") or pending_entry.get("nome") or ""
        drafts = sorted(set(pending_entry.get("drafts") or []))
        for field in ADVERSE_FIELDS:
            value = _adverse_value(field, result.get(field))
            if value is None:
                continue
            resumo = _summarize(field, value)
            for draft_id in drafts:
                rows.append(
                    {
                        "draft_id": draft_id,
                        "nome_pep": nome,
                        "cpf_pep": cpf,
                        "campo_desabonador": field,
                        "resumo": resumo,
                    }
                )

    rows.sort(key=lambda row: (row["nome_pep"], row["cpf_pep"], row["draft_id"], row["campo_desabonador"]))
    return rows, sorted(ignored_errors)


def validate_decisions(decisions: list[dict], expected_count: int | None = None) -> dict[str, dict]:
    if expected_count is not None and len(decisions) != expected_count:
        raise ValueError(
            f"Decisões esperadas: {expected_count}; encontradas: {len(decisions)}"
        )
    decisions_by_draft = {}
    for row in decisions:
        draft_id = row.get("draft_id")
        if not draft_id:
            raise ValueError("Decisão sem draft_id")
        if draft_id in decisions_by_draft:
            raise ValueError(f"draft_id duplicado nas decisões: {draft_id}")
        decisions_by_draft[draft_id] = row
    return decisions_by_draft


def build_decision_rows(adverse_rows: list[dict], decisions: list[dict]) -> list[dict]:
    decisions_by_draft = validate_decisions(decisions)
    grouped = defaultdict(list)
    for row in adverse_rows:
        grouped[(row["draft_id"], row["nome_pep"], row["cpf_pep"])].append(row)

    crossed = []
    for (draft_id, nome, cpf), findings in grouped.items():
        decision = decisions_by_draft.get(draft_id)
        if not decision:
            raise ValueError(f"draft_id {draft_id} sem decisão correspondente")
        fields = sorted({finding["campo_desabonador"] for finding in findings})
        summaries = [
            f"{finding['campo_desabonador']}: {finding['resumo']}"
            for finding in sorted(findings, key=lambda item: item["campo_desabonador"])
        ]
        approved_at = decision.get("approved_at") or ""
        crossed.append(
            {
                "draft_id": draft_id,
                "nome_pep": nome,
                "cpf_pep": cpf,
                "campos_desabonadores": "; ".join(fields),
                "resumo_achados": " | ".join(summaries),
                "current_status": decision.get("current_status") or "",
                "approved_at": approved_at,
                "approved_at_preenchido": "SIM" if approved_at else "NÃO",
                "rejected_at": decision.get("rejected_at") or "",
                "finalized_at": decision.get("finalized_at") or "",
            }
        )

    crossed.sort(key=lambda row: (row["nome_pep"], row["cpf_pep"], row["draft_id"]))
    return crossed


def _write_csv(path: Path, columns: tuple[str, ...], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    ledger = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
    pending = json.loads(PENDING_PATH.read_text(encoding="utf-8"))
    decisions = json.loads(DECISIONS_PATH.read_text(encoding="utf-8"))
    if len(pending) != 281:
        raise ValueError(f"Escopo esperado: 281 CPFs; encontrado: {len(pending)}")
    validate_decisions(decisions, expected_count=436)

    adverse_rows, ignored_errors = build_adverse_rows(ledger, pending)
    decision_rows = build_decision_rows(adverse_rows, decisions)
    _write_csv(ADVERSE_OUT, ADVERSE_COLUMNS, adverse_rows)
    _write_csv(DECISIONS_OUT, DECISION_COLUMNS, decision_rows)

    unique_peps = len({row["cpf_pep"] for row in adverse_rows})
    approved = sum(row["approved_at_preenchido"] == "SIM" for row in decision_rows)
    print(f"PEPs desabonadores: {unique_peps}")
    print(f"Linhas de achados: {len(adverse_rows)}")
    print(f"Decisões cruzadas: {len(decision_rows)}; approved_at preenchido: {approved}")
    print(f"Entradas ignoradas por erro_*: {len(ignored_errors)}")
    if ignored_errors:
        print(f"CPFs ignorados por erro_*: {', '.join(ignored_errors)}")


if __name__ == "__main__":
    main()
