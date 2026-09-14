import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def run_script(script: str, payload: dict):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "findings.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(ROOT / ".tools" / script), "--input", str(path), "--output", str(path)],
            check=False,
            capture_output=True,
            text=True,
        )
        result = json.loads(path.read_text(encoding="utf-8"))
        return proc, result


class FixStaleJusbrasilScopeTextTest(unittest.TestCase):
    def test_replaces_false_scope_claim_and_preserves_the_rest(self):
        stale = (
            "Consulta à API não retornou processos criminais. Total retornado: 0. "
            "Fonte confiável — cobre Vara Criminal Estadual, TRF, MP. "
            "ESCOPO: este contrato JusBrasil não cobre processos cíveis/trabalhistas — "
            "ver achado Credilink (ProcessoTribunalJustica) para essa cobertura."
        )
        payload = {
            "_meta": {"description": "teste"},
            "draft-a": [{"snippet": stale, "source": "JusBrasil Background Check API (produção)"}],
            "draft-b": [{"snippet": "sem alteração", "source": "Outra fonte"}],
        }

        proc, result = run_script("fix-stale-jusbrasil-scope-text.py", payload)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        fixed = result["draft-a"][0]["snippet"]
        self.assertIn("não retornou processos criminais", fixed)
        self.assertNotIn("não cobre processos cíveis/trabalhistas", fixed)
        self.assertIn("pendente de nova consulta quando a cota mensal liberar", fixed)
        self.assertEqual(result["draft-b"][0]["snippet"], "sem alteração")
        self.assertIn("1 achado(s) corrigido(s) em 1 draft_id(s)", proc.stdout)


class BackfillAchadoPositivoTest(unittest.TestCase):
    def test_classifies_conservatively_and_preserves_existing_values(self):
        payload = {
            "_meta": {},
            "draft-a": [
                {"title": "M7 — Contexto regional", "snippet": "operação no município", "risk_indicator": "alto"},
                {"title": "Consulta", "snippet": "não retornou processos", "risk_indicator": "alto"},
                {"title": "Mídia", "snippet": "não foram encontradas matérias adversas", "risk_indicator": "medio"},
                {"title": "Processo", "snippet": "réu em ação penal ativa", "risk_indicator": "medio"},
                {"title": "Sanção", "snippet": "empresa consta no CNEP", "risk_indicator": "alto"},
                {"title": "Informativo", "snippet": "consta em cadastro público", "risk_indicator": "baixo"},
                {"title": "Erro de Consulta", "snippet": "falha técnica; não foi possível consultar", "risk_indicator": "medio"},
                {"title": "Preservado", "snippet": "nenhum resultado", "risk_indicator": "baixo", "achado_positivo": True},
            ],
        }

        proc, result = run_script("backfill-achado-positivo.py", payload)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        values = [f["achado_positivo"] for f in result["draft-a"]]
        self.assertEqual(values, [False, False, False, True, True, False, False, True])
        self.assertIn("true=2 false=5 já_tinham=1", proc.stdout)


if __name__ == "__main__":
    unittest.main()
