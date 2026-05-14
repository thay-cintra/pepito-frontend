import { REGISTRATION_QUEUE, REGISTRATION_META } from "@/data/registration-queue";
import type {
  CheckBucket,
  RegistrationCase,
  RegistrationStatus,
} from "@/types/registration";
import type { Analise } from "@/types/kyc";
import { inferCargoOrgao, inferTipoPep } from "@/data/registration-enrich";
import { uid } from "./utils";
import { statusLabel } from "./parecer";

const KEY_TAKEN = "pepito.registration.taken";
const KEY_ANALISES = "pepito.analises";

const EMAILS_ANALISTA = ["jeniffer@cora.com.br", "lucasfeller@cora.com.br", "m.matos@cora.com.br"];

/** Extrai o parecer real do analista a partir do histórico do webhook. */
function extrairParecerAnalista(c: RegistrationCase): string {
  // Fonte primária: webhook_historico (ação ENVIAR_LIDERANCA_PLD do analista)
  const webhook = (c as unknown as { webhook_historico?: Array<{ user_email: string; acao: string; text: string; tipo: string }> })
    .webhook_historico ?? [];

  const envio = webhook.find(
    (h) => EMAILS_ANALISTA.includes(h.user_email) && h.acao === "ENVIAR_LIDERANCA_PLD" && h.text?.trim()
  );
  if (envio?.text) return envio.text;

  // Fallback: qualquer comentário substancial de analista no histórico gerado
  const historico = c.historico_comentarios ?? [];
  const parecer = historico
    .filter((h) => EMAILS_ANALISTA.includes(h.user_email) && h.text && h.text.trim().length > 30)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  return parecer?.text ?? "";
}

const VALID_STATUS: RegistrationStatus[] = ["DOUBLE_CHECK", "IN_ANALYSIS"];

/**
 * Aplica as condições da Fila PLD do Retool de forma estrita:
 *   status IN ('DOUBLE_CHECK','IN_ANALYSIS')
 *   AND sub_status = 'PLD_SCORE'
 *   AND person_type = 'OWNER'
 */
function passesPLDFilters(c: RegistrationCase): boolean {
  return (
    VALID_STATUS.includes(c.status) &&
    c.sub_status === "PLD_SCORE" &&
    c.person_type === "OWNER"
  );
}

function readTaken(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY_TAKEN);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeTaken(map: Record<string, string>) {
  localStorage.setItem(KEY_TAKEN, JSON.stringify(map));
}

/**
 * Retorna os draft_ids cujas análises já foram concluídas (Decisão Final).
 * Casos com camadaStatus === "concluido" saem automaticamente de qualquer fila.
 * Casos CHECK_ANALISTA com camadaStatus === "aguardando_segunda" também saem
 * (foram enviados à 2ª camada — o analista já processou).
 */
function readExcludedDraftIds(bucket: CheckBucket): Set<string> {
  try {
    const raw = localStorage.getItem(KEY_ANALISES);
    if (!raw) return new Set();
    const analises: Array<{ camadaStatus: string; draftId?: string }> = JSON.parse(raw);
    return new Set(
      analises
        .filter((a) => {
          if (!a.draftId) return false;
          if (a.camadaStatus === "concluido") return true;
          // Analista processou o caso (1ª camada concluída) → sai do CheckAnalista
          if (bucket === "CHECK_ANALISTA" && a.camadaStatus === "aguardando_segunda") return true;
          return false;
        })
        .map((a) => a.draftId!),
    );
  } catch {
    return new Set();
  }
}

export function listByBucket(bucket: CheckBucket): RegistrationCase[] {
  const excluidos = readExcludedDraftIds(bucket);
  return REGISTRATION_QUEUE.filter(
    (c) => passesPLDFilters(c) && c.bucket === bucket && !excluidos.has(c.draft_id),
  ).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function getRegistrationCase(draftId: string): RegistrationCase | undefined {
  return REGISTRATION_QUEUE.find((c) => c.draft_id === draftId);
}

export function markTaken(draftId: string, analiseId: string) {
  const map = readTaken();
  map[draftId] = analiseId;
  writeTaken(map);
}

export function untake(draftId: string) {
  const map = readTaken();
  delete map[draftId];
  writeTaken(map);
}

export function isTaken(draftId: string): boolean {
  return !!readTaken()[draftId];
}

export function countByBucket(bucket: CheckBucket): number {
  return listByBucket(bucket).length;
}

export function countTotalPLD(): number {
  return REGISTRATION_QUEUE.filter(passesPLDFilters).length;
}

/** Verifica se o draft já tem uma Analise local em curso no Pepito. */
export function hasPepitoAnalise(draftId: string): boolean {
  try {
    const taken = readTaken();
    return !!taken[draftId];
  } catch {
    return false;
  }
}

/** Snapshot metadata do JSON gerado por build-real-queue.py. */
export function getQueueSnapshotMeta() {
  return REGISTRATION_META;
}

/**
 * Converte um RegistrationCase (já enriquecido com pesquisa) em uma Analise
 * pronta para abrir na 2ª camada (Mesa). Usado quando a Liderança "puxa" um
 * caso CHECK_LIDERANCA — toda a investigação já está concluída, restando
 * apenas o parecer final.
 */
export function synthesizeAnalise(c: RegistrationCase): Analise {
  const id = uid();
  const now = new Date().toISOString();
  const cargoOrgao = inferCargoOrgao(c);
  const tipoPep = inferTipoPep(c);
  return {
    id,
    data: now,
    createdAt: now,
    draftId: c.draft_id,
    cliente: {
      cnpj: c.cnpj,
      razaoSocial: c.rf_nome_oficial,
      tipoPep,
      tipoVinculo: tipoPep === "relacionado" ? "Owner é vínculo do PEP titular" : "",
      nomePessoaVinculada: cargoOrgao.nomePEP,
      cpfPepTitular: tipoPep === "relacionado" ? (cargoOrgao.cpfTitular || c.pep_pf?.[0]?.cpf_titular || "") : "",
      nomeResponsavel: c.full_name_pf,
      cpfResponsavel: c.cpf,
      cargoPep: cargoOrgao.cargo,
      orgaoPublico: cargoOrgao.orgao,
      cnae: c.cnae,
      atividadeEconomica: c.cnae,
      faturamentoMensal: (c.faturamento_presumido || "").replace(/^"|"$/g, ""),
      capitalSocial: c.porte || "",
      dataConstituicao: c.data_constituicao,
      enderecoComercial: c.endereco_comercial,
      origemRecursos: "",
      rendaDeclarada: "",
      patrimonioEstimado: "",
      motivoRelacionamento: `Conta puxada da Fila PLD (${c.bucket}). draft_id: ${c.draft_id}. Score PLD ${c.score_pld}.`,
      socios: c.qsa.filter((s) => s.nome).map((s) => ({
        nome: s.nome,
        cpf: s.cpf,
        participacao: s.qual,
      })),
    },
    parecerPrimeiraCamada: extrairParecerAnalista(c) || c.parecer_sugerido,
    resultadosPesquisa: c.resultados_pesquisa,
    analiseGeral: c.analise_geral,
    status: c.recomendacao_sugerida,
    recomendacao: statusLabel(c.recomendacao_sugerida),
    parecerCompleto: "",
    camadaStatus: "aguardando_segunda",
    duracaoPrimeiraCamada: 0, // investigação feita pelo pipeline KYC, não pela 1ª camada manual
    historicoComentarios: c.historico_comentarios.map((h) => ({
      timestamp: h.timestamp,
      user_email: h.user_email,
      text: h.text,
      tipo: h.tipo,
    })),
  };
}
