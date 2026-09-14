import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "sinalizar-pareceres-desatualizados.py"


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


class SinalizarPareceresDesatualizadosTest(unittest.TestCase):
    def test_updates_both_buckets_limits_summary_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            alerts = root / "alerts.csv"
            media = root / "media.json"
            analyst = root / "analyst.json"
            leadership = root / "leadership.json"

            with alerts.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=[
                    "draft_id", "bucket", "decisao_registrada", "quantos_achados_alto",
                    "resumo_achado_mais_grave", "generated_at_parecer",
                ])
                writer.writeheader()
                writer.writerows([
                    {"draft_id": "both", "bucket": "CHECK_ANALISTA"},
                    {"draft_id": "both", "bucket": "CHECK_LIDERANCA"},
                    {"draft_id": "already", "bucket": "CHECK_LIDERANCA"},
                ])

            long_snippet = "x" * 170
            write_json(media, {
                "both": [
                    {"title": "Achado um", "snippet": long_snippet, "risk_indicator": "alto", "achado_positivo": True},
                    {"title": "Achado dois", "snippet": "segundo resumo", "risk_indicator": "alto", "achado_positivo": True},
                    {"title": "Achado três", "snippet": "não deve ser detalhado", "risk_indicator": "alto", "achado_positivo": True},
                    {"title": "Negativo", "risk_indicator": "alto", "achado_positivo": False},
                ],
                "already": [{"title": "Alto", "risk_indicator": "alto", "achado_positivo": True}],
            })
            write_json(analyst, {
                "both": {"text": "Texto analista original.", "model": "m", "generated_at": "g"},
            })
            already = {
                "text": "⚠️ ATENÇÃO — ACHADO ADICIONADO APÓS A GERAÇÃO DESTE PARECER: já sinalizado.\n\n---\n\nOriginal.",
                "decisao": "aprovado",
                "status": "inalterado",
                "revisao_manual_2026_09_15": {"motivo": "existente", "autor": "thay"},
            }
            write_json(leadership, {
                "both": {"text": "Texto liderança original.", "decisao": "aprovado", "status": "mantido"},
                "already": already,
            })

            command = [
                sys.executable, str(SCRIPT),
                "--alerts", str(alerts),
                "--media-findings", str(media),
                "--pareceres-sugestao", str(analyst),
                "--pareceres-lideranca", str(leadership),
            ]
            first = subprocess.run(command, check=True, capture_output=True, text=True)

            updated_analyst = json.loads(analyst.read_text(encoding="utf-8"))
            updated_leadership = json.loads(leadership.read_text(encoding="utf-8"))
            analyst_text = updated_analyst["both"]["text"]
            leadership_text = updated_leadership["both"]["text"]

            self.assertIn("pareceres-sugestao.json: 1 atualizado(s), 0 pulado(s)", first.stdout)
            self.assertIn("pareceres-lideranca.json: 1 atualizado(s), 1 pulado(s)", first.stdout)
            self.assertTrue(analyst_text.startswith("⚠️ ATENÇÃO — ACHADO DE RISCO ALTO NÃO REFLETIDO NESTE PARECER"))
            self.assertIn("Achado um — " + ("x" * 150) + "…", analyst_text)
            self.assertIn("Achado dois — segundo resumo", analyst_text)
            self.assertIn("+ 1 outro achado de risco alto", analyst_text)
            self.assertNotIn("Achado três — não deve ser detalhado", analyst_text)
            self.assertTrue(analyst_text.endswith("Texto analista original."))
            self.assertTrue(leadership_text.endswith("Texto liderança original."))
            self.assertEqual(updated_leadership["both"]["decisao"], "aprovado")
            self.assertEqual(updated_leadership["both"]["status"], "mantido")
            self.assertEqual(updated_leadership["already"], already)
            self.assertEqual(updated_analyst["both"]["model"], "m")
            self.assertIn("revisao_manual_2026_09_15", updated_analyst["both"])

            after_first = (analyst.read_bytes(), leadership.read_bytes())
            second = subprocess.run(command, check=True, capture_output=True, text=True)

            self.assertEqual((analyst.read_bytes(), leadership.read_bytes()), after_first)
            self.assertIn("pareceres-sugestao.json: 0 atualizado(s), 1 pulado(s)", second.stdout)
            self.assertIn("pareceres-lideranca.json: 0 atualizado(s), 2 pulado(s)", second.stdout)


if __name__ == "__main__":
    unittest.main()
