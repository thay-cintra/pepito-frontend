#!/usr/bin/env python
"""
Reprocessa (força regeneração) os pareceres de casos do backlog que hoje
sugerem MONITORAMENTO REFORÇADO, após correção dos prompts em
generate-sugestao-parecer.py / generate-sugestao-lideranca.py (que
derivavam para esse status só por vínculo/mandato PEP ativo, sem exigir
fator de risco adicional sensível).

Pula revisões manuais (model contendo "manual"). Sobrescreve apenas as
entradas afetadas — não regenera o backlog inteiro (custo de LLM).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Import direto por caminho, pois os módulos têm hífen no nome do arquivo.
import importlib.util

ROOT = Path(__file__).resolve().parents[1]


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


analista_mod = _load_module(ROOT / ".tools" / "generate-sugestao-parecer.py", "sugestao_parecer")
lideranca_mod = _load_module(ROOT / ".tools" / "generate-sugestao-lideranca.py", "sugestao_lideranca")

QUEUE_PATH = ROOT / "src" / "data" / "registration-queue-real.json"
FINDINGS_PATH = ROOT / "src" / "data" / "media-findings.json"
SUGESTAO_PATH = ROOT / "src" / "data" / "pareceres-sugestao.json"
LIDERANCA_PATH = ROOT / "src" / "data" / "pareceres-lideranca.json"


def main():
    payload = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    items = {c["draft_id"]: c for c in (payload["items"] if isinstance(payload, dict) else payload)}
    findings_all = json.loads(FINDINGS_PATH.read_text(encoding="utf-8"))

    # ── CHECK_ANALISTA (pareceres-sugestao.json) ──
    sugestao = json.loads(SUGESTAO_PATH.read_text(encoding="utf-8"))
    alvo_analista = [
        did for did, v in sugestao.items()
        if isinstance(v, dict) and v.get("text")
        and "manual" not in (v.get("model") or "")
        and "MONITORAMENTO REFOR" in v["text"].upper()
        and did in items
    ]
    print(f"CHECK_ANALISTA: {len(alvo_analista)} casos em Monitoramento Reforçado para reprocessar")
    for i, did in enumerate(alvo_analista, 1):
        c = items[did]
        f = findings_all.get(did) or []
        if not isinstance(f, list):
            f = []
        print(f"  [{i}/{len(alvo_analista)}] {c['full_name_pf']:42s} → reprocessando...")
        try:
            texto = analista_mod.gerar(c, f)
            sugestao[did] = {
                "text": texto,
                "model": analista_mod.MODEL,
                "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
            }
            SUGESTAO_PATH.write_text(json.dumps(sugestao, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"    ❌ falhou: {e}")

    # ── CHECK_LIDERANCA (pareceres-lideranca.json) ──
    lideranca = json.loads(LIDERANCA_PATH.read_text(encoding="utf-8"))
    alvo_lideranca = [
        did for did, v in lideranca.items()
        if isinstance(v, dict) and v.get("decisao") == "monitoramento"
        and "manual" not in (v.get("model") or "")
        and did in items
    ]
    print(f"\nCHECK_LIDERANCA: {len(alvo_lideranca)} casos em Monitoramento Reforçado para reprocessar")
    for i, did in enumerate(alvo_lideranca, 1):
        c = items[did]
        f = findings_all.get(did) or []
        if not isinstance(f, list):
            f = []
        print(f"  [{i}/{len(alvo_lideranca)}] {c['full_name_pf']:42s} → reprocessando...")
        try:
            texto = lideranca_mod.gerar(c, f)
            decisao = lideranca_mod.detect_decisao(texto)
            resumo = lideranca_mod._gerar_resumo(texto, decisao)
            lideranca[did] = {
                "text": texto,
                "resumo": resumo,
                "decisao": decisao,
                "model": lideranca_mod.MODEL,
                "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
            }
            print(f"     → nova decisão: {decisao}")
            LIDERANCA_PATH.write_text(json.dumps(lideranca, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"    ❌ falhou: {e}")

    from collections import Counter
    print("\n✓ Reprocessamento concluído.")
    print("Distribuição ANALISTA agora:",
          Counter("monitoramento" if "MONITORAMENTO REFOR" in v.get("text", "").upper() else "outro"
                  for v in sugestao.values() if isinstance(v, dict) and v.get("text")))
    print("Distribuição LIDERANCA agora:",
          Counter(v.get("decisao") for v in lideranca.values() if isinstance(v, dict)))


if __name__ == "__main__":
    main()
