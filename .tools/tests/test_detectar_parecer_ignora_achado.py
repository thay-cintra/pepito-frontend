import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "detectar-parecer-ignora-achado.py"


def load_detector():
    spec = importlib.util.spec_from_file_location("detectar_parecer_ignora_achado", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DetectarParecerIgnoraAchadoTest(unittest.TestCase):
    def test_detecta_negacao_com_achados_positivos_e_informa_bucket_atual(self):
        detector = load_detector()
        pareceres = {
            "draft-contraditorio": {
                "text": (
                    "Em análises reputacionais, não foram identificadas mídias ou processos "
                    "desabonadores. Considerando a ausência de desabonos relevantes, sugerimos "
                    "a APROVAÇÃO."
                )
            },
            "draft-sem-contradicao": {
                "text": "Foi localizado um processo civil informativo. Sugerimos a APROVAÇÃO."
            },
        }
        media = {
            "draft-contraditorio": [
                {
                    "title": "Processo civil: 21 encontrados",
                    "source": "JusBrasil",
                    "risk_indicator": "medio",
                    "achado_positivo": True,
                },
                {
                    "title": "Resultado descartado",
                    "source": "Busca web",
                    "risk_indicator": "alto",
                    "achado_positivo": False,
                },
            ],
            "draft-sem-contradicao": [
                {
                    "title": "Processo trabalhista: 1 encontrado",
                    "source": "JusBrasil",
                    "risk_indicator": "baixo",
                    "achado_positivo": True,
                }
            ],
        }
        fila = {
            "items": [
                {
                    "draft_id": "draft-contraditorio",
                    "bucket": "CHECK_LIDERANCA",
                    "full_name_pf": "Pessoa Teste",
                }
            ]
        }

        rows = detector.detectar_contradicoes(pareceres, media, fila)

        self.assertEqual(1, len(rows))
        self.assertEqual(
            {
                "draft_id": "draft-contraditorio",
                "nome_titular": "Pessoa Teste",
                "bucket_atual": "CHECK_LIDERANCA",
                "quantos_achados_contraditos": 1,
                "resumo_do_achado": "Processo civil: 21 encontrados | fonte: JusBrasil | risco: medio",
                "frase_do_parecer_que_contradiz": (
                    "Em análises reputacionais, não foram identificadas mídias ou processos "
                    "desabonadores. | Considerando a ausência de desabonos relevantes, "
                    "sugerimos a APROVAÇÃO."
                ),
            },
            rows[0],
        )

    def test_cobre_variacoes_de_negacao_sem_exigir_risco_alto(self):
        detector = load_detector()
        frases = [
            "Ausência total de apontamentos.",
            "Sem processos em nome do titular.",
            "Sem mídia adversa identificada.",
            "Nenhum achado reputacional foi localizado.",
            "Não foi identificado processo desabonador.",
        ]
        media = {
            f"draft-{indice}": [
                {
                    "title": "Achado real",
                    "source": "Fonte",
                    "risk_indicator": risco,
                    "achado_positivo": True,
                }
            ]
            for indice, risco in enumerate(["baixo", "medio", "alto", "baixo", "medio"])
        }
        pareceres = {
            f"draft-{indice}": {"text": frase}
            for indice, frase in enumerate(frases)
        }

        rows = detector.detectar_contradicoes(pareceres, media, {"items": []})

        self.assertEqual(5, len(rows))

    def test_ignora_negacoes_qualificadas_que_nao_contradizem_os_achados(self):
        detector = load_detector()
        frases = [
            "Não foram identificadas mídias adversas adicionais para a empresa.",
            "Nenhum achado confirma relação com o prefeito investigado.",
            "O ilícito é de natureza cível, sem processo criminal.",
            "Não há achado adverso próprio para o titular.",
        ]
        pareceres = {
            f"draft-{indice}": {"text": frase}
            for indice, frase in enumerate(frases)
        }
        media = {
            f"draft-{indice}": [
                {
                    "title": "Processo civil real",
                    "source": "JusBrasil",
                    "risk_indicator": "medio",
                    "achado_positivo": True,
                }
            ]
            for indice in range(len(frases))
        }

        rows = detector.detectar_contradicoes(pareceres, media, {"items": []})

        self.assertEqual([], rows)

    def test_detecta_nao_ha_processos_sem_qualificacao(self):
        detector = load_detector()
        pareceres = {"draft": {"text": "Não há mídia adversa, processos ou sanções."}}
        media = {
            "draft": [
                {
                    "title": "Inquérito real",
                    "source": "MP",
                    "risk_indicator": "medio",
                    "achado_positivo": True,
                }
            ]
        }

        rows = detector.detectar_contradicoes(pareceres, media, {"items": []})

        self.assertEqual(1, len(rows))


if __name__ == "__main__":
    unittest.main()
