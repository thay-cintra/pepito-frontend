#!/usr/bin/env python3
"""Detecta pareceres que negam achados positivos existentes na pesquisa.

O escopo intencionalmente abrange todos os pareceres-sugestao, mesmo quando o
draft já migrou para outro bucket. O bucket atual é apenas informado no CSV.
"""

import argparse
import csv
import json
import os
import re
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PARECERES = ROOT / "src" / "data" / "pareceres-sugestao.json"
DEFAULT_MEDIA = ROOT / "src" / "data" / "media-findings.json"
DEFAULT_FILA = ROOT / "src" / "data" / "registration-queue-real.json"
DEFAULT_OUTPUT = ROOT / ".tools" / "pareceres-ignoram-achado.csv"

HEADERS = [
    "draft_id",
    "nome_titular",
    "bucket_atual",
    "quantos_achados_contraditos",
    "resumo_do_achado",
    "frase_do_parecer_que_contradiz",
]

NEGACAO_RE = re.compile(
    r"(?:"
    r"n[aã]o\s+(?:foram|foi)\s+(?:identificad[ao]s?|encontrad[ao]s?|localizad[ao]s?)"
    r"|aus[eê]ncia\s+total"
    r"|aus[eê]ncia\s+de\s+(?:desabonos?|achados?|apontamentos?|m[ií]dias?\s+adversas?|processos?)"
    r"|sem\s+(?:quaisquer\s+)?(?:processos?|m[ií]dias?\s+adversas?|desabonos?|achados?|apontamentos?)"
    r"|nenhum(?:a)?\s+(?:achado|desabono|apontamento|processo|m[ií]dia\s+adversa)"
    r"|n[aã]o\s+h[aá]\s+(?:m[ií]dias?\s+adversas?|processos?|san[çc][õo]es?|achados?|desabonos?)"
    r")",
    re.IGNORECASE,
)


def carregar_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: esperado objeto JSON na raiz")
    return data


def _frases_contraditorias(texto: object) -> list[str]:
    if not isinstance(texto, str):
        return []
    frases = re.split(r"(?<=[.!?])\s+", " ".join(texto.split()))
    contraditorias = []
    for frase in frases:
        match = NEGACAO_RE.search(frase)
        if not match:
            continue
        trecho = frase[match.start():].lower()
        depois = frase[match.end():].lower()
        if "adiciona" in trecho:
            continue
        if match.group().lower().startswith(("nenhum achado", "nenhuma achado")):
            if re.match(r"\s+(?:confirma|indica|demonstra|estabelece)\b", depois):
                continue
        if match.group().lower().startswith("sem processo") and re.match(r"\s+criminal", depois):
            continue
        if match.group().lower().startswith(("não há achado", "nao ha achado")):
            if re.match(r"\s+adverso\s+pr[oó]prio\b", depois):
                continue
        contraditorias.append(frase.strip())
    return contraditorias


def _achados_positivos(media: dict, draft_id: str) -> list[dict]:
    findings = media.get(draft_id, [])
    if not isinstance(findings, list):
        return []
    return [
        finding
        for finding in findings
        if isinstance(finding, dict) and finding.get("achado_positivo") is True
    ]


def _resumir_achado(finding: dict) -> str:
    titulo = " ".join(str(finding.get("title") or "Achado sem título").split())
    fonte = " ".join(str(finding.get("source") or "não informada").split())
    risco = " ".join(str(finding.get("risk_indicator") or "não informado").split())
    return f"{titulo} | fonte: {fonte} | risco: {risco}"


def detectar_contradicoes(pareceres: dict, media: dict, fila: dict) -> list[dict[str, object]]:
    itens = fila.get("items", [])
    if not isinstance(itens, list):
        raise ValueError("registration-queue-real.json: campo 'items' deve ser uma lista")
    fila_por_draft = {
        item.get("draft_id"): item
        for item in itens
        if isinstance(item, dict) and isinstance(item.get("draft_id"), str)
    }

    linhas: list[dict[str, object]] = []
    for draft_id, parecer in pareceres.items():
        if draft_id == "_meta" or not isinstance(parecer, dict):
            continue
        achados = _achados_positivos(media, draft_id)
        frases = _frases_contraditorias(parecer.get("text"))
        if not achados or not frases:
            continue

        item = fila_por_draft.get(draft_id, {})
        nome = (
            item.get("full_name_pf")
            or item.get("social_name")
            or item.get("rf_nome_oficial")
            or "NÃO LOCALIZADO NA FILA ATUAL"
        )
        linhas.append(
            {
                "draft_id": draft_id,
                "nome_titular": nome,
                "bucket_atual": item.get("bucket") or "FORA_DA_FILA_ATUAL",
                "quantos_achados_contraditos": len(achados),
                "resumo_do_achado": " || ".join(_resumir_achado(f) for f in achados),
                "frase_do_parecer_que_contradiz": " | ".join(frases),
            }
        )
    return sorted(linhas, key=lambda linha: str(linha["draft_id"]))


def escrever_csv_atomico(path: Path, linhas: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporario = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=HEADERS)
            writer.writeheader()
            writer.writerows(linhas)
        os.replace(temporario, path)
    except Exception:
        try:
            os.unlink(temporario)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pareceres", type=Path, default=DEFAULT_PARECERES)
    parser.add_argument("--media-findings", type=Path, default=DEFAULT_MEDIA)
    parser.add_argument("--fila", type=Path, default=DEFAULT_FILA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    linhas = detectar_contradicoes(
        carregar_json(args.pareceres),
        carregar_json(args.media_findings),
        carregar_json(args.fila),
    )
    escrever_csv_atomico(args.output, linhas)
    print(f"{len(linhas)} contradição(ões) gravada(s) em {args.output}")


if __name__ == "__main__":
    main()
