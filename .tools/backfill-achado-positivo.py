#!/usr/bin/env python3
"""Preenche `achado_positivo` conservadoramente nos findings históricos."""

import argparse
import json
import os
import re
import tempfile
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / "src" / "data" / "media-findings.json"
NEGATIVE_PATTERNS = (
    r"\bnao retornou\b",
    r"\bnenhum(?:a|as|s)?\b",
    r"\bsem processos?\b",
    r"\bsem mandados?\b",
    r"\bsem (?:midia|midias|achado|achados|adversidade|adversidades|sancao|sancoes)\b",
    r"\bnao identificad[oa]s?\b",
    r"\bnao (?:foi |foram )?encontrad[oa]s?\b",
    r"\bnao encontr(?:ou|aram)\b",
    r"\bnao (?:e|era) alvo\b",
    r"\bnao ha mencao direta\b",
    r"\bnada encontrado\b",
    r"\bsem resultado\b",
    r"\b0\s+processos?\b",
    r"\btotal retornado:\s*0\b",
    r"\bnao foi possivel\b",
    r"\bconsulta (?:automatica )?nao (?:foi )?realizada\b",
    r"\bfalha (?:tecnica|de autenticacao|ao consultar)\b",
    r"\berro de consulta\b",
    r"\bcontrole de quota\b",
    r"\blimite .* atingido\b",
    r"\bverificacao manual necessaria\b",
    r"\bn/a\s*[—-]\s*(?:consulta|falha|chave)\b",
)


def normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(char for char in text if not unicodedata.combining(char)).lower()


def is_m7(finding: dict) -> bool:
    marker = " ".join(normalize(finding.get(field)) for field in ("title", "source", "match", "homonimo_alerta"))
    return bool(re.search(r"\bm7\b", marker) or "contexto regional" in marker)


def classify(finding: dict) -> bool:
    if is_m7(finding):
        return False
    searchable = " ".join(
        normalize(finding.get(field))
        for field in ("title", "snippet", "source", "match", "homonimo_alerta")
    )
    if any(re.search(pattern, searchable) for pattern in NEGATIVE_PATTERNS):
        return False
    # Médio/alto com conteúdo substantivo representa ocorrência relevante.
    # Baixo histórico sem marcação explícita fica falso por segurança: não
    # superestimamos identidade apenas porque a fonte confirmou um CPF.
    return finding.get("risk_indicator") in {"medio", "alto"}


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


def backfill(payload: dict, *, reclassify: bool = False) -> tuple[int, int, int]:
    true_count = false_count = already_had = 0
    for findings in payload.values():
        if not isinstance(findings, list):
            continue
        for finding in findings:
            if not isinstance(finding, dict):
                continue
            had_field = "achado_positivo" in finding
            if had_field:
                already_had += 1
                # M7 é invariavelmente contextual, inclusive se um produtor
                # antigo gravou `true` por engano.
                if is_m7(finding):
                    finding["achado_positivo"] = False
                if not reclassify:
                    continue
            finding["achado_positivo"] = classify(finding)
            # Os contadores true/false representam apenas campos adicionados
            # nesta execução; já_tinham permanece auditável separadamente.
            if not had_field:
                if finding["achado_positivo"]:
                    true_count += 1
                else:
                    false_count += 1
    return true_count, false_count, already_had


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--reclassify", action="store_true", help="Reaplica a heurística a campos já preenchidos")
    args = parser.parse_args()
    output = args.output or args.input

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    true_count, false_count, already_had = backfill(payload, reclassify=args.reclassify)
    atomic_write_json(output, payload)
    final = [f.get("achado_positivo") for fs in payload.values() if isinstance(fs, list) for f in fs if isinstance(f, dict)]
    print(
        f"achado_positivo: true={true_count} false={false_count} já_tinham={already_had}; "
        f"totais_finais true={final.count(True)} false={final.count(False)}"
    )


if __name__ == "__main__":
    main()
