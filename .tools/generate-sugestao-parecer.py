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


def _parse_data_br(s: str | None):
    """Parseia dd/mm/yyyy (formato usado pela Credilink em pep_pf)."""
    if not s:
        return None
    try:
        from datetime import datetime
        return datetime.strptime(s.strip(), "%d/%m/%Y")
    except (ValueError, AttributeError):
        return None


def _status_mandato_label(p: dict) -> str:
    """Espelha statusMandato() de src/data/registration-enrich.ts — usado para
    dar ao LLM o status já calculado, em vez de deixá-lo inferir 'hoje' sozinho."""
    from datetime import datetime
    fim = _parse_data_br(p.get("data_fim"))
    if not fim:
        return "vigência não informada"
    hoje = datetime.now()
    if hoje <= fim:
        return f"ATIVO até {p.get('data_fim')}"
    carencia = _parse_data_br(p.get("data_fim_carencia"))
    if carencia and hoje <= carencia:
        return f"encerrado em {p.get('data_fim')} — em carência PLD até {p.get('data_fim_carencia')}"
    return f"encerrado em {p.get('data_fim')} (fora do período de carência)"


def _registro_pep_principal(pep_pf: list) -> dict:
    """Entre múltiplos registros pep_pf (reeleição gera 1 registro por
    mandato), escolhe o mandato ATIVO agora; senão o de data_fim mais
    recente. O campo `tipo` (T/R) da Credilink NÃO indica recência — o
    mandato vigente pode vir com tipo "R" e um encerrado com tipo "T".
    Espelha registroPepPrincipal() de src/data/registration-enrich.ts.
    Ver .tools/INCIDENT-REPORT-2026-08-12-MANDATO-PEP.md."""
    if not pep_pf:
        return {}
    from datetime import datetime
    hoje = datetime.now()
    com_meta = []
    for p in pep_pf:
        inicio = _parse_data_br(p.get("data_inicio"))
        fim = _parse_data_br(p.get("data_fim"))
        ativo_agora = fim is not None and hoje <= fim and (inicio is None or hoje >= inicio)
        com_meta.append((p, fim, ativo_agora))
    ativos = sorted((x for x in com_meta if x[2]), key=lambda x: x[1], reverse=True)
    if ativos:
        return ativos[0][0]
    com_fim = sorted((x for x in com_meta if x[1] is not None), key=lambda x: x[1], reverse=True)
    if com_fim:
        return com_fim[0][0]
    return next((p for p in pep_pf if p.get("tipo") == "T"), pep_pf[0])


def _resumir_campo_pipeline(raw, max_itens: int = 3) -> str:
    """Resume pj_midianegativas/pf_midianegativas/processosjudiciais_pj/pf —
    campos JSON estruturados do pipeline Credilink/midiamonitor — em texto
    legível para o prompt do LLM.

    Substitui o truncamento bruto por caractere (`campo[:80]`), que cortava
    o JSON no meio e escondia achados reais mesmo quando existiam. Casos
    reais que motivaram o fix (2026-08-12):
      - PEP Carla Suzi Emerenciano: notícia de CONDENAÇÃO por facilitar
        contratação de parente (nepotismo/improbidade) — 100% invisível ao
        LLM porque o JSON de mídia (1979 chars) era cortado em 80.
      - Titular Fábio Callado Castelo Branco: agregado "Desabonadora" com
        38 ocorrências incluindo Corrupção/Criminal/Prisão/Improbidade
        Administrativa — também cortado antes de qualquer conteúdo útil.
      - Titular Marcos Antônio dos Santos: notícias mencionavam tráfico/PCC
        associadas ao nome — investigação via JusBrasil consulta pro
        confirmou 0 processos para o CPF real (homônimo comum, PB vs. BA).
        Por isso o resumo preserva o sinal de `risco_homonimo` do próprio
        pipeline — a IA precisa VER o achado E o alerta de homônimo juntos,
        não nenhum dos dois.
    Ver .tools/INCIDENT-REPORT-2026-08-12-TRUNCAMENTO-CAMPOS-PIPELINE.md.
    """
    t = (raw or "").strip().strip('"')
    if not t:
        return "(sem)"
    low = t.lower()
    if "não encontrad" in low or "nao encontrad" in low:
        return "nada encontrado"
    try:
        parsed = json.loads(t)
    except Exception:
        return t[:800] + ("…" if len(t) > 800 else "")

    if isinstance(parsed, dict) and "noticias" in parsed:
        homonimo = (parsed.get("consulta", {}) or {}).get("risco_homonimo", {}) or {}
        noticias = parsed.get("noticias") or []
        ordem_risco = {"Alto": 0, "Médio": 1, "Baixo": 2}
        noticias_ord = sorted(
            noticias,
            key=lambda n: (
                ordem_risco.get((n.get("analise") or {}).get("nivel_risco"), 3),
                -((n.get("analise") or {}).get("confianca", 0)),
            ),
        )
        partes = []
        if homonimo.get("nivel") and homonimo.get("nivel") != "BAIXO":
            partes.append(f"[risco homônimo {homonimo['nivel']}: {', '.join(homonimo.get('motivos', []))}]")
        for n in noticias_ord[:max_itens]:
            a = n.get("analise") or {}
            partes.append(
                f"\"{n.get('titulo','')}\" ({(n.get('fonte') or {}).get('nome','')}, {(n.get('data_publicacao') or '')[:10]}) "
                f"— match {a.get('match_type','')}, confiança {a.get('confianca','')}%, "
                f"risco {a.get('nivel_risco','')}, menção {a.get('tipo_mencao','')}: "
                f"{(n.get('resumo') or '')[:200]}"
            )
        return " | ".join(partes) if partes else "sem menções confirmadas"

    if isinstance(parsed, dict) and "TipoMidia" in parsed:
        return f"{parsed.get('TipoMidia')}: {parsed.get('Descricao','')} (Quantidade: {parsed.get('Quantidade','?')})"

    if isinstance(parsed, dict) and "QuantidadeTotal" in parsed:
        campos = {k: v for k, v in parsed.items() if k not in ("Partes",) and v}
        return "; ".join(f"{k}: {v}" for k, v in campos.items())

    if isinstance(parsed, list):
        def _score(p):
            status_ativo = 0 if str(p.get("Status", "")).upper() == "ATIVO" else 1
            tipo = f"{p.get('Tipo','')} {p.get('Assunto','')}".upper()
            eh_civel_trab = any(k in tipo for k in ("CIVEL", "TRABALHISTA", "FAZENDA"))
            return (status_ativo, 0 if not eh_civel_trab else 1)
        procs_ord = sorted(parsed, key=_score)
        itens = [
            f"{p.get('Numero','')} ({p.get('Tribunal','')}, {p.get('Tipo') or 'natureza não informada'}): "
            f"{p.get('Assunto','')} — {p.get('Status','')}"
            for p in procs_ord[:max_itens]
        ]
        sufixo = f" (+{len(parsed) - max_itens} outro(s))" if len(parsed) > max_itens else ""
        return "; ".join(itens) + sufixo

    return t[:800] + ("…" if len(t) > 800 else "")


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
9. MONITORAMENTO REFORÇADO só é cabível quando, além do vínculo PEP, houver pelo menos UM fator de risco adicional sensível e concreto: mídia/processo identificado mas não conclusivo, homônimo não descartado, empresa no mesmo município/UF de atuação do PEP em setor com interface relevante com o poder público, ou empresa aberta durante o mandato em setor sensível. Vínculo/mandato PEP ativo, isoladamente e sem nenhum desses fatores, é APROVAÇÃO — NUNCA use "mandato ativo" como única justificativa para monitoramento reforçado.
10. ACHADO DO PIPELINE INTERNO (mídia negativa / processos) NUNCA é "nada identificado" por padrão — os campos "Mídia adversa"/"Processos" abaixo já vêm resumidos com o(s) achado(s) mais relevante(s), quando existem. Se vier preenchido com um achado concreto, CITE-O explicitamente na 2ª frase — nunca escreva "não foram identificadas mídias ou processos desabonadores" quando o campo trouxer conteúdo. Se o achado vier acompanhado de "[risco homônimo ALTO/MEDIO: ...]", trate como NÃO CONFIRMADO — mencione a suspeita e a necessidade de confirmação de identidade pelo analista, mas NÃO escale automaticamente para REPROVAÇÃO só por isso (nome comum ≠ pessoa confirmada; ver regra sobre match exato). Achado com nível "Alto" e SEM alerta de homônimo, especialmente citando Corrupção/Criminal/Prisão/Improbidade/Homicídio/Tráfico, é achado factual concreto que basta para justificar, no mínimo, monitoramento reforçado (ou REPROVAÇÃO se confirmado e grave).
11. PROIBIDO citar a numeração destas REGRAS no texto do parecer (ex.: "regra 9", "item 9", "nos termos da regra"). Essas regras são só um guia de raciocínio interno — descreva o fator de risco em linguagem natural, nunca remetendo a uma regra interna do sistema.

EXIGÊNCIA SOBRE A BUSCA DE MÍDIA: a varredura automatizada deve combinar nome completo do PEP + município + cargo + período do mandato e explorar fontes regionais e setoriais (imprensa local/blogs estaduais, TRE, MP estadual, TCE, Câmara Municipal, Polícia Federal/Civil, DOU). Antes de afirmar "sem mídia adversa" você precisa ter consultado essas fontes. Achados de cassação/improbidade/operação contra o PEP titular ou owner-relacionado tornam a recomendação obrigatoriamente REPROVAÇÃO.

EXEMPLO DO ESTILO — APROVAÇÃO (referência absoluta; vínculo PEP ativo sem nenhum outro fator de risco):

"Trata-se de empresa cujo titular possui relacionamento de sócio com a PEP Josinalva Guerra Lins Silva (Vereadora de Natuba/PB), através de outra PJ (SUAS CONSULT LTDA - CNPJ 40.400.051/0001-25, que possui atividade de desenvolvimento e treinamentos em programas de computadores). Em análises reputacionais, não foram identificadas mídias ou processos desabonadores face à empresa, ao seu titular ou à PEP. Dito isso, considerando que não foram identificados desabonos relevantes sob a ótica de LD e que a atividade da empresa não guarda interface com o cargo público exercido, não temos objeções ao início do relacionamento, sugerimos a APROVAÇÃO do cadastro."

EXEMPLO DO ESTILO — MONITORAMENTO REFORÇADO (referência absoluta; exige fator adicional, aqui a interface setor-cargo no mesmo município):

"Trata-se de empresa cujo titular possui relacionamento de sócio com a PEP Antônio Carlos Ferreira (Secretário de Obras de Nova Serrana/MG), atuando no ramo de construção civil e prestação de serviços à administração pública. Em análises reputacionais, não foram identificadas mídias ou processos desabonadores face à empresa, ao seu titular ou à PEP. Dito isso, considerando a ausência de desabonos mas a interface direta entre a atividade da empresa (construção civil) e a pasta ocupada pelo PEP (Obras) no mesmo município, sugerimos a APROVAÇÃO SOB MONITORAMENTO REFORÇADO, dado o potencial conflito de interesses."

ESTRUTURA:
1ª frase: vínculo + PEP + cargo + município + atividade. Use formato: "Trata-se de empresa cujo titular [é o próprio PEP / é VINCULO da PEP NOME] (CARGO de CIDADE/UF), atuando em [CNAE]."
2ª frase: análise reputacional resumida. "Em análises reputacionais, [resultado]."
3ª frase: recomendação fundamentada. "Considerando [...], sugerimos [...]."

Retorne APENAS o parágrafo do parecer, sem nada antes ou depois."""


def montar_user_prompt(case: dict, findings: list) -> str:
    pep = case.get("pep_pf") or []
    pep_titular = _registro_pep_principal(pep)
    nome_pep = pep_titular.get("nome_titular") or "(não informado)"
    cargo_real = pep_titular.get("cargo_formal") or pep_titular.get("perfil") or "cargo não informado"
    orgao = pep_titular.get("orgao") or case.get("uf", "")
    vinculo = vinculo_natural(pep_titular.get("ds_vinculo"))
    data_inicio = pep_titular.get("data_inicio") or ""
    data_fim = pep_titular.get("data_fim") or ""
    status_mandato = _status_mandato_label(pep_titular) if pep_titular else "vigência não informada"

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

    pj_midia = _resumir_campo_pipeline(case.get("pj_midianegativas"))
    pf_midia = _resumir_campo_pipeline(case.get("pf_midianegativas"))
    pj_proc = _resumir_campo_pipeline(case.get("processosjudiciais_pj"))
    pf_proc = _resumir_campo_pipeline(case.get("processosjudiciais_pf"))

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
- Status do mandato (já calculado, não infira sozinho): {status_mandato}
{f'- Tipo de vínculo (DSVINCULO): {vinculo}' if not is_titular and vinculo else ''}

ACHADOS RELEVANTES: {findings_summary or '(nenhum achado externo material)'}

PIPELINE INTERNO:
- Mídia adversa PJ: {pj_midia}
- Mídia adversa PF: {pf_midia}
- Processos PJ: {pj_proc}
- Processos PF: {pf_proc}

Redija a sugestão em UM parágrafo (3-4 frases), texto fluido sem redundâncias, mencionando explicitamente o tipo de vínculo na 1ª frase."""


def _parece_completo(text: str) -> bool:
    """Mesma heurística de sanidade usada em generate-sugestao-lideranca.py —
    detecta o caso real (draft 5397f71c, 2026-08-12) em que a resposta foi
    cortada no meio da frase ('...caso descartado, o') e persistida sem
    checagem no pareceres-sugestao.json."""
    t = text.rstrip()
    return bool(t) and t.endswith((".", '"', "!", "?", "”", ")"))


def gerar(case: dict, findings: list, max_retries: int = 5) -> str:
    prompt = montar_user_prompt(case, findings)
    # Casos com achado de mídia detalhado (fonte, data, natureza do delito)
    # consomem mais tokens de saída do que o parágrafo padrão de 3-4 frases —
    # 400 truncou o draft 5397f71c antes da recomendação final.
    token_budgets = [500, 800, 1100]
    last_text = ""
    for attempt in range(max_retries):
        max_tokens = token_budgets[min(attempt, len(token_budgets) - 1)]
        try:
            r = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=max_tokens,
                temperature=0.3,
            )
            choice = r.choices[0]
            text = choice.message.content.strip().replace("\n\n", " ").replace("\n", " ")
            last_text = text
            truncado_pelo_modelo = getattr(choice, "finish_reason", None) == "length"
            if truncado_pelo_modelo or not _parece_completo(text):
                print(
                    f"     ⚠️  resposta parece truncada (finish_reason={getattr(choice, 'finish_reason', '?')}, "
                    f"max_tokens={max_tokens}) — tentando de novo com orçamento maior."
                )
                continue
            return text
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            wait = 2 ** (attempt + 1)  # 2s, 4s, 8s, 16s
            time.sleep(wait)
    raise RuntimeError(
        f"sugestão de parecer truncada após {max_retries} tentativas (draft {case.get('draft_id')}): "
        f"{last_text[-120:]!r}"
    )


def main():
    payload = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    items = payload["items"] if isinstance(payload, dict) else payload
    findings_all = json.loads(FINDINGS_PATH.read_text(encoding="utf-8"))

    # Preserva tudo o que já existe — só gera para casos NOVOS sem sugestão.
    # Revisões manuais (model=manual-*) ficam intactas; demais entradas também,
    # para evitar regenerar 46 prompts a cada sincronização (custo elevado de LLM).
    sugestoes = {}
    if OUT_PATH.exists():
        try:
            sugestoes = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            sugestoes = {}

    analistas = [c for c in items if c.get("bucket") == "CHECK_ANALISTA"]
    print(f"Total ANALISTA: {len(analistas)}")
    print(f"Modelo: {MODEL}\n")

    for i, c in enumerate(analistas, 1):
        did = c["draft_id"]
        # Preserva sugestão existente — não regenerar para economizar tokens
        existing = sugestoes.get(did)
        if isinstance(existing, dict) and existing.get("text"):
            print(f"  [{i}/{len(analistas)}] {c['full_name_pf']:42s} → preservado")
            continue
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
