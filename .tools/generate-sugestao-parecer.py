#!/usr/bin/env python
"""
Gera sugestão CONCISA de parecer para os casos CHECK_ANALISTA, no estilo
EXATO do exemplo da analista (Josinalva Guerra Lins Silva): 1 parágrafo,
3-5 frases, sem cabeçalho, sem prefixo de ação, objetivo, sucinto e fluido.

Inclui o tipo de vínculo real (DSVINCULO) extraído do pep_pf da Credilink.

Saída: src/data/pareceres-sugestao.json (keyed by draft_id, somente ANALISTA)
"""
import json
import os
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = ROOT / "src" / "data" / "registration-queue-real.json"
FINDINGS_PATH = ROOT / "src" / "data" / "media-findings.json"
OUT_PATH = ROOT / "src" / "data" / "pareceres-sugestao.json"

client = OpenAI(
    api_key=os.environ["LITELLM_API_KEY"],
    base_url=os.environ["LITELLM_BASE_URL"],
)
MODEL = os.environ.get("LLM_MODEL", "anthropic-claude-sonnet-4-6")

VINCULO_LABEL = {
    "IRMA(O)": "irmão",
    "PAI": "pai",
    "MAE": "mãe",
    "FILHA(O)": "filho/filha",
    "FILHO": "filho",
    "FILHA": "filha",
    "CONJUGE": "cônjuge",
    "COMPANHEIRO(A)": "companheiro/companheira",
    "TIA(O)": "tio/tia",
    "SOBRINHA(O)": "sobrinho/sobrinha",
    "PRIMA(O)": "primo/prima",
    "AVO": "avó/avô",
    "NETA(O)": "neto/neta",
    "GENRO": "genro",
    "NORA": "nora",
    "SOGRA(O)": "sogro/sogra",
    "CUNHADA(O)": "cunhado/cunhada",
    "PADRASTO": "padrasto",
    "MADRASTA": "madrasta",
    "ENTEADA(O)": "enteado/enteada",
}


def vinculo_natural(ds: str | None) -> str:
    if not ds:
        return ""
    return VINCULO_LABEL.get(ds.strip().upper(), ds.lower())


SYSTEM_PROMPT = """Você é um analista de Compliance/PLD da Cora. Redija UMA sugestão de parecer em UM PARÁGRAFO único, no estilo do exemplo abaixo.

REGRAS:
1. UM ÚNICO PARÁGRAFO (sem quebras de linha duplas).
2. 3 a 4 frases. Texto fluido, sem repetir informação.
3. Sem cabeçalho, sem prefixo de ação, sem markdown.
4. SEMPRE cite o TIPO DE VÍNCULO (sócio, irmão, mãe, pai, sobrinha, cônjuge, etc.) na primeira frase.
5. Use APENAS dados fornecidos. Não invente sócios, mídias ou processos.
6. Se não houver achado adverso, declare "não foram identificadas mídias ou processos desabonadores".
7. Termine com a recomendação: APROVAÇÃO, MONITORAMENTO REFORÇADO, ou REPROVAÇÃO.
8. Seja sucinto. Não inclua informação redundante.

EXIGÊNCIA SOBRE A BUSCA DE MÍDIA: a varredura automatizada deve combinar nome completo do PEP + município + cargo + período do mandato e explorar fontes regionais e setoriais (imprensa local/blogs estaduais, TRE, MP estadual, TCE, Câmara Municipal, Polícia Federal/Civil, DOU). Antes de afirmar "sem mídia adversa" você precisa ter consultado essas fontes. Achados de cassação/improbidade/operação contra o PEP titular ou owner-relacionado tornam a recomendação obrigatoriamente REPROVAÇÃO.

EXEMPLO DO ESTILO (referência absoluta):

"Trata-se de empresa cujo titular possui relacionamento de sócio com a PEP Josinalva Guerra Lins Silva (Vereadora de Natuba/PB), através de outra PJ (SUAS CONSULT LTDA - CNPJ 40.400.051/0001-25, que possui atividade de desenvolvimento e treinamentos em programas de computadores). Em análises reputacionais, não foram identificadas mídias ou processos desabonadores face à empresa, ao seu titular ou à PEP. Dito isso, considerando que não foram identificados desabonos relevantes sob a ótica de LD, não temos objeções ao início do relacionamento, porém, considerando o atual cumprimento de mandato ativo pela pessoa relacionada, sugerimos a inclusão em monitoramento reforçado, devido ter sociedade com PEP ativa em empresa com atividade ligada a computação."

ESTRUTURA:
1ª frase: vínculo + PEP + cargo + município + atividade. Use formato: "Trata-se de empresa cujo titular [é o próprio PEP / é VINCULO da PEP NOME] (CARGO de CIDADE/UF), atuando em [CNAE]."
2ª frase: análise reputacional resumida. "Em análises reputacionais, [resultado]."
3ª frase: recomendação fundamentada. "Considerando [...], sugerimos [...]."

Retorne APENAS o parágrafo do parecer, sem nada antes ou depois."""


def montar_user_prompt(case: dict, findings: list) -> str:
    pep = case.get("pep_pf") or []
    pep_titular = next((p for p in pep if p.get("tipo") == "T"), pep[0] if pep else {})
    nome_pep = pep_titular.get("nome_titular") or "(não informado)"
    cargo_real = pep_titular.get("cargo_formal") or pep_titular.get("perfil") or "cargo não informado"
    orgao = pep_titular.get("orgao") or case.get("uf", "")
    vinculo = vinculo_natural(pep_titular.get("ds_vinculo"))
    data_inicio = pep_titular.get("data_inicio") or ""
    data_fim = pep_titular.get("data_fim") or ""

    cpf_owner = (case.get("cpf") or "").replace(".", "").replace("-", "")
    cpf_pep = (pep_titular.get("cpf_titular") or "").replace(".", "").replace("-", "")
    is_titular = cpf_owner == cpf_pep

    findings_summary = ""
    if findings:
        sorted_f = sorted(
            findings,
            key=lambda f: {"alto": 0, "medio": 1, "baixo": 2}.get(f.get("risk_indicator"), 3),
        )[:2]
        findings_summary = " | ".join(
            f"{f.get('source', '')}: {f.get('snippet', '')[:120]}"
            + (" [HOMÔNIMO]" if f.get("homonimo_alerta") else "")
            for f in sorted_f
        )

    pj_midia = (case.get("pj_midianegativas") or "").replace('"', "").strip()
    pf_midia = (case.get("pf_midianegativas") or "").replace('"', "").strip()
    pj_proc = (case.get("processosjudiciais_pj") or "").replace('"', "").strip()
    pf_proc = (case.get("processosjudiciais_pf") or "").replace('"', "").strip()

    cnae_clean = case.get("cnae", "").split(" - ")[-1] if " - " in case.get("cnae", "") else case.get("cnae", "")

    return f"""DADOS DO CASO:
- Owner: {case['full_name_pf']} (CPF {case['cpf']})
- Razão Social: {case['rf_nome_oficial']} (CNPJ {case['cnpj']})
- CNAE: {cnae_clean}
- Cidade da PJ: {case.get('cidade', '')}/{case.get('uf', '')}
- Data abertura PJ: {case.get('data_constituicao', '')}

VINCULAÇÃO PEP (Credilink):
- {'O OWNER É O PRÓPRIO PEP TITULAR' if is_titular else f'Owner é {vinculo or "vínculo"} de PEP'}
- PEP titular: {nome_pep}
- Cargo formal: {cargo_real}
- Órgão/Município: {orgao}
- Mandato: {data_inicio} → {data_fim}
{f'- Tipo de vínculo (DSVINCULO): {vinculo}' if not is_titular and vinculo else ''}

ACHADOS RELEVANTES: {findings_summary or '(nenhum achado externo material)'}

PIPELINE INTERNO:
- Mídia adversa PJ/PF: {pj_midia[:80] or '(sem)'} / {pf_midia[:80] or '(sem)'}
- Processos PJ/PF: {pj_proc[:80] or '(sem)'} / {pf_proc[:80] or '(sem)'}

Redija a sugestão em UM parágrafo (3-4 frases), texto fluido sem redundâncias, mencionando explicitamente o tipo de vínculo na 1ª frase."""


def gerar(case: dict, findings: list, max_retries: int = 3) -> str:
    prompt = montar_user_prompt(case, findings)
    for attempt in range(max_retries):
        try:
            r = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=400,
                temperature=0.3,
            )
            return r.choices[0].message.content.strip().replace("\n\n", " ").replace("\n", " ")
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2)
    return ""


def main():
    payload = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    items = payload["items"] if isinstance(payload, dict) else payload
    findings_all = json.loads(FINDINGS_PATH.read_text(encoding="utf-8"))

    # Apaga cache para regenerar tudo
    sugestoes = {}

    analistas = [c for c in items if c.get("bucket") == "CHECK_ANALISTA"]
    print(f"Total ANALISTA: {len(analistas)}")
    print(f"Modelo: {MODEL}\n")

    for i, c in enumerate(analistas, 1):
        did = c["draft_id"]
        f = findings_all.get(did) or []
        if not isinstance(f, list):
            f = []
        print(f"  [{i}/{len(analistas)}] {c['full_name_pf']:42s} → gerando...")
        try:
            texto = gerar(c, f)
            sugestoes[did] = {
                "text": texto,
                "model": MODEL,
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            OUT_PATH.write_text(json.dumps(sugestoes, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"    ❌ falhou: {e}")

    print(f"\n✓ {len([s for s in sugestoes.values() if s.get('text')])}/{len(analistas)} sugestões geradas")


if __name__ == "__main__":
    main()
