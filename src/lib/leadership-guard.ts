interface ConsultationGateStatus {
  jusbrasilOk: boolean;
  credilinkPepOk: boolean;
}

/** Casos reais só avançam com ambas as consultas verificadas. A confirmação
 * manual é tratada separadamente pela tela e registrada no histórico. */
export function needsManualConsultationCheck(
  hasRealDraft: boolean,
  status: ConsultationGateStatus | null,
  liveCredilinkOk: boolean,
): boolean {
  if (!hasRealDraft) return false;
  if (!status) return true;
  return !(status.jusbrasilOk && (status.credilinkPepOk || liveCredilinkOk));
}

/** Uma consulta feita nesta sessão só substitui o ledger quando ela cobre a
 * única pendência relacionada e o CPF consultado é exatamente o pendente.
 * Assim, consultar o PEP principal não mascara outro PEP ainda sem consulta. */
export function liveConsultationCoversAllPending(
  pendingRelatedPepCpfs: string[],
  consultedCpf: string,
): boolean {
  const normalizedConsultedCpf = consultedCpf.replace(/\D/g, "");
  return normalizedConsultedCpf.length > 0
    && pendingRelatedPepCpfs.length === 1
    && pendingRelatedPepCpfs[0].replace(/\D/g, "") === normalizedConsultedCpf;
}
