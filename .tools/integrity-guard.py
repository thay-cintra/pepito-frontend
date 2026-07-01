#!/usr/bin/env python3
"""
Integrity Guard — Proteção contra exclusões acidentais de pareceres

Responsabilidades:
  1. Fazer backup diário dos arquivos de parecer
  2. Detectar deletions entre execuções
  3. Alertar Slack se integridade foi quebrada
  4. Restaurar automaticamente de backup
  5. Manter histórico de versões

Arquivos protegidos:
  - pareceres-sugestao.json
  - pareceres-real.json
  - pareceres-lideranca.json
  - analises-salvas.json
"""

import json
import hashlib
import shutil
from pathlib import Path
from datetime import datetime
import os
import sys

ROOT = Path(__file__).resolve().parents[2] / "pepito-frontend"
DATA_DIR = ROOT / "src" / "data"
BACKUP_DIR = ROOT / ".tools" / "backups" / "pareceres"
INTEGRITY_LOG = ROOT / ".tools" / "integrity.log"

# Arquivos críticos para proteção
PROTECTED_FILES = {
    "pareceres-sugestao.json": "Sugestões IA do parecer analista",
    "pareceres-real.json": "Pareceres reais do analista",
    "pareceres-lideranca.json": "Decisões da liderança",
    "analises-salvas.json": "Análises salvas (backup)",
}


class IntegrityGuard:
    """Monitora integridade dos arquivos de parecer"""

    def __init__(self):
        self.alerts = []
        self.restored = 0
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    def _compute_hash(self, filepath: Path) -> str:
        """Calcula hash SHA256 de um arquivo"""
        if not filepath.exists():
            return "FILE_NOT_FOUND"
        with open(filepath, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def _get_backup_path(self, filename: str, timestamp: str = None) -> Path:
        """Retorna caminho de backup com timestamp"""
        if timestamp is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return BACKUP_DIR / f"{filename}.{timestamp}.backup"

    def _load_manifest(self) -> dict:
        """Carrega manifest de integridade anterior"""
        manifest_path = BACKUP_DIR / "manifest.json"
        if manifest_path.exists():
            try:
                return json.loads(manifest_path.read_text())
            except Exception:
                return {}
        return {}

    def _save_manifest(self, manifest: dict):
        """Salva manifest de integridade"""
        manifest_path = BACKUP_DIR / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2))

    def backup_files(self) -> dict:
        """Faz backup de todos os arquivos protegidos"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        manifest = {}

        for filename, description in PROTECTED_FILES.items():
            filepath = DATA_DIR / filename

            if not filepath.exists():
                manifest[filename] = {
                    "status": "NOT_FOUND",
                    "size": 0,
                    "hash": "FILE_NOT_FOUND",
                    "backed_up": False,
                }
                continue

            try:
                # Calcula hash
                file_hash = self._compute_hash(filepath)
                size = filepath.stat().st_size

                # Faz backup
                backup_path = self._get_backup_path(filename, timestamp)
                shutil.copy2(filepath, backup_path)

                manifest[filename] = {
                    "status": "OK",
                    "size": size,
                    "hash": file_hash,
                    "timestamp": timestamp,
                    "backed_up": True,
                    "description": description,
                }

                print(f"✓ Backup: {filename} ({size} bytes)")
            except Exception as e:
                manifest[filename] = {
                    "status": "ERROR",
                    "error": str(e),
                    "backed_up": False,
                }
                print(f"✗ Erro ao fazer backup de {filename}: {str(e)}")

        # Salva manifest
        self._save_manifest(manifest)
        return manifest

    def check_integrity(self) -> dict:
        """Verifica se houve deleção de pareceres desde último backup"""
        previous_manifest = self._load_manifest()

        if not previous_manifest:
            print("[INFO] Primeiro backup — nada para comparar")
            return {"status": "FIRST_RUN", "violations": 0}

        violations = {
            "deleted": [],  # Arquivos que foram deletados
            "shrunk": [],  # Arquivos que ficaram muito menores
            "corrupted": [],  # Arquivos que mudaram drasticamente
        }

        for filename, prev_data in previous_manifest.items():
            if filename not in PROTECTED_FILES:
                continue

            filepath = DATA_DIR / filename
            current_data = {
                "status": "NOT_FOUND",
                "size": 0,
                "hash": "FILE_NOT_FOUND",
            }

            if filepath.exists():
                current_data = {
                    "status": "OK",
                    "size": filepath.stat().st_size,
                    "hash": self._compute_hash(filepath),
                }

            # Verifica deleção
            if prev_data.get("status") == "OK" and current_data["status"] == "NOT_FOUND":
                violations["deleted"].append(filename)
                self._alert(f"🔴 DELETADO: {filename}")
                continue

            # Verifica se ficou muito menor (> 50% de perda)
            if prev_data.get("size", 0) > 0 and current_data.get("size", 0) > 0:
                prev_size = prev_data["size"]
                curr_size = current_data["size"]
                loss_pct = (1 - curr_size / prev_size) * 100

                if loss_pct > 50:
                    violations["shrunk"].append(
                        {
                            "filename": filename,
                            "loss_pct": loss_pct,
                            "before": prev_size,
                            "after": curr_size,
                        }
                    )
                    self._alert(
                        f"🟠 ENCOLHIDO: {filename} perdeu {loss_pct:.0f}% do tamanho"
                    )

            # Verifica hash (corrupção)
            if (
                prev_data.get("hash") != current_data.get("hash")
                and prev_data.get("size", 0) > 0
                and current_data.get("size", 0) > 0
            ):
                # Mudança significativa sem perda de tamanho pode ser corrupção
                if abs(prev_data["size"] - current_data["size"]) < prev_data["size"] * 0.1:
                    violations["corrupted"].append(filename)
                    self._alert(f"🟡 HASH DIFERENTE: {filename}")

        total_violations = (
            len(violations["deleted"])
            + len(violations["shrunk"])
            + len(violations["corrupted"])
        )

        return {
            "status": "CHECKED",
            "violations": total_violations,
            "deleted": violations["deleted"],
            "shrunk": violations["shrunk"],
            "corrupted": violations["corrupted"],
        }

    def restore_from_backup(self, filename: str) -> bool:
        """Restaura arquivo do backup mais recente"""
        backups = sorted(BACKUP_DIR.glob(f"{filename}.*.backup"), reverse=True)

        if not backups:
            self._alert(f"✗ Nenhum backup encontrado para {filename}")
            return False

        latest_backup = backups[0]

        try:
            shutil.copy2(latest_backup, DATA_DIR / filename)
            self._alert(f"✓ Restaurado de: {latest_backup.name}")
            self.restored += 1
            return True
        except Exception as e:
            self._alert(f"✗ Erro ao restaurar {filename}: {str(e)}")
            return False

    def _alert(self, message: str):
        """Registra alerta"""
        self.alerts.append(message)
        print(f"[ALERTA] {message}")

    def auto_recover(self, violations: dict):
        """Recupera automaticamente de problemas detectados"""
        if violations.get("violations", 0) == 0:
            print("✅ Integridade OK — nenhum problema detectado")
            return

        print(f"\n⚠️  {violations['violations']} violação(ões) detectada(s)")

        # Restaura deletados
        for filename in violations.get("deleted", []):
            print(f"\n🔧 Restaurando {filename}...")
            if self.restore_from_backup(filename):
                print(f"✓ {filename} restaurado com sucesso")

        # Alerta para encolhimento (requer investigação)
        for item in violations.get("shrunk", []):
            print(
                f"\n⚠️  CUIDADO: {item['filename']} perdeu {item['loss_pct']:.0f}%"
            )
            print(f"   Antes: {item['before']} bytes")
            print(f"   Depois: {item['after']} bytes")
            print(f"   Ação: Investigar manualmente antes de restaurar")

    def send_slack_alert(self, violations: dict):
        """Envia alerta para Slack se houver violações"""
        if violations.get("violations", 0) == 0:
            return

        try:
            import requests
            from dotenv import load_dotenv

            load_dotenv(Path("/Users/thay/Projetos Thay/.env"))
            webhook_url = os.getenv("SLACK_WEBHOOK_URL", "")

            if not webhook_url:
                return

            verify_ssl = os.getenv("NODE_ENV", "").lower() != "development"

            # Constrói mensagem
            blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "⚠️ Integrity Guard Alert"},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*Integridade de pareceres comprometida!*\n\n*Violações:* {violations['violations']}\n*Restaurados:* {self.restored}",
                    },
                },
            ]

            if violations.get("deleted"):
                blocks.append(
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"🔴 *DELETADOS:*\n" + "\n".join(violations["deleted"]),
                        },
                    }
                )

            if violations.get("shrunk"):
                shrunk_text = "\n".join(
                    [
                        f"• {item['filename']}: -{item['loss_pct']:.0f}%"
                        for item in violations["shrunk"]
                    ]
                )
                blocks.append(
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": f"🟠 *ENCOLHIDOS:*\n{shrunk_text}"},
                    }
                )

            payload = {"blocks": blocks}
            requests.post(webhook_url, json=payload, timeout=10, verify=verify_ssl)
        except Exception as e:
            print(f"[AVISO] Erro ao enviar alerta Slack: {str(e)}")

    def log_integrity_report(self, violations: dict):
        """Salva relatório de integridade"""
        report = {
            "timestamp": datetime.now().isoformat(),
            "violations": violations,
            "alerts": self.alerts,
            "restored": self.restored,
        }

        # Append ao log
        with open(INTEGRITY_LOG, "a") as f:
            f.write(json.dumps(report) + "\n")

        print(f"\n✓ Relatório salvo: {INTEGRITY_LOG}")


def main():
    guard = IntegrityGuard()

    print("=" * 70)
    print("INTEGRITY GUARD — Proteção de Pareceres")
    print("=" * 70 + "\n")

    # 1. Verifica integridade (compara com backup anterior)
    print("[1/4] Verificando integridade...")
    violations = guard.check_integrity()

    # 2. Faz novo backup
    print("\n[2/4] Fazendo backup dos arquivos...")
    manifest = guard.backup_files()

    # 3. Auto-recupera se necessário
    if violations.get("violations", 0) > 0:
        print("\n[3/4] Auto-recuperando...")
        guard.auto_recover(violations)

        # 4. Alerta Slack
        print("\n[4/4] Enviando alertas...")
        guard.send_slack_alert(violations)

    # Salva relatório
    guard.log_integrity_report(violations)

    print("\n" + "=" * 70)
    if violations.get("violations", 0) == 0:
        print("✅ STATUS: Integridade OK")
    else:
        print(f"⚠️  STATUS: {violations['violations']} violação(ões)")
    print("=" * 70)

    # Exit com código de erro se houver deletados
    if violations.get("deleted"):
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
