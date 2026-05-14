/**
 * Carrega os 29 casos REAIS da Fila PLD (sub_status=PLD_SCORE) extraídos via
 * Athena de `squad_core.registration_notebook_output_single` e enriquece cada
 * caso com:
 *   - 20+ links de verificação parametrizados (TSE, CNJ, sanções, mídia, etc.)
 *   - Análise consolidada baseada nos sinais já apurados pelo pipeline
 *   - Parecer sugerido em PT-BR
 *
 * O JSON `registration-queue-real.json` está no .gitignore (contém PII).
 * Para regenerar: rode `python pepito-frontend/.tools/build-real-queue.py`.
 */

import type { RegistrationCase } from "@/types/registration";
import {
  gerarResultados,
  gerarAnaliseGeral,
  gerarParecerSugerido,
  recomendacaoSugerida,
  gerarHistoricoComentarios,
} from "./registration-enrich";
import realData from "./registration-queue-real.json";

type Raw = Omit<
  RegistrationCase,
  "resultados_pesquisa" | "analise_geral" | "parecer_sugerido" | "recomendacao_sugerida" | "historico_comentarios"
>;

interface QueuePayload {
  _meta: {
    fetched_at: string;
    source_table: string;
    total: number;
    by_bucket: Record<string, number>;
  };
  items: Raw[];
}

// JSON pode estar no formato antigo (array) ou novo ({_meta, items})
const payload = realData as QueuePayload | Raw[];
const RAW: Raw[] = Array.isArray(payload) ? payload : payload.items;
const META = Array.isArray(payload)
  ? { fetched_at: "", source_table: "squad_core.registration_notebook_output_single", total: payload.length, by_bucket: {} }
  : payload._meta;

export const REGISTRATION_META = META;

export const REGISTRATION_QUEUE: RegistrationCase[] = RAW.map((c) => ({
  ...c,
  resultados_pesquisa: gerarResultados(c),
  analise_geral: gerarAnaliseGeral(c),
  parecer_sugerido: gerarParecerSugerido(c),
  recomendacao_sugerida: recomendacaoSugerida(c),
  historico_comentarios: gerarHistoricoComentarios(c),
}));
