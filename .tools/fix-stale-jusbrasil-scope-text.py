#!/usr/bin/env python3
"""Corrige, sem chamar APIs, a declaração antiga sobre o escopo JusBrasil."""

import argparse
import json
import os
import re
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / "src" / "data" / "media-findings.json"
PENDING_NOTICE = (
    "Cobertura civil/trabalhista deste CPF ainda não foi reconsultada desde a "
    "ampliação de escopo de 2026-09-14 — pendente de nova consulta quando a "
    "cota mensal liberar."
)
STALE_SCOPE_RE = re.compile(
    r"\s*ESCOPO:\s*[^.]*?não cobre processos c[ií]veis\s*/\s*trabalhistas[^.]*\.?",
    flags=re.IGNORECASE,
)


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def fix_payload(payload: dict) -> tuple[int, int]:
    corrected = 0
    draft_ids: set[str] = set()
    for draft_id, findings in payload.items():
        if not isinstance(findings, list):
            continue
        for finding in findings:
            if not isinstance(finding, dict) or not isinstance(finding.get("snippet"), str):
                continue
            snippet = finding["snippet"]
            if not STALE_SCOPE_RE.search(snippet):
                continue
            cleaned = STALE_SCOPE_RE.sub("", snippet).strip()
            cleaned = re.sub(r"\s{2,}", " ", cleaned)
            if cleaned and not cleaned.endswith((".", "!", "?")):
                cleaned += "."
            finding["snippet"] = f"{cleaned} {PENDING_NOTICE}".strip()
            corrected += 1
            draft_ids.add(draft_id)
    return corrected, len(draft_ids)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or args.input

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    corrected, drafts = fix_payload(payload)
    atomic_write_json(output, payload)
    print(f"{corrected} achado(s) corrigido(s) em {drafts} draft_id(s)")


if __name__ == "__main__":
    main()
