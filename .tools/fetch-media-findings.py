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


def _finding_erro_consulta(motivo: str, cpf: str, nome: str) -> dict:
    """Achado explícito de FALHA de consulta (chave ausente, HTTP != 200,
    exceção) — nunca deve ser confundido com "consultamos e não achamos nada".
    Frontend (registration-enrich.ts) trata `source` com "Erro de Consulta"
    do mesmo jeito que o placeholder de cota: sem badge de similaridade, com
    pendente_verificacao=true (achado Codex, 2026-09-11)."""
    return {
        "title": "⚠️ VERIFICAÇÃO MANUAL NECESSÁRIA — Erro de Consulta JusBrasil",
        "url": "https://www.jusbrasil.com.br/consulta-pro/",
        "snippet": (
            f"A consulta à API JusBrasil Background Check falhou para {nome} (CPF {cpf}): {motivo}. "
            f"NÃO foi possível confirmar ausência ou presença de processos — isto NÃO é um resultado "
            f"negativo, é uma falha técnica. OBRIGATÓRIO: verificar manualmente no JusBrasil PRO."
        ),
        "source": "Sistema Pepito — Erro de Consulta JusBrasil",
        "risk_indicator": "medio",
        "tipo": "processo",
        "match": f"N/A — falha técnica: {motivo}",
    }

# TESSERATI_ACCESS_KEY nunca existiu em nenhum .env do projeto — a variável
# dedicada e comentada desse serviço (mesmo domínio api.tesserati.com.br) é
# CREDILINK_API_KEY (ver CLAUDE.md raiz). Sem este fallback, _credilink_auth()
# sempre recebia CREDILINK_ACCESS_KEY="" e consultar_credilink() retornava [] em
# silêncio — nenhuma consulta Credilink real era feita (achado 2026-09-11).
CREDILINK_ACCESS_KEY = os.environ.get("TESSERATI_ACCESS_KEY") or os.environ.get("CREDILINK_API_KEY", "")
CREDILINK_BASE_URL = os.environ.get("TESSERATI_API_BASE") or os.environ.get("CREDILINK_API_BASE", "https://api.tesserati.com.br")
_credilink_token: str | None = None  # cached JWT (válido 24h)


def _credilink_auth() -> str | None:
    """Obtém (ou reutiliza) o JWT da Credilink API."""
    global _credilink_token
    if _credilink_token or not CREDILINK_ACCESS_KEY:
        return _credilink_token
    try:
        resp = _JUS_SESSION.post(
            f"{CREDILINK_BASE_URL}/api/Autenticar",
            json={"accessKey": CREDILINK_ACCESS_KEY},
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("authenticated"):
                _credilink_token = data["accessToken"]
                return _credilink_token
        print(f"      Credilink auth falhou: {resp.status_code} {resp.text[:100]}")
    except Exception as e:
        print(f"      Credilink auth erro: {e}")
    return None


def _credilink_get(endpoint: str, params: dict) -> dict:
    """GET autenticado na Credilink API. Retorna {"_erro": <motivo>} em falha
    (sem token, HTTP != 200, exceção) — distinto de {} legítimo, pra quem
    chama não confundir "endpoint falhou" com "endpoint respondeu vazio"
    (achado Codex #11, 2026-09-12; mesmo padrão já usado em _jus_post)."""
    token = _credilink_auth()
    if not token:
        return {"_erro": "sem autenticação Credilink"}
    try:
        resp = _JUS_SESSION.get(
            f"{CREDILINK_BASE_URL}/{endpoint}",
            params=params,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=20,
        )
        if resp.status_code == 200:
            return resp.json()
        print(f"      Credilink GET {endpoint} HTTP {resp.status_code}: {resp.text[:100]}")
        return {"_erro": f"HTTP {resp.status_code} em {endpoint}"}
    except Exception as e:
        print(f"      Credilink GET {endpoint} erro: {e}")
        return {"_erro": f"exceção em {endpoint}: {e}"}


# Tipificações de listas sancionatórias que implicam alto risco
CREDILINK_LISTAS_ALTO = {
    "ofac", "onu", "un", "interpol", "pep internacional", "terrorismo",
    "narcotráfico", "narcotrafico", "lavagem", "ceis", "cnep", "improbidade",
}


def consultar_credilink(cpf: str, nome: str, cnpj: str = "", papel: str = "owner") -> list[dict]:
    """
    Consulta Credilink: MandadosPrisao, ProcessoTribunalJustica, MidiasNegativas,
    Compliance (CEIS/CNEP) e ComplianceInternacional para CPF/nome.
    """
    if not CREDILINK_ACCESS_KEY:
        return [{
            "title": "⚠️ VERIFICAÇÃO MANUAL NECESSÁRIA — Erro de Consulta Credilink",
            "url": "https://api.tesserati.com.br",
            "snippet": f"CREDILINK_API_KEY/TESSERATI_ACCESS_KEY ausente — consulta Credilink não disparada para {nome} (CPF {cpf}). NÃO é resultado negativo, é falha de configuração.",
            "source": "Sistema Pepito — Erro de Consulta Credilink",
            "risk_indicator": "medio",
            "tipo": "processo",
            "match": "N/A — chave de API ausente",
        }]

    cpf_clean = re.sub(r"\D", "", cpf or "")
    findings: list[dict] = []

    # Falha de autenticação (rede, credencial inválida): sem isso, todo
    # _credilink_get() abaixo devolve {} em silêncio e a função retorna [] —
    # indistinguível de "consultamos e não achamos nada" (achado Codex, 2026-09-11).
    if not _credilink_auth():
        return [{
            "title": "⚠️ VERIFICAÇÃO MANUAL NECESSÁRIA — Erro de Consulta Credilink",
            "url": "https://api.tesserati.com.br",
            "snippet": f"Falha de autenticação na API Credilink para {nome} (CPF {cpf}). NÃO foi possível consultar mandados/processos/mídias — NÃO é resultado negativo, é falha técnica.",
            "source": "Sistema Pepito — Erro de Consulta Credilink",
            "risk_indicator": "medio",
            "tipo": "processo",
            "match": "N/A — falha de autenticação",
        }]

    def _erro_endpoint(endpoint_label: str, r: dict) -> None:
        # Achado explícito de falha — nunca deixa "endpoint falhou" virar
        # "endpoint não achou nada" em silêncio (achado Codex #11, 2026-09-12).
        findings.append({
            "title": f"⚠️ VERIFICAÇÃO MANUAL NECESSÁRIA — Erro de Consulta Credilink ({endpoint_label})",
            "url": "https://api.tesserati.com.br",
            "snippet": f"Falha ao consultar {endpoint_label} na Credilink para {nome} (CPF {cpf}): {r.get('_erro')}. NÃO é resultado negativo.",
            "source": "Sistema Pepito — Erro de Consulta Credilink",
            "risk_indicator": "medio",
            "tipo": "processo",
            "match": f"N/A — falha técnica em {endpoint_label}",
        })

    # ── 1. Mandados de Prisão ─────────────────────────────────────────────────
    if cpf_clean:
        r = _credilink_get("api/MandadosPrisao", {"cpf": cpf_clean})
        if r.get("_erro"):
            _erro_endpoint("MandadosPrisao", r)
        result = r.get("result")
        if result and isinstance(result, list) and len(result) > 0:
            for m in result:
                findings.append({
                    "title": f"Credilink BNMP — Mandado de Prisão — {nome}",
                    "url": "https://bnmp.cnj.jus.br/",
                    "snippet": (
                        f"Mandado de prisão identificado via Credilink para {nome} (CPF {cpf}). "
                        f"Dados: {json.dumps(m, ensure_ascii=False)[:200]}"
                    ),
                    "source": "Credilink — BNMP Nacional",
                    "risk_indicator": "alto",
                    "tipo": "processo",
                    "match": f"CPF {cpf}",
                    "decisao_recomendada": f"REPROVAÇÃO — mandado de prisão ativo para {papel}.",
                })

    # ── 2. Processos Tribunais (civil + criminal) ─────────────────────────────
    # Antes deste fix (2026-09-11), processos não-criminais eram descartados em
    # silêncio pela list comprehension — o analista via "sem processos" mesmo
    # havendo processo cível/trabalhista real e ativo. Agora TODO processo vira
    # achado: criminal escala risco a "alto" + recomenda REPROVAÇÃO; os demais
    # (cível/trabalhista/etc.) entram como achado informativo de risco baixo,
    # sem escalar a decisão — mas nunca mais somem do resultado.
    if cpf_clean:
        r = _credilink_get("api/ProcessoTribunalJustica", {"cpf": cpf_clean})
        if r.get("_erro"):
            _erro_endpoint("ProcessoTribunalJustica", r)
        result = r.get("result")
        if result and isinstance(result, dict):
            lawsuits = result.get("lawsuits", [])
            criminais = [l for l in lawsuits if "CRIMINAL" in ((l.get("courtType") or "") + (l.get("type") or "")).upper()
                        or "PENAL" in (l.get("mainSubject") or "").upper()
                        or "CRIME" in (l.get("mainSubject") or "").upper()]
            nao_criminais = [l for l in lawsuits if l not in criminais]
            if criminais:
                tip_list = [l.get("mainSubject","")[:60] for l in criminais[:3]]
                findings.append({
                    "title": f"Credilink — Processos criminais ({len(criminais)}) — {nome}",
                    "url": "https://api.tesserati.com.br/api/ProcessoTribunalJustica",
                    "snippet": (
                        f"{nome} tem {len(criminais)} processo(s) criminal(is) via Credilink. "
                        f"Assuntos: {'; '.join(tip_list)}. "
                        f"Fonte: base consolidada de tribunais brasileiros."
                    ),
                    "source": "Credilink — ProcessoTribunalJustica",
                    "risk_indicator": "alto",
                    "tipo": "processo",
                    "match": f"CPF {cpf}",
                    "decisao_recomendada": f"REPROVAÇÃO — {len(criminais)} processo(s) criminal(is) confirmado(s) via Credilink.",
                })
            if nao_criminais:
                tip_list_nc = [l.get("mainSubject","")[:60] for l in nao_criminais[:3]]
                findings.append({
                    "title": f"Credilink — Processos não-criminais ({len(nao_criminais)}) — {nome}",
                    "url": "https://api.tesserati.com.br/api/ProcessoTribunalJustica",
                    "snippet": (
                        f"{nome} tem {len(nao_criminais)} processo(s) não-criminal(is) (cível/trabalhista/outro) "
                        f"via Credilink. Assuntos: {'; '.join(tip_list_nc)}. "
                        f"Sem indício criminal — não escala a recomendação, mas registrado para o analista avaliar."
                    ),
                    "source": "Credilink — ProcessoTribunalJustica",
                    "risk_indicator": "baixo",
                    "tipo": "processo",
                    "match": f"CPF {cpf}",
                })

    # ── 3. Mídias Negativas ───────────────────────────────────────────────────
    if nome:
        r = _credilink_get("api/MidiasNegativas", {"Termo": nome})
        if r.get("_erro"):
            _erro_endpoint("MidiasNegativas", r)
        result = r.get("result")
        if result and isinstance(result, list) and len(result) > 0:
            findings.append({
                "title": f"Credilink — Mídias Negativas — {nome}",
                "url": "https://api.tesserati.com.br/api/MidiasNegativas",
                "snippet": (
                    f"{len(result)} mídia(s) negativa(s) identificada(s) para {nome} via Credilink. "
                    f"Primeiro resultado: {json.dumps(result[0], ensure_ascii=False)[:200]}"
                ),
                "source": "Credilink — Mídias Negativas",
                "risk_indicator": "medio",
                "tipo": "midia",
                "match": f"Nome {nome}",
            })

    # ── 4. Compliance Nacional (CEIS/CNEP) ────────────────────────────────────
    if cpf_clean:
        r = _credilink_get("api/CNEP", {"cnpj": cnpj}) if cnpj else {}
        if r.get("_erro"):
            _erro_endpoint("CNEP", r)
        result = r.get("result")
        if result and isinstance(result, list) and len(result) > 0:
            findings.append({
                "title": f"Credilink CNEP — Empresa punida — {nome}",
                "url": "https://api.tesserati.com.br/api/CNEP",
                "snippet": f"Empresa {cnpj} consta no CNEP (Cadastro Nacional de Empresas Punidas). {json.dumps(result[0],ensure_ascii=False)[:200]}",
                "source": "Credilink — CNEP",
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
    Retorna {"_quota_exceeded": True} se limite atingido; {"_erro": <motivo>}
    se a chamada falhou por qualquer outro motivo (chave ausente, HTTP != 200,
    exceção). Chave "_erro" existe PARA DISTINGUIR "não conseguimos consultar"
    de "consultamos e a API devolveu vazio" — antes das duas caíam no mesmo
    `{}`, e consultar_jusbrasil() reportava "nenhum processo criminal —
    confirmado na API" mesmo quando a API nunca foi de fato alcançada
    (achado Codex, 2026-09-11)."""
    if not JUS_KEY:
        return {"_erro": "JUSBRASIL_API_KEY ausente — consulta não disparada"}
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
        return {"_erro": f"HTTP {resp.status_code} em /{endpoint}"}
    except Exception as e:
        print(f"      JusBrasil erro em /{endpoint}: {e}")
        return {"_erro": f"exceção em /{endpoint}: {e}"}


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
    if resp.get("_erro"):
        return [_finding_erro_consulta(resp["_erro"], cpf, nome)]
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
        # Explícito: nenhum processo CRIMINAL encontrado via API — o contrato
        # JusBrasil Background Check só cobre criminal/BNMP/MP (não tem
        # endpoint cível/trabalhista); o snippet deixa esse escopo explícito
        # para não passar a impressão de "nenhum processo" no sentido amplo.
        findings.append({
            "title": f"JusBrasil API: nenhum processo criminal — {nome_api}",
            "url": "https://www.jusbrasil.com.br/processos/",
            "snippet": (
                f"Consulta à JusBrasil Background Check API (produção) para CPF {cpf} "
                f"não retornou processos criminais. "
                f"Total retornado: {total}. Fonte confiável — cobre Vara Criminal Estadual, TRF, MP. "
                f"ESCOPO: este contrato JusBrasil não cobre processos cíveis/trabalhistas — "
                f"ver achado Credilink (ProcessoTribunalJustica) para essa cobertura."
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
    if resp_bnmp.get("_erro"):
        findings.append(_finding_erro_consulta(resp_bnmp["_erro"], cpf, nome))
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
    if resp_mp.get("_erro"):
        findings.append(_finding_erro_consulta(resp_mp["_erro"], cpf, nome))
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

━━━ BLOCO MÍDIA — EMPRESA (CNPJ/razão social, não só o nome do titular) ━━━
M8. "{razao_social}" OR "{cnpj_owner}" "fraude" OR "investigação" OR "processo" OR "notícia" — mídia adversa da PESSOA JURÍDICA em si
M9. "{razao_social}" "{cnpj_owner}" site:jusbrasil.com.br OR site:escavador.com — processos da empresa

━━━ BLOCO GOVERNO ESTADUAL/FEDERAL (TCE/ALE/DOU/CGU) ━━━
M10. "{nome_pep}" TCE-{uf_owner} — julgamento de contas, reprovação
M11. "{nome_pep}" Câmara/Assembleia {municipio_pep} — atas, processos disciplinares
M12. "{nome_pep}" OR "{razao_social}" Diário Oficial da União — atos oficiais
M13. "{nome_pep}" CGU servidores federais — vínculo com cargo público federal

REGRAS:
- NÃO repita buscas de processos judiciais — esses já vieram da API JusBrasil
- Foque em: confirmação de cargo/mandato PEP, mídia adversa, contratos públicos, Portal da Transparência
- Homônimo: só marque homonimo_alerta quando há evidência concreta de identidade diferente
- risk_indicator "alto": contrato público via inexigibilidade com ente do PEP, cassação, operação policial direta
- risk_indicator "medio": menção em operação sem prisão, processo cível improbidade, risco ambiental
- risk_indicator "baixo": confirmação de cargo/mandato sem adversidades

NOMENCLATURA OBRIGATÓRIA DO CAMPO "source" (thay@cora.com.br, 2026-09-12):
o frontend (Pepito) suprime o link estático "clique aqui e verifique manualmente" de uma fonte
quando já existe um achado real desta pesquisa com o mesmo nome de fonte — então SEMPRE use
EXATAMENTE um destes nomes quando o bloco correspondente foi de fato executado (com sucesso ou
não), para o Pepito parar de pedir verificação manual do que você já verificou:
- Bloco M1 (mandato/candidatura no TSE): "source": "TSE — Divulgação de Candidaturas"
- Bloco M3/M6 (Portal da Transparência, contratos federais do PEP ou da empresa): "source": "Portal da Transparência — CEIS / CNEP / CEPIM (CNPJ)"
- Bloco M10 (TCE estadual): "source": "TCE-{UF} — busca interna" (troque {UF} pela UF real do caso, ex. "TCE-CE — busca interna")
- Bloco M11 (Câmara/Assembleia estadual): "source": "Câmara/ALE-{UF} — Portal de Transparência" (troque {UF} pela UF real)
- Bloco M12 (Diário Oficial da União): "source": "Diário Oficial da União (DOU)"
- Bloco M13 (CGU servidores federais): "source": "CGU — Servidores Federais"
Os nomes exatos de {UF}, {nome_pep} etc. para ESTE caso específico vêm no prompt do usuário
abaixo — use o UF informado lá, não invente.
Se o bloco não encontrar nada, ainda assim gere o finding com risk_indicator "baixo" e esse
"source" exato — "nada encontrado" é resultado válido de uma busca que rodou, não motivo pra
omitir o finding.

Retorne APENAS o array JSON dos findings:
[{"title":"...","url":"...","snippet":"...","source":"...","risk_indicator":"baixo","tipo":"pep|midia","match":"..."}]
"""


def _parse_websearch_findings_text(text: str) -> list[dict]:
    """Extrai findings do texto do modelo sem aceitar falha silenciosa."""
    raw_excerpt = text[:200]
    start = text.find("[")
    if start == -1:
        raise ValueError(
            "WebSearch retornou resposta sem JSON reconhecível "
            "(possível budget/erro silencioso), "
            f"texto bruto (200 chars): {raw_excerpt!r}"
        )

    try:
        parsed, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError as e:
        raise ValueError(
            "WebSearch retornou resposta sem JSON reconhecível "
            f"({e}; possível budget/erro silencioso), "
            f"texto bruto (200 chars): {raw_excerpt!r}"
        ) from e

    if not isinstance(parsed, list) or not all(isinstance(f, dict) for f in parsed):
        raise ValueError(
            "WebSearch retornou JSON válido mas não é list[dict], "
            f"texto bruto (200 chars): {raw_excerpt!r}"
        )
    if not parsed:
        raise ValueError(
            "WebSearch retornou lista de findings vazia "
            "(possível budget/erro silencioso), "
            f"texto bruto (200 chars): {raw_excerpt!r}"
        )
    return parsed


def pesquisar_caso_web(case: dict, findings_jusbrasil: list[dict]) -> list[dict]:
    """WebSearch para mídia adversa, PEP e Portal da Transparência."""
    if not WEB_SEARCH_AVAILABLE or claude is None:
        print("      WebSearch não executado: cliente/chave indisponível")
        return []
    pep_list = case.get("pep_pf") or []
    if not pep_list:
        print("      WebSearch não executado: pep_pf vazio")
        return []

    pep = pep_list[0]
    nome_pep = pep.get("nome_titular", "")
    cargo = pep.get("cargo_formal", pep.get("perfil", ""))
    orgao = pep.get("orgao", "")
    ds_vinculo = pep.get("ds_vinculo", "")
    vinculo = VINCULO_LABEL.get((ds_vinculo or "").strip().upper(), ds_vinculo or "sócio/familiar")
    nome_owner = case.get("full_name_pf", "")
    cnpj = case.get("cnpj", "")
    razao_social = case.get("rf_nome_oficial", "")
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
Execute os blocos M1–M13 do system prompt usando os valores abaixo:{resumo_api}

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

EMPRESA (pessoa jurídica em si, não confundir com o titular pessoa física):
  {{razao_social}} = "{razao_social}"

Foque especialmente em (empresa, titular E PEP — os três, não só o PEP):
1. Confirmar se "{nome_pep}" está ativo como {cargo} em {orgao} (M1)
2. Contratos do PEP/empresa com entes públicos — Portal da Transparência federal e municipal (M3/M6)
3. Mídia adversa do PEP, do titular e da EMPRESA "{razao_social}" (CNPJ {cnpj}) em si — não só do nome do titular (M2/M5/M8/M9)
4. TCE-{uf}, Câmara/ALE-{uf}, DOU e CGU (M10-M13) para o PEP "{nome_pep}"

Nomes EXATOS de "source" pra usar (UF real já resolvido — use literalmente, não invente outro):
- TCE estadual: "TCE-{uf} — busca interna"
- Câmara/Assembleia estadual: "Câmara/ALE-{uf} — Portal de Transparência"
- Diário Oficial da União: "Diário Oficial da União (DOU)"
- CGU servidores federais: "CGU — Servidores Federais"
- Portal da Transparência (M3 ou M6): "Portal da Transparência — CEIS / CNEP / CEPIM (CNPJ)"
- TSE (M1): "TSE — Divulgação de Candidaturas"
Gere um finding para CADA um desses blocos, mesmo que "nada encontrado" (risco baixo) — a ausência
de achado é resultado válido de uma busca que rodou; só omita o finding se a busca não puder ser
executada de forma alguma (bloqueio de acesso, captcha, site fora do ar).

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
            return _parse_websearch_findings_text(text)

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
      JusBrasil/Credilink/WebSearch apenas para o owner. Se nenhuma fonte encontrar
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

    # ── Credilink: owner + empresa (sempre) ──────────────────────────────────
    print(f"      → Credilink [owner] CPF {cpf_owner}...")
    credilink_owner = consultar_credilink(cpf_owner, nome_owner, cnpj=cnpj, papel="owner")
    findings.extend(credilink_owner)

    if pep_nao_identificado:
        # Credilink já foi consultada e não encontrou PEP.
        # NÃO consumimos quota de JusBrasil/Credilink para PEP (não existe).
        # Registramos o resultado da dupla-verificação para orientar a decisão.
        print(f"      → PEP não identificado pela Credilink — dupla-verificação (owner only)...")
        altos = [f for f in findings if f.get("risk_indicator") == "alto"]
        # Falha técnica (cota/erro) NUNCA pode virar "candidato a Falso
        # Positivo" — isso é "não conseguimos verificar", não "verificamos e
        # não achamos nada" (achado Codex #6, 2026-09-11).
        falhou_consulta = any(
            f.get("source", "").startswith("Sistema Pepito — Controle de Quota") or
            f.get("source", "").startswith("Sistema Pepito — Erro de Consulta")
            for f in findings
        )
        if not altos and not falhou_consulta:
            findings.append({
                "title": "Credilink: PEP não identificado — candidato a Falso Positivo",
                "url": "",
                "snippet": (
                    f"A Credilink (fonte oficial de PEP) não identificou nenhum PEP vinculado a "
                    f"{nome_owner} (CPF {cpf_owner}, CNPJ {cnpj}). "
                    f"A dupla-verificação via JusBrasil Background Check e Credilink também não "
                    f"encontrou processos criminais, mandados de prisão ou adversidades materiais. "
                    f"Caso candidato a FALSO POSITIVO — o alerta foi gerado por outro critério "
                    f"(HAS_QSA, SUS_NAME, HIGH_PLD) mas sem correspondência PEP confirmada."
                ),
                "source": "Credilink (identificação via notebook) + JusBrasil + Credilink (antecedentes) — dupla-verificação",
                "risk_indicator": "baixo",
                "tipo": "pep",
                "match": "Credilink: sem PEP | JusBrasil: sem processos | Credilink: sem adversidades",
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
    # cpf_owner entra pré-marcado como já consultado: quando o owner É o PEP
    # titular (cpf_titular == cpf_owner), sem isso o loop reconsultava o MESMO
    # CPF pela 2ª vez (já verificado no passo "owner" acima) — desperdício de
    # cota JusBrasil/Credilink num contrato com margem apertada (achado
    # 2026-09-11, draft 98deb27d: cota em 312/325).
    cpfs_consultados: set[str] = {re.sub(r"\D", "", cpf_owner or "")}

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

        # Credilink: compliance / mandados / mídias do PEP
        print(f"      → Credilink [{papel_label}] CPF {cpf_pep} ({nome_pep})...")
        credilink_pep_result = consultar_credilink(cpf_pep, nome_pep, papel=papel_label)
        altos_tess = [f for f in credilink_pep_result if f.get("risk_indicator") == "alto"]
        findings.extend(altos_tess if altos_tess else credilink_pep_result[:1])

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
        alvos = todas  # Cobre AMBAS as filas — uso manual/backfill pontual
        print(f"Modo: re-pesquisa COMPLETA — {len(lideranca)} LIDERANCA + {len(analista)} ANALISTA = {len(alvos)} casos")
    elif args.force is not None:
        ids = set(args.force) if args.force else {it["draft_id"] for it in todas}
        alvos = [it for it in todas if it["draft_id"] in ids]
        print(f"Modo: re-pesquisa forçada de {len(alvos)} caso(s): {[a['full_name_pf'] for a in alvos]}")
    else:
        # Modo padrão (chamado por queue-sync.sh a cada sincronização): pesquisa
        # SÓ CHECK_ANALISTA sem cobertura. CHECK_LIDERANCA nunca entra aqui —
        # regra definida por thay@cora.com.br em 2026-09-11: o histórico de
        # mídia/processos é recente o bastante para não precisar reconsultar
        # quando o caso escala pra Mesa (o draft_id é o mesmo, então
        # `findings` já cobre o caso desde a passagem pelo Analista). Cobrir
        # CHECK_LIDERANCA é exceção pontual — usar --force ou --all-lideranca.
        alvos = [it for it in analista if it["draft_id"] not in findings]
        print(f"ANALISTA: {len(analista)} | Sem cobertura: {len(alvos)} | (LIDERANCA: {len(lideranca)} — não roda por padrão, ver --force/--all-lideranca)")

    if not alvos:
        print("✓ Nenhum caso para pesquisar.")
        return

    # Antes, `findings` só era gravado em disco DEPOIS do loop inteiro
    # terminar — uma exceção em QUALQUER caso no meio da batelada (ex.: bug
    # de parse do WebSearch, ver pesquisar_caso_web() acima) derrubava o
    # script e jogava fora TODO o trabalho já feito pros casos anteriores,
    # mesmo já tendo consumido chamadas reais (pagas) de JusBrasil/Credilink/
    # WebSearch pra eles (achado real: batelada de 63 casos, 2026-09-12,
    # crash no caso 37/63 perdeu os 36 anteriores). Agora: grava
    # incrementalmente após CADA caso, e um erro isolado num caso vira log +
    # skip (draft_id fica de fora do findings, tentado de novo na próxima
    # run) em vez de derrubar o processo inteiro.
    pesquisados = 0
    falhas: list[str] = []
    for i, case in enumerate(alvos, 1):
        nome = case.get("full_name_pf", case["draft_id"][:8])
        print(f"  [{i}/{len(alvos)}] {nome:<45}")
        try:
            result = pesquisar_caso(case)
            if not isinstance(result, list) or not all(isinstance(f, dict) for f in result):
                raise ValueError(f"pesquisar_caso() retornou tipo inesperado: {type(result)}")
        except Exception as e:
            print(f"     ✗ ERRO — caso pulado (fica sem cobertura, tenta de novo na próxima run): {e}")
            falhas.append(case["draft_id"])
            continue

        findings[case["draft_id"]] = result
        pesquisados += 1

        altos = [f for f in result if f.get("risk_indicator") == "alto"]
        print(f"     ✓ {len(result)} finding(s) | {len(altos)} alto(s)")

        # Grava incrementalmente (escrita atômica via arquivo temporário +
        # os.replace) — cada caso já consumiu API real, não vale a pena
        # arriscar perder o resultado por causa de um crash num caso seguinte.
        tmp_path = FINDINGS_PATH.with_suffix(f".tmp{os.getpid()}")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(findings, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, FINDINGS_PATH)

        if i < len(alvos):
            time.sleep(3)

    print(f"\n✓ media-findings.json atualizado — {pesquisados}/{len(alvos)} caso(s) pesquisado(s) com sucesso")
    if falhas:
        print(f"⚠️  {len(falhas)} caso(s) falharam e ficaram sem cobertura (tentar de novo na próxima run): {falhas}")


if __name__ == "__main__":
    main()
