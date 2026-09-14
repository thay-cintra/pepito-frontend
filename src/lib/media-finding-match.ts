export interface FindingMatchMetadata {
  title?: string;
  source?: string;
  risk_indicator?: string;
  match?: string;
  homonimo_alerta?: string;
  achado_positivo?: boolean;
}

export function isRegionalContextFinding(finding: FindingMatchMetadata): boolean {
  const marker = [finding.title, finding.source, finding.match, finding.homonimo_alerta]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\bm7\b/i.test(marker) || marker.includes("contexto regional");
}

/** Retorna o conteúdo do badge apenas quando existe um match nominal real.
 * Findings antigos sem `achado_positivo` mantêm a heurística anterior. */
export function findingSimilarity(finding: FindingMatchMetadata): string | undefined {
  const technicalPlaceholder = finding.source?.includes("Controle de Quota")
    || finding.source?.includes("Erro de Consulta");
  if (technicalPlaceholder || isRegionalContextFinding(finding)) return undefined;
  if (finding.achado_positivo === false) return undefined;
  if (finding.achado_positivo === true || finding.achado_positivo === undefined) {
    return finding.homonimo_alerta ? "verificar identidade" : "100%";
  }
  return undefined;
}
