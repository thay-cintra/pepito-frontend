#!/usr/bin/env python3
"""
Gera a lista de auditoria manual pedida por thay@cora.com.br (2026-09-12):
"Ao final de tudo e todas as correções, me traga a lista dos 281 casos com
PEPs Relacionados que não tinham consulta na Credilink e agora tem.
DRAFT ID + NOME PEP + CPF PEP + TOKEN. Farei uma mini auditoria manualmente
na Credilink."

Cruza o alvo original da batelada histórica (CPF -> {nome, drafts}) com o
ledger real (src/data/credilink-pep-consultas.json), listando só entradas
com consulta CONCLUÍDA com sucesso (mesma validação estrita usada em
credilinkEntryOk()/getConsultaStatus() no TS: sem chave erro_*, compliance
com code==200 e message != "Processando", token presente).

Uso:
  python3 .tools/gerar-auditoria-credilink-pep.py [--alvos <path.json>] [--out <path.csv>]

--alvos default: o arquivo de 281 CPFs gerado pela investigação Athena
  (histórico decidido desde abril/2026 sem consulta Credilink registrada).
  Se não for passado, cai pra checar TODAS as entradas do ledger (menos
  útil pra esse pedido específico, mas serve de fallback).
"""
import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER_PATH = ROOT / "src" / "data" / "credilink-pep-consultas.json"
DEFAULT_OUT = ROOT / ".tools" / "auditoria-credilink-pep-relacionado.csv"


def entry_ok(e: dict) -> bool:
    if not e:
        return False
    if any(k.startswith("erro") for k in e.keys()):
        return False
    compliance = e.get("compliance") or {}
    return compliance.get("code") == 200 and compliance.get("message") != "Processando" and bool(e.get("token_compliance"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--alvos", type=str, default=None, help="JSON {cpf: {nome, drafts:[...]}} do universo auditado")
    ap.add_argument("--out", type=str, default=str(DEFAULT_OUT))
    args = ap.parse_args()

    ledger = json.loads(LEDGER_PATH.read_text())

    if args.alvos:
        alvos = json.loads(Path(args.alvos).read_text())
    else:
        # Fallback: todo o ledger vira "alvo" (sem draft associado conhecido).
        alvos = {cpf: {"nome": e.get("nome", ""), "drafts": []} for cpf, e in ledger.items()}

    rows = []
    done, pending = 0, 0
    for cpf, info in alvos.items():
        e = ledger.get(cpf)
        if entry_ok(e):
            done += 1
            drafts = info.get("drafts") or ["(sem draft associado)"]
            for d in drafts:
                rows.append({
                    "draft_id": d,
                    "nome_pep": info.get("nome", e.get("nome", "")),
                    "cpf_pep": cpf,
                    "token_credilink": e["token_compliance"],
                })
        else:
            pending += 1

    rows.sort(key=lambda r: r["draft_id"])

    out_path = Path(args.out)
    with out_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["draft_id", "nome_pep", "cpf_pep", "token_credilink"])
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"CPFs concluídos: {done} / pendentes: {pending} / total alvo: {len(alvos)}")
    print(f"Linhas (draft x CPF — 1 PEP pode ter >1 draft associado): {len(rows)}")
    print(f"CSV salvo em: {out_path}")
    if pending > 0:
        print(f"⚠️  Ainda faltam {pending} CPFs — rode de novo quando a batelada terminar.")


if __name__ == "__main__":
    sys.exit(main())
