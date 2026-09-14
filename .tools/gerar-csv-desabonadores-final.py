#!/usr/bin/env python3
"""Monta o relatório final de PEPs desabonadores com cadastro PJ e dossiê."""

import csv
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ADVERSE_PATH = ROOT / ".tools" / "auditoria-pep-relacionado-DESABONADOR.csv"
LEDGER_PATH = ROOT / "src" / "data" / "credilink-pep-consultas.json"
LOOKUP_PATH = ROOT / ".tools" / "cadastro-pj-lookup.json"
OUTPUT_PATH = ROOT / ".tools" / "RELATORIO-FINAL-PEP-DESABONADOR.csv"

OUTPUT_COLUMNS = (
    "DRAFT_ID",
    "RAZAO_SOCIAL",
    "CNPJ",
    "BID_ATUAL",
    "CPF_PEP",
    "NOME_PEP",
    "TIPO_SITUACAO_DESABONADORA",
    "LINK_CREDILINK",
    "TOKEN",
)

# Ordem conservadora aprovada pela Thay: a classificação ALTO/ALTÍSSIMO do
# próprio motor de compliance vem primeiro; depois, evidência judicial em polo
# passivo, mídia negativa e, por fim, dívida ativa de natureza financeira.
SEVERITY = {
    "score": (0, "Score Credilink ALTO/ALTÍSSIMO"),
    "processosJudiciais": (1, "Processo judicial em polo passivo/adverso"),
    "midiaNegativas": (2, "Mídia negativa"),
    "dividasAtivas": (3, "Dívida ativa"),
}


def _load_json(path: Path, *, optional: bool = False) -> dict[str, Any]:
    if optional and not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} deve conter um objeto JSON")
    return value


def generate_report(
    adverse_path: Path,
    ledger_path: Path,
    lookup_path: Path,
    output_path: Path,
) -> dict[str, int]:
    ledger = _load_json(ledger_path)
    lookup = _load_json(lookup_path, optional=True)
    missing_lookup: set[str] = set()
    missing_tokens: set[str] = set()
    output_rows: list[tuple[int, dict[str, str]]] = []

    with adverse_path.open(encoding="utf-8", newline="") as source:
        for source_row in csv.DictReader(source):
            draft_id = (source_row.get("draft_id") or "").strip()
            cpf_pep = (source_row.get("cpf_pep") or "").strip()
            field = (source_row.get("campo_desabonador") or "").strip()
            if field not in SEVERITY:
                raise ValueError(f"Campo desabonador sem prioridade definida: {field!r}")

            cadastro = lookup.get(draft_id)
            if not isinstance(cadastro, dict):
                cadastro = {}
                missing_lookup.add(draft_id)

            ledger_entry = ledger.get(cpf_pep)
            token = (
                str(ledger_entry.get("token_compliance") or "").strip()
                if isinstance(ledger_entry, dict)
                else ""
            )
            if not token:
                missing_tokens.add(cpf_pep)

            severity, situation = SEVERITY[field]
            output_rows.append(
                (
                    severity,
                    {
                        "DRAFT_ID": draft_id,
                        "RAZAO_SOCIAL": str(cadastro.get("razao_social") or "").strip(),
                        "CNPJ": str(cadastro.get("cnpj") or "").strip(),
                        "BID_ATUAL": str(cadastro.get("bid") or "").strip(),
                        "CPF_PEP": cpf_pep,
                        "NOME_PEP": (source_row.get("nome_pep") or "").strip(),
                        "TIPO_SITUACAO_DESABONADORA": situation,
                        "LINK_CREDILINK": (
                            "https://dashboard.tesserati.com.br/Compliance/VisualizarDossie"
                            f"?token={token}"
                            if token
                            else ""
                        ),
                        "TOKEN": token,
                    },
                )
            )

    output_rows.sort(
        key=lambda item: (
            item[0],
            item[1]["DRAFT_ID"],
            item[1]["CPF_PEP"],
            item[1]["NOME_PEP"],
        )
    )
    with output_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(row for _, row in output_rows)

    return {
        "linhas": len(output_rows),
        "draft_ids_sem_lookup": len(missing_lookup),
        "tokens_ausentes": len(missing_tokens),
    }


def main() -> None:
    stats = generate_report(ADVERSE_PATH, LEDGER_PATH, LOOKUP_PATH, OUTPUT_PATH)
    print(f"Relatório gerado: {OUTPUT_PATH}")
    print(f"Linhas: {stats['linhas']}")
    print(f"Draft IDs sem cadastro PJ no lookup: {stats['draft_ids_sem_lookup']}")
    print(f"CPFs de PEP sem token_compliance: {stats['tokens_ausentes']}")


if __name__ == "__main__":
    main()
