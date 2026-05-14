#!/usr/bin/env python
"""
Pesquisa de mídia e judicial OBRIGATÓRIA para casos CHECK_LIDERANCA.

Fontes (em ordem de execução):
  1. JusBrasil Background Check API (produção) — processos criminais, BNMP e MP
     por CPF do owner E CPF do PEP (quando sócio/titular)
  2. WebSearch (Anthropic web_search_20250305) — mídia adversa, Portal da
     Transparência, confirmação de cargo PEP, contratos públicos

Os achados da API JusBrasil são registrados com risk_indicator estruturado
(alto/medio/baixo) e nunca dependem de indexação web aberta — cobrem Vara
Criminal Estadual, TRF, BNMP e MP que a busca web não alcança.

Roda como [2/5] no refresh-daily.sh, após build-real-queue.py.
"""
import json
import os
import re
import time
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Session JusBrasil — verify=False para ambiente corporativo com proxy SSL auto-assinado
_JUS_SESSION = requests.Session()
_JUS_SESSION.verify = False
_JUS_SESSION.headers.update({
    "User-Agent": "curl/8.4.0",
    "Accept": "application/json",
})
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = ROOT / "src" / "data" / "registration-queue-real.json"
FINDINGS_PATH = ROOT / "src" / "data" / "media-findings.json"

MODEL = "anthropic-claude-sonnet-4-6"

# Cliente Anthropic: usa ANTHROPIC_API_KEY direto se disponível,
# senão usa LITELLM_API_KEY (proxy Cora) com base_url alternativa.
_anthr_key = os.environ.get("ANTHROPIC_API_KEY")
_litellm_key = os.environ.get("LITELLM_API_KEY")
_litellm_url = os.environ.get("LITELLM_BASE_URL", "")

if _anthr_key:
    import anthropic
    claude = anthropic.Anthropic(api_key=_anthr_key)
    WEB_SEARCH_AVAILABLE = True
elif _litellm_key:
    import anthropic
    claude = anthropic.Anthropic(api_key=_litellm_key, base_url=_litellm_url)
    WEB_SEARCH_AVAILABLE = True
else:
    claude = None
    WEB_SEARCH_AVAILABLE = False
    print("AVISO: Nenhuma chave Anthropic disponível — rodando em modo JusBrasil-only.")

JUS_KEY = os.environ.get("JUSBRASIL_API_KEY", "")
JUS_BASE = os.environ.get("JUSBRASIL_API_BASE", "https://api.jusbrasil.com.br")

# ── Controle de limite JusBrasil ────────────────────────────────────────────
_JUS_USAGE_PATH = Path(__file__).parent / "jusbrasil-usage.json"
_JUS_LIMIT = 325       # 65% do contrato — 35% reservado para alertas de monitoramento
_JUS_WARN_THRESHOLD = 293  # aviso ao atingir 90% do limite efetivo


def _jus_usage_load() -> dict:
    try:
        return json.loads(_JUS_USAGE_PATH.read_text())
    except Exception:
        return {"total": 0, "by_month": {}, "limit": _JUS_LIMIT}


def _jus_usage_save(data: dict) -> None:
    _JUS_USAGE_PATH.write_text(json.dumps(data, indent=2))


def _jus_usage_increment(n: int = 1) -> tuple[int, bool]:
    """Incrementa contador e retorna (total, limite_atingido)."""
    import datetime
    data = _jus_usage_load()
    month = datetime.date.today().strftime("%Y-%m")
    data["total"] = data.get("total", 0) + n
    data["by_month"][month] = data["by_month"].get(month, 0) + n
    _jus_usage_save(data)
    return data["total"], data["total"] >= _JUS_LIMIT


def _jus_quota_exceeded() -> bool:
    return _jus_usage_load().get("total", 0) >= _JUS_LIMIT


def _jus_quota_warning() -> bool:
    return _jus_usage_load().get("total", 0) >= _JUS_WARN_THRESHOLD


_FINDING_LIMITE_ATINGIDO = {
    "title": "⚠️ VERIFICAÇÃO MANUAL NECESSÁRIA — Limite JusBrasil atingido",
    "url": "https://www.jusbrasil.com.br/consulta-pro/configuracoes",
    "snippet": (
        "Quota de 500 consultas JusBrasil Background Check foi atingida para o período contratual. "
        "A diligência judicial automática não pôde ser realizada para este caso. "
        "OBRIGATÓRIO: realizar verificação manual de processos criminais, BNMP e MP "
        "diretamente no JusBrasil PRO antes de aprovar ou enviar para a Mesa de Decisão."
    ),
    "source": "Sistema Pepito — Controle de Quota JusBrasil",
    "risk_indicator": "medio",
    "tipo": "processo",
    "match": "N/A — consulta automática não realizada por limite de quota",
}

TESS_ACCESS_KEY = os.environ.get("TESSERATI_ACCESS_KEY", "")
TESS_BASE = os.environ.get("TESSERATI_API_BASE", "https://api.tesserati.com.br")
_tess_token: str | None = None  # cached JWT (válido 24h)


def _tess_auth() -> str | None:
    """Obtém (ou reutiliza) o JWT da Tesserati API."""
    global _tess_token
    if _tess_token or not TESS_ACCESS_KEY:
        return _tess_token
    try:
        resp = _JUS_SESSION.post(
            f"{TESS_BASE}/api/Autenticar",
            json={"accessKey": TESS_ACCESS_KEY},
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("authenticated"):
                _tess_token = data["accessToken"]
                return _tess_token
        print(f"      Tesserati auth falhou: {resp.status_code} {resp.text[:100]}")
    except Exception as e:
        print(f"      Tesserati auth erro: {e}")
    return None


def _tess_get(endpoint: str, params: dict) -> dict:
    """GET autenticado na Tesserati API."""
    token = _tess_auth()
    if not token:
        return {}
    try:
        resp = _JUS_SESSION.get(
            f"{TESS_BASE}/{endpoint}",
            params=params,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=20,
        )
        if resp.status_code == 200:
            return resp.json()
        print(f"      Tesserati GET {endpoint} HTTP {resp.status_code}: {resp.text[:100]}")
        return {}
    except Exception as e:
        print(f"      Tesserati GET {endpoint} erro: {e}")
        return {}


# Tipificações de listas sancionatórias que implicam alto risco
TESS_LISTAS_ALTO = {
    "ofac", "onu", "un", "interpol", "pep internacional", "terrorismo",
    "narcotráfico", "narcotrafico", "lavagem", "ceis", "cnep", "improbidade",
}


def consultar_tesserati(cpf: str, nome: str, cnpj: str = "", papel: str = "owner") -> list[dict]:
    """
    Consulta Tesserati: MandadosPrisao, ProcessoTribunalJustica, MidiasNegativas,
    Compliance (CEIS/CNEP) e ComplianceInternacional para CPF/nome.
    """
    if not TESS_ACCESS_KEY:
        return []

    cpf_clean = re.sub(r"\D", "", cpf or "")
    findings: list[dict] = []

    # ── 1. Mandados de Prisão ─────────────────────────────────────────────────
    if cpf_clean:
        r = _tess_get("api/MandadosPrisao", {"cpf": cpf_clean})
        result = r.get("result")
        if result and isinstance(result, list) and len(result) > 0:
            for m in result:
                findings.append({
                    "title": f"Tesserati BNMP — Mandado de Prisão — {nome}",
                    "url": "https://bnmp.cnj.jus.br/",
                    "snippet": (
                        f"Mandado de prisão identificado via Tesserati para {nome} (CPF {cpf}). "
                        f"Dados: {json.dumps(m, ensure_ascii=False)[:200]}"
                    ),
                    "source": "Tesserati — BNMP Nacional",
                    "risk_indicator": "alto",
                    "tipo": "processo",
                    "match": f"CPF {cpf}",
                    "decisao_recomendada": f"REPROVAÇÃO — mandado de prisão ativo para {papel}.",
                })

    # ── 2. Processos Tribunais (civil + criminal) ─────────────────────────────
    if cpf_clean:
        r = _tess_get("api/ProcessoTribunalJustica", {"cpf": cpf_clean})
        result = r.get("result")
        if result and isinstance(result, dict):
            lawsuits = result.get("lawsuits", [])
            criminais = [l for l in lawsuits if "CRIMINAL" in ((l.get("courtType") or "") + (l.get("type") or "")).upper()
                        or "PENAL" in (l.get("mainSubject") or "").upper()
                        or "CRIME" in (l.get("mainSubject") or "").upper()]
            if criminais:
                tip_list = [l.get("mainSubject","")[:60] for l in criminais[:3]]
                findings.append({
                    "title": f"Tesserati — Processos criminais ({len(criminais)}) — {nome}",
                    "url": "https://api.tesserati.com.br/api/ProcessoTribunalJustica",
                    "snippet": (
                        f"{nome} tem {len(criminais)} processo(s) criminal(is) via Tesserati. "
                        f"Assuntos: {'; '.join(tip_list)}. "
                        f"Fonte: base consolidada de tribunais brasileiros."
                    ),
                    "source": "Tesserati — ProcessoTribunalJustica",
                    "risk_indicator": "alto" if criminais else "medio",
                    "tipo": "processo",
                    "match": f"CPF {cpf}",
                    "decisao_recomendada": f"REPROVAÇÃO — {len(criminais)} processo(s) criminal(is) confirmado(s) via Tesserati." if criminais else "",
                })

    # ── 3. Mídias Negativas ───────────────────────────────────────────────────
    if nome:
        r = _tess_get("api/MidiasNegativas", {"Termo": nome})
        result = r.get("result")
        if result and isinstance(result, list) and len(result) > 0:
            findings.append({
                "title": f"Tesserati — Mídias Negativas — {nome}",
                "url": "https://api.tesserati.com.br/api/MidiasNegativas",
                "snippet": (
                    f"{len(result)} mídia(s) negativa(s) identificada(s) para {nome} via Tesserati. "
                    f"Primeiro resultado: {json.dumps(result[0], ensure_ascii=False)[:200]}"
                ),
                "source": "Tesserati — Mídias Negativas",
                "risk_indicator": "medio",
                "tipo": "midia",
                "match": f"Nome {nome}",
            })

    # ── 4. Compliance Nacional (CEIS/CNEP) ────────────────────────────────────
    if cpf_clean:
        r = _tess_get("api/CNEP", {"cnpj": cnpj}) if cnpj else {}
        result = r.get("result")
        if result and isinstance(result, list) and len(result) > 0:
            findings.append({
                "title": f"Tesserati CNEP — Empresa punida — {nome}",
                "url": "https://api.tesserati.com.br/api/CNEP",
                "snippet": f"Empresa {cnpj} consta no CNEP (Cadastro Nacional de Empresas Punidas). {json.dumps(result[0],ensure_ascii=False)[:200]}",
                "source": "Tesserati — CNEP",
                "risk_indicator": "alto",
                "tipo": "processo",
                "match": f"CNPJ {cnpj}",
                "decisao_recomendada": "REPROVAÇÃO — empresa punida conforme CNEP.",
            })

    return findings

VINCULO_LABEL = {
    "IRMA(O)": "irmão/irmã", "PAI": "pai", "MAE": "mãe", "FILHO": "filho",
    "FILHA": "filha", "FILHA(O)": "filho/filha", "FILHO(A)": "filho/filha",
    "CONJUGE": "cônjuge", "CONJUGE*": "cônjuge", "POSSIVEL CONJUGE": "possível cônjuge",
    "TIA(O)": "tio/tia", "TIO(A)": "tio/tia",
    "SOBRINHA(O)": "sobrinho/sobrinha", "SOBRINHO(A)": "sobrinho/sobrinha",
    "PRIMA(O)": "primo/prima", "PRIMO(A)": "primo/prima",
    "AVO": "avô/avó", "NETA(O)": "neto/neta", "NETO(A)": "neto/neta",
    "SOGRA": "sogra/sogro", "PARENTE": "parente", "SOCIO": "sócio",
}

TRF_POR_UF = {
    "AC": 1, "AM": 1, "AP": 1, "PA": 1, "RO": 1, "RR": 1, "TO": 1,
    "AL": 5, "BA": 1, "CE": 5, "MA": 1, "PB": 5, "PE": 5, "PI": 1,
    "RN": 5, "SE": 5, "ES": 2, "MG": 1, "RJ": 2, "SP": 3,
    "PR": 4, "RS": 4, "SC": 4, "DF": 1, "GO": 1, "MS": 3, "MT": 1,
}

# Tipificações que implicam reprovação imediata (polo passivo = réu)
TIPIFICACOES_ALTO = {
    "tráfico", "trafico", "drogas", "entorpecentes",
    "estelionato", "falsidade", "fraude", "lavagem",
    "homicídio", "homicidio", "roubo", "furto qualificado",
    "associação criminosa", "associacao criminosa", "organização criminosa",
    "peculato", "corrupção", "corrupcao", "improbidade",
    "sequestro", "extorsão", "extorsao", "concussão",
}


def _cpf_digits(cpf: str) -> str:
    """Remove formatação do CPF."""
    return re.sub(r"\D", "", cpf or "")


def _jus_post(endpoint: str, payload: dict) -> dict:
    """Faz POST na API JusBrasil via requests. Rastreia quota (limite 500).
    Retorna {"_quota_exceeded": True} se limite atingido."""
    if not JUS_KEY:
        return {}
    if _jus_quota_exceeded():
        return {"_quota_exceeded": True}
    url = f"{JUS_BASE}/{endpoint}"
    try:
        resp = _JUS_SESSION.post(
            url, json=payload,
            headers={"apikey": JUS_KEY, "Content-Type": "application/json"},
            timeout=30,
        )
        total, exceeded = _jus_usage_increment(1)
        if _jus_quota_warning():
            print(f"      ⚠️  JusBrasil: {total}/{_JUS_LIMIT} consultas usadas")
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in (429, 402):
            print(f"      JusBrasil QUOTA EXCEEDED ({resp.status_code})")
            return {"_quota_exceeded": True}
        print(f"      JusBrasil HTTP {resp.status_code} em /{endpoint}: {resp.text[:200]}")
        return {}
    except Exception as e:
        print(f"      JusBrasil erro em /{endpoint}: {e}")
        return {}


def _classificar_tipificacoes(tipificacoes: list[dict]) -> tuple[str, list[str]]:
    """Classifica lista de tipificações → (risk_indicator, nomes)."""
    nomes = [t.get("tipo_de_ocorrencia", "") for t in tipificacoes]
    for nome in nomes:
        for kw in TIPIFICACOES_ALTO:
            if kw in nome.lower():
                return "alto", nomes
    return "medio", nomes


def consultar_jusbrasil(cpf: str, nome: str, papel: str = "owner") -> list[dict]:
    """
    Consulta criminal, BNMP e MP para um CPF via JusBrasil Background Check.
    Retorna lista de findings estruturados.
    """
    cpf_clean = _cpf_digits(cpf)
    if not cpf_clean or len(cpf_clean) != 11:
        return []

    # Verifica quota ANTES de qualquer chamada
    if _jus_quota_exceeded():
        alert = dict(_FINDING_LIMITE_ATINGIDO)
        alert["snippet"] = f"{alert['snippet']} CPF consultado: {cpf} ({nome}, {papel})."
        return [alert]

    findings = []
    payload = {"documentNumber": cpf_clean, "pagination": {"cursor": "", "size": 50}}

    # ── 1. Processos criminais ────────────────────────────────────────────────
    resp = _jus_post("background-check/lawsuits/criminal", payload)
    if resp.get("_quota_exceeded"):
        alert = dict(_FINDING_LIMITE_ATINGIDO)
        alert["snippet"] = f"{alert['snippet']} CPF: {cpf} ({nome})."
        return [alert]
    nome_api = resp.get("nome", nome)
    processos = resp.get("processos", [])
    total = resp.get("pagination", {}).get("total", 0)

    criminal_alto = []
    criminal_outros = []

    for p in processos:
        polo_passivo = p.get("polo_passivo", False)
        conf = p.get("confianca_associacao", "BAIXA")
        tipificacoes = p.get("tipificacao", [])
        risco, tip_nomes = _classificar_tipificacoes(tipificacoes)
        classe = p.get("classe_processual", p.get("assunto", ""))
        numero = p.get("numero_processo", "")
        link = p.get("link", "")
        tribunal = p.get("status", {}).get("tribunal", "") or p.get("tribunal", "")

        if not polo_passivo and risco != "alto":
            # Não é réu e tipificação não é crítica — ignorar (pode ser vítima/testemunha)
            continue

        entry = {
            "title": f"Processo criminal — {nome_api} ({papel.upper()})",
            "url": link or f"https://www.jusbrasil.com.br/processos/",
            "snippet": (
                f"{nome_api} figura como {'réu (polo passivo)' if polo_passivo else 'parte'} "
                f"em processo criminal: {classe or 'Processo Criminal'}. "
                f"Tipificação: {', '.join(tip_nomes) if tip_nomes else 'não especificada'}. "
                f"Processo nº {numero}. Tribunal: {tribunal}. "
                f"Confiança de associação ao CPF: {conf}. "
                f"Fonte: JusBrasil Background Check API (produção)."
            ),
            "source": f"JusBrasil Background Check — {tribunal or 'TJ/TRF'}",
            "risk_indicator": risco if polo_passivo else "medio",
            "tipo": "processo",
            "match": f"CPF {cpf} — confiança {conf} — polo_passivo={polo_passivo}",
        }

        if risco == "alto" and polo_passivo:
            entry["decisao_recomendada"] = (
                f"REPROVAÇÃO — {papel.upper()} réu em processo criminal ativo por "
                f"{', '.join(tip_nomes)}. "
                f"{'Crimes de fraude são antecedentes diretos de lavagem de dinheiro.' if any(k in str(tip_nomes).lower() for k in ['estelionato','falsidade','fraude']) else 'Risco criminal incompatível com apetite da instituição.'}"
            )
            criminal_alto.append(entry)
        else:
            criminal_outros.append(entry)

    # Adiciona agrupado para não poluir com dezenas de entradas
    if criminal_alto:
        findings.extend(criminal_alto)
    elif criminal_outros:
        # Resumo dos não-críticos
        findings.append({
            "title": f"Processos criminais ({len(criminal_outros)} encontrados) — {nome_api}",
            "url": "https://www.jusbrasil.com.br/processos/",
            "snippet": (
                f"{nome_api} tem {total} processo(s) criminal(is) no JusBrasil. "
                f"Processos encontrados sem configurar réu em tipificação crítica. "
                f"Validar manualmente os detalhes para descartar homônimos."
            ),
            "source": "JusBrasil Background Check API",
            "risk_indicator": "medio",
            "tipo": "processo",
            "match": f"CPF {cpf} — {len(criminal_outros)} processo(s) sem polo passivo crítico",
        })
    else:
        # Explícito: nenhum processo criminal encontrado via API
        findings.append({
            "title": f"JusBrasil API: nenhum processo criminal — {nome_api}",
            "url": "https://www.jusbrasil.com.br/processos/",
            "snippet": (
                f"Consulta à JusBrasil Background Check API (produção) para CPF {cpf} "
                f"não retornou processos criminais. "
                f"Total retornado: {total}. Fonte confiável — cobre Vara Criminal Estadual, TRF, MP."
            ),
            "source": "JusBrasil Background Check API (produção)",
            "risk_indicator": "baixo",
            "tipo": "processo",
            "match": f"CPF {cpf} confirmado na API — sem processos criminais",
        })

    # ── 2. BNMP — mandados de prisão ─────────────────────────────────────────
    resp_bnmp = _jus_post("background-check/bnmp", {"documentNumber": cpf_clean})
    if resp_bnmp.get("_quota_exceeded"):
        findings.append(dict(_FINDING_LIMITE_ATINGIDO))
        return findings
    mandados = resp_bnmp.get("mandados", [])
    if mandados:
        for m in mandados:
            situacao = m.get("situacao", "")
            especie = m.get("especie_prisao", "")
            tip_bnmp = [t.get("tipo_de_ocorrencia", "") for t in m.get("tipificacao", [])]
            conf_m = m.get("confianca_associacao", "?")
            findings.append({
                "title": f"BNMP — Mandado de prisão — {nome_api}",
                "url": "https://bnmp.cnj.jus.br/",
                "snippet": (
                    f"MANDADO DE PRISÃO encontrado via BNMP para {nome_api} (CPF {cpf}). "
                    f"Situação: {situacao}. Espécie: {especie}. "
                    f"Tipificação: {', '.join(tip_bnmp) or 'não especificada'}. "
                    f"Confiança: {conf_m}. Processo nº: {m.get('numero_processo','?')}."
                ),
                "source": "BNMP — Banco Nacional de Mandados de Prisão (via JusBrasil API)",
                "risk_indicator": "alto",
                "tipo": "processo",
                "match": f"CPF {cpf} — confiança {conf_m}",
                "decisao_recomendada": f"REPROVAÇÃO — mandado de prisão ativo ({situacao}) para o {'owner' if papel == 'owner' else 'PEP sócio'}.",
            })

    # ── 3. MP — inquéritos e investigações ───────────────────────────────────
    resp_mp = _jus_post("background-check/mp", {"documentNumber": cpf_clean, "kind": "CRIMINAL"})
    if resp_mp.get("_quota_exceeded"):
        findings.append(dict(_FINDING_LIMITE_ATINGIDO))
        return findings
    mp_records = resp_mp.get("mp", [])
    for mp in mp_records:
        conf_mp = mp.get("confianca_associacao", "?")
        tip_mp = [t.get("tipo_de_ocorrencia", "") for t in mp.get("tipificacao", [])]
        risco_mp, _ = _classificar_tipificacoes(mp.get("tipificacao", []))
        findings.append({
            "title": f"MP — Inquérito/Investigação criminal — {nome_api}",
            "url": f"https://www.mp{mp.get('uf','').lower()}.mp.br/",
            "snippet": (
                f"{nome_api} consta em registro do Ministério Público ({mp.get('sigla','MP')}) "
                f"em procedimento de tipo {mp.get('tipo_procedimento','?')}. "
                f"Situação: {mp.get('situacao','?')}. Assunto: {mp.get('assunto','?')}. "
                f"Tipificação: {', '.join(tip_mp) or 'não especificada'}. Confiança: {conf_mp}."
            ),
            "source": f"MP {mp.get('sigla','?')} via JusBrasil Background Check API",
            "risk_indicator": risco_mp,
            "tipo": "processo",
            "match": f"CPF {cpf} — confiança {conf_mp}",
        })

    return findings


# ─────────────────────────── WebSearch (mídia + PEP) ─────────────────────────

SYSTEM = """Você é um analista de PLD/KYC realizando pesquisa de mídia adversa e validação de PEP para a Mesa de Decisão do Cora.

A consulta de processos judiciais já foi realizada via API JusBrasil. Sua tarefa é complementar com:

━━━ BLOCO MÍDIA — PEP ━━━
M1. "{nome_pep}" "{municipio_pep}" "{cargo_pep}" — confirmar mandato atual (TSE, portal câmara/prefeitura)
M2. "{nome_pep}" "corrupção" OR "improbidade" OR "cassação" OR "investigação" OR "operação policial"
M3. "{nome_pep}" "{municipio_pep}" site:portaldatransparencia.gov.br — contratos federais
M4. "{nome_pep}" "{municipio_pep}" "licitação" OR "contrato" OR "dispensa" OR "inexigibilidade"

━━━ BLOCO MÍDIA — OWNER ━━━
M5. "{nome_owner}" "{cidade_owner}" "fraude" OR "investigação" OR "contrato público" OR "licitação"
M6. "{cnpj_owner}" site:portaldatransparencia.gov.br — contratos federais da empresa

━━━ BLOCO MÍDIA — CONTEXTO REGIONAL ━━━
M7. "{municipio_pep}" OR "{cidade_owner}" + "operação policial" OR "corrupção municipal" (últimos 2 anos)

REGRAS:
- NÃO repita buscas de processos judiciais — esses já vieram da API JusBrasil
- Foque em: confirmação de cargo/mandato PEP, mídia adversa, contratos públicos, Portal da Transparência
- Homônimo: só marque homonimo_alerta quando há evidência concreta de identidade diferente
- risk_indicator "alto": contrato público via inexigibilidade com ente do PEP, cassação, operação policial direta
- risk_indicator "medio": menção em operação sem prisão, processo cível improbidade, risco ambiental
- risk_indicator "baixo": confirmação de cargo/mandato sem adversidades

Retorne APENAS o array JSON dos findings:
[{"title":"...","url":"...","snippet":"...","source":"...","risk_indicator":"baixo","tipo":"pep|midia","match":"..."}]
"""


def pesquisar_caso_web(case: dict, findings_jusbrasil: list[dict]) -> list[dict]:
    """WebSearch para mídia adversa, PEP e Portal da Transparência."""
    if not WEB_SEARCH_AVAILABLE or claude is None:
        return []
    pep_list = case.get("pep_pf") or []
    if not pep_list:
        return []

    pep = pep_list[0]
    nome_pep = pep.get("nome_titular", "")
    cargo = pep.get("cargo_formal", pep.get("perfil", ""))
    orgao = pep.get("orgao", "")
    ds_vinculo = pep.get("ds_vinculo", "")
    vinculo = VINCULO_LABEL.get((ds_vinculo or "").strip().upper(), ds_vinculo or "sócio/familiar")
    nome_owner = case.get("full_name_pf", "")
    cnpj = case.get("cnpj", "")
    cidade = case.get("cidade", "")
    uf = case.get("uf", "")

    # Resumo do que já encontramos via API para evitar duplicação no WebSearch
    resumo_api = ""
    if findings_jusbrasil:
        altos = [f for f in findings_jusbrasil if f.get("risk_indicator") == "alto"]
        resumo_api = (
            f"\n\nNOTA: JusBrasil API já retornou {len(findings_jusbrasil)} finding(s) "
            f"({'incluindo ' + str(len(altos)) + ' alto(s)' if altos else 'sem risco alto confirmado'}). "
            f"NÃO repita buscas de processos judiciais — concentre-se em mídia e contratos públicos."
        )

    prompt = f"""Realize pesquisa de MÍDIA ADVERSA e PORTAL DA TRANSPARÊNCIA para o seguinte caso PLD.
Execute os blocos M1–M7 do system prompt usando os valores abaixo:{resumo_api}

PEP:
  {{nome_pep}} = "{nome_pep}"
  {{municipio_pep}} = "{orgao}"
  {{cargo_pep}} = "{cargo}"
  {{vinculo}} = "{vinculo}"

OWNER:
  {{nome_owner}} = "{nome_owner}"
  {{cnpj_owner}} = "{cnpj}"
  {{cidade_owner}} = "{cidade}"
  {{uf_owner}} = "{uf}"

Foque especialmente em:
1. Confirmar se "{nome_pep}" está ativo como {cargo} em {orgao}
2. Contratos do PEP/empresa com entes públicos (Portal da Transparência federal e municipal)
3. Mídia adversa (investigações, operações, cassação)

Retorne o array JSON com todos os findings."""

    messages = [{"role": "user", "content": prompt}]

    for attempt in range(3):
        try:
            response = claude.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=SYSTEM,
                tools=[{"type": "web_search_20250305", "name": "web_search"}],
                messages=messages,
            )

            while response.stop_reason == "tool_use":
                tool_uses = [b for b in response.content if b.type == "tool_use"]
                tool_results = [
                    {"type": "tool_result", "tool_use_id": tu.id, "content": json.dumps(tu.input)}
                    for tu in tool_uses
                ]
                messages = messages + [
                    {"role": "assistant", "content": response.content},
                    {"role": "user", "content": tool_results},
                ]
                response = claude.messages.create(
                    model=MODEL,
                    max_tokens=4096,
                    system=SYSTEM,
                    tools=[{"type": "web_search_20250305", "name": "web_search"}],
                    messages=messages,
                )

            text = "".join(getattr(b, "text", "") for b in response.content).strip()
            if text.startswith("["):
                return json.loads(text)
            m = re.search(r"\[.*\]", text, re.DOTALL)
            return json.loads(m.group(0)) if m else []

        except Exception as e:
            print(f"      WebSearch tentativa {attempt + 1} falhou: {e}")
            if attempt < 2:
                time.sleep(10)

    return []


def pesquisar_caso(case: dict) -> list[dict]:
    """
    Pesquisa completa de diligência PLD para um caso.

    Regra Credilink:
    - pep_pf populado → PEP identificado pela Credilink (via notebook); NÃO re-consultar.
    - pep_pf vazio  → Credilink não identificou PEP; fazer dupla-verificação via
      JusBrasil/Tesserati/WebSearch apenas para o owner. Se nenhuma fonte encontrar
      adversidades, o caso é candidato a falso positivo.
    """
    pep_list = case.get("pep_pf") or []
    nome_owner = case.get("full_name_pf", "")
    cpf_owner = case.get("cpf", "")
    cnpj = case.get("cnpj", "")
    pep_nao_identificado = len(pep_list) == 0

    findings: list[dict] = []

    # ── JusBrasil: owner (sempre) ────────────────────────────────────────────
    print(f"      → JusBrasil [owner] CPF {cpf_owner}...")
    jus_owner = consultar_jusbrasil(cpf_owner, nome_owner, papel="owner")
    findings.extend(jus_owner)

    # ── Tesserati: owner + empresa (sempre) ──────────────────────────────────
    print(f"      → Tesserati [owner] CPF {cpf_owner}...")
    tess_owner = consultar_tesserati(cpf_owner, nome_owner, cnpj=cnpj, papel="owner")
    findings.extend(tess_owner)

    if pep_nao_identificado:
        # Credilink já foi consultada e não encontrou PEP.
        # NÃO consumimos quota de JusBrasil/Tesserati para PEP (não existe).
        # Registramos o resultado da dupla-verificação para orientar a decisão.
        print(f"      → PEP não identificado pela Credilink — dupla-verificação (owner only)...")
        altos = [f for f in findings if f.get("risk_indicator") == "alto"]
        if not altos:
            findings.append({
                "title": "Credilink: PEP não identificado — candidato a Falso Positivo",
                "url": "",
                "snippet": (
                    f"A Credilink (fonte oficial de PEP) não identificou nenhum PEP vinculado a "
                    f"{nome_owner} (CPF {cpf_owner}, CNPJ {cnpj}). "
                    f"A dupla-verificação via JusBrasil Background Check e Tesserati também não "
                    f"encontrou processos criminais, mandados de prisão ou adversidades materiais. "
                    f"Caso candidato a FALSO POSITIVO — o alerta foi gerado por outro critério "
                    f"(HAS_QSA, SUS_NAME, HIGH_PLD) mas sem correspondência PEP confirmada."
                ),
                "source": "Credilink (via notebook) + JusBrasil + Tesserati — dupla-verificação",
                "risk_indicator": "baixo",
                "tipo": "pep",
                "match": "Credilink: sem PEP | JusBrasil: sem processos | Tesserati: sem adversidades",
                "decisao_recomendada": "FALSO POSITIVO — PEP não confirmado por nenhuma fonte.",
            })
        # WebSearch focado apenas no owner (sem bloco PEP — não existe)
        print(f"      → WebSearch (owner/empresa only — sem PEP)...")
        web_findings = pesquisar_caso_web(case, findings)
        findings.extend(web_findings)
        return findings

    # ── PEP identificado pela Credilink — dupla-checagem para TODOS os PEPs ───
    # Cobre tanto PEP titular (tipo T / owner direto) quanto PEP relacionado
    # (tipo R / qualquer vínculo familiar ou societário). A Credilink já fez a
    # identificação; aqui verificamos registros criminais/adversidades.
    cpfs_consultados: set[str] = set()  # evita duplicatas se mesmo CPF aparecer duas vezes

    for pep in pep_list:
        cpf_pep = pep.get("cpf_titular", "")
        nome_pep = pep.get("nome_titular", "")
        vinculo = (pep.get("ds_vinculo") or "").upper()
        tipo_pep = (pep.get("tipo") or "").upper()
        papel_label = f"pep_{vinculo.lower()}" if vinculo else "pep_titular"

        if not cpf_pep or cpf_pep in cpfs_consultados:
            continue
        cpfs_consultados.add(cpf_pep)

        # JusBrasil: processos criminais do PEP (titular ou relacionado)
        print(f"      → JusBrasil [{papel_label}] CPF {cpf_pep} ({nome_pep})...")
        jus_pep = consultar_jusbrasil(cpf_pep, nome_pep, papel=papel_label)
        # Para sócio direto: adiciona todos; para familiares: só altos (quota)
        if vinculo in ("SOCIO", "") or tipo_pep == "T":
            findings.extend(jus_pep)
        else:
            altos_pep = [f for f in jus_pep if f.get("risk_indicator") == "alto"]
            findings.extend(altos_pep if altos_pep else jus_pep[:1])

        # Tesserati: compliance / mandados / mídias do PEP
        print(f"      → Tesserati [{papel_label}] CPF {cpf_pep} ({nome_pep})...")
        tess_pep = consultar_tesserati(cpf_pep, nome_pep, papel=papel_label)
        altos_tess = [f for f in tess_pep if f.get("risk_indicator") == "alto"]
        findings.extend(altos_tess if altos_tess else tess_pep[:1])

    # ── WebSearch: mídia + PEP + Portal Transparência ────────────────────────
    print(f"      → WebSearch (mídia/PEP/transparência)...")
    web_findings = pesquisar_caso_web(case, findings)
    findings.extend(web_findings)

    return findings


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", nargs="*", metavar="DRAFT_ID",
                        help="Re-pesquisa draft_ids específicos")
    parser.add_argument("--all-lideranca", action="store_true",
                        help="Re-pesquisa todos os CHECK_LIDERANCA")
    args = parser.parse_args()

    with open(QUEUE_PATH) as f:
        queue = json.load(f)
    with open(FINDINGS_PATH) as f:
        findings = json.load(f)

    items = queue.get("items", [])
    lideranca = [it for it in items if it.get("bucket") == "CHECK_LIDERANCA"]
    analista = [it for it in items if it.get("bucket") == "CHECK_ANALISTA"]
    todas = lideranca + analista

    if args.all_lideranca:
        alvos = todas  # Cobre AMBAS as filas
        print(f"Modo: re-pesquisa COMPLETA — {len(lideranca)} LIDERANCA + {len(analista)} ANALISTA = {len(alvos)} casos")
    elif args.force is not None:
        ids = set(args.force) if args.force else {it["draft_id"] for it in todas}
        alvos = [it for it in todas if it["draft_id"] in ids]
        print(f"Modo: re-pesquisa forçada de {len(alvos)} caso(s): {[a['full_name_pf'] for a in alvos]}")
    else:
        # Modo padrão: pesquisa casos SEM cobertura em AMBAS as filas
        alvos = [it for it in todas if it["draft_id"] not in findings]
        print(f"LIDERANCA: {len(lideranca)} | ANALISTA: {len(analista)} | Sem cobertura: {len(alvos)}")

    if not alvos:
        print("✓ Nenhum caso para pesquisar.")
        return

    pesquisados = 0
    for i, case in enumerate(alvos, 1):
        nome = case.get("full_name_pf", case["draft_id"][:8])
        print(f"  [{i}/{len(alvos)}] {nome:<45}")
        result = pesquisar_caso(case)
        findings[case["draft_id"]] = result
        pesquisados += 1

        altos = [f for f in result if f.get("risk_indicator") == "alto"]
        print(f"     ✓ {len(result)} finding(s) | {len(altos)} alto(s)")

        if i < len(alvos):
            time.sleep(3)

    with open(FINDINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(findings, f, ensure_ascii=False, indent=2)

    print(f"\n✓ media-findings.json atualizado — {pesquisados} caso(s) pesquisado(s)")


if __name__ == "__main__":
    main()
