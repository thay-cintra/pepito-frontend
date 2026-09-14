export interface CredilinkValidationEntry {
  token_compliance?: unknown;
  compliance?: unknown;
}

export function hasCredilinkToken(token: unknown): token is string {
  return typeof token === "string" && token.trim().length > 0;
}

/** Consulta concluída só é evidência válida quando há token real e resultado
 * consolidado, sem campo técnico de erro. */
export function isCredilinkEntryOk(entry: CredilinkValidationEntry | undefined): boolean {
  if (!entry) return false;
  if (Object.keys(entry).some((key) => key.startsWith("erro"))) return false;
  if (!hasCredilinkToken(entry.token_compliance)) return false;
  if (!entry.compliance || typeof entry.compliance !== "object") return false;
  const compliance = entry.compliance as { code?: number; message?: string };
  return compliance.code === 200 && compliance.message !== "Processando";
}
