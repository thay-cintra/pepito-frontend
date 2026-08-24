#!/usr/bin/env python
"""
Gera sugestão de PARECER DA LIDERANÇA (Mesa de Decisão) para os 11 casos
CHECK_LIDERANCA, escolhendo o template correto entre:
  - APROVADO
  - REPROVADO
  - APROVADO SOB MONITORAMENTO REFORÇADO
  - FALSO POSITIVO

Saída: src/data/pareceres-lideranca.json
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
PARECERES_REAL_PATH = ROOT / "src" / "data" / "pareceres-real.json"
OUT_PATH = ROOT / "src" / "data" / "pareceres-lideranca.json"


def _load_pareceres_real() -> dict:
    try:
        return json.loads(PARECERES_REAL_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


_PARECERES_REAL_CACHE: dict | None = None


def _get_parecer_analista(draft_id: str) -> str:
    """Retorna o comentário do analista (ENVIAR_LIDERANCA_PLD) para uso no prompt."""
    global _PARECERES_REAL_CACHE
    if _PARECERES_REAL_CACHE is None:
        _PARECERES_REAL_CACHE = _load_pareceres_real()
    entry = _PARECERES_REAL_CACHE.get(draft_id, {})
    comentarios = entry.get("comentarios", [])
    # Prioriza ENVIAR_LIDERANCA_PLD, depois qualquer comentário
    #
    # LIMITE GENEROSO (4000/2000, não 600/400): o corte anterior de 600 chars
    # cortava o parecer da analista NO MEIO da frase, antes de qualquer achado
    # concreto — o texto do analista segue o padrão "vínculo/PEP primeiro,
    # achados reputacionais depois", então truncar em 600 chars descartava
    # sistematicamente o achado (número de processo, artigo do CP, etc.) e
    # entregava ao LLM só o preâmbulo. Caso real: draft c0270b8a (2026-08-12)
    # — parecer de 1540 chars citando processo ativo de tentativa de
    # homicídio (verificado via JusBrasil consulta pro); o corte em 600
    # eliminava a citação inteira, e o LLM concluiu "dados não sustentam
    # reprovação" sem nunca ter recebido o achado. Levantamento: 54/168
    # (32%) dos pareceres ENVIAR_LIDERANCA_PLD já excediam 600 chars — não
    # era caso isolado. Novo limite (4000) cobre com folga o maior parecer
    # real observado (1540 chars); ver INCIDENT-REPORT-2026-08-12-MANDATO-PEP.md.
    for c in comentarios:
        if c.get("acao") == "ENVIAR_LIDERANCA_PLD" and c.get("text"):
            text = c["text"]
            return text[:4000] + ("…" if len(text) > 4000 else "")
    for c in comentarios:
        if c.get("text"):
            text = c["text"]
            return text[:2000] + ("…" if len(text) > 2000 else "")
    return ""


def _gerar_resumo(texto: str, decisao: str) -> str:
    """Extrai 1-2 frases centrais do parecer como resumo sucinto.

    Corta na fronteira de frase (". "), nunca no meio de uma palavra/número.
    Bug real (2026-08-24): o corte bruto `body[0][:280]` cortava sempre em
    280 chars exatos sem olhar pra onde caía — "...durante o mandato at"
    (ativo), "...constituída em 201" (2013), "...Processo n.º
    5208402-18.2025.8.13." (faltava ".0024)") — sem "…" indicando corte,
    parecendo texto corrompido pra quem revisa. Mesma lógica de fronteira de
    frase já existe no lado TypeScript (`extrairResumoParecer` em
    registration-enrich.ts, resolvido antes) — replicada aqui. Ver
    INCIDENT-REPORT-2026-08-24-RESUMO-TRUNCADO.md.
    """
    lines = [l.strip() for l in texto.split("\n") if l.strip()]
    body = [l for l in lines if not l.startswith("Decisão:") and not l.startswith("CNPJ:")]
    labels = {
        "reprovado": "REPROVAR",
        "monitoramento": "APROVAR com Diligência Reforçada",
        "aprovado": "APROVAR",
        "falso_positivo": "FALSO POSITIVO",
    }
    if not body:
        return ""
    prefixo = labels.get(decisao, "REVISAR")

    paragrafo = body[0]
    first_dot = paragrafo.find(". ")
    if 20 < first_dot < 200:
        frase_curta = paragrafo[: first_dot + 1]
    else:
        frase_curta = paragrafo[:180]
    if not frase_curta.endswith("."):
        frase_curta += "…"
    return f"{prefixo} — {frase_curta}"

client = OpenAI(
    api_key=os.environ["LITELLM_API_KEY"],
    base_url=os.environ["LITELLM_BASE_URL"],
)
MODEL = os.environ.get("LLM_MODEL", "anthropic-claude-sonnet-4-6")

VINCULO_LABEL = {
    "IRMA(O)": "irmão", "PAI": "pai", "MAE": "mãe", "FILHO": "filho", "FILHA": "filha",
    "FILHA(O)": "filho/filha", "CONJUGE": "cônjuge", "TIA(O)": "tio/tia",
    "SOBRINHA(O)": "sobrinho/sobrinha", "PRIMA(O)": "primo/prima",
    "AVO": "avô/avó", "NETA(O)": "neto/neta",
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

    Substitui o truncamento bruto por caractere (`campo[:120]`), que cortava
    o JSON no meio e escondia achados reais mesmo quando existiam. Casos
    reais que motivaram o fix (2026-08-12):
      - PEP Carla Suzi Emerenciano: notícia de CONDENAÇÃO por facilitar
        contratação de parente (nepotismo/improbidade) — 100% invisível ao
        LLM porque o JSON de mídia (1979 chars) era cortado em 120.
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


SYSTEM_PROMPT = """Você é o Líder de Compliance/PLD da Cora na Mesa de Decisão (2ª Camada). O analista já fez a diligência — seu papel é validar ou divergir da recomendação dele com base nos fatos que ele levantou.

REGRAS DE DECISÃO:
(1) APROVADO — vínculo PEP sem achado adverso e sem fator de risco adicional sensível. É o DESFECHO PADRÃO quando não há evidência material nem fator agravante — vínculo/mandato PEP ativo, isoladamente, NUNCA é motivo suficiente para nada além de aprovação.
(2) REPROVADO — achado factual concreto: processo criminal ativo, mídia adversa confirmada, sanção CEIS/CGU, contrato público via inexigibilidade com ente do PEP. Não reprovar apenas por suspeita estrutural.

PESO DO PARECER DO ANALISTA (regra crítica, violada em caso real — draft c0270b8a, 2026-08-12): os campos automatizados internos (processosjudiciais_pf/pj, mídia) são uma varredura superficial por nome/CNPJ e frequentemente NÃO capturam o que a pesquisa manual do analista encontrou — "processos judiciais não encontrados" nesses campos NÃO significa que o achado do analista é inválido. Se o parecer do analista citar um achado ESPECÍFICO E VERIFICÁVEL (número de processo, tribunal, artigo do Código Penal, data, natureza do crime), trate-o como achado factual concreto para fins da regra (2)/(3) — NUNCA escreva "os dados fornecidos não sustentam esse desfecho" só porque os campos automatizados vieram vazios. Só desconsidere um achado citado pelo analista se houver razão concreta para duvidar dele no material fornecido (ex.: o próprio analista relata homônimo não confirmado, ou processo textualmente arquivado/extinto sem repercussão). Na dúvida sobre a gravidade, sinalize a divergência para o revisor humano em vez de descartar o achado.

ACHADO DO PIPELINE INTERNO (mídia/processos abaixo, quando o analista não repetiu o mesmo achado no parecer): NUNCA é "nada identificado" por padrão — os campos já vêm resumidos com o achado mais relevante, quando existe. Se vier preenchido com conteúdo concreto, CITE-O explicitamente. Se vier com "[risco homônimo ALTO/MEDIO: ...]", trate como NÃO CONFIRMADO — mencione a suspeita e a necessidade de confirmação de identidade, mas NÃO escale para REPROVAÇÃO só por isso (nome comum ≠ pessoa confirmada). Achado nível "Alto" sem alerta de homônimo, especialmente citando Corrupção/Criminal/Prisão/Improbidade/Homicídio/Tráfico, é achado factual concreto para fins da regra (2)/(3).
(3) MONITORAMENTO REFORÇADO — exige, além do vínculo PEP, pelo menos UM fator de risco adicional sensível e concreto: (a) mídia ou processo identificado mas não conclusivo/insuficiente para reprovação; (b) homônimo não descartado; (c) empresa no mesmo município/UF de atuação do PEP E em setor com interface relevante com o poder público; (d) empresa aberta durante o mandato do PEP em setor sensível. NUNCA é o desfecho default só por o vínculo/mandato estar ativo — na ausência desses fatores, a resposta correta é APROVADO.
(4) FALSO POSITIVO — PEP não confirmado ou erro de cadastro.

FORMATO — MÁXIMO 5 LINHAS NO TOTAL:

```
Decisão: [STATUS LITERAL]
CNPJ: [CNPJ] — [Razão Social]

[Linha 1: valide ou corrija a recomendação do analista. Ex: "O analista recomenda aprovação com monitoramento — concordo." ou "O analista recomenda aprovação, porém identificou [X] — divergência: reprovar."]
[Linha 2-3: cite o fator determinante em 1-2 frases. Se o analista já explicou, apenas confirme. Se houver divergência, explique em 1 frase.]
[Linha 4: recomendação final. Citar BACEN 3.978/2020.]
```

OBRIGATÓRIO: Use o PARECER DO ANALISTA como ponto de partida. Não repita o que ele disse — apenas valide, complemente ou divirja.
PROIBIDO: Repetir dados do caso que o analista já descreveu (CNPJ, nome, cargo PEP, vínculo). Máximo 5 linhas.

EXEMPLOS REAIS DA LIDERANÇA (use como referência absoluta):

[APROVADO — exemplo] "Decisão: CADASTRO APROVADO
CNPJ: 37.836.141/0001-59 — Francisco de assis freire 08697377404

O único fator de risco é o relacionamento com PEP. Contudo, a atividade econômica da empresa é de baixo risco para crimes de lavagem de dinheiro ou corrupção, sem aparente conflito de interesses com o cargo político do parente. A ausência total de sanções, processos por improbidade ou mídia adversa para a empresa, seu titular e o PEP relacionado, mitiga significativamente o risco inicial.

Após análise aprofundada, os apontamentos não configuram risco impeditivo. Recomendo a APROVAÇÃO DO CADASTRO conforme política PLD/FT vigente."

[REPROVADO — exemplo] "Decisão: CADASTRO REPROVADO
CNPJ: 66.197.923/0001-93 — RAV SERVICOS MEDICOS LTDA

Risco Elevado. A empresa RAV SERVICOS MEDICOS LTDA foi constituída há menos de um mês (10/04/2026), atuando em setor de alto risco para contratações públicas (serviços de urgência). O sócio único, Roberto Alfonso Villacrez Flores, possui vínculo societário direto em outra empresa com o PEP Lazaro de Araujo de Almeida, atual prefeito de Fonte Boa/AM. Ambos os PEPs relacionados, Lazaro de Almeida e Cleinaldo de Almeida Costa (ex-reitor da UEA), possuem mídias adversas relevantes e processos judiciais envolvendo alegações de irregularidades na gestão pública. A convergência de empresa recém-criada, sócio com ligação direta a PEP com mídia adversa e atuação em setor sensível configura um cenário de altíssimo risco para conflito de interesses e lavagem de dinheiro.

Diante dos fatores de risco identificados, recomendo a NÃO APROVAÇÃO do relacionamento comercial, por incompatibilidade com o apetite de risco da instituição, conforme Circular BACEN 3.978/2020."

[MONITORAMENTO REFORÇADO — exemplo] "Decisão: CADASTRO APROVADO SOB MONITORAMENTO REFORÇADO
CNPJ: 25.061.741/0001-03 — Erykson ferreira lima 03996534302

A análise confirma o vínculo PEP de Erykson Ferreira Lima com seu irmão, Edson Ferreira Lima, vereador em Farias Brito/CE. A empresa, um comércio varejista, foi aberta em 2016, sendo preexistente ao mandato do PEP iniciado em 2021. Embora a empresa esteja sediada na mesma cidade da atuação política, o que exige atenção, a natureza da atividade (varejo) e a anterioridade da constituição da empresa mitigam significativamente os riscos de conflito de interesse e de uso para fins ilícitos. Não foram encontrados apontamentos negativos em fontes de sanções, judiciais ou de mídia adversa para a empresa, seu titular ou o PEP.

Recomendo a APROVAÇÃO SOB MONITORAMENTO REFORÇADO, com revisão periódica dos fatores de risco, conforme Circular BACEN 3.978/2020."

[FALSO POSITIVO — exemplo] "Decisão: FALSO POSITIVO — CADASTRO APROVADO
CNPJ: [...]

A análise identificou que houve erro de processamento e não foram identificadas pessoas expostas politicamente no QSA ou como relacionados.

Recomendo a APROVAÇÃO DO CADASTRO conforme política PLD/FT vigente."

REGRAS:
- SEMPRE cite o tipo de vínculo (irmão, pai, mãe, sócio, etc.) extraído do DSVINCULO.
- SEMPRE cite o cargo formal real do PEP (extraído de Descrição_Função).
- Use os achados externos (mídia/processos) quando houver, indicando fonte.
- NÃO invente fatos. Se não há mídia adversa, declare "ausência total de sanções, processos por improbidade ou mídia adversa".
- Termine com a recomendação no parágrafo final.
- Retorne APENAS o texto formatado, sem nada antes ou depois.

EXPECTATIVA SOBRE A BUSCA DE MÍDIA (orienta como interpretar/exigir achados):
A busca automatizada de mídia adversa NUNCA pode se restringir a portais nacionais (G1, Folha, UOL). É obrigatório explorar fontes regionais e setoriais, porque a maioria dos casos PEP de cidades pequenas só aparece em veículos locais. Antes de concluir "sem mídia adversa", a busca deve ter combinado os termos: nome completo do PEP + município de atuação + cargo formal + período do mandato (e, quando aplicável, palavras-chave: "cassação", "improbidade", "operação", "TCE", "TRE", "juiz eleitoral", "MPF", "denúncia"). Fontes que devem ter sido consultadas:
  • Imprensa regional/estadual e blogs jornalísticos locais (ex: portaldodesa.com.br, diegoemir.com, blogs políticos do estado)
  • TRE/TSE (decisões eleitorais, cassação, desincompatibilização, contas de campanha rejeitadas)
  • MP estadual (mp{UF}.mp.br) — denúncias por improbidade administrativa
  • TCE estadual — reprovação de contas, multas
  • Câmara Municipal / Assembleia Legislativa — atas e processos
  • Portal da Transparência da prefeitura/órgão correspondente
  • Polícia Federal / Civil — operações nominais
  • DOU / Diário Oficial estadual / Tribunal de Contas
Se o caso vem com findings que NÃO citam o município correto do PEP, ou que falham em cruzar nome+município+período, EXIJA REPESQUISA antes de decidir — homônimos em cidades diferentes NÃO comprovam ausência de mídia. Indícios de cassação, improbidade ou operação contra o PEP titular ou owner-relacionado configuram REPROVAÇÃO obrigatória."""


def montar_user_prompt(case: dict, findings: list) -> str:
    pep = case.get("pep_pf") or []
    pep_titular = _registro_pep_principal(pep)
    nome_pep = pep_titular.get("nome_titular") or "(não informado)"
    cargo = pep_titular.get("cargo_formal") or pep_titular.get("perfil") or "cargo não informado"
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
        )[:3]
        findings_summary = "\n".join(
            f"  - [{f.get('risk_indicator', '').upper()}] {f.get('source', '')}: {f.get('title', '')} — {f.get('snippet', '')[:200]}"
            + (f" [HOMÔNIMO: {f['homonimo_alerta']}]" if f.get("homonimo_alerta") else "")
            for f in sorted_f
        )

    pj_midia = _resumir_campo_pipeline(case.get("pj_midianegativas"))
    pf_midia = _resumir_campo_pipeline(case.get("pf_midianegativas"))
    pj_proc = _resumir_campo_pipeline(case.get("processosjudiciais_pj"))
    pf_proc = _resumir_campo_pipeline(case.get("processosjudiciais_pf"))

    cnae_clean = case.get("cnae", "").split(" - ")[-1] if " - " in case.get("cnae", "") else case.get("cnae", "")

    return f"""DADOS DO CASO (CHECK_LIDERANCA):
- Razão Social: {case['rf_nome_oficial']}
- CNPJ: {case['cnpj']}
- Owner: {case['full_name_pf']} (CPF {case['cpf']})
- CNAE: {cnae_clean}
- Cidade da PJ: {case.get('cidade', '')}/{case.get('uf', '')}
- Data abertura PJ: {case.get('data_constituicao', '')} (calcular idade vs mandato do PEP)
- Score PLD: {case.get('score_pld', '')}

VINCULAÇÃO PEP (Credilink):
- {'O OWNER É O PRÓPRIO PEP TITULAR' if is_titular else f'Owner é {vinculo or "vínculo"} de PEP'}
- PEP titular: {nome_pep}
- Cargo formal: {cargo}
- Órgão/Município: {orgao}
- Início mandato: {data_inicio}
- Fim mandato: {data_fim}
- Status do mandato (já calculado, não infira sozinho): {status_mandato}
{f'- Tipo de vínculo: {vinculo}' if not is_titular and vinculo else ''}

ACHADOS EXTERNOS:
{findings_summary or '  (nenhum achado externo material)'}

PIPELINE INTERNO:
- Mídia adversa PJ: {pj_midia}
- Mídia adversa PF: {pf_midia}
- Processos PJ: {pj_proc}
- Processos PF: {pf_proc}

PARECER DO ANALISTA (insumo da 1ª Camada):
{_get_parecer_analista(case.get('draft_id', '')) or '(sem parecer do analista disponível)'}

ESCOLHA o desfecho apropriado e redija o parecer no formato exato dos exemplos do system prompt. Use os dados fornecidos. Cite o vínculo e cargo formal.
Use o parecer do analista como insumo adicional — se o analista identificou achados concretos (processos criminais, contratos públicos, mídias adversas), considere-os na sua decisão."""


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
            text = r.choices[0].message.content.strip()
            # Remove eventuais blocos ``` Markdown
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text.rsplit("```", 1)[0].rstrip()
            return text.strip()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2)
    return ""


def detect_decisao(text: str) -> str:
    """Extrai a decisão a partir da linha "Decisão: ..." do template (ver
    FORMATO no SYSTEM_PROMPT) — NUNCA faz keyword-match no corpo inteiro do
    texto, porque o corpo pode citar as mesmas palavras se referindo a um
    achado específico, não à decisão do caso. Bug real: draft 1a38bc16
    (2026-08-13) tinha "Decisão: CADASTRO APROVADO SOB MONITORAMENTO
    REFORÇADO" mas foi classificado como "falso_positivo" porque o corpo
    dizia "...descartado como falso positivo" sobre uma notícia irrelevante
    (match de frase genérica) — nada a ver com a decisão do caso.
    """
    linha_decisao = ""
    for linha in text.split("\n"):
        cabecalho = linha.strip().upper()
        if cabecalho.startswith("DECISÃO:") or cabecalho.startswith("DECISAO:"):
            linha_decisao = cabecalho
            break
    # Fallback pro texto inteiro só se o template não tiver sido seguido
    # (não deveria acontecer, mas não queremos um caso sem decisão nenhuma).
    t = linha_decisao or text.upper()
    if "FALSO POSITIVO" in t:
        return "falso_positivo"
    if "REPROVADO" in t and "APROVADO SOB" not in t:
        return "reprovado"
    if "MONITORAMENTO REFORÇADO" in t or "MONITORAMENTO REFORCADO" in t:
        return "monitoramento"
    if "APROVADO" in t:
        return "aprovado"
    return "monitoramento"


def main():
    payload = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    items = payload["items"] if isinstance(payload, dict) else payload
    findings_all = json.loads(FINDINGS_PATH.read_text(encoding="utf-8"))

    # Carrega pareceres existentes — preserva os revisados manualmente (model=manual-*)
    sugestoes = {}
    if OUT_PATH.exists():
        existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        for did, entry in existing.items():
            if isinstance(entry, dict) and "manual" in (entry.get("model") or ""):
                sugestoes[did] = entry  # nunca sobrescreve revisões manuais

    liderancas = [c for c in items if c.get("bucket") == "CHECK_LIDERANCA"]
    print(f"Total LIDERANCA: {len(liderancas)}")
    print(f"Modelo: {MODEL}\n")

    for i, c in enumerate(liderancas, 1):
        did = c["draft_id"]
        # Pula casos revisados manualmente — decisão já está correta
        if did in sugestoes:
            # Garante que o resumo existe nos manuais
            if not sugestoes[did].get("resumo") and sugestoes[did].get("text"):
                sugestoes[did]["resumo"] = _gerar_resumo(
                    sugestoes[did]["text"], sugestoes[did].get("decisao", "monitoramento")
                )
            print(f"  [{i}/{len(liderancas)}] {c['full_name_pf']:42s} → preservado (revisão manual: {sugestoes[did].get('decisao')})")
            continue
        f = findings_all.get(did) or []
        if not isinstance(f, list):
            f = []
        print(f"  [{i}/{len(liderancas)}] {c['full_name_pf']:42s} → gerando parecer Liderança...")
        try:
            texto = gerar(c, f)
            decisao = detect_decisao(texto)
            resumo = _gerar_resumo(texto, decisao)
            sugestoes[did] = {
                "text": texto,
                "resumo": resumo,
                "decisao": decisao,
                "model": MODEL,
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            print(f"     → decisão: {decisao}")
            OUT_PATH.write_text(json.dumps(sugestoes, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"    ❌ falhou: {e}")

    print(f"\n✓ {len([s for s in sugestoes.values() if s.get('text')])}/{len(liderancas)} pareceres Liderança gerados")
    from collections import Counter
    print(f"\nDistribuição de decisões:")
    for k, v in Counter(s.get("decisao") for s in sugestoes.values()).items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
