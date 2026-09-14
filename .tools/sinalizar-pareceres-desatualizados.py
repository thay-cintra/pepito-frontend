#!/usr/bin/env python3
"""Insere aviso de revisão em pareceres favoráveis com achado alto real.

O CSV produzido por detectar-parecer-desatualizado.py define exatamente quais
pares (draft_id, bucket) estão autorizados. O script não altera decisão, status,
resumo ou metadados preexistentes do parecer.
"""

import argparse
import csv
import json
import os
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ALERTS = ROOT / ".tools" / "pareceres-potencialmente-desatualizados.csv"
DEFAULT_MEDIA = ROOT / "src" / "data" / "media-findings.json"
DEFAULT_SUGESTAO = ROOT / "src" / "data" / "pareceres-sugestao.json"
DEFAULT_LIDERANCA = ROOT / "src" / "data" / "pareceres-lideranca.json"

MARKER_FIELD = "revisao_manual_2026_09_15"
WARNING_PREFIX = "⚠️ ATENÇÃO — ACHADO DE RISCO ALTO NÃO REFLETIDO NESTE PARECER"
AUTHOR = "thay@cora.com.br + Codex"
REVIEW_DATE = "2026-09-15"


def _load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: esperado objeto JSON na raiz")
    return value


def _load_alerts(path: Path) -> list[tuple[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"draft_id", "bucket"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"{path}: colunas obrigatórias ausentes: {sorted(required)}")
        alerts: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for line_number, row in enumerate(reader, start=2):
            pair = ((row.get("draft_id") or "").strip(), (row.get("bucket") or "").strip())
            if not all(pair):
                raise ValueError(f"{path}:{line_number}: draft_id/bucket vazio")
            if pair in seen:
                raise ValueError(f"{path}:{line_number}: alerta duplicado para {pair}")
            seen.add(pair)
            alerts.append(pair)
    return alerts


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


def _shorten(text: object, limit: int = 150) -> str:
    normalized = " ".join(str(text or "").split())
    return normalized if len(normalized) <= limit else normalized[:limit].rstrip() + "…"


def _findings_summary(findings: list[dict]) -> str:
    summaries = []
    for finding in findings[:2]:
        title = " ".join(str(finding.get("title") or finding.get("source") or "Achado alto sem título").split())
        snippet = _shorten(finding.get("snippet"))
        summaries.append(f"{title} — {snippet}" if snippet else title)
    result = "; ".join(summaries)
    remaining = len(findings) - len(summaries)
    if remaining == 1:
        result += "; + 1 outro achado de risco alto"
    elif remaining > 1:
        result += f"; + {remaining} outros achados de risco alto"
    return result


def _already_flagged(entry: dict) -> bool:
    text = str(entry.get("text") or "").lstrip()
    return MARKER_FIELD in entry or text.startswith("⚠️ ATENÇÃO — ACHADO")


def _prepend_warning(entry: dict, findings: list[dict]) -> None:
    original_text = entry.get("text")
    if not isinstance(original_text, str) or not original_text.strip():
        raise ValueError("parecer sem campo text válido")
    summary = _findings_summary(findings)
    warning = (
        f"{WARNING_PREFIX} ({AUTHOR}, {REVIEW_DATE}): {summary}. "
        "A decisão abaixo foi registrada sem considerar essas informações — "
        "requer revisão humana antes de manter a aprovação."
    )
    entry["text"] = f"{warning}\n\n---\n\n{original_text}"
    entry[MARKER_FIELD] = {
        "motivo": (
            f"Parecer favorável sinalizado por coexistir com {len(findings)} "
            "achado(s) real(is) de risco alto; decisão preservada para revisão humana."
        ),
        "autor": AUTHOR,
    }


def _write_json_atomic(path: Path, value: dict) -> None:
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def apply_alerts(
    alerts: list[tuple[str, str]],
    media: dict,
    sugestao: dict,
    lideranca: dict,
) -> tuple[dict[str, int], dict[str, int]]:
    stores = {
        "CHECK_ANALISTA": sugestao,
        "CHECK_LIDERANCA": lideranca,
    }
    updated = {bucket: 0 for bucket in stores}
    skipped = {bucket: 0 for bucket in stores}

    # Valida o escopo inteiro antes de modificar qualquer objeto em memória.
    validated: list[tuple[str, str, dict, list[dict]]] = []
    for draft_id, bucket in alerts:
        if bucket not in stores:
            raise ValueError(f"bucket desconhecido no CSV: {bucket}")
        entry = stores[bucket].get(draft_id)
        if not isinstance(entry, dict):
            raise ValueError(f"parecer ausente: {bucket}/{draft_id}")
        findings = _high_positive_findings(media, draft_id)
        if not findings:
            raise ValueError(f"nenhum achado alto positivo atual: {bucket}/{draft_id}")
        validated.append((draft_id, bucket, entry, findings))

    for _draft_id, bucket, entry, findings in validated:
        if _already_flagged(entry):
            skipped[bucket] += 1
            continue
        _prepend_warning(entry, findings)
        updated[bucket] += 1
    return updated, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--alerts", type=Path, default=DEFAULT_ALERTS)
    parser.add_argument("--media-findings", type=Path, default=DEFAULT_MEDIA)
    parser.add_argument("--pareceres-sugestao", type=Path, default=DEFAULT_SUGESTAO)
    parser.add_argument("--pareceres-lideranca", type=Path, default=DEFAULT_LIDERANCA)
    args = parser.parse_args()

    alerts = _load_alerts(args.alerts)
    media = _load_json(args.media_findings)
    sugestao = _load_json(args.pareceres_sugestao)
    lideranca = _load_json(args.pareceres_lideranca)
    updated, skipped = apply_alerts(alerts, media, sugestao, lideranca)

    if updated["CHECK_ANALISTA"]:
        _write_json_atomic(args.pareceres_sugestao, sugestao)
    if updated["CHECK_LIDERANCA"]:
        _write_json_atomic(args.pareceres_lideranca, lideranca)

    print(
        "pareceres-sugestao.json: "
        f"{updated['CHECK_ANALISTA']} atualizado(s), {skipped['CHECK_ANALISTA']} pulado(s)"
    )
    print(
        "pareceres-lideranca.json: "
        f"{updated['CHECK_LIDERANCA']} atualizado(s), {skipped['CHECK_LIDERANCA']} pulado(s)"
    )


if __name__ == "__main__":
    main()
