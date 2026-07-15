#!/usr/bin/env python3
"""
Supervisor Agent — Monitoramento diário da aplicação Pepito

Responsabilidades:
  1. Verificar saúde de agentes/serviços
  2. Detectar bugs, erros, melhorias
  3. Monitorar performance e disponibilidade
  4. Enviar alertas Slack por nível de risco

Níveis de risco:
  - MUITO ALTO: Aplicação down, dados corrompidos, perda crítica
  - ALTO: Funcionalidade quebrada, erro em fluxo crítico
  - MÉDIO: Bug menor, performance degradada, dados inconsistentes
  - BAIXO: Sugestão de melhoria, warning, otimização
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timedelta
import subprocess
import re
from typing import Any

# Adiciona raiz do projeto ao path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
import os

load_dotenv(ROOT / ".env")


class Alert:
    """Representa um alerta do supervisor"""
    MUITO_ALTO = "🔴 MUITO ALTO"
    ALTO = "🟠 ALTO"
    MÉDIO = "🟡 MÉDIO"
    BAIXO = "🔵 BAIXO"

    def __init__(self, nivel: str, titulo: str, descricao: str, componente: str):
        self.nivel = nivel
        self.titulo = titulo
        self.descricao = descricao
        self.componente = componente
        self.timestamp = datetime.now().isoformat()

    def to_dict(self) -> dict:
        return {
            "nivel": self.nivel,
            "titulo": self.titulo,
            "descricao": self.descricao,
            "componente": self.componente,
            "timestamp": self.timestamp,
        }


class SupervisorAgent:
    """Agente que monitora saúde da aplicação Pepito"""

    def __init__(self):
        self.alerts: list[Alert] = []
        self.checks_executados = 0
        self.checks_falhados = 0

    def adicionar_alerta(self, alert: Alert):
        """Registra um alerta"""
        self.alerts.append(alert)
        print(f"[{alert.nivel}] {alert.componente}: {alert.titulo}")

    def check_servidor_node(self) -> bool:
        """Verifica se servidor Node está respondendo (endpoint /health, sem SSO)"""
        try:
            result = subprocess.run(
                ["curl", "-s", "-k", "-m", "5", "https://localhost:4173/health"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.checks_executados += 1
            if result.returncode != 0 or '"ok":true' not in result.stdout.replace(" ", ""):
                self.adicionar_alerta(
                    Alert(
                        Alert.MUITO_ALTO,
                        "Servidor Node não responde",
                        "Aplicação Pepito está offline ou retornando erro HTTP.",
                        "Servidor Express",
                    )
                )
                self.checks_falhados += 1
                return False
            return True
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MUITO_ALTO,
                    "Erro ao verificar servidor",
                    f"Não consegui conectar: {str(e)}",
                    "Servidor Express",
                )
            )
            return False

    def check_api_queue(self) -> bool:
        """
        Verifica se a fila PLD tem dados válidos.

        Lê registration-queue-real.json diretamente do disco em vez de chamar
        /api/queue via HTTP: o endpoint exige SSO (requireAuth) e o Supervisor
        não tem sessão de navegador, o que gerava falso-positivo (401 tratado
        como "API indisponível"). O arquivo em disco é a mesma fonte que o
        endpoint serve, então o check permanece equivalente sem precisar
        contornar a autenticação.
        """
        try:
            file_path = ROOT / "pepito-frontend" / "src" / "data" / "registration-queue-real.json"
            self.checks_executados += 1

            if not file_path.exists():
                self.adicionar_alerta(
                    Alert(
                        Alert.ALTO,
                        "API /queue indisponível",
                        "Arquivo registration-queue-real.json não encontrado.",
                        "API PLD Queue",
                    )
                )
                self.checks_falhados += 1
                return False

            data = json.loads(file_path.read_text())
            total = data.get("_meta", {}).get("total", 0)

            if total == 0:
                self.adicionar_alerta(
                    Alert(
                        Alert.MÉDIO,
                        "Fila PLD vazia",
                        "Nenhum caso retornado de registration-queue-real.json.",
                        "API PLD Queue",
                    )
                )
                return False

            return True
        except json.JSONDecodeError:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.ALTO,
                    "API retorna JSON inválido",
                    "registration-queue-real.json não é JSON válido.",
                    "API PLD Queue",
                )
            )
            return False
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.ALTO,
                    "Erro ao verificar fila PLD",
                    f"Erro: {str(e)}",
                    "API PLD Queue",
                )
            )
            return False

    def check_arquivo_build(self) -> bool:
        """Verifica se dist/ foi buildado recentemente"""
        try:
            dist_path = ROOT / "pepito-frontend" / "dist" / "index.html"
            self.checks_executados += 1

            if not dist_path.exists():
                self.adicionar_alerta(
                    Alert(
                        Alert.MUITO_ALTO,
                        "Build dist/ não encontrado",
                        "Arquivo dist/index.html não existe. App não foi buildado.",
                        "Build System",
                    )
                )
                self.checks_falhados += 1
                return False

            # Verifica se foi buildado nos últimos 24h
            mtime = dist_path.stat().st_mtime
            age_hours = (datetime.now().timestamp() - mtime) / 3600

            if age_hours > 24:
                self.adicionar_alerta(
                    Alert(
                        Alert.MÉDIO,
                        "Build desatualizado",
                        f"dist/ foi buildado há {int(age_hours)} horas. Atualizações recentes podem não estar visíveis.",
                        "Build System",
                    )
                )
                return False

            return True
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MÉDIO,
                    "Erro ao verificar build",
                    f"Erro: {str(e)}",
                    "Build System",
                )
            )
            return False

    def check_analises_salvas(self) -> bool:
        """Verifica integridade de analises-salvas.json"""
        try:
            file_path = ROOT / "pepito-frontend" / "src" / "data" / "analises-salvas.json"
            self.checks_executados += 1

            if not file_path.exists():
                self.adicionar_alerta(
                    Alert(
                        Alert.ALTO,
                        "Arquivo analises-salvas.json não encontrado",
                        "Persistência de análises pode estar quebrada.",
                        "Storage",
                    )
                )
                self.checks_falhados += 1
                return False

            data = json.loads(file_path.read_text())
            total = len(data.get("analises", []))

            # Valida estrutura mínima
            if not isinstance(data.get("analises"), list):
                self.adicionar_alerta(
                    Alert(
                        Alert.ALTO,
                        "JSON corrompido: analises-salvas.json",
                        "Campo 'analises' não é array.",
                        "Storage",
                    )
                )
                self.checks_falhados += 1
                return False

            # Aviso se arquivo ficou muito grande (> 100MB)
            size_mb = file_path.stat().st_size / (1024 * 1024)
            if size_mb > 100:
                self.adicionar_alerta(
                    Alert(
                        Alert.MÉDIO,
                        "Arquivo analises-salvas.json muito grande",
                        f"Tamanho: {size_mb:.1f}MB. Considere limpar histórico.",
                        "Storage",
                    )
                )

            return True
        except json.JSONDecodeError:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MUITO_ALTO,
                    "JSON corrompido: analises-salvas.json",
                    "Arquivo não é JSON válido. Dados podem estar perdidos.",
                    "Storage",
                )
            )
            return False
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.ALTO,
                    "Erro ao verificar analises-salvas.json",
                    f"Erro: {str(e)}",
                    "Storage",
                )
            )
            return False

    def check_registration_queue_real(self) -> bool:
        """Verifica integridade de registration-queue-real.json"""
        try:
            file_path = ROOT / "pepito-frontend" / "src" / "data" / "registration-queue-real.json"
            self.checks_executados += 1

            if not file_path.exists():
                self.adicionar_alerta(
                    Alert(
                        Alert.MUITO_ALTO,
                        "Arquivo registration-queue-real.json não encontrado",
                        "Fila PLD não está disponível.",
                        "PLD Queue",
                    )
                )
                self.checks_falhados += 1
                return False

            data = json.loads(file_path.read_text())
            items = data.get("items", [])

            if not isinstance(items, list):
                self.adicionar_alerta(
                    Alert(
                        Alert.MUITO_ALTO,
                        "JSON corrompido: registration-queue-real.json",
                        "Campo 'items' não é array.",
                        "PLD Queue",
                    )
                )
                self.checks_falhados += 1
                return False

            # Aviso se fila está vazia
            if len(items) == 0:
                self.adicionar_alerta(
                    Alert(
                        Alert.MÉDIO,
                        "Fila PLD vazia",
                        "Nenhum caso para análise. Verificar Athena/Retool.",
                        "PLD Queue",
                    )
                )

            return True
        except json.JSONDecodeError:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MUITO_ALTO,
                    "JSON corrompido: registration-queue-real.json",
                    "Arquivo não é JSON válido.",
                    "PLD Queue",
                )
            )
            return False
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.ALTO,
                    "Erro ao verificar registration-queue-real.json",
                    f"Erro: {str(e)}",
                    "PLD Queue",
                )
            )
            return False

    def check_cobertura_pareceres_sugestao(self) -> bool:
        """
        Verifica se todo draft_id da fila tem Parecer Sugestão IA gerado
        (pareceres-sugestao.json p/ CHECK_ANALISTA, pareceres-lideranca.json
        p/ CHECK_LIDERANCA). Cobre falha silenciosa dos geradores de sugestão
        e bundle desatualizado sem os pareceres mais recentes.
        """
        try:
            data_dir = ROOT / "pepito-frontend" / "src" / "data"
            self.checks_executados += 1

            queue = json.loads((data_dir / "registration-queue-real.json").read_text())
            items = queue.get("items", [])
            sugestao = json.loads((data_dir / "pareceres-sugestao.json").read_text())
            lideranca = json.loads((data_dir / "pareceres-lideranca.json").read_text())

            faltando_analista = [
                i["draft_id"] for i in items
                if i.get("bucket") == "CHECK_ANALISTA"
                and not (sugestao.get(i["draft_id"]) or {}).get("text")
            ]
            faltando_lideranca = [
                i["draft_id"] for i in items
                if i.get("bucket") == "CHECK_LIDERANCA"
                and not (lideranca.get(i["draft_id"]) or {}).get("text")
            ]

            if faltando_analista or faltando_lideranca:
                self.adicionar_alerta(
                    Alert(
                        Alert.ALTO,
                        "Parecer Sugestão IA ausente em casos da fila",
                        f"CHECK_ANALISTA sem sugestão: {len(faltando_analista)} "
                        f"({faltando_analista[:5]}). CHECK_LIDERANCA sem sugestão: "
                        f"{len(faltando_lideranca)} ({faltando_lideranca[:5]}). "
                        "Rodar generate-sugestao-parecer.py / generate-sugestao-lideranca.py.",
                        "Parecer Sugestão IA",
                    )
                )
                self.checks_falhados += 1
                return False

            return True
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MÉDIO,
                    "Erro ao verificar cobertura de Parecer Sugestão IA",
                    f"Erro: {str(e)}",
                    "Parecer Sugestão IA",
                )
            )
            return False

    def check_taxa_monitoramento_reforcado(self) -> bool:
        """
        Detecta derivação excessiva para Monitoramento Reforçado em
        CHECK_LIDERANCA — sinal de que o critério de negócio está usando
        PEP/vínculo ativo isoladamente em vez de exigir achado materializado
        (mídia/processo/achado externo de risco alto).
        """
        try:
            data_dir = ROOT / "pepito-frontend" / "src" / "data"
            self.checks_executados += 1

            lideranca = json.loads((data_dir / "pareceres-lideranca.json").read_text())
            total = [v for v in lideranca.values() if v.get("text")]
            if not total:
                return True

            reforcado = [v for v in total if "MONITORAMENTO REFORÇADO" in (v.get("text") or "").upper()]
            taxa = len(reforcado) / len(total)

            if taxa > 0.7:
                self.adicionar_alerta(
                    Alert(
                        Alert.MÉDIO,
                        "Taxa anômala de Monitoramento Reforçado em CHECK_LIDERANCA",
                        f"{len(reforcado)}/{len(total)} ({taxa:.0%}) dos pareceres de liderança "
                        "sugerem Monitoramento Reforçado — revisar se o critério exige achado "
                        "materializado (mídia/processo/achado externo), não apenas vínculo PEP ativo.",
                        "Regra de Negócio — Monitoramento Reforçado",
                    )
                )
                return False

            return True
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MÉDIO,
                    "Erro ao verificar taxa de Monitoramento Reforçado",
                    f"Erro: {str(e)}",
                    "Regra de Negócio — Monitoramento Reforçado",
                )
            )
            return False

    def check_novos_casos_lideranca(self) -> bool:
        """
        Alerta quando um novo caso passa a aparecer em bucket=CHECK_LIDERANCA
        desde a última execução do supervisor. Cobre o gap detectado em
        2026-07-15 (caso c974b32f): o analista deriva um caso à Mesa, o
        Retool/sync promove o bucket, mas nenhum canal notifica a Liderança —
        o caso só é visto se alguém abrir a Fila de Revisão manualmente.

        Estado persistido em .tools/supervisor-state-lideranca.json (lista
        de draft_id já vistos). Primeira execução apenas grava o baseline
        (não dispara alerta para o histórico inteiro).
        """
        try:
            data_dir = ROOT / "pepito-frontend" / "src" / "data"
            state_path = ROOT / "pepito-frontend" / ".tools" / "supervisor-state-lideranca.json"
            self.checks_executados += 1

            queue = json.loads((data_dir / "registration-queue-real.json").read_text())
            items = queue.get("items", [])

            atuais = {
                i["draft_id"]: i
                for i in items
                if i.get("bucket") == "CHECK_LIDERANCA"
                and i.get("status") in ("DOUBLE_CHECK", "IN_ANALYSIS")
                and i.get("sub_status") == "PLD_SCORE"
                and i.get("person_type") == "OWNER"
            }

            if state_path.exists():
                vistos = set(json.loads(state_path.read_text()).get("draft_ids", []))
            else:
                vistos = None  # primeira execução — sem baseline para comparar

            state_path.write_text(json.dumps({
                "draft_ids": sorted(atuais.keys()),
                "atualizado_em": datetime.now().isoformat(),
            }, indent=2, ensure_ascii=False))

            if vistos is None:
                return True

            novos = [draft_id for draft_id in atuais if draft_id not in vistos]
            if novos:
                linhas = []
                for draft_id in novos[:10]:
                    c = atuais[draft_id]
                    linhas.append(
                        f"• {c.get('rf_nome_oficial') or c.get('full_name_pf')} "
                        f"(CNPJ {c.get('cnpj')}, score {c.get('score_pld')}) — draft {draft_id}"
                    )
                self.adicionar_alerta(
                    Alert(
                        Alert.MÉDIO,
                        f"{len(novos)} novo(s) caso(s) escalado(s) para CHECK_LIDERANCA",
                        "Caso(s) derivado(s) pelo analista ou promovido(s) pelo Retool desde a "
                        "última verificação. Conferir Fila de Revisão:\n" + "\n".join(linhas),
                        "Fila de Revisão — Liderança",
                    )
                )
                return False

            return True
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MÉDIO,
                    "Erro ao verificar novos casos em CHECK_LIDERANCA",
                    f"Erro: {str(e)}",
                    "Fila de Revisão — Liderança",
                )
            )
            return False

    def check_consistencia_bucket_lideranca(self) -> bool:
        """
        Reimplementa os mesmos filtros de passesPLDFilters()
        (pepito-frontend/src/lib/registration-queue.ts) para detectar
        itens marcados bucket=CHECK_LIDERANCA no Retool que NÃO passariam
        nos filtros da Fila de Revisão do frontend — ou seja, casos que a
        Liderança acha que escalou mas que nunca aparecerão na tela.
        """
        try:
            data_dir = ROOT / "pepito-frontend" / "src" / "data"
            self.checks_executados += 1

            queue = json.loads((data_dir / "registration-queue-real.json").read_text())
            items = queue.get("items", [])

            marcados_lideranca = [i for i in items if i.get("bucket") == "CHECK_LIDERANCA"]
            invisiveis = [
                i["draft_id"] for i in marcados_lideranca
                if not (
                    i.get("status") in ("DOUBLE_CHECK", "IN_ANALYSIS")
                    and i.get("sub_status") == "PLD_SCORE"
                    and i.get("person_type") == "OWNER"
                )
            ]

            if invisiveis:
                self.adicionar_alerta(
                    Alert(
                        Alert.ALTO,
                        "Casos em CHECK_LIDERANCA invisíveis na Fila de Revisão",
                        f"{len(invisiveis)} caso(s) com bucket=CHECK_LIDERANCA não passam nos "
                        f"filtros do frontend (status/sub_status/person_type): {invisiveis[:5]}. "
                        "A Liderança acredita que o caso foi escalado mas ele nunca renderiza.",
                        "Fila de Revisão — Liderança",
                    )
                )
                self.checks_falhados += 1
                return False

            return True
        except Exception as e:
            self.checks_executados += 1
            self.checks_falhados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MÉDIO,
                    "Erro ao verificar consistência do bucket CHECK_LIDERANCA",
                    f"Erro: {str(e)}",
                    "Fila de Revisão — Liderança",
                )
            )
            return False

    def check_git_status(self) -> bool:
        """Verifica estado do repositório Git"""
        try:
            self.checks_executados += 1

            # Verifica se há mudanças não commitadas
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=ROOT / "pepito-frontend",
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode != 0:
                self.adicionar_alerta(
                    Alert(
                        Alert.BAIXO,
                        "Erro ao verificar git status",
                        "Não consegui rodar 'git status'.",
                        "Git Repository",
                    )
                )
                return False

            if result.stdout.strip():
                # Tem mudanças não commitadas
                lines = result.stdout.strip().split("\n")
                self.adicionar_alerta(
                    Alert(
                        Alert.BAIXO,
                        "Mudanças não commitadas",
                        f"{len(lines)} arquivo(s) modificado(s) sem commit.",
                        "Git Repository",
                    )
                )
                return False

            return True
        except Exception as e:
            self.checks_executados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.BAIXO,
                    "Erro ao verificar git",
                    f"Erro: {str(e)}",
                    "Git Repository",
                )
            )
            return False

    def check_typescript_errors(self) -> bool:
        """Verifica se há erros de TypeScript no código"""
        try:
            self.checks_executados += 1

            result = subprocess.run(
                ["npm", "run", "typecheck"],
                cwd=ROOT / "pepito-frontend",
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                # Conta quantos erros
                error_lines = result.stderr.count("error")
                self.adicionar_alerta(
                    Alert(
                        Alert.ALTO,
                        "Erros de TypeScript detectados",
                        f"npm typecheck falhou com ~{error_lines} erro(s). Build pode falhar.",
                        "TypeScript",
                    )
                )
                self.checks_falhados += 1
                return False

            return True
        except subprocess.TimeoutExpired:
            self.checks_executados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MÉDIO,
                    "TypeCheck timeout",
                    "npm typecheck demorou > 30s.",
                    "TypeScript",
                )
            )
            return False
        except Exception as e:
            self.checks_executados += 1
            self.adicionar_alerta(
                Alert(
                    Alert.MÉDIO,
                    "Erro ao verificar TypeScript",
                    f"Erro: {str(e)}",
                    "TypeScript",
                )
            )
            return False

    def executar_todas_verificacoes(self) -> dict:
        """Executa todas as verificações do supervisor"""
        print("\n" + "=" * 60)
        print(f"SUPERVISOR AGENT — {datetime.now().isoformat()}")
        print("=" * 60 + "\n")

        # Executa todas as verificações
        self.check_servidor_node()
        self.check_api_queue()
        self.check_arquivo_build()
        self.check_analises_salvas()
        self.check_registration_queue_real()
        self.check_cobertura_pareceres_sugestao()
        self.check_taxa_monitoramento_reforcado()
        self.check_novos_casos_lideranca()
        self.check_consistencia_bucket_lideranca()
        self.check_git_status()
        # self.check_typescript_errors()  # Opcional — comentado para não bloquear se npm não disponível

        # Sumário
        print(f"\n{'=' * 60}")
        print(f"SUMÁRIO: {self.checks_executados} verificações")
        print(f"Falhadas: {self.checks_falhados}")
        print(f"Alertas: {len(self.alerts)}")
        print("=" * 60 + "\n")

        return {
            "timestamp": datetime.now().isoformat(),
            "checks_executados": self.checks_executados,
            "checks_falhados": self.checks_falhados,
            "alertas": [a.to_dict() for a in self.alerts],
        }


def enviar_para_slack(resultado: dict, webhook_url: str):
    """Envia alertas para Slack via webhook"""
    if not webhook_url:
        print("[AVISO] SLACK_WEBHOOK_URL não configurada. Alertas não serão enviados.")
        return

    if not resultado["alertas"]:
        print("[OK] Nenhum alerta para enviar ao Slack.")
        return

    try:
        import requests
    except ImportError:
        print("[AVISO] requests não instalado. Pulando envio para Slack.")
        return

    # Agrupa alertas por nível
    alertas_por_nivel = {}
    for alert in resultado["alertas"]:
        nivel = alert["nivel"]
        if nivel not in alertas_por_nivel:
            alertas_por_nivel[nivel] = []
        alertas_por_nivel[nivel].append(alert)

    # Cria mensagem Slack
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "🔍 Relatório Supervisor — Pepito",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Horário:* {resultado['timestamp']}\n*Verificações:* {resultado['checks_executados']} | *Falhadas:* {resultado['checks_falhados']}",
            },
        },
    ]

    # Adiciona alertas agrupados por nível
    for nivel in ["🔴 MUITO ALTO", "🟠 ALTO", "🟡 MÉDIO", "🔵 BAIXO"]:
        if nivel in alertas_por_nivel:
            alerts = alertas_por_nivel[nivel]
            texto = f"*{nivel}* ({len(alerts)})\n"
            for alert in alerts:
                texto += f"• *{alert['componente']}*: {alert['titulo']}\n  {alert['descricao']}\n"

            blocks.append(
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": texto},
                }
            )

    payload = {"blocks": blocks}

    try:
        import json as _json
        import subprocess
        _payload = _json.dumps(payload)
        _bundle = os.path.expanduser("~/.cora_cacert.pem")
        _cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                "-X", "POST", "-H", "Content-Type: application/json",
                "-d", _payload]
        if os.path.exists(_bundle):
            _cmd += ["--cacert", _bundle]
        _cmd.append(webhook_url)
        _result = subprocess.run(_cmd, capture_output=True, text=True, timeout=15)
        if _result.stdout.strip() == "200":
            print(f"✓ Alertas enviados para Slack ({len(resultado['alertas'])} alertas)")
        else:
            print(f"✗ Erro ao enviar para Slack: HTTP {_result.stdout.strip()}")
    except Exception as e:
        print(f"✗ Erro ao enviar para Slack: {str(e)}")


def main():
    supervisor = SupervisorAgent()
    resultado = supervisor.executar_todas_verificacoes()

    # Envia para Slack se webhook configurada.
    # IMPORTANTE: usar a variável dedicada, não a genérica SLACK_WEBHOOK_URL —
    # o .env raiz tem essa chave repetida em vários blocos (midiamonitor_pld,
    # morning-call, pepito-supervisor, giro PCC/CV) e dotenv mantém o último
    # valor parseado no arquivo, que hoje pertence ao bloco do Giro PCC/CV
    # (canal #midias-adversas). Usar a genérica aqui envia o relatório do
    # Pepito Supervisor para o canal errado. Bug real: 2026-07-15.
    webhook_url = os.getenv("SLACK_WEBHOOK_URL_PEPITO_SUPERVISOR", "")
    if webhook_url:
        enviar_para_slack(resultado, webhook_url)

    # Salva resultado em arquivo
    log_file = ROOT / "pepito-frontend" / ".tools" / "supervisor-last-report.json"
    log_file.write_text(json.dumps(resultado, indent=2, ensure_ascii=False))
    print(f"✓ Relatório salvo em: {log_file}")

    # Exit com código de erro se houver alertas críticos
    muito_altos = [a for a in resultado["alertas"] if "🔴" in a["nivel"]]
    if muito_altos:
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
