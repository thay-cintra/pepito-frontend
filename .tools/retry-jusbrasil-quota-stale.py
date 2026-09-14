#!/usr/bin/env python3
"""
Reconsulta JusBrasil pros casos que ficaram com um achado "Controle de
Quota"/"Erro de Consulta" JusBrasil parado no media-findings.json de quando
a cota estava (ou parecia estar, por bug de contagem lifetime-vs-mês já
corrigido) esgotada — pedido de thay@cora.com.br (2026-09-14): "Já
verificamos que temos cota, então corrija isso."

Não sobrescreve Credilink/WebSearch já presentes — remove SÓ os achados
JusBrasil-side com source "Sistema Pepito — Controle de Quota JusBrasil"
ou "Sistema Pepito — Erro de Consulta JusBrasil" do caso, reconsulta
consultar_jusbrasil() pro owner (e pra cada CPF de PEP relacionado
distinto) e insere o resultado fresco no lugar. Se a cota realmente
estourar de novo no meio da lista (proteção já embutida em
consultar_jusbrasil()/_jus_quota_exceeded()), o placeholder novo (com
número real e atualizado) volta a aparecer — não é erro, é o limite
mensal funcionando.

Uso:
  python3 .tools/retry-jusbrasil-quota-stale.py [--bucket CHECK_LIDERANCA|CHECK_ANALISTA] [--limit N]
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE_PATH = ROOT / "src" / "data" / "registration-queue-real.json"
FINDINGS_PATH = ROOT / "src" / "data" / "media-findings.json"

JUS_PLACEHOLDER_SOURCES = (
    "Sistema Pepito — Controle de Quota JusBrasil",
    "Sistema Pepito — Erro de Consulta JusBrasil",
)


def _atomic_write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(f".tmp{os.getpid()}")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", choices=["CHECK_LIDERANCA", "CHECK_ANALISTA"], default=None)
    ap.add_argument("--limit", type=int, default=None, help="Máximo de draft_ids a reprocessar nesta run")
    args = ap.parse_args()

    # Import tardio pra reaproveitar consultar_jusbrasil() exatamente como o
    # pipeline principal usa (mesma sessão HTTP, mesmo controle de cota).
    import importlib.util
    spec = importlib.util.spec_from_file_location("fetch_media_findings", ROOT / ".tools" / "fetch-media-findings.py")
    fmf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fmf)

    queue = json.loads(QUEUE_PATH.read_text())
    findings = json.loads(FINDINGS_PATH.read_text())
    items = {it["draft_id"]: it for it in queue.get("items", [])}

    afetados = []
    for did, fs in findings.items():
        if not isinstance(fs, list):
            continue
        if any(isinstance(f, dict) and f.get("source") in JUS_PLACEHOLDER_SOURCES for f in fs):
            it = items.get(did)
            if not it:
                continue
            if args.bucket and it.get("bucket") != args.bucket:
                continue
            afetados.append(it)

    # Prioriza CHECK_LIDERANCA (mais perto da decisão) quando não filtrado por --bucket.
    afetados.sort(key=lambda it: 0 if it.get("bucket") == "CHECK_LIDERANCA" else 1)
    if args.limit:
        afetados = afetados[: args.limit]

    print(f"Casos afetados a reprocessar: {len(afetados)}")

    processados, bloqueados_cota = 0, 0
    for i, it in enumerate(afetados, 1):
        did = it["draft_id"]
        nome = it.get("full_name_pf", did[:8])
        print(f"[{i}/{len(afetados)}] {nome} ({it.get('bucket')})")

        cpfs = [(it.get("cpf", ""), nome, "owner")]
        owner_cpf = re.sub(r"\D", "", it.get("cpf") or "")
        vistos = {owner_cpf}
        for p in it.get("pep_pf") or []:
            cpf_pep = re.sub(r"\D", "", p.get("cpf_titular") or "")
            if cpf_pep and cpf_pep not in vistos:
                vistos.add(cpf_pep)
                cpfs.append((cpf_pep, p.get("nome_titular", ""), "pep"))

        fs = [f for f in findings.get(did, []) if not (isinstance(f, dict) and f.get("source") in JUS_PLACEHOLDER_SOURCES)]

        this_case_cota = False
        for cpf, nome_cpf, papel in cpfs:
            resultado = fmf.consultar_jusbrasil(cpf, nome_cpf, papel=papel)
            fs.extend(resultado)
            if any(r.get("source") == "Sistema Pepito — Controle de Quota JusBrasil" for r in resultado):
                this_case_cota = True

        findings[did] = fs
        _atomic_write(FINDINGS_PATH, findings)
        if this_case_cota:
            bloqueados_cota += 1
            print("   -> cota mensal esgotada durante esta run — parando aqui.")
            break
        processados += 1

    print(f"\nProcessados com sucesso: {processados}/{len(afetados)}")
    if bloqueados_cota:
        print(f"Parou por esgotar a cota mensal no meio da lista — rode de novo no próximo período.")


if __name__ == "__main__":
    sys.exit(main())
