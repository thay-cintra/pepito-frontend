#!/usr/bin/env python
"""
Gera 32 pareceres técnicos com qualidade de produção via Claude (LiteLLM Cora).

Cada parecer:
  - É baseado nos dados REAIS do caso (Athena snapshot)
  - Incorpora achados reais de WebSearch (media-findings.json)
  - Usa os 3 templates oficiais como guia
  - Varia tom e detalhes para soar como um analista humano

Saída: src/data/pareceres-llm.json (keyed by draft_id)
"""
import json
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = ROOT / "src" / "data" / "registration-queue-real.json"
FINDINGS_PATH = ROOT / "src" / "data" / "media-findings.json"
OUT_PATH = ROOT / "src" / "data" / "pareceres-llm.json"

client = OpenAI(
    api_key=os.environ["LITELLM_API_KEY"],
    base_url=os.environ["LITELLM_BASE_URL"],
)
MODEL = os.environ.get("LLM_MODEL", "anthropic-claude-sonnet-4-6")

SYSTEM_PROMPT = """Você é um analista sênior de Compliance e PLD/FTP da Cora, escrevendo o parecer técnico de um cadastro PJ que envolve uma Pessoa Politicamente Exposta (PEP).

Você redige no padrão da equipe de PLD do Cora, em português brasileiro, com tom técnico e objetivo. Sua análise é fundamentada na Circular BACEN 3.978/2020 e nas diretrizes COAF.

REGRAS RÍGIDAS:
1. Use APENAS os dados fornecidos. Não invente fatos, mídias ou condenações.
2. Se houver achado real fornecido, cite o nome da fonte (ex: "JusBrasil", "Câmara Municipal de X").
3. Se não houver achado adverso, declare explicitamente "não foram identificadas mídias ou processos desabonadores".
4. Nunca afirme que uma pessoa cometeu crime se não houver condenação transitada em julgado citada.
5. Trate alertas de homônimo de forma cautelosa — sempre exija validação de identidade antes de decisão final.
6. O parecer deve ter 3-4 parágrafos curtos (4-8 linhas total).
7. Sempre termine recomendando UMA das 3 decisões: REPROVAÇÃO, APROVAÇÃO COM MONITORAMENTO REFORÇADO, ou APROVAÇÃO.
8. Não use formatação Markdown — texto corrido, parágrafos separados por quebra dupla de linha.

TEMPLATES OFICIAIS DA EQUIPE (use como guia, adaptando ao caso):

[REPROVADO] "A análise evidencia uma convergência de fatores de risco elevado. A atividade econômica de '...' e a sede da empresa na mesma cidade de sua atuação política (.../...) criam um cenário de alto risco para conflito de interesses. Apesar da ausência de mídia adversa ou sanções no momento, a estrutura societária e operacional é considerada de altíssimo risco.

Diante dos fatores de risco identificados, recomendo a NÃO APROVAÇÃO do relacionamento comercial, por incompatibilidade com o apetite de risco da instituição, conforme Circular BACEN 3.978/2020."

[APROVADO] "O único fator de risco é o relacionamento com PEP. Contudo, a atividade econômica da empresa é de baixo risco para crimes de lavagem de dinheiro ou corrupção, sem aparente conflito de interesses com o cargo político do parente. A ausência total de sanções, processos por improbidade ou mídia adversa para a empresa, seu titular e o PEP relacionado, mitiga significativamente o risco inicial.

Após análise aprofundada, os apontamentos não configuram risco impeditivo. Recomendo a APROVAÇÃO DO CADASTRO conforme política PLD/FT vigente."

[APROVADO SOB MONITORAMENTO REFORÇADO] "A combinação de parentesco próximo, sobreposição geográfica e temporal entre a atividade empresarial e o mandato político, somada ao histórico do PEP, eleva o risco de conflito de interesses.

Recomendo a APROVAÇÃO SOB MONITORAMENTO REFORÇADO, com revisão periódica dos fatores de risco, conforme Circular BACEN 3.978/2020."

CRITÉRIOS PARA ESCOLHA:
- REPROVAÇÃO: bucket=CHECK_LIDERANCA + CNAE sensível na mesma UF do mandato + alguma evidência adversa
- MONITORAMENTO REFORÇADO: PEP em mandato ativo + sinais não-conclusivos OU bucket=CHECK_LIDERANCA sem achados materiais
- APROVAÇÃO: PEP relacionado de baixa exposição + atividade não-sensível + zero achados adversos

EXIGÊNCIA SOBRE A BUSCA DE MÍDIA: a varredura automatizada não pode se limitar a portais nacionais. A busca deve combinar nome completo do PEP + município + cargo + período do mandato e cobrir: imprensa regional/blogs locais (do estado), TRE/TSE (cassação, desincompatibilização, contas rejeitadas), MP estadual (improbidade), TCE (reprovação de contas), Câmara/ALE (atas), Polícia Federal/Civil (operações), DOU/Diários Oficiais. Achados sobre o município de atuação do PEP (e não apenas a cidade da PJ) são obrigatórios. Cassação, improbidade ou operação contra o PEP titular ou owner-relacionado tornam a recomendação OBRIGATORIAMENTE REPROVAÇÃO.

Retorne APENAS o texto do parecer, em português, sem cabeçalhos."""


def montar_user_prompt(case: dict, findings: list) -> str:
    pep = case.get("pep_pf") or []
    pep_titular = next((p for p in pep if p.get("tipo") == "T"), pep[0] if pep else {})
    nome_pep = pep_titular.get("nome_titular") or "(não informado)"
    cargo_pep = pep_titular.get("perfil") or "(não informado)"
    uf_pep = pep_titular.get("uf") or case.get("uf") or ""

    findings_txt = "Nenhum achado externo registrado." if not findings else "\n".join(
        f"- [{f.get('risk_indicator', 'baixo').upper()}] {f.get('source', '')}: {f.get('title', '')} — {f.get('snippet', '')[:200]}" + (
            f" [HOMÔNIMO: {f['homonimo_alerta']}]" if f.get("homonimo_alerta") else ""
        )
        for f in findings
    )

    pj_midia = (case.get("pj_midianegativas") or "").replace('"', '').strip()
    pf_midia = (case.get("pf_midianegativas") or "").replace('"', '').strip()
    pj_proc = (case.get("processosjudiciais_pj") or "").replace('"', '').strip()
    pf_proc = (case.get("processosjudiciais_pf") or "").replace('"', '').strip()

    return f"""DADOS DO CASO:
- Razão Social: {case['rf_nome_oficial']}
- CNPJ: {case['cnpj']}
- Owner (PF): {case['full_name_pf']} (CPF {case['cpf']})
- Tipo PEP: {'TITULAR (owner é o próprio PEP)' if pep_titular.get('cpf_titular', '').replace('.', '').replace('-', '') == case['cpf'].replace('.', '').replace('-', '') else 'RELACIONADO'}
- PEP titular: {nome_pep}
- Cargo: {cargo_pep}
- UF de mandato: {uf_pep}
- CNAE: {case.get('cnae', '')}
- Cidade da PJ: {case.get('cidade', '')}/{case.get('uf', '')}
- Data de constituição: {case.get('data_constituicao', '')}
- Bucket Retool: {case['bucket']}
- Reason: {case.get('evaluation_reason', '')}
- Score PLD: {case.get('score_pld', '')}

ACHADOS EXTERNOS (WebSearch real):
{findings_txt}

PIPELINE INTERNO Cora:
- Mídia PJ: {pj_midia or '(sem dado)'}
- Mídia PF: {pf_midia or '(sem dado)'}
- Processos PJ: {pj_proc or '(sem dado)'}
- Processos PF: {pf_proc or '(sem dado)'}

Redija o parecer técnico no padrão Cora."""


def gerar_parecer(case: dict, findings: list, max_retries: int = 3) -> str:
    user_prompt = montar_user_prompt(case, findings)
    for attempt in range(max_retries):
        try:
            r = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=800,
                temperature=0.3,
            )
            return r.choices[0].message.content.strip()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            print(f"    retry {attempt + 1}/{max_retries}: {e}")
            time.sleep(2)
    return ""


def main():
    payload = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    items = payload["items"] if isinstance(payload, dict) else payload
    findings_all = json.loads(FINDINGS_PATH.read_text(encoding="utf-8"))

    pareceres = {}
    if OUT_PATH.exists():
        try:
            pareceres = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            print(f"Carregado JSON existente com {len(pareceres)} pareceres")
        except Exception:
            pareceres = {}

    print(f"Total de casos: {len(items)}")
    print(f"Modelo: {MODEL}\n")

    for i, c in enumerate(items, 1):
        did = c["draft_id"]
        if did in pareceres and pareceres[did].get("text"):
            print(f"  [{i}/{len(items)}] {c['full_name_pf']:42s} ✓ (cached)")
            continue

        f = findings_all.get(did) or []
        if not isinstance(f, list):
            f = []
        print(f"  [{i}/{len(items)}] {c['full_name_pf']:42s} ({c['bucket']}) → gerando parecer...")
        try:
            parecer = gerar_parecer(c, f)
            pareceres[did] = {
                "text": parecer,
                "model": MODEL,
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "case_summary": f"{c['full_name_pf']} - {c['rf_nome_oficial'][:40]}",
            }
            # Salva incrementalmente (em caso de erro nos próximos)
            OUT_PATH.write_text(json.dumps(pareceres, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"    ❌ falhou: {e}")
            pareceres[did] = {"error": str(e)}

    print(f"\n✓ {len([p for p in pareceres.values() if p.get('text')])}/{len(items)} pareceres gerados")
    print(f"  Saída: {OUT_PATH}")


if __name__ == "__main__":
    main()
