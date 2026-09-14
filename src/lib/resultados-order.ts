import type { NivelRisco } from "@/types/kyc";

const RISK_ORDER: Record<NivelRisco, number> = {
  alto: 0,
  medio: 1,
  baixo: 2,
};

/** Ordenação apenas visual: preserva a ordem relativa dentro de cada risco. */
export function orderResultadosByRisk<T extends { risco: NivelRisco }>(resultados: readonly T[]): T[] {
  return resultados
    .map((resultado, index) => ({ resultado, index }))
    .sort((a, b) => RISK_ORDER[a.resultado.risco] - RISK_ORDER[b.resultado.risco] || a.index - b.index)
    .map(({ resultado }) => resultado);
}
