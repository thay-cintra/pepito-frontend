import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "fetch-media-findings.py"
SPEC = importlib.util.spec_from_file_location("fetch_media_findings", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
fetch_media_findings = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch_media_findings)


class ParseWebsearchFindingsTextTest(unittest.TestCase):
    def test_rejects_response_without_json_and_includes_raw_text_excerpt(self):
        raw_text = "budget bloqueado sem payload JSON " + ("x" * 250)

        with self.assertRaisesRegex(
            ValueError,
            r"resposta sem JSON reconhecível.*texto bruto \(200 chars\)",
        ) as raised:
            fetch_media_findings._parse_websearch_findings_text(raw_text)

        self.assertIn(repr(raw_text[:200]), str(raised.exception))
        self.assertNotIn(raw_text[:201], str(raised.exception))

    def test_rejects_explicit_empty_findings_array(self):
        with self.assertRaisesRegex(ValueError, r"lista de findings vazia"):
            fetch_media_findings._parse_websearch_findings_text("[]")

    def test_parses_balanced_findings_array_after_prose(self):
        raw_text = (
            "Resultado da pesquisa:\n"
            '[{"source":"TSE — Divulgação de Candidaturas",'
            '"risk_indicator":"baixo","achado_positivo":true}]\nObservação final.'
        )

        self.assertEqual(
            fetch_media_findings._parse_websearch_findings_text(raw_text),
            [
                {
                    "source": "TSE — Divulgação de Candidaturas",
                    "risk_indicator": "baixo",
                    "achado_positivo": True,
                }
            ],
        )

    def test_rejects_websearch_finding_without_explicit_positive_flag(self):
        raw_text = '[{"source":"TSE","risk_indicator":"baixo"}]'

        with self.assertRaisesRegex(ValueError, r"achado_positivo booleano"):
            fetch_media_findings._parse_websearch_findings_text(raw_text)

    def test_forces_m7_context_to_not_be_a_positive_match(self):
        raw_text = (
            '[{"source":"Mídia regional","risk_indicator":"alto",'
            '"match":"M7 — contexto regional","achado_positivo":true}]'
        )

        parsed = fetch_media_findings._parse_websearch_findings_text(raw_text)

        self.assertFalse(parsed[0]["achado_positivo"])

    def test_logs_when_websearch_is_skipped_for_case_without_pep(self):
        original_available = fetch_media_findings.WEB_SEARCH_AVAILABLE
        original_claude = fetch_media_findings.claude
        fetch_media_findings.WEB_SEARCH_AVAILABLE = True
        fetch_media_findings.claude = object()
        output = io.StringIO()

        try:
            with redirect_stdout(output):
                result = fetch_media_findings.pesquisar_caso_web(
                    {"draft_id": "sem-pep", "pep_pf": []}, []
                )
        finally:
            fetch_media_findings.WEB_SEARCH_AVAILABLE = original_available
            fetch_media_findings.claude = original_claude

        self.assertEqual(result, [])
        self.assertIn("WebSearch não executado: pep_pf vazio", output.getvalue())


class JusbrasilQuotaTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_usage_path = fetch_media_findings._JUS_USAGE_PATH
        fetch_media_findings._JUS_USAGE_PATH = Path(self.temp_dir.name) / "usage.json"
        self.month = date.today().strftime("%Y-%m")

    def tearDown(self):
        fetch_media_findings._JUS_USAGE_PATH = self.original_usage_path
        self.temp_dir.cleanup()

    def _write_usage(self, *, total, current_month):
        fetch_media_findings._JUS_USAGE_PATH.write_text(
            json.dumps(
                {
                    "total": total,
                    "by_month": {"2026-04": 325, self.month: current_month},
                    "limit": 325,
                }
            )
        )

    def test_quota_checks_current_month_instead_of_lifetime_total(self):
        self._write_usage(total=325, current_month=37)

        self.assertFalse(fetch_media_findings._jus_quota_exceeded())
        self.assertFalse(fetch_media_findings._jus_quota_warning())

    def test_increment_returns_current_month_usage_and_preserves_lifetime_total(self):
        self._write_usage(total=325, current_month=37)

        month_total, exceeded = fetch_media_findings._jus_usage_increment()
        saved = json.loads(fetch_media_findings._JUS_USAGE_PATH.read_text())

        self.assertEqual(month_total, 38)
        self.assertFalse(exceeded)
        self.assertEqual(saved["total"], 326)
        self.assertEqual(saved["by_month"][self.month], 38)

    def test_warning_and_limit_boundaries_are_monthly(self):
        self._write_usage(total=900, current_month=292)
        self.assertFalse(fetch_media_findings._jus_quota_warning())
        self.assertFalse(fetch_media_findings._jus_quota_exceeded())

        fetch_media_findings._jus_usage_increment()
        self.assertTrue(fetch_media_findings._jus_quota_warning())
        self.assertFalse(fetch_media_findings._jus_quota_exceeded())

        self._write_usage(total=932, current_month=324)
        month_total, exceeded = fetch_media_findings._jus_usage_increment()
        self.assertEqual(month_total, 325)
        self.assertTrue(exceeded)
        self.assertTrue(fetch_media_findings._jus_quota_exceeded())

    def test_failed_dispatched_request_is_still_counted(self):
        class FailingSession:
            def post(self, *args, **kwargs):
                raise TimeoutError("read timed out")

        self._write_usage(total=10, current_month=0)
        original_key = fetch_media_findings.JUS_KEY
        original_session = fetch_media_findings._JUS_SESSION
        fetch_media_findings.JUS_KEY = "test-key"
        fetch_media_findings._JUS_SESSION = FailingSession()
        try:
            result = fetch_media_findings._jus_post("background-check/test", {})
        finally:
            fetch_media_findings.JUS_KEY = original_key
            fetch_media_findings._JUS_SESSION = original_session

        saved = json.loads(fetch_media_findings._JUS_USAGE_PATH.read_text())
        self.assertIn("_erro", result)
        self.assertEqual(saved["by_month"][self.month], 1)
        self.assertEqual(saved["total"], 11)

    def test_missing_or_invalid_month_map_starts_at_zero(self):
        fetch_media_findings._JUS_USAGE_PATH.write_text(
            json.dumps({"total": 7, "by_month": None, "limit": 325})
        )

        self.assertFalse(fetch_media_findings._jus_quota_warning())
        self.assertFalse(fetch_media_findings._jus_quota_exceeded())
        month_total, exceeded = fetch_media_findings._jus_usage_increment()

        self.assertEqual(month_total, 1)
        self.assertFalse(exceeded)


class ConsultarJusbrasilTest(unittest.TestCase):
    def test_consults_all_five_endpoints_and_classifies_noncriminal_lawsuits(self):
        calls = []
        responses = {
            "background-check/lawsuits/criminal": {
                "nome": "Pessoa Teste",
                "processos": [
                    {
                        "tipo_processo": "CRIMINAL",
                        "status": "ATIVO",
                        "tipificacao": [
                            {"tipo_de_ocorrencia": "Fraude em licitação"}
                        ],
                        "polo_passivo": True,
                        "tribunal": "TJSP",
                        "UF": "SP",
                        "comarca": "São Paulo",
                    },
                    {
                        "tipo_processo": "CRIMINAL",
                        "status": "ARQUIVADO",
                        "tipificacao": [
                            {"tipo_de_ocorrencia": "Infração não crítica"}
                        ],
                        "polo_passivo": False,
                        "tribunal": "TJSP",
                        "UF": "SP",
                        "comarca": "São Paulo",
                    },
                ],
                "pagination": {"total": 2},
            },
            "background-check/lawsuits/civil": {
                "nome": "Pessoa Teste",
                "processos": [
                    {
                        "tipo_processo": "CIVIL",
                        "status": "ATIVO",
                        "polo_passivo": True,
                        "tribunal": "TJSP",
                        "UF": "SP",
                        "comarca": "São Paulo",
                        "valor_causa": 1000,
                    }
                ],
                "pagination": {"total": 1},
            },
            "background-check/lawsuits/trabalhista": {
                "nome": "Pessoa Teste",
                "processos": [
                    {
                        "tipo_processo": "TRABALHISTA",
                        "status": "ARQUIVADO",
                        "polo_passivo": False,
                        "tribunal": "TRT2",
                        "UF": "SP",
                        "comarca": "São Paulo",
                        "valor_causa": 500,
                    }
                ],
                "pagination": {"total": 1},
            },
            "background-check/bnmp": {"mandados": []},
            "background-check/mp": {"mp": []},
        }
        original_post = fetch_media_findings._jus_post
        original_quota = fetch_media_findings._jus_quota_exceeded

        def fake_post(endpoint, payload):
            calls.append((endpoint, payload))
            return responses[endpoint]

        fetch_media_findings._jus_post = fake_post
        fetch_media_findings._jus_quota_exceeded = lambda: False
        try:
            findings = fetch_media_findings.consultar_jusbrasil(
                "123.456.789-01", "Pessoa Teste"
            )
        finally:
            fetch_media_findings._jus_post = original_post
            fetch_media_findings._jus_quota_exceeded = original_quota

        self.assertEqual(
            [endpoint for endpoint, _ in calls],
            [
                "background-check/lawsuits/criminal",
                "background-check/lawsuits/civil",
                "background-check/lawsuits/trabalhista",
                "background-check/bnmp",
                "background-check/mp",
            ],
        )
        for endpoint, payload in calls[:3]:
            self.assertEqual(payload["pagination"]["size"], 100, endpoint)

        civil = next(f for f in findings if "processo civil" in f["title"].lower())
        trabalhista = next(
            f for f in findings if "processo trabalhista" in f["title"].lower()
        )
        self.assertEqual(civil["risk_indicator"], "medio")
        self.assertEqual(trabalhista["risk_indicator"], "baixo")
        criminal = next(f for f in findings if "processo criminal" in f["title"].lower())
        self.assertEqual(criminal["risk_indicator"], "alto")
        self.assertIn("REPROVAÇÃO", criminal["decisao_recomendada"])
        criminal_info = next(
            f for f in findings if "processos criminais (1" in f["title"].lower()
        )
        self.assertEqual(criminal_info["risk_indicator"], "baixo")
        self.assertNotIn("decisao_recomendada", criminal_info)
        self.assertNotIn("decisao_recomendada", civil)
        self.assertNotIn("decisao_recomendada", trabalhista)


if __name__ == "__main__":
    unittest.main()
