#!/usr/bin/env python
"""
Consulta Credilink (Tesserati) individual para o CPF do PEP RELACIONADO
(quando o PEP não é o titular da conta) — cobre o gap documentado em
.tools/INCIDENT-REPORT-2026-09-11-CREDILINK-PEP-NAO-CONSULTADO.md:
token_pf_cred/pep_pf só refletem a consulta ao CPF do TITULAR DA CONTA;
o CPF do PEP relacionado nunca era consultado individualmente.

Quando o PEP É o titular da conta (pep_pf[].cpf_titular == case.cpf), NÃO
consulta de novo — a informação já existe na tabela
squad_core.registration_notebook_output_single (token_pf_cred + pep_pf),
conforme regra definida por thay@cora.com.br em 2026-09-11.

Fluxo por CPF (mesmo padrão usado nos scripts _rif_collect_*.py, já
validado em produção):
  1. POST /api/Autenticar            → accessToken (cacheado, válido ~24h)
  2. POST /api/Compliance?cpf={cpf}  → token de processamento assíncrono
  3. GET  /api/PEP?cpf={cpf}         → identificação/confirmação PEP (síncrono)
  4. sleep(15) — dá tempo do processamento assíncrono do Compliance
  5. GET  /api/Compliance?token=...  → resultado consolidado

Ledger de consultas já feitas: src/data/credilink-pep-consultas.json,
chaveado por CPF (dígitos). Modo padrão NUNCA reconsulta um CPF já presente
no ledger — "rodou uma vez, não roda de novo" vale pra Credilink assim como
já vale pro JusBrasil (fetch-media-findings.py).

Uso:
  python consultar-credilink-pep.py                  # casos desde --desde (default 2026-04-01)
  python consultar-credilink-pep.py --desde 2026-01-01
  python consultar-credilink-pep.py --force CPF [CPF ...]   # reconsulta CPFs específicos
  python consultar-credilink-pep.py --dry-run        # só lista quem seria consultado, não chama a API
"""
import argparse
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT.parent / ".env")

QUEUE_PATH = ROOT / "src" / "data" / "registration-queue-real.json"
ANALISES_PATH = ROOT / "src" / "data" / "analises-salvas.json"
LEDGER_PATH = ROOT / "src" / "data" / "credilink-pep-consultas.json"
LOG_PATH = Path(__file__).parent / "consultar-credilink-pep.log"

CREDILINK_KEY = os.environ.get("CREDILINK_API_KEY", "")
CREDILINK_BASE = (os.environ.get("CREDILINK_API_BASE", "") or "https://api.tesserati.com.br").rstrip("/")

_session = requests.Session()
_session.verify = False
_session.headers.update({"User-Agent": "curl/8.4.0", "Accept": "application/json"})

_token_cache: str | None = None


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def _write_json_atomic(path: Path, data: dict) -> None:
    """Escreve via arquivo temporário + os.replace (atômico no mesmo
    filesystem) — sem isso, uma interrupção no meio do write_text() direto
    deixava o JSON truncado/corrompido (achado Codex #10, 2026-09-11)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _auth() -> str | None:
    global _token_cache
    if _token_cache:
        return _token_cache
    if not CREDILINK_KEY:
        print("[FATAL] CREDILINK_API_KEY ausente no .env — abortando.")
        return None
    try:
        r = _session.post(
            f"{CREDILINK_BASE}/api/Autenticar",
            json={"accessKey": CREDILINK_KEY},
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        data = r.json()
        if data.get("authenticated") or data.get("accessToken"):
            _token_cache = data.get("accessToken")
            return _token_cache
        print(f"  Autenticação Credilink falhou: {r.status_code} {r.text[:150]}")
    except Exception as e:
        print(f"  Erro na autenticação Credilink: {e}")
    return None


def _consultar_cpf(cpf: str, nome: str) -> dict:
    """Roda o fluxo completo (Compliance + PEP) para um CPF. Nunca lança —
    devolve sempre um dict, com 'erro' preenchido se algo falhou, para o
    chamador decidir se persiste um resultado parcial ou pula."""
    token = _auth()
    if not token:
        return {"erro": "sem_autenticacao"}

    # Content-Type obrigatório mesmo no POST sem corpo — API responde 415
    # Unsupported Media Type sem ele (achado testando este script, 2026-09-11).
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"}
    resultado: dict = {
        "cpf": cpf,
        "nome": nome,
        "consultado_em": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # 1. Dispara o processamento de compliance (assíncrono)
    compliance_token = None
    try:
        # Corpo precisa da chave "cpfcnpj" (não "cpf") — API responde 200 com
        # code:400 embutido no corpo ("Campo cpfcnpj e token vazios") se o
        # nome do campo estiver errado; token vem aninhado em result.token,
        # não no topo do JSON (achado testando este script, 2026-09-11).
        r = _session.post(f"{CREDILINK_BASE}/api/Compliance?cpf={cpf}", headers=headers, json={"cpfcnpj": cpf}, timeout=15)
        body = r.json() if r.status_code == 200 else {}
        if r.status_code == 200 and body.get("code") == 200:
            compliance_token = (body.get("result") or {}).get("token")
            # code:200 sem token no corpo é resposta malformada — sem isso
            # ficava sem token e sem erro registrado, indistinguível de uma
            # falha silenciosa (achado Codex #3, 2026-09-11).
            if not compliance_token:
                resultado["erro_compliance_post"] = f"HTTP 200 code:200 mas sem result.token: {r.text[:200]}"
        else:
            resultado["erro_compliance_post"] = f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as e:
        resultado["erro_compliance_post"] = str(e)

    # 2. Identificação PEP (síncrono) — é a confirmação real de que esse CPF
    #    é (ou não) PEP, independente do que a Credilink já tinha identificado
    #    via notebook para o titular da conta.
    try:
        r = _session.get(f"{CREDILINK_BASE}/api/PEP?cpf={cpf}", headers=headers, timeout=20)
        if r.status_code == 200:
            resultado["pep"] = r.json()
        else:
            resultado["erro_pep"] = f"HTTP {r.status_code}: {r.text[:150]}"
    except Exception as e:
        resultado["erro_pep"] = str(e)

    # 3. Resultado consolidado do compliance (aguarda processamento assíncrono).
    # Testado manualmente (2026-09-11): 15s não bastam — "Processando" por 2
    # tentativas, só ficou "Processado" na 3ª (~45s). Poll com backoff, até
    # ~2min de espera total antes de desistir.
    if compliance_token:
        resultado["token_compliance"] = compliance_token
        for tentativa in range(8):
            time.sleep(15)
            try:
                r = _session.get(f"{CREDILINK_BASE}/api/Compliance?token={compliance_token}", headers=headers, timeout=20)
                if r.status_code != 200:
                    resultado["erro_compliance_get"] = f"HTTP {r.status_code}: {r.text[:150]}"
                    break
                body = r.json()
                if body.get("message") == "Processando":
                    continue
                # code:200 é obrigatório — sem essa checagem, um erro de
                # negócio devolvido com HTTP 200 (ex.: token inválido/expirado)
                # era gravado como se fosse o resultado final normal (achado
                # Codex #3, 2026-09-11).
                if body.get("code") == 200:
                    resultado["compliance"] = body
                else:
                    resultado["erro_compliance_get"] = f"code {body.get('code')}: {body.get('message')}"
                break
            except Exception as e:
                resultado["erro_compliance_get"] = str(e)
                break
        else:
            resultado["erro_compliance_get"] = "timeout — ainda 'Processando' após 8 tentativas (~2min)"

    return resultado


def _coletar_alvos(desde: datetime) -> dict[str, dict]:
    """Varre a fila aberta + análises salvas localmente e monta o dict
    {cpf_pep: {nome, drafts: set()}} de PEPs RELACIONADOS (cpf_titular !=
    CPF do titular da conta) em casos com data >= `desde`. PEP titular
    (cpf_titular == cpf do owner) nunca entra aqui — já tem a informação
    real vinda da tabela squad_core.registration_notebook_output_single."""
    alvos: dict[str, dict] = {}

    if QUEUE_PATH.exists():
        payload = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
        items = payload.get("items", payload) if isinstance(payload, dict) else payload
        for c in items:
            ca = c.get("created_at", "")
            try:
                dt = datetime.strptime(ca[:19], "%Y-%m-%d %H:%M:%S")
            except Exception:
                continue
            if dt < desde:
                continue
            owner_cpf = _digits(c.get("cpf"))
            for p in c.get("pep_pf") or []:
                cpf_pep = _digits(p.get("cpf_titular"))
                if cpf_pep and cpf_pep != owner_cpf:
                    alvos.setdefault(cpf_pep, {"nome": p.get("nome_titular"), "drafts": set()})
                    alvos[cpf_pep]["drafts"].add(c.get("draft_id", ""))

    if ANALISES_PATH.exists():
        payload = json.loads(ANALISES_PATH.read_text(encoding="utf-8"))
        analises = payload.get("analises", []) if isinstance(payload, dict) else payload
        for a in analises:
            data_str = a.get("createdAt") or a.get("data") or ""
            try:
                dt = datetime.strptime(data_str[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
            except Exception:
                continue
            if dt < desde:
                continue
            cliente = a.get("cliente") or {}
            if cliente.get("tipoPep") == "relacionado" and cliente.get("cpfPepTitular"):
                cpf_pep = _digits(cliente["cpfPepTitular"])
                owner_cpf = _digits(cliente.get("cpfResponsavel"))
                if cpf_pep and cpf_pep != owner_cpf:
                    alvos.setdefault(cpf_pep, {"nome": cliente.get("nomePessoaVinculada", ""), "drafts": set()})
                    alvos[cpf_pep]["drafts"].add(a.get("draftId", a.get("id", "")))

    return alvos


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--desde", default="2026-04-01", help="Data mínima (YYYY-MM-DD) dos casos a considerar")
    parser.add_argument("--force", nargs="*", metavar="CPF", help="Reconsulta CPFs específicos (ignora ledger)")
    parser.add_argument("--dry-run", action="store_true", help="Só lista quem seria consultado, não chama a API")
    args = parser.parse_args()

    desde = datetime.strptime(args.desde, "%Y-%m-%d")
    alvos = _coletar_alvos(desde)

    ledger: dict[str, dict] = {}
    if LEDGER_PATH.exists():
        try:
            ledger = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        except Exception:
            ledger = {}

    if args.force:
        # Valida 11 dígitos antes de chamar a API de produção — sem isso,
        # `--force abc 123.45` gerava chaves vazia/"12345" e consultava a
        # Credilink real com lixo (achado Codex #11, 2026-09-11).
        cpfs_validos, invalidos = [], []
        for c in args.force:
            d = _digits(c)
            (cpfs_validos if len(d) == 11 else invalidos).append(d or c)
        if invalidos:
            print(f"[FATAL] CPF(s) inválido(s) (precisa 11 dígitos): {invalidos} — abortando sem consumir cota.")
            return
        pendentes = {cpf: alvos.get(cpf, {"nome": "", "drafts": set()}) for cpf in cpfs_validos}
    else:
        # Entradas com erro_* NÃO contam como "já consultado" — sem isso uma
        # falha transitória (timeout, token expirado) ficava marcada como
        # resolvida pra sempre, exigindo --force manual pra notar e corrigir
        # (achado Codex #9, 2026-09-11).
        def _falhou(entry: dict) -> bool:
            return any(k.startswith("erro") for k in entry)
        pendentes = {
            cpf: info for cpf, info in alvos.items()
            if cpf not in ledger or _falhou(ledger[cpf])
        }

    print(f"PEPs relacionados candidatos (desde {args.desde}): {len(alvos)}")
    print(f"Já consultados (no ledger): {len(alvos) - len(pendentes) if not args.force else '—'}")
    print(f"Pendentes de consulta agora: {len(pendentes)}")

    if args.dry_run:
        for cpf, info in pendentes.items():
            print(f"  [DRY-RUN] {cpf} — {info.get('nome','')} — drafts: {sorted(info.get('drafts', []))}")
        return

    if not pendentes:
        print("✓ Nenhum CPF pendente de consulta.")
        return

    if not CREDILINK_KEY:
        print("[FATAL] CREDILINK_API_KEY ausente no .env — abortando sem consumir nada.")
        return

    ok, falhas = 0, 0
    for i, (cpf, info) in enumerate(pendentes.items(), 1):
        nome = info.get("nome", "")
        print(f"  [{i}/{len(pendentes)}] {cpf} — {nome}...")
        resultado = _consultar_cpf(cpf, nome)
        resultado["drafts"] = sorted(info.get("drafts", []))
        ledger[cpf] = resultado
        # Persiste incrementalmente — uma falha no meio do lote não perde o que já rodou
        _write_json_atomic(LEDGER_PATH, ledger)

        if any(k.startswith("erro") for k in resultado):
            falhas += 1
            print(f"     ⚠️  erro(s): {[k for k in resultado if k.startswith('erro')]}")
        else:
            ok += 1
            # isPEP vem do resultado consolidado do Compliance (dado real da
            # Receita/Credilink pro CPF específico do PEP) — muito mais
            # confiável que /api/PEP?cpf=, que responde "PEPs relacionados A
            # este CPF" (pergunta inversa: pessoas ligadas a ele que são PEP,
            # não se ele mesmo é).
            pessoa = ((resultado.get("compliance") or {}).get("result") or {}).get("pessoa") or {}
            is_pep = pessoa.get("isPEP")
            print(f"     ✓ isPEP (Credilink, CPF próprio): {is_pep} | token compliance: {resultado.get('token_compliance', '—')}")

        if i < len(pendentes):
            time.sleep(2)

    print(f"\n✓ {ok} consulta(s) concluída(s), {falhas} com erro — ledger em {LEDGER_PATH}")


if __name__ == "__main__":
    main()
