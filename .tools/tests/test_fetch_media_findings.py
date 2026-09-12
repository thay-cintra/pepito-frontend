import importlib.util
import io
import unittest
from contextlib import redirect_stdout
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
            '"risk_indicator":"baixo"}]\nObservação final.'
        )

        self.assertEqual(
            fetch_media_findings._parse_websearch_findings_text(raw_text),
            [
                {
                    "source": "TSE — Divulgação de Candidaturas",
                    "risk_indicator": "baixo",
                }
            ],
        )

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


if __name__ == "__main__":
    unittest.main()
