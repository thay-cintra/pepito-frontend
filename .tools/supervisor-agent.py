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
        """Verifica se servidor Node está respondendo"""
        try:
            result = subprocess.run(
                ["curl", "-s", "-k", "-m", "5", "https://192-168-201-67.sslip.io:4173"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.checks_executados += 1
            if result.returncode != 0 or "<!doctype" not in result.stdout.lower():
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
        """Verifica se /api/queue retorna dados válidos"""
        try:
            result = subprocess.run(
                [
                    "curl",
                    "-s",
                    "-k",
                    "-m",
                    "5",
                    "https://192-168-201-67.sslip.io:4173/api/queue",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.checks_executados += 1

            if result.returncode != 0:
                self.adicionar_alerta(
                    Alert(
                        Alert.ALTO,
                        "API /queue indisponível",
                        "Endpoint /api/queue não responde.",
                        "API PLD Queue",
                    )
                )
                self.checks_falhados += 1
                return False

            data = json.loads(result.stdout)
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
                    "Resposta de /api/queue não é JSON válido.",
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
        response = requests.post(webhook_url, json=payload, timeout=10)
        if response.status_code == 200:
            print(f"✓ Alertas enviados para Slack ({len(resultado['alertas'])} alertas)")
        else:
            print(f"✗ Erro ao enviar para Slack: {response.status_code}")
    except Exception as e:
        print(f"✗ Erro ao enviar para Slack: {str(e)}")


def main():
    supervisor = SupervisorAgent()
    resultado = supervisor.executar_todas_verificacoes()

    # Envia para Slack se webhook configurada
    webhook_url = os.getenv("SLACK_WEBHOOK_URL", "")
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
