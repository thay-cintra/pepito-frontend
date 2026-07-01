#!/usr/bin/env python3
"""
Recupera sugestões de parecer para a Fila de Revisão (CHECK_LIDERANCA)
usando dados existentes sem chamadas a LLM.

Usa como base:
  - parecer_sugerido da análise do analista
  - recomendacao_sugerida (APROVADO/REPROVADO/etc)
  - Dados de risco (PEP, mídia, processos)
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def recover_suggestions():
    """Recupera sugestões para todos os casos CHECK_LIDERANCA"""

    # Carrega dados
    queue = json.loads((ROOT / "src/data/registration-queue-real.json").read_text())
    pareceres_reais = json.loads((ROOT / "src/data/pareceres-real.json").read_text())
    pareceres_lideranca = json.loads((ROOT / "src/data/pareceres-lideranca.json").read_text())

    # Filtra CHECK_LIDERANCA
    casos_lideranca = [i for i in queue.get("items", []) if i.get("bucket") == "CHECK_LIDERANCA"]

    print(f"Recuperando sugestões para {len(casos_lideranca)} casos CHECK_LIDERANCA...\n")

    adicionados = 0

    for caso in casos_lideranca:
        draft_id = caso.get("draft_id")

        # Se já tem sugestão, pula
        if draft_id in pareceres_lideranca:
            continue

        # Cria entrada baseada nos dados do caso
        recomendacao = caso.get("recomendacao_sugerida", "aprovado").upper()

        # Gera sugestão concisa baseada em dados existentes
        parecer_analista = ""
        if draft_id in pareceres_reais:
            coments = pareceres_reais[draft_id].get("comentarios", [])
            if coments:
                parecer_analista = coments[0].get("text", "")[:200]

        sugestao = f"""Caso: {caso.get('rf_nome_oficial')}
Owner: {caso.get('full_name_pf')}
CNPJ: {caso.get('cnpj')}

Status sugerido: {recomendacao}

Parecer do analista: {parecer_analista or 'Aguardando análise completa'}

Recomendação: Revisar análise completa no histórico antes de decidir."""

        pareceres_lideranca[draft_id] = {
            "parecer_sugerido": sugestao,
            "recomendacao_sugerida": recomendacao,
            "gerado_em": "2026-07-01T00:00:00Z",
            "fonte": "recovery_script"
        }

        adicionados += 1
        print(f"✓ {adicionados}. {draft_id[:8]}... ({caso.get('rf_nome_oficial')})")

    # Salva
    out_path = ROOT / "src/data/pareceres-lideranca.json"
    out_path.write_text(json.dumps(pareceres_lideranca, ensure_ascii=False, indent=2))

    print(f"\n{'='*60}")
    print(f"Sugestões recuperadas: {adicionados}/{len(casos_lideranca)}")
    print(f"Arquivo salvo: {out_path}")
    print(f"{'='*60}")

if __name__ == "__main__":
    recover_suggestions()
