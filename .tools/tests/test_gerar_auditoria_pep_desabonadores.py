import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "gerar-auditoria-pep-relacionado-desabonador.py"
)
SPEC = importlib.util.spec_from_file_location("auditoria_pep_desabonador", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
auditoria = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(auditoria)


class AuditoriaPepDesabonadorTest(unittest.TestCase):
    def test_filters_benign_responses_and_keeps_structured_hits_and_high_score(self):
        pending = {
            "11111111111": {"nome": "PEP Um", "drafts": ["draft-a", "draft-b"]},
            "22222222222": {"nome": "PEP Dois", "drafts": ["draft-c"]},
        }
        ledger = {
            "11111111111": {
                "compliance": {
                    "result": {
                        "antecedentesCriminais": "Nenhum registro encontrado para este documento",
                        "processosJudiciais": [
                            {
                                "Numero": "0001",
                                "Tipo": "CRIMINAL",
                                "Partes": "REU",
                            }
                        ],
                        "midiaNegativas": "Mídias Negativas não encontrados para este CPF",
                        "score": {"Numero": 100, "Descricao": "ALTO"},
                    }
                }
            },
            "22222222222": {
                "compliance": {
                    "result": {
                        "processosJudiciais": "Processos Judiciais não encontrados para este CPF",
                        "score": {"Numero": 464, "Descricao": "MEDIO"},
                    }
                }
            },
        }

        rows, ignored_errors = auditoria.build_adverse_rows(ledger, pending)

        self.assertEqual(ignored_errors, [])
        self.assertEqual(len(rows), 4)
        self.assertEqual(
            {(row["draft_id"], row["campo_desabonador"]) for row in rows},
            {
                ("draft-a", "processosJudiciais"),
                ("draft-a", "score"),
                ("draft-b", "processosJudiciais"),
                ("draft-b", "score"),
            },
        )

    def test_excludes_neutral_media_and_processes_where_pep_is_only_plaintiff(self):
        pending = {"11111111111": {"nome": "PEP Um", "drafts": ["draft-a"]}}
        ledger = {
            "11111111111": {
                "compliance": {
                    "result": {
                        "midiaNegativas": {
                            "resumo": {"sentimento": {"negativo": 0, "neutro": 1}},
                            "noticias": [{"titulo": "Notícia neutra"}],
                        },
                        "processosJudiciais": [
                            {"Numero": "0001", "Tipo": "CIVEL", "Partes": "AUTOR"}
                        ],
                    }
                }
            }
        }

        rows, ignored_errors = auditoria.build_adverse_rows(ledger, pending)

        self.assertEqual(rows, [])
        self.assertEqual(ignored_errors, [])

    def test_keeps_only_passive_processes_in_process_summary(self):
        pending = {"11111111111": {"nome": "PEP Um", "drafts": ["draft-a"]}}
        ledger = {
            "11111111111": {
                "compliance": {
                    "result": {
                        "processosJudiciais": [
                            {"Numero": "0001", "Partes": "AUTOR"},
                            {"Numero": "0002", "Partes": "REU"},
                        ]
                    }
                }
            }
        }

        rows, _ = auditoria.build_adverse_rows(ledger, pending)

        self.assertEqual(len(rows), 1)
        self.assertIn("0002", rows[0]["resumo"])
        self.assertNotIn("0001", rows[0]["resumo"])

    def test_ignores_entry_with_error_field(self):
        pending = {"11111111111": {"nome": "PEP Um", "drafts": ["draft-a"]}}
        ledger = {
            "11111111111": {
                "erro_compliance": "timeout",
                "compliance": {"result": {"score": {"Numero": 100, "Descricao": "ALTO"}}},
            }
        }

        rows, ignored_errors = auditoria.build_adverse_rows(ledger, pending)

        self.assertEqual(rows, [])
        self.assertEqual(ignored_errors, ["11111111111"])

    def test_builds_one_decision_row_per_matching_draft(self):
        adverse_rows = [
            {
                "draft_id": "draft-a",
                "nome_pep": "PEP Um",
                "cpf_pep": "11111111111",
                "campo_desabonador": "score",
                "resumo": "ALTO",
            },
            {
                "draft_id": "draft-a",
                "nome_pep": "PEP Um",
                "cpf_pep": "11111111111",
                "campo_desabonador": "processosJudiciais",
                "resumo": "1 processo",
            },
        ]
        decisions = [
            {
                "draft_id": "draft-a",
                "current_status": "APPROVED",
                "approved_at": "2026-05-01T10:00:00Z",
                "rejected_at": None,
                "finalized_at": "2026-05-01T10:00:00Z",
            },
            {"draft_id": "outro", "current_status": "REJECTED", "approved_at": None},
        ]

        rows = auditoria.build_decision_rows(adverse_rows, decisions)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["draft_id"], "draft-a")
        self.assertEqual(rows[0]["approved_at_preenchido"], "SIM")
        self.assertEqual(rows[0]["campos_desabonadores"], "processosJudiciais; score")

    def test_rejects_duplicate_decision_draft_ids(self):
        decisions = [{"draft_id": "draft-a"}, {"draft_id": "draft-a"}]

        with self.assertRaisesRegex(ValueError, "draft_id duplicado"):
            auditoria.validate_decisions(decisions, expected_count=2)

    def test_rejects_missing_decision_for_an_adverse_draft(self):
        adverse_rows = [
            {
                "draft_id": "draft-a",
                "nome_pep": "PEP Um",
                "cpf_pep": "11111111111",
                "campo_desabonador": "score",
                "resumo": "ALTO",
            }
        ]

        with self.assertRaisesRegex(ValueError, "sem decisão correspondente"):
            auditoria.build_decision_rows(adverse_rows, [{"draft_id": "outro"}])


if __name__ == "__main__":
    unittest.main()
