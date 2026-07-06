#!/usr/bin/env python3
"""
Regenera sugestões de parecer que estão faltando em pareceres-sugestao.json

Problema: Novos casos na fila não têm sugestões geradas automaticamente
Solução: Extrair dados das análises existentes e gerar sugestões heurísticas
"""

import json
import re
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[2] / "pepito-frontend"
DATA_DIR = ROOT / "src" / "data"
ANALISES_FILE = DATA_DIR / "analises-salvas.json"
SUGESTOES_FILE = DATA_DIR / "pareceres-sugestao.json"

def extract_draft_id(motivoRelacionamento: str) -> str:
    """Extrai UUID ou draft_id de motivoRelacionamento"""
    # Procura por UUID
    uuid_match = re.search(
        r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',
        motivoRelacionamento
    )
    if uuid_match:
        return uuid_match.group(0)

    # Procura por drf-XXXXX
    draft_match = re.search(r'drf-[A-Z0-9]+', motivoRelacionamento)
    if draft_match:
        return draft_match.group(0)

    return None

def gerar_sugestao_heuristica(analise: dict) -> str:
    """Gera uma sugestão de parecer usando dados existentes da análise"""
    cliente = analise.get('cliente', {})

    # Extrai dados básicos
    razao_social = cliente.get('razaoSocial', 'empresa')
    nome_pep = cliente.get('nomePessoaVinculada', cliente.get('nomeResponsavel', 'PEP'))
    tipo_pep = cliente.get('tipoPep', 'relacionado')
    cargo = cliente.get('cargoPep', 'cargo desconhecido')
    uf = cliente.get('enderecoComercial', '').split('/')[-1] if '/' in cliente.get('enderecoComercial', '') else 'UF'
    cnae = cliente.get('cnae', '')

    # Extrai parecer da primeira camada se existir
    parecer_primeira = analise.get('parecerPrimeiraCamada', '')

    # Cria sugestão concisa baseada no parecer existente
    if parecer_primeira:
        # Usa o parecer existente mas encurta para 1 parágrafo
        if len(parecer_primeira) > 500:
            sugestao = parecer_primeira[:500] + "..."
        else:
            sugestao = parecer_primeira
    else:
        # Fallback: cria uma sugestão genérica
        if tipo_pep == "titular":
            sugestao = f"Empresa {razao_social} cujo titular é o próprio PEP {nome_pep} ({cargo}, {uf}). Atividade: {cnae}. Análise de risco conforme Score PLD e achados externos. Sugestão técnica: verificar em segunda camada."
        else:
            sugestao = f"Empresa {razao_social} com titular vinculado ao PEP {nome_pep} ({cargo}, {uf}). Atividade: {cnae}. Análise de conformidade PLD realizada. Sugestão: avaliar em segunda camada conforme critérios institucionais."

    return sugestao

def main():
    print("=" * 70)
    print("REGENERADOR DE SUGESTÕES — Parecer IA")
    print("=" * 70 + "\n")

    # 1. Carrega arquivos
    print("[1/4] Carregando arquivos...")
    with open(ANALISES_FILE) as f:
        analises_data = json.load(f)

    with open(SUGESTOES_FILE) as f:
        sugestoes_data = json.load(f)

    analises = analises_data.get('analises', [])
    sugestoes_keys = set(sugestoes_data.keys())

    print(f"  ✓ Análises: {len(analises)}")
    print(f"  ✓ Sugestões existentes: {len(sugestoes_keys)}")

    # 2. Extrai draftIds e identifica os faltando
    print("\n[2/4] Identificando sugestões faltando...")
    draft_ids_analises = {}
    faltando = []

    for analise in analises:
        motivo = analise.get('cliente', {}).get('motivoRelacionamento', '')
        draft_id = extract_draft_id(motivo)

        if draft_id:
            draft_ids_analises[draft_id] = analise
            if draft_id not in sugestoes_keys:
                faltando.append(draft_id)

    print(f"  ✓ DraftIds encontrados: {len(draft_ids_analises)}")
    print(f"  ✗ DraftIds SEM sugestão: {len(faltando)}")

    # 3. Gera sugestões faltando
    print(f"\n[3/4] Gerando {len(faltando)} sugestões faltando...")
    geradas = 0

    for draft_id in faltando:
        analise = draft_ids_analises[draft_id]
        try:
            sugestao_texto = gerar_sugestao_heuristica(analise)

            sugestoes_data[draft_id] = {
                "text": sugestao_texto,
                "model": "heuristic-fallback",
                "generated_at": datetime.now().isoformat() + "Z",
                "metodo": "regenerado - análise existente"
            }
            geradas += 1

            if geradas <= 5:
                print(f"  ✓ {draft_id}: sugestão gerada ({len(sugestao_texto)} chars)")
        except Exception as e:
            print(f"  ✗ {draft_id}: erro ao gerar ({str(e)[:50]})")

    print(f"\n  Total gerado: {geradas}/{len(faltando)}")

    # 4. Salva arquivo atualizado
    print("\n[4/4] Salvando sugestões...")
    with open(SUGESTOES_FILE, 'w') as f:
        json.dump(sugestoes_data, f, indent=2, ensure_ascii=False)

    print(f"  ✓ Arquivo salvo: {SUGESTOES_FILE}")
    print(f"  ✓ Total de sugestões agora: {len(sugestoes_data)}")

    print("\n" + "=" * 70)
    print(f"✅ CONCLUÍDO: {geradas} sugestões regeneradas")
    print("=" * 70)

if __name__ == "__main__":
    main()
