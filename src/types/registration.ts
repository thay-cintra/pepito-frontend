/**
 * Schema reflete `squad_core.registration_notebook_output_single` — snapshot
 * mais recente de cada draft, filtrado pelas condições da Fila PLD do Retool:
 *
 *   status        IN ('DOUBLE_CHECK', 'IN_ANALYSIS')
 *   sub_status     = 'PLD_SCORE'
 *   evaluation_reason = 'HIGH_PLD'
 *
 * (`person_type` não existe nessa tabela — todos os registros são por design
 * do OWNER do cadastro.)
 *
 * O atributo `bucket` (CHECK_LIDERANCA | CHECK_ANALISTA) é derivado do
 * `score_pld` numérico — o Retool real pode usar regra própria.
 */

import type { ResultadoPesquisa, StatusAnalise } from "./kyc";

export type RegistrationStatus = "DOUBLE_CHECK" | "IN_ANALYSIS";
export type RegistrationSubStatus = "PLD_SCORE";
export type PersonType = "OWNER";
export type EvaluationReason =
  | "HIGH_PLD"
  | "MEI_ISSUE"
  | "SUS_NAME"
  | "SUS_NAME_FAIL"
  | "HAS_QSA"
  | "SANCTIONS_MANUAL"
  | "PF_STATUS_CHECK"
  | "PJ_STATUS_CHECK"
  | "MEI_NOT_IN_QSA"
  | "SUS_EMAIL"
  | string;        // tolerar valores futuros sem quebrar
export type RegistrationEvaluation = "MANUAL_ANALYSIS" | "HAS_QSA" | string;

export type TipoAnalise =
  | "fila_analise_normal"
  | "reanalise_docs"
  | "reanalise"
  | "casos_nao_analisados";

export type CheckBucket = "CHECK_LIDERANCA" | "CHECK_ANALISTA";

/** Item de PEP retornado em `pep_pf` da Credilink (lista vinculada ao CPF). */
export interface PepPfItem {
  id: number | null;
  tipo: "T" | "R" | string | null;            // T=Titular, R=Relacionado
  cpf_titular: string | null;
  nome_titular: string | null;
  cpf_relacionado: string | null;
  nome_relacionado: string | null;
  ds_vinculo: string | null;                   // IRMA(O), MAE, PAI, SOBRINHA(O), CONJUGE, FILHA(O) etc.
  perfil: string | null;                       // ex. "VEREAD", "PREFEI", "DEP_EST"
  cargo_formal: string | null;                 // VEREADOR, PREFEITO, DEPUTADO ESTADUAL, etc.
  orgao: string | null;                        // ex: "DOM FELICIANO-RS"
  data_inicio: string | null;                  // dd/mm/yyyy
  data_fim: string | null;
  data_fim_carencia: string | null;
  data_atualizacao: string | null;
  uf: string | null;
}

export interface QSAItem {
  nome: string;
  cpf: string;
  qual: string;
}

export interface ComentarioHistorico {
  timestamp: string;          // ISO 8601
  user_email: string;         // ex: lucasfeller@cora.com.br
  text: string;               // texto do parecer/ação
  tipo?: "parecer" | "acao" | "decisao" | "observacao" | "sistema";
}

export interface PessoaEquipe {
  email: string;
  nome: string;
  papel: "analista" | "liderança" | "sistema" | string;
}

export interface AuditEntry {
  timestamp: string;
  email: string;
  first_name?: string;
  team?: string;
  original_status: string;
  new_status: string;
}

export interface RegistrationCase {
  // Identificação
  draft_id: string;
  cnpj: string;
  cpf: string;
  rf_nome_oficial: string;
  trade_name: string;
  full_name_pf: string;
  social_name: string;
  email: string;

  // Estado / fila
  status: RegistrationStatus;
  sub_status: RegistrationSubStatus;
  person_type: PersonType;
  evaluation: RegistrationEvaluation;
  evaluation_reason: EvaluationReason;
  bucket: CheckBucket;

  // PLD
  score_pld: number;
  score_level: string | null;             // "HIGH" / "MEDIUM" / "LOW"

  // Cadastro PJ (Receita)
  cnae: string;
  natureza_juridica: string;
  porte: string;
  uf: string;
  cidade: string;
  endereco_comercial: string;
  data_constituicao: string;
  datedif_cnpj: string | null;
  faturamento_presumido: string;
  rec_situacao_cadastral: string;
  is_mei: string | null;

  // PEP / QSA / sinais
  pep_pf: PepPfItem[];
  pep_pj: unknown;                         // pode ser array ou string com mensagem
  qsa: QSAItem[];

  // Pesquisas pré-feitas (mensagens textuais ou listas)
  pj_midianegativas: string | null;
  pf_midianegativas: string | null;
  processosjudiciais_pj: string | null;
  processosjudiciais_pf: string | null;
  rufra_pf_fraude_confirmada: string | null;
  rufra_pj_fraude_confirmada: string | null;

  // Tokens Credilink/Tessera (reais, extraídos da Athena)
  token_pf_cred: string | null;
  token_pj_cred: string | null;

  // Metadados
  created_at: string;
  modified_at: string;

  // Investigação enriquecida (gerada no cliente a partir dos campos acima)
  resultados_pesquisa: ResultadoPesquisa[];
  analise_geral: string;
  parecer_sugerido: string;
  recomendacao_sugerida: StatusAnalise;

  // Histórico e inclusão de comentários (timeline do caso)
  historico_comentarios: ComentarioHistorico[];

  // Equipe e audit reais
  analista_responsavel: PessoaEquipe | null;
  lideranca: PessoaEquipe;
  audit_real: AuditEntry[];
  /** Histórico real do Retool PLD (project_webhook.event_acompanhamento_analise_cadastral) */
  webhook_historico?: Array<{
    timestamp: string;
    user_email: string;
    text: string;
    acao: string;
    processo: string;
    tipo: string;
  }>;
}

const REASON_LABEL: Record<string, string> = {
  HIGH_PLD: "Score PLD elevado",
  MEI_ISSUE: "Inconsistência cadastral MEI",
  SUS_NAME: "Nome com indício suspeito",
  SUS_NAME_FAIL: "Nome suspeito + falha na verificação",
  HAS_QSA: "Possui QSA (revisão obrigatória)",
  SANCTIONS_MANUAL: "Listas de sanções — revisão manual",
  PF_STATUS_CHECK: "Pendência de status PF",
  PJ_STATUS_CHECK: "Pendência de status PJ",
  MEI_NOT_IN_QSA: "MEI ausente do QSA",
  SUS_EMAIL: "E-mail suspeito",
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] || reason;
}

/** Mapeia o código de perfil PEP da base para uma descrição em PT-BR. */
const PERFIL_LABEL: Record<string, string> = {
  VEREAD: "Vereador(a)",
  DEP_ESTAD: "Deputado(a) Estadual",
  DEP_FED: "Deputado(a) Federal",
  SENADOR: "Senador(a)",
  PREF: "Prefeito(a)",
  VICE_PREF: "Vice-prefeito(a)",
  GOV: "Governador(a)",
  VICE_GOV: "Vice-governador(a)",
  PRES: "Presidente da República",
  MIN: "Ministro(a) de Estado",
  SEC_EST: "Secretário(a) Estadual",
  SEC_MUN: "Secretário(a) Municipal",
  CONS_TCE: "Conselheiro(a) do TCE",
  CONS_TCU: "Ministro(a) do TCU",
  DESEMB: "Desembargador(a)",
  PROC: "Procurador(a)",
};

export function perfilPepLabel(perfil: string | null | undefined): string {
  if (!perfil) return "PEP (cargo não classificado)";
  return PERFIL_LABEL[perfil.trim().toUpperCase()] || `PEP (${perfil})`;
}
