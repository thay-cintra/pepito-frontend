#!/usr/bin/env python3
"""Sinaliza pareceres favoráveis que hoje coexistem com achado alto real.

O alerta não conclui que a decisão esteja errada nem que o achado surgiu depois
do parecer. Ele apenas encaminha o caso para revisão humana, pois os findings
não possuem timestamp individual que permita provar a ordem dos eventos.
"""

import argparse
import csv
import json
import os
import re
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MEDIA = ROOT / "src" / "data" / "media-findings.json"
DEFAULT_LIDERANCA = ROOT / "src" / "data" / "pareceres-lideranca.json"
DEFAULT_SUGESTAO = ROOT / "src" / "data" / "pareceres-sugestao.json"
DEFAULT_OUTPUT = ROOT / ".tools" / "pareceres-potencialmente-desatualizados.csv"
HEADERS = [
    "draft_id",
    "bucket",
    "decisao_registrada",
    "quantos_achados_alto",
    "resumo_achado_mais_grave",
    "generated_at_parecer",
]


def _load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: esperado objeto JSON na raiz")
    return data


def _normalize_decision(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "aprovado": "aprovado",
        "aprovacao": "aprovado",
        "aprovação": "aprovado",
        "falso_positivo": "falso_positivo",
    }
    return aliases.get(normalized)


def _decision_from_suggestion(text: object) -> str | None:
    """Replica de forma conservadora a leitura da frase final usada na UI."""
    if not isinstance(text, str) or not text.strip():
        return None
    sentences = [part for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part]
    final = (sentences[-1] if sentences else text).upper()
    if "FALSO POSITIVO" in final:
        return "falso_positivo"
    if re.search(r"N[ÃA]O\s+APROVA|REPROVA|N[ÃA]O\s+TEMOS\s+OBJE.*REPROVA|RECUSA", final):
        return None
    if re.search(r"MONITORAMENTO\s+REFOR", final):
        return None
    if "APROVA" in final or re.search(r"N[ÃA]O\s+TEMOS\s+OBJE|SEM\s+OBJE[ÇC][ÃA]O", final):
        return "aprovado"
    return None


def _high_positive_findings(media: dict, draft_id: str) -> list[dict]:
    findings = media.get(draft_id, [])
    if not isinstance(findings, list):
        return []
    return [
        finding
        for finding in findings
        if isinstance(finding, dict)
        and str(finding.get("risk_indicator", "")).lower() == "alto"
        and finding.get("achado_positivo") is True
    ]


def _finding_summary(finding: dict, limit: int = 500) -> str:
    title = str(finding.get("title") or finding.get("source") or "Achado alto sem título").strip()
    snippet = " ".join(str(finding.get("snippet") or "").split())
    summary = f"{title} — {snippet}" if snippet else title
    return summary if len(summary) <= limit else summary[: limit - 1].rstrip() + "…"


def detect_alerts(media: dict, lideranca: dict, sugestao: dict) -> list[dict[str, object]]:
    alerts: list[dict[str, object]] = []
    sources = (
        ("CHECK_ANALISTA", sugestao, lambda entry: _decision_from_suggestion(entry.get("text"))),
        ("CHECK_LIDERANCA", lideranca, lambda entry: _normalize_decision(entry.get("decisao"))),
    )
    for bucket, opinions, decision_reader in sources:
        for draft_id, entry in opinions.items():
            if draft_id == "_meta" or not isinstance(entry, dict):
                continue
            decision = decision_reader(entry)
            if decision not in {"aprovado", "falso_positivo"}:
                continue
            high_findings = _high_positive_findings(media, draft_id)
            if not high_findings:
                continue
            alerts.append({
                "draft_id": draft_id,
                "bucket": bucket,
                "decisao_registrada": decision,
                "quantos_achados_alto": len(high_findings),
                "resumo_achado_mais_grave": _finding_summary(high_findings[0]),
                "generated_at_parecer": entry.get("generated_at", ""),
            })
    return sorted(alerts, key=lambda row: (str(row["draft_id"]), str(row["bucket"])))


def _write_csv_atomic(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=HEADERS)
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-findings", type=Path, default=DEFAULT_MEDIA)
    parser.add_argument("--pareceres-lideranca", type=Path, default=DEFAULT_LIDERANCA)
    parser.add_argument("--pareceres-sugestao", type=Path, default=DEFAULT_SUGESTAO)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    rows = detect_alerts(
        _load_json(args.media_findings),
        _load_json(args.pareceres_lideranca),
        _load_json(args.pareceres_sugestao),
    )
    _write_csv_atomic(args.output, rows)
    print(f"{len(rows)} alerta(s) gravado(s) em {args.output}")


if __name__ == "__main__":
    main()
