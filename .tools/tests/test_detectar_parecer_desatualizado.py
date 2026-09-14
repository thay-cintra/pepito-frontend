import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "detectar-parecer-desatualizado.py"


class DetectorParecerDesatualizadoTest(unittest.TestCase):
    def test_flags_only_approved_decisions_with_real_high_findings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            media = root / "media.json"
            lideranca = root / "lideranca.json"
            sugestao = root / "sugestao.json"
            output = root / "alertas.csv"

            media.write_text(json.dumps({
                "_meta": {},
                "a": [
                    {"title": "Condenação confirmada", "snippet": "Mantida pelo tribunal.", "risk_indicator": "alto", "achado_positivo": True},
                    {"title": "Placeholder", "risk_indicator": "alto", "achado_positivo": False},
                ],
                "b": [{"title": "Alto", "risk_indicator": "alto", "achado_positivo": True}],
                "c": [{"title": "Alto", "risk_indicator": "alto", "achado_positivo": True}],
                "d": [{"title": "Baixo", "risk_indicator": "baixo", "achado_positivo": True}],
                "e": [{"title": "Negativo", "risk_indicator": "alto", "achado_positivo": False}],
                "f": [{"title": "Sanção", "snippet": "Sanção real.", "risk_indicator": "alto", "achado_positivo": True}],
            }), encoding="utf-8")
            lideranca.write_text(json.dumps({
                "a": {"decisao": "aprovado", "generated_at": "2026-09-12T00:00:00Z"},
                "c": {"decisao": "reprovado", "generated_at": "2026-09-12T00:00:00Z"},
                "d": {"decisao": "aprovado", "generated_at": "2026-09-12T00:00:00Z"},
                "e": {"decisao": "aprovado", "generated_at": "2026-09-12T00:00:00Z"},
                "f": {"decisao": "falso_positivo", "generated_at": "2026-09-13T00:00:00Z"},
            }), encoding="utf-8")
            sugestao.write_text(json.dumps({
                "a": {"text": "Há ressalvas no corpo. Considerando o conjunto, sugerimos a APROVAÇÃO.", "generated_at": "2026-09-11T00:00:00Z"},
                "b": {"text": "O caso cita aprovação anterior. Recomendamos MONITORAMENTO REFORÇADO.", "generated_at": "2026-09-11T00:00:00Z"},
            }), encoding="utf-8")

            subprocess.run([
                sys.executable, str(SCRIPT),
                "--media-findings", str(media),
                "--pareceres-lideranca", str(lideranca),
                "--pareceres-sugestao", str(sugestao),
                "--output", str(output),
            ], check=True, capture_output=True, text=True)

            with output.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))

            self.assertEqual(
                list(rows[0]),
                ["draft_id", "bucket", "decisao_registrada", "quantos_achados_alto", "resumo_achado_mais_grave", "generated_at_parecer"],
            )
            self.assertEqual([(r["draft_id"], r["bucket"]) for r in rows], [
                ("a", "CHECK_ANALISTA"),
                ("a", "CHECK_LIDERANCA"),
                ("f", "CHECK_LIDERANCA"),
            ])
            self.assertEqual(rows[0]["quantos_achados_alto"], "1")
            self.assertIn("Condenação confirmada", rows[0]["resumo_achado_mais_grave"])


if __name__ == "__main__":
    unittest.main()
