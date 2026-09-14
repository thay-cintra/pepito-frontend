import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "gerar-csv-desabonadores-final.py"


def load_script():
    spec = importlib.util.spec_from_file_location("gerar_csv_desabonadores_final", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GerarCsvDesabonadoresFinalTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.adverse_path = self.root / "desabonadores.csv"
        self.ledger_path = self.root / "ledger.json"
        self.lookup_path = self.root / "lookup.json"
        self.output_path = self.root / "final.csv"

        with self.adverse_path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(
                output,
                fieldnames=["draft_id", "nome_pep", "cpf_pep", "campo_desabonador", "resumo"],
            )
            writer.writeheader()
            writer.writerows(
                [
                    {"draft_id": "draft-2", "nome_pep": "PEP Dois", "cpf_pep": "222", "campo_desabonador": "dividasAtivas", "resumo": "dívida"},
                    {"draft_id": "draft-1", "nome_pep": "PEP Um", "cpf_pep": "111", "campo_desabonador": "midiaNegativas", "resumo": "mídia"},
                    {"draft_id": "draft-3", "nome_pep": "PEP Três", "cpf_pep": "333", "campo_desabonador": "processosJudiciais", "resumo": "réu"},
                    {"draft_id": "draft-1", "nome_pep": "PEP Um", "cpf_pep": "111", "campo_desabonador": "score", "resumo": "ALTO"},
                ]
            )
        self.ledger_path.write_text(
            json.dumps(
                {
                    "111": {"token_compliance": "token-111"},
                    "222": {"token_compliance": "token-222"},
                    "333": {"token_compliance": "token-333"},
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_merges_lookup_token_and_sorts_by_documented_severity(self):
        module = load_script()
        self.lookup_path.write_text(
            json.dumps(
                {
                    "draft-1": {"razao_social": "Empresa Um", "cnpj": "11", "bid": "BID-1"},
                    "draft-3": {"razao_social": "Empresa Três", "cnpj": "33", "bid": None},
                }
            ),
            encoding="utf-8",
        )

        stats = module.generate_report(
            self.adverse_path,
            self.ledger_path,
            self.lookup_path,
            self.output_path,
        )
        with self.output_path.open(encoding="utf-8", newline="") as source:
            rows = list(csv.DictReader(source))

        self.assertEqual(list(rows[0]), list(module.OUTPUT_COLUMNS))
        self.assertEqual(
            [row["TIPO_SITUACAO_DESABONADORA"] for row in rows],
            [
                "Score Credilink ALTO/ALTÍSSIMO",
                "Processo judicial em polo passivo/adverso",
                "Mídia negativa",
                "Dívida ativa",
            ],
        )
        self.assertEqual(rows[0]["RAZAO_SOCIAL"], "Empresa Um")
        self.assertEqual(rows[0]["TOKEN"], "token-111")
        self.assertEqual(
            rows[0]["LINK_CREDILINK"],
            "https://dashboard.tesserati.com.br/Compliance/VisualizarDossie?token=token-111",
        )
        self.assertEqual(rows[1]["BID_ATUAL"], "")
        self.assertEqual(stats["draft_ids_sem_lookup"], 1)
        self.assertEqual(stats["tokens_ausentes"], 0)

    def test_missing_lookup_file_leaves_company_fields_blank_without_failing(self):
        module = load_script()

        stats = module.generate_report(
            self.adverse_path,
            self.ledger_path,
            self.lookup_path,
            self.output_path,
        )
        with self.output_path.open(encoding="utf-8", newline="") as source:
            rows = list(csv.DictReader(source))

        self.assertTrue(all(not row["RAZAO_SOCIAL"] and not row["CNPJ"] and not row["BID_ATUAL"] for row in rows))
        self.assertEqual(stats["draft_ids_sem_lookup"], 3)


if __name__ == "__main__":
    unittest.main()
