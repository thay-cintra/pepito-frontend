/**
 * Consulta Credilink (Tesserati é o MESMO serviço — nunca tratar como
 * fontes diferentes) sob demanda para o CPF do PEP relacionado.
 *
 * Chama o endpoint real do servidor (POST /api/credilink/consultar-pep),
 * que dispara .tools/consultar-credilink-pep.py e espera terminar (~45-90s,
 * processamento assíncrono da própria Credilink). O resultado retornado é
 * usado DIRETO no estado do componente — não depende de rebuild do bundle
 * (credilink-pep-consultas.json é import estático, só atualiza no próximo
 * build; a consulta ao vivo contorna isso devolvendo o dado fresco na
 * própria resposta HTTP).
 *
 * thay@cora.com.br, 2026-09-12: "não quero que seja validado manualmente,
 * você deve fazer a consulta na Credilink... traga a consulta na tela
 * também, no mesmo formato do titular da conta."
 */

export interface CredilinkPepEntry {
  cpf: string;
  nome: string;
  consultado_em: string;
  token_compliance?: string;
  compliance?: {
    code?: number;
    message?: string;
    result?: {
      pessoa?: {
        nomeCompleto?: string;
        isPEP?: boolean;
        statusReceitaFederal?: string;
      };
    };
  };
  pep?: unknown;
  [erro: string]: unknown;
}

/** Mesmo formato exibido pro titular (CredilinkResultado em mock-ai.ts),
 * pra reaproveitar o mesmo layout de card na tela. */
export interface CredilinkPepResultadoUI {
  numeroToken: string;
  linkDossie: string;
  consultadoEm: string;
  nomeConsultado: string;
  isPEP?: boolean;
}

export function credilinkPepEntryParaUI(entry: CredilinkPepEntry): CredilinkPepResultadoUI {
  const pessoa = entry.compliance?.result?.pessoa;
  return {
    numeroToken: entry.token_compliance || "",
    linkDossie: entry.token_compliance
      ? `https://dashboard.tesserati.com.br/Compliance/VisualizarDossie?token=${entry.token_compliance}`
      : "",
    consultadoEm: entry.consultado_em,
    nomeConsultado: pessoa?.nomeCompleto || entry.nome,
    isPEP: pessoa?.isPEP,
  };
}

export async function consultarCredilinkPepAgora(cpf: string, nome: string): Promise<CredilinkPepResultadoUI> {
  const cpfDigits = cpf.replace(/\D/g, "");
  const r = await fetch("/api/credilink/consultar-pep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cpf: cpfDigits, nome }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) {
    throw new Error(body.error || `HTTP ${r.status}`);
  }
  const entry: CredilinkPepEntry = body.entry;
  // Mesma validação estrita do getConsultaStatus()/credilinkEntryOk() no
  // backend (registration-enrich.ts/server.cjs) — sem isso uma entrada
  // incompleta (sem compliance consolidado, ou de outro CPF por engano)
  // virava "sucesso" na tela (achado Codex, 2026-09-12).
  const erros = Object.keys(entry || {}).filter((k) => k.startsWith("erro"));
  if (erros.length > 0) {
    throw new Error(`Consulta concluiu com erro: ${erros.map((k) => `${k}=${entry[k]}`).join("; ")}`);
  }
  if (!entry || entry.cpf !== cpfDigits) {
    throw new Error("Resposta do servidor não corresponde ao CPF consultado.");
  }
  if (!entry.compliance || entry.compliance.code !== 200 || entry.compliance.message === "Processando") {
    throw new Error("Consulta não retornou resultado consolidado (compliance ausente/incompleto).");
  }
  return credilinkPepEntryParaUI(entry);
}
