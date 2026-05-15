import type { RegistrationCase } from "@/types/registration";
import {
  gerarResultados,
  gerarAnaliseGeral,
  gerarParecerSugerido,
  recomendacaoSugerida,
  gerarHistoricoComentarios,
} from "./registration-enrich";

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

export const QUEUE_UPDATED_EVENT = "pepito:queue-updated";

const EMPTY_META: QueuePayload["_meta"] = {
  fetched_at: "",
  source_table: "squad_core.registration_notebook_output_single",
  total: 0,
  by_bucket: {},
};

// Cache in-memory — atualizado pela API, nunca pelo build
export let REGISTRATION_QUEUE: RegistrationCase[] = [];
export let REGISTRATION_META: QueuePayload["_meta"] = EMPTY_META;

function enrich(raw: Raw[]): RegistrationCase[] {
  return raw.map((c) => ({
    ...c,
    resultados_pesquisa: gerarResultados(c),
    analise_geral: gerarAnaliseGeral(c),
    parecer_sugerido: gerarParecerSugerido(c),
    recomendacao_sugerida: recomendacaoSugerida(c),
    historico_comentarios: gerarHistoricoComentarios(c),
  }));
}

/** Busca a fila do servidor (/api/queue) e atualiza o cache em memória.
 *  Retorna quantos casos vieram e quantos são novos em relação ao cache anterior. */
export async function refreshQueueFromServer(): Promise<{ total: number; novos: number }> {
  try {
    const res = await fetch("/api/queue");
    if (!res.ok) return { total: 0, novos: 0 };
    const payload: QueuePayload | Raw[] = await res.json();

    const raw = Array.isArray(payload) ? payload : payload.items;
    const meta = Array.isArray(payload) ? { ...EMPTY_META, total: raw.length } : payload._meta;

    const anterior = new Set(REGISTRATION_QUEUE.map((c) => c.draft_id));
    const novos = raw.filter((c) => !anterior.has(c.draft_id)).length;

    REGISTRATION_QUEUE = enrich(raw);
    REGISTRATION_META = meta;

    window.dispatchEvent(new CustomEvent(QUEUE_UPDATED_EVENT, { detail: { total: raw.length, novos } }));
    return { total: raw.length, novos };
  } catch {
    return { total: 0, novos: 0 };
  }
}

// Carrega automaticamente ao importar o módulo
refreshQueueFromServer().catch(() => {});
