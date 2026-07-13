#!/usr/bin/env python
"""
Gera pld-risk-scores.json com a probabilidade de lavagem de dinheiro
para cada caso da fila PLD (CHECK_LIDERANCA + CHECK_ANALISTA).

Modelo baseado em análise de 399 contas históricas com risk_business.status='PLD'.
9 fatores de risco com pesos derivados da frequência histórica.

Roda como [6/6] no refresh-daily.sh, após generate-sugestao-lideranca.py.
"""
import json
import re
import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = ROOT / "src" / "data" / "registration-queue-real.json"
OUT_PATH = ROOT / "src" / "data" / "pld-risk-scores.json"

# ── Fatores de risco e pesos (derivados da base histórica de 399 casos PLD) ──
PESOS = {
    "score_high": 25,           # Score PLD ≥1000
    "cnae_risco": 20,           # CNAE de alto risco (tabela Cora score ≥20)
    "pep_titular": 15,          # Owner IS o PEP (CPF do owner == cpf_titular)
    "pep_relacionado": 8,       # Owner é vínculo do PEP (familiar, sócio, etc.)
    "proc_jud": 12,             # Processos judiciais ao onboarding
    "empresa_nova": 8,          # Empresa aberta há <6 meses
    "midia_neg": 5,             # Mídias negativas identificadas
    "sus_name": 5,              # Nome em lista suspeita
    "eleitoral_2026": 10,       # PEP ativo + eleições 2026
    "municipio_fronteira": 8,   # Município de fronteira/extração mineral/Zona Franca (BACEN 4.001)
    "cnae_regulado": 7,         # CNAE regulado sem verificação de autorização
    # REMOVIDO: "municipio_risco" — histórico de contas PLD em uma cidade não é
    # atributo de risco do endereço. Risco geográfico = apenas fronteira/extração/ZFM.
}
MAX_SCORE = sum(PESOS.values())  # 115

# ── CNAEs PROIBIDAS — Rejeição Automática (Manual KYC Cora) ─────────────────
# Fonte: Manual KYC, regra cnae_allowed → COMPLIANCE_CNAE_ALLOWED
# Ação: REJEIÇÃO imediata — não iniciar relacionamento comercial
# CNAES_PROIBIDAS_CORA guarda o código EXATO de 7 dígitos (classe + subclasse).
# Antes comparávamos por prefixo de 4/5 dígitos (classe, sem subclasse), o que
# confundia subclasses distintas da mesma classe — ex.: 4789-0/09 (armas) casava
# com 4789-0/07 (escritório), majorando risco indevidamente. Ver bug CNAE cruzado.
CNAES_PROIBIDAS_CORA = {
    "0893200",   # Extração de gemas (pedras preciosas e semipreciosas) — 0893-2/00
    "4649410",   # Comércio atacadista de jóias, relógios e bijuterias — 4649-4/10
    "4689301",   # Comércio atacadista de produtos da extração mineral — 4689-3/01
    "8411600",   # Administração pública em geral — 8411-6/00
    "9492800",   # Atividades de organizações políticas — 9492-8/00
    "4789009",   # Comércio varejista de armas e munições — 4789-0/09
    "3311200",   # Manutenção de tanques, reservatórios metálicos e caldeiras — 3311-2/00
    "0500301",   # Extração de carvão mineral — 0500-3/01
    "0600001",   # Extração de petróleo e gás natural — 0600-0/01
    "0722701",   # Extração de minério de estanho — 0722-7/01
    "0723501",   # Extração de minério de manganês — 0723-5/01
    "0724301",   # Extração de minério de metais preciosos — 0724-3/01
    "0725100",   # Extração de minerais radioativos — 0725-1/00
    "4687702",   # Comércio atacadista de resíduos e sucatas metálicos — 4687-7/02
    "4687703",   # Comércio atacadista de resíduos e sucatas não metálicos — 4687-7/03
    "8299704",   # Leiloeiros independentes — 8299-7/04
    "9200399",   # Exploração de jogos de azar e apostas — 9200-3/99
}

# Classes (4 dígitos) cujas descrições cobrem TODAS as subclasses (wildcard "/0x"
# ou "/xx" na fonte) — aqui, e só aqui, o match por classe é intencional.
CNAES_PROIBIDAS_CLASSE = {
    "3211",   # Lapidação de gemas / joalheria / ourivesaria / cunhagem — 3211-6/0x
    "2550",   # Fabricação de equipamento bélico / armas de fogo e munições — 2550-1/0x
    "0729",   # Extração de minérios de nióbio, titânio, tungstênio, níquel, cobre etc. — 0729-4/xx
}

CNAES_PROIBIDAS_DESCRICAO = {
    "0893200": "Extração de gemas (pedras preciosas e semipreciosas) — 0893-2/00",
    "3211": "Lapidação de gemas / Joalheria / Ourivesaria / Cunhagem — 3211-6/0x",
    "4649410": "Comércio atacadista de jóias, relógios e pedras preciosas — 4649-4/10",
    "4689301": "Comércio atacadista de produtos da extração mineral — 4689-3/01",
    "8411600": "Administração pública em geral — 8411-6/00",
    "9492800": "Atividades de organizações políticas — 9492-8/00",
    "4789009": "Comércio varejista de armas e munições — 4789-0/09",
    "2550": "Fabricação de equipamento bélico / Armas de fogo e munições — 2550-1/0x",
    "3311200": "Manutenção de tanques, reservatórios metálicos e caldeiras — 3311-2/00",
    "0500301": "Extração de carvão mineral — 0500-3/01",
    "0600001": "Extração de petróleo e gás natural — 0600-0/01",
    "0722701": "Extração de minério de estanho — 0722-7/01",
    "0723501": "Extração de minério de manganês — 0723-5/01",
    "0724301": "Extração de minério de metais preciosos — 0724-3/01",
    "0725100": "Extração de minerais radioativos — 0725-1/00",
    "0729": "Extração de minérios (nióbio, titânio, tungstênio, níquel, cobre, chumbo, zinco) — 0729-4/xx",
    "4687702": "Comércio atacadista de resíduos e sucatas metálicos — 4687-7/02",
    "4687703": "Comércio atacadista de resíduos e sucatas não metálicos — 4687-7/03",
    "8299704": "Leiloeiros independentes — 8299-7/04",
    "9200399": "Exploração de jogos de azar e apostas — 9200-3/99",
}

# CNAEs de risco elevado validados contra a tabela Cora (score ≥ 20).
HIGH_RISK_CNAES = {
    # Score 20 confirmado na tabela Cora
    "7490104", "7319002",           # intermediação/agenciamento, promoção de vendas
    "6463800", "6462000", "6619399",  # holdings, serviços financeiros auxiliares
    "4641903", "4731800",           # atacadista joias, combustíveis
    # Score verificado / sem conflito com score 5 explícito
    "4721104", "5611201",
    "4921301", "4922101",
    "4761003", "4763601", "4751201",
    "4741500", "4722901", "4724500", "4723700",
    "4729699", "4713001", "9609207",
    "4399103", "4312600", "4313400", "4319300",
}

# ── Municípios de risco geográfico — apenas regiões de risco confirmadas ──────
# Critério: região de fronteira internacional, extração mineral de alto risco
# ou zona especial de livre comércio (conforme BACEN 4.001 e COAF).
# NÃO inclui cidades por histórico de contas PLD — esse é fator da análise,
# não do endereço. Só inclui onde o ENDEREÇO por si só gera risco adicional.
MUNICIPIOS_ALTO_RISCO_PLD = {
    # Zona Franca de Manaus — regime tributário especial, alta circulação de mercadorias
    "MANAUS",
    # Polos atacadistas com alta movimentação de dinheiro vivo conhecida pelo COAF
    "BRÁS",  # bairro SP mas município = SP
    # Região do ABC — histórico COAF de empresas de fachada e doleiros
    "SAO BERNARDO DO CAMPO", "SANTO ANDRE", "OSASCO",
}

# Motivo de risco por município (para label descritivo)
MUNICIPIO_RISCO_MOTIVO = {
    "SAO PAULO": "principal polo financeiro do Brasil (15.8% dos casos históricos PLD)",
    "RIO DE JANEIRO": "polo financeiro + histórico de crime organizado (4.5% dos casos)",
    "MANAUS": "Zona Franca + fronteira + histórico PLD (2.5% dos casos)",
    "CUIABA": "polo do agronegócio + rota de tráfico Centro-Oeste (2.3% dos casos)",
    "BELO HORIZONTE": "capital MG — polo financeiro Sudeste (2.0% dos casos)",
    "JUIZ DE FORA": "polo financeiro MG + rota SP-RJ (2.0% dos casos)",
    "GOIANIA": "polo financeiro Centro-Oeste (1.8% dos casos)",
    "BRASILIA": "polo político/financeiro federal (1.8% dos casos)",
    "FOZ DO IGUACU": "tríplice fronteira Brasil-Argentina-Paraguai — alto risco COAF",
    "TABATINGA": "fronteira com Colômbia e Peru — rota de narcotráfico",
    "CORUMBA": "fronteira com Bolívia — principal rota de cocaína para o Brasil",
    "SANTARANA": "hub do garimpo no Pará",
}

def get_municipio_risco_label(cidade_norm: str, cidade_raw: str) -> str:
    """Retorna label descritivo do risco do município."""
    motivo = MUNICIPIO_RISCO_MOTIVO.get(cidade_norm)
    if motivo:
        return f"Município de alto risco PLD: {cidade_raw} — {motivo}."
    return (f"Município de alto risco PLD: {cidade_raw} — concentração histórica "
            f"elevada de contas encerradas por PLD na base Cora. "
            f"Diligência Reforçada e monitoramento de transações recomendados.")

# CNAEs de serviços financeiros/participações com score ≥ 20 na tabela Cora
CNAE_FIN = {"6463", "6462", "6619", "6550", "6541", "6493", "6491", "6492", "6499"}
# CNAE_INT: só códigos com score 20 CONFIRMADO na tabela Cora
# REMOVIDO "7319" genérico (7319-0-04 publicidade=score5; 7319-0-02 promoção=score20 via HIGH_RISK_CNAES)
# REMOVIDO "7020" consultoria em gestão = score 5 (linha 352)
# ADICIONADO "7911" agências de viagem = score 20 confirmado na Cora
# ADICIONADO "9491" org. religiosas = score 20 ("ATIVIDADES DE ORGANIZACOES RELIGIOSAS OU FILOSOFICAS")
CNAE_INT = {
    "7490",   # Intermediação e agenciamento de serviços (score 20)
    "7911",   # Agências de viagens (score 20)
    "9491",   # Organizações religiosas (score 20)
}
CNAE_COMB = {
    "4731", "4732",   # Comércio varejista de combustíveis p/ veículos (score 20)
    "4784",           # Comércio varejista de GLP — "COM VAREJISTA DE GÁS LIQUEFEITO" (score 20)
}

# Carvão vegetal e lenha têm score 2415 na tabela Cora.
# Subclasse exata não confirmada na planilha (L3/L4) — mantido como match de
# classe (4 dígitos) até validação com o time de Compliance, e não como código
# exato de 7 dígitos (que exigiria confirmar a subclasse certa).
CNAES_PROIBIDAS_CLASSE.update({
    "4692",  # Comércio atacadista de carvão vegetal e lenha (L3 planilha)
    "4729",  # Comércio varejista de carvão vegetal e lenha (L4 planilha)
})

# Cargos PEP de maior risco (controle de recursos públicos)
CARGOS_ALTO_RISCO = [
    "PREFEITO", "VEREADOR", "GOVERNADOR", "DEPUTADO", "SENADOR",
    "SECRETARIO", "DIRETOR GERAL", "PRESIDENTE", "VICE-PREFEITO",
    "PROCURADOR", "CHEFE DE GABINETE",
]

# ── Municípios de risco geográfico (Circular BACEN 4.001) ────────────────────
# Municípios em zona de fronteira (150km da fronteira internacional — IBGE)
MUNICIPIOS_FRONTEIRA = {
    # Fronteira Norte: AM, RR, AP, PA, AC, RO
    "TABATINGA","BENJAMIN CONSTANT","ATALAIA DO NORTE","CUCUI","SAO GABRIEL DA CACHOEIRA",
    "MATURACA","PACARAIMA","BOA VISTA","BONFIM","LETHEM","NORMANDIA","UIRAMUTA",
    "OIAPOQUE","CALCOENE","LARANJAL DO JARI",
    # Fronteira Oeste: AC, RO, MT, MS
    "ASSIS BRASIL","BRASILEIA","EPITACIOLANDIA","CRUZEIRO DO SUL","GUAJARA-MIRIM",
    "COSTA MARQUES","CORUMBA","LADARIO","PONTA PORA","MUNDO NOVO",
    # Fronteira Sul: RS, SC, PR
    "URUGUAIANA","QUARAI","BARRA DO QUARAI","JAGUARAO","CHUÍ","LIVRAMENTO",
    "SANANDUVA","FOZ DO IGUACU","GUAIRA","DIONISIO CERQUEIRA","SAO BORJA",
    # Zona Franca (alto risco específico)
    "MANAUS","TABATINGA",
}

# Municípios de extração mineral de alto risco (garimpo, ouro, diamantes)
MUNICIPIOS_EXTRACAO = {
    "ITAITUBA","JACAREACANGA","AVEIRO","NOVO PROGRESSO","ALTAMIRA",  # PA garimpo
    "ALTA FLORESTA","PEIXOTO DE AZEVEDO","GUARANTÃ DO NORTE",       # MT garimpo
    "SINOP","COLIDER","TERRA NOVA DO NORTE",                         # MT
    "PONTES E LACERDA","VILA BELA DA SANTISSIMA TRINDADE",           # MT fronteira+ouro
    "MUCAJA","ALTO ALEGRE","AMAJARI","NORMANDIA",                    # RR garimpo Yanomami
    "SAO FELIX DO XINGU","OURILANDIA DO NORTE","TUCUMA",             # PA
    "CUMARU DO NORTE","REDENCAO","CONCEICAO DO ARAGUAIA",            # PA
    "MARABA","PARAUAPEBAS","CARAJAS",                                # PA mineração
    "TANGARA DA SERRA","CAMPO VERDE",                                # MT
}

# CNAEs com autorização regulatória obrigatória e órgão competente
CNAE_REGULADO = {
    "6411": {"orgao": "BACEN", "descricao": "Banco comercial", "url": "https://www.bcb.gov.br/estabilidadefinanceira/buscaentidade"},
    "6422": {"orgao": "BACEN", "descricao": "Banco múltiplo", "url": "https://www.bcb.gov.br/estabilidadefinanceira/buscaentidade"},
    "6431": {"orgao": "BACEN", "descricao": "Banco de câmbio", "url": "https://www.bcb.gov.br/estabilidadefinanceira/buscaentidade"},
    "6491": {"orgao": "BACEN/COAF", "descricao": "Factoring (fomento mercantil)", "url": "https://www.bcb.gov.br/estabilidadefinanceira/registrofomento"},
    "6499": {"orgao": "BACEN", "descricao": "Serviços financeiros não regulados", "url": "https://www.bcb.gov.br"},
    "6512": {"orgao": "SUSEP", "descricao": "Seguros de vida", "url": "https://www.susep.gov.br/menu/a-susep/cadastro-de-corretores-e-empresas/cadastro-de-seguradoras"},
    "6513": {"orgao": "SUSEP", "descricao": "Planos de saúde/vida", "url": "https://www.ans.gov.br/operadoras/cadastro-de-operadoras"},
    "6611": {"orgao": "CVM", "descricao": "Administração de valores mobiliários", "url": "https://www.gov.br/cvm/pt-br/assuntos/regulados"},
    "6612": {"orgao": "CVM/BACEN", "descricao": "Distribuição de títulos e valores", "url": "https://www.gov.br/cvm/pt-br/assuntos/regulados"},
    "6613": {"orgao": "CVM", "descricao": "Corretora de valores", "url": "https://www.gov.br/cvm/pt-br/assuntos/regulados"},
    "6622": {"orgao": "SUSEP", "descricao": "Corretora de seguros", "url": "https://www.susep.gov.br"},
    "6630": {"orgao": "CVM", "descricao": "Gestão de fundos de investimento", "url": "https://www.gov.br/cvm/pt-br/assuntos/regulados"},
    "8660": {"orgao": "ANS", "descricao": "Planos de saúde", "url": "https://www.ans.gov.br/operadoras/cadastro-de-operadoras"},
    "3211": {"orgao": "DNPM/ANM", "descricao": "Lapidação/joalheria — extração mineral", "url": "https://sistemas.anm.gov.br"},
    "4731": {"orgao": "ANP", "descricao": "Combustíveis — revendedor autorizado", "url": "https://postos.anp.gov.br/consulta-de-postos"},
    "4732": {"orgao": "ANP", "descricao": "Combustíveis — distribuidora autorizada", "url": "https://www.gov.br/anp/pt-br/assuntos/distribuicao-e-revenda"},
    "4921": {"orgao": "ANTT", "descricao": "Transporte rodoviário interestadual de passageiros", "url": "https://appweb.antt.gov.br"},
    "4940": {"orgao": "ANTT", "descricao": "Transporte rodoviário de cargas — ETC", "url": "https://www.gov.br/antt/pt-br/assuntos/cargas"},
    "5911": {"orgao": "ANCINE", "descricao": "Produção cinematográfica", "url": "https://ancine.gov.br/pt-br/todos-os-registros"},
    "6421": {"orgao": "BACEN", "descricao": "Caixa econômica", "url": "https://www.bcb.gov.br"},
}


def extract_cnae_prefix(cnae_raw: str) -> tuple[str, str]:
    """Retorna (prefixo4, código7) do CNAE."""
    cc = re.sub(r"[^0-9]", "", cnae_raw)[:7]
    return cc[:4], cc[:7]


def calcular_score(case: dict) -> dict:
    """Calcula probabilidade de LD para um caso da fila."""
    score_pld = int(case.get("score_pld", 0) or 0)
    cnae_raw = case.get("cnae", "") or ""
    uf = case.get("uf", "") or ""
    data_const = case.get("data_constituicao", "") or ""
    pep_pf = case.get("pep_pf") or []
    proc_pf = case.get("processosjudiciais_pf", "") or ""
    midia_pf = case.get("pf_midianegativas", "") or ""
    midia_pj = case.get("pj_midianegativas", "") or ""
    eval_reason = case.get("evaluation_reason", "") or ""

    cp4, cp7 = extract_cnae_prefix(cnae_raw)

    sp = 0
    fatores = []

    # 0. CNAE proibida (Manual KYC Cora — rejeição automática)
    # Verificação ANTES de qualquer outro fator — caso com CNAE proibida deve ser
    # reprovado independentemente dos demais fatores.
    # Match por código EXATO de 7 dígitos (classe+subclasse) — nunca por prefixo —
    # exceto para as classes em CNAES_PROIBIDAS_CLASSE, cuja descrição cobre
    # explicitamente todas as subclasses da classe (wildcard "/0x"/"xx" na fonte).
    if cp7 in CNAES_PROIBIDAS_CORA or cp4 in CNAES_PROIBIDAS_CLASSE:
        matched = cp7 if cp7 in CNAES_PROIBIDAS_CORA else cp4
        if matched:
            sp += MAX_SCORE  # score máximo → probabilidade 99%
            desc = CNAES_PROIBIDAS_DESCRICAO.get(matched, cnae_raw)
            fatores.append({
                "id": "cnae_proibida",
                "label": (
                    f"🚫 CNAE PROIBIDA — Rejeição automática pela política Cora. "
                    f"{desc}. "
                    f"Regra: cnae_allowed=False → sub_status COMPLIANCE_CNAE_ALLOWED. "
                    f"Não iniciar relacionamento comercial."
                ),
                "nivel": "alto",
            })
            return {
                "probabilidade": 99.0,
                "nivel": "critico",
                "score_modelo": MAX_SCORE,
                "score_max": MAX_SCORE,
                "fatores": fatores,
                "pep_cargo": "",
                "pep_vinculo": "",
                "gerado_em": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }

    # 1. Score PLD
    if score_pld >= 1000:
        sp += PESOS["score_high"]
        fatores.append({"id": "score_high", "label": f"Score PLD {score_pld} (HIGH)", "nivel": "alto"})
    elif score_pld >= 500:
        sp += 12
        fatores.append({"id": "score_medio", "label": f"Score PLD {score_pld} (médio-alto)", "nivel": "medio"})

    # 2. CNAE de risco
    if cp4 in CNAE_FIN | CNAE_INT | CNAE_COMB or cp7 in HIGH_RISK_CNAES:
        sp += PESOS["cnae_risco"]
        fatores.append({"id": "cnae_risco", "label": f"CNAE alto risco ({cnae_raw[:40]})", "nivel": "alto"})

    # 3. PEP — distingue titular (owner IS o PEP) de relacionado (owner é vínculo do PEP)
    #    Critério correto: compara CPF do owner com cpf_titular do registro Credilink.
    #    tipo=="T" indica apenas que é um registro de PEP principal na Credilink,
    #    NÃO que o owner é o PEP — um familiar pode ter tipo "T" em seu próprio registro.
    pep_tit = False       # True somente se owner CPF == cpf_titular
    pep_relacionado = False  # True se há PEP mas owner é vínculo (familiar, sócio, etc.)
    pep_cargo = ""
    pep_vinculo = ""
    pep_ativo = False
    cargo_alto = False
    owner_cpf_digits = re.sub(r"\D", "", str(case.get("cpf", "") or ""))

    for pep in pep_pf:
        if not isinstance(pep, dict):
            continue
        c = str(pep.get("cargo_formal", pep.get("perfil", "")) or "")
        if c:
            pep_cargo = c
        vinculo = pep.get("ds_vinculo", "") or ""
        if vinculo:
            pep_vinculo = vinculo
        df_c = str(pep.get("data_fim_carencia", pep.get("data_fim", "")) or "")
        if any(y in df_c for y in ["2026", "2027", "2028", "2029", "2030"]):
            pep_ativo = True
        # Verificação correta: owner é o PEP se seu CPF coincide com cpf_titular
        cpf_tit = re.sub(r"\D", "", str(pep.get("cpf_titular", "") or ""))
        if owner_cpf_digits and cpf_tit and owner_cpf_digits == cpf_tit:
            pep_tit = True
        if any(k in c.upper() for k in CARGOS_ALTO_RISCO):
            cargo_alto = True

    if not pep_tit and pep_pf:
        pep_relacionado = True

    outros_fatores_risco = any(
        f["id"] in ("proc_jud", "midia_neg", "cnae_risco", "sus_name")
        for f in fatores
    )

    if pep_tit:
        sp += PESOS["pep_titular"]
        # PEP titular: gatilho de análise, não risco isolado.
        nivel_pep = "alto" if outros_fatores_risco else "medio"
        fatores.append({
            "id": "pep_titular",
            "label": (
                f"PEP titular ({pep_cargo[:25]}): o próprio titular da empresa é uma "
                f"Pessoa Politicamente Exposta — gatilho obrigatório de Diligência Reforçada "
                f"(Circular BACEN 3.978/2020). Isoladamente não é motivo de reprovação."
            ),
            "nivel": nivel_pep,
        })
    elif pep_relacionado:
        # PEP relacionado tem peso menor; sozinho não é risco material
        sp += PESOS.get("pep_relacionado", 8)
        nivel_rel = "medio" if outros_fatores_risco else "baixo"
        vinculo_label = pep_vinculo if pep_vinculo else "vínculo"
        fatores.append({
            "id": "pep_relacionado",
            "label": (
                f"PEP relacionado ({pep_cargo[:25]}) — {vinculo_label}: titular possui vínculo "
                f"com Pessoa Politicamente Exposta, não é o PEP. Gatilho de Diligência Reforçada "
                f"(Circular BACEN 3.978/2020). Isoladamente não é motivo de reprovação."
            ),
            "nivel": nivel_rel,
        })

    # 4. Processos judiciais ao onboarding
    has_proc = (
        proc_pf
        and "não encontrad" not in proc_pf.lower()
        and "nenhum" not in proc_pf.lower()
        and len(proc_pf) > 50
    )
    if has_proc:
        sp += PESOS["proc_jud"]
        fatores.append({"id": "proc_jud", "label": "Processos judiciais ao onboarding", "nivel": "alto"})

    # 5. Município de alta concentração histórica de PLD (granularidade cidade)
    import unicodedata as _ud
    def _norm(s: str) -> str:
        s = s.upper().strip()
        s = _ud.normalize('NFD', s)
        return ''.join(c for c in s if _ud.category(c) != 'Mn')

    cidade_raw = case.get("cidade", "") or ""
    cidade_norm = _norm(cidade_raw)
    # municipio_risco REMOVIDO: histórico de PLD em cidades não é critério geográfico
    # de risco. Risco por localização = apenas BACEN 4.001 (fronteira/extração/ZFM).

    # 6. Empresa nova (<6 meses)
    if data_const:
        try:
            d = datetime.datetime.strptime(data_const[:10], "%Y-%m-%d")
            age_months = (datetime.datetime.now() - d).days / 30
            if age_months < 6:
                sp += PESOS["empresa_nova"]
                fatores.append({
                    "id": "empresa_nova",
                    "label": f"Empresa nova ({age_months:.0f} meses)",
                    "nivel": "medio",
                })
        except ValueError:
            pass

    # 7. Mídias negativas
    has_midia = any(
        m and "não encontrad" not in m.lower() and "sem mídia" not in m.lower() and len(m) > 50
        for m in [midia_pf, midia_pj]
    )
    if has_midia:
        sp += PESOS["midia_neg"]
        fatores.append({"id": "midia_neg", "label": "Mídias negativas identificadas", "nivel": "medio"})

    # 8. Nome em lista suspeita
    if eval_reason in ("SUS_NAME", "SUS_NAME_FAIL"):
        sp += PESOS["sus_name"]
        fatores.append({"id": "sus_name", "label": "Nome em lista suspeita (SUS_NAME)", "nivel": "alto"})

    # 9. PEP ativo + período eleitoral 2026 (com descrição ampliada)
    # Só adiciona peso se o PEP tem mandato ATIVO — não apenas pela existência do vínculo.
    if pep_ativo and cargo_alto:
        sp += PESOS["eleitoral_2026"]
        # Descrição específica por cargo
        cidade = case.get("cidade", "") or ""
        pep_info = next((p for p in pep_pf if isinstance(p, dict)), {})
        orgao_pep = str(pep_info.get("orgao", "") or "")
        if "PREFEITO" in pep_cargo.upper():
            label = (f"PEP Prefeito ativo ({orgao_pep[:25]}) + eleições 2026: risco de "
                     f"uso da empresa para captar recursos de campanha via contratos "
                     f"municipais, emendas ou repasses públicos. Candidatura à reeleição "
                     f"cria incentivo a buscar fontes extraoficiais de financiamento.")
        elif "VEREADOR" in pep_cargo.upper():
            label = (f"PEP Vereador ativo ({orgao_pep[:25]}) + eleições 2026: vereadores "
                     f"têm acesso a emendas impositivas e influência sobre contratos "
                     f"municipais. Risco de a empresa titular receber repasses do município "
                     f"via inexigibilidade ou dispensa, ou ser usada para financiar campanha "
                     f"de reeleição (caixa 2 digital — típica tipologia pré-eleitoral).")
        else:
            label = (f"PEP {pep_cargo[:20]} ativo + eleições 2026: mandatário com poder "
                     f"orçamentário tem incentivo para usar a conta PJ vinculada para "
                     f"movimentar recursos de campanha extraoficiais.")
        # Nível: "alto" quando há outros fatores concretos (CNAE risco, processos, mídias)
        # "medio" quando o risco eleitoral é o principal fator sem outros evidências
        outros_concretos = any(
            f["id"] in ("proc_jud", "midia_neg", "cnae_risco", "sus_name", "cnae_regulado")
            for f in fatores
        )
        nivel_eleit = "alto" if outros_concretos else "medio"
        fatores.append({"id": "eleitoral_2026", "label": label, "nivel": nivel_eleit})

    # 10. Município de fronteira / extração mineral (Circular BACEN 4.001)
    cidade = (case.get("cidade", "") or "").upper().strip()
    # Normalizar (remover acentos para comparação)
    import unicodedata
    def norm_cidade(c):
        return ''.join(x for x in unicodedata.normalize('NFD', c) if unicodedata.category(x) != 'Mn')
    cidade_norm = norm_cidade(cidade)
    is_fronteira = cidade_norm in {norm_cidade(m) for m in MUNICIPIOS_FRONTEIRA}
    is_extracao = cidade_norm in {norm_cidade(m) for m in MUNICIPIOS_EXTRACAO}
    if is_fronteira or is_extracao:
        sp += PESOS["municipio_fronteira"]
        tipo_geo = "fronteira internacional" if is_fronteira else "extração mineral de alto risco"
        fatores.append({
            "id": "municipio_fronteira",
            "label": (f"Município de {tipo_geo} ({cidade}): Circular BACEN 4.001 "
                      f"classifica como zona de risco elevado para LD/FT. "
                      f"{'Zona de fronteira facilita tráfico de drogas/armas, contrabando e doleiros.' if is_fronteira else 'Região de garimpo/mineração associada a ouro ilegal, lavagem via sucata e comércio de minerais sem nota.'} "
                      f"Exige Diligência Reforçada e monitoramento contínuo."),
            "nivel": "alto",
        })

    # 11. CNAE regulamentado sem verificação de autorização
    cnae_reg_info = CNAE_REGULADO.get(cp4)
    if cnae_reg_info:
        sp += PESOS["cnae_regulado"]
        fatores.append({
            "id": "cnae_regulado",
            "label": (f"CNAE regulamentado — {cnae_reg_info['descricao']}: "
                      f"obrigatório verificar autorização de funcionamento no "
                      f"{cnae_reg_info['orgao']} antes de aprovar. "
                      f"Operar sem registro é crime (art. 16 da Lei 7.492/86). "
                      f"Consultar: {cnae_reg_info['url']}"),
            "nivel": "alto",
            "orgao_url": cnae_reg_info['url'],
        })

    prob = min(sp / MAX_SCORE * 100, 99.0)
    nivel: str
    if prob >= 60:
        nivel = "critico"
    elif prob >= 40:
        nivel = "alto"
    elif prob >= 20:
        nivel = "medio"
    else:
        nivel = "baixo"

    return {
        "probabilidade": round(prob, 1),
        "nivel": nivel,
        "score_modelo": sp,
        "score_max": MAX_SCORE,
        "fatores": fatores,
        "pep_cargo": pep_cargo,
        "pep_vinculo": pep_vinculo,
        "gerado_em": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def main() -> None:
    with open(QUEUE_PATH, encoding="utf-8") as f:
        queue = json.load(f)

    items = queue.get("items", [])
    scores: dict[str, dict] = {}

    for case in items:
        draft_id = case.get("draft_id", "")
        if draft_id:
            scores[draft_id] = calcular_score(case)

    by_nivel: dict[str, int] = {}
    for s in scores.values():
        by_nivel[s["nivel"]] = by_nivel.get(s["nivel"], 0) + 1

    output = {
        "_meta": {
            "descricao": (
                "Scores de probabilidade de lavagem de dinheiro por draft_id. "
                "Modelo baseado em análise de 399 contas históricas com risk_business.status='PLD'. "
                "9 fatores de risco com pesos derivados de frequência histórica."
            ),
            "modelo_versao": "1.0",
            "universo_historico": 399,
            "gerado_em": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_casos": len(scores),
            "distribuicao": by_nivel,
            "fatores_pesos": PESOS,
        },
        "scores": scores,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"✓ pld-risk-scores.json gerado: {len(scores)} casos")
    print(f"  Distribuição: {by_nivel}")
    criticos = [(did, s["probabilidade"]) for did, s in scores.items() if s["nivel"] == "critico"]
    criticos.sort(key=lambda x: -x[1])
    for did, p in criticos:
        nome = next((it["rf_nome_oficial"][:40] for it in items if it.get("draft_id") == did), "?")
        print(f"  🔴 {p:.1f}% — {nome}")


if __name__ == "__main__":
    main()
