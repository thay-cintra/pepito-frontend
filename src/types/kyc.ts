export type StatusAnalise =
  | "aprovado"
  | "reprovado"
  | "monitoramento"
  | "falso_positivo";

export type CamadaStatus =
  | "rascunho"
  | "aguardando_segunda"
  | "concluido";

export interface Socio {
  nome: string;
  cpf: string;
  participacao: string;
}

/** Posições padrão do QSA da Receita Federal + opções comuns. */
export type RelacaoEmpresa =
  | ""
  | "Sócio"
  | "Sócio Administrador"
  | "Diretor"
  | "Presidente"
  | "Procurador"
  | "Administrador"
  | "Membro do Conselho de Administração"
  | "Conselheiro Fiscal"
  | "Sócio Comanditário"
  | "Sócio Comanditado"
  | "Sócio Cotista"
  | "Sócio Ostensivo"
  | "Acionista Controlador"
  | "Empresário (Individual)"
  | "Sócio Pessoa Jurídica Domiciliado no Exterior"
  | "Sócio Pessoa Física Residente ou Domiciliado no Exterior"
  | "Titular Pessoa Física Residente ou Domiciliado no Exterior"
  | "Outros";

/** Tipos de vínculo quando o owner é PEP relacionado. */
export type TipoVinculoPEP =
  | ""
  | "Cônjuge/Companheiro"
  | "Parente até 2º grau"
  | "Sócio/Representante em outra empresa"
  | "Procurador"
  | "Controlador de Pessoa Jurídica"
  | "Outro vínculo";

/** Grau de parentesco quando tipo_vinculo = "Parente até 2º grau". */
export type GrauParentesco =
  | ""
  | "Pai"
  | "Mãe"
  | "Irmão"
  | "Irmã"
  | "Tio"
  | "Tia"
  | "Filho"
  | "Filha";

export interface ClienteData {
  cnpj: string;
  razaoSocial: string;
  tipoPep: "titular" | "relacionado";
  tipoVinculo: TipoVinculoPEP | string;
  grauParentesco?: GrauParentesco;
  nomePessoaVinculada: string;
  cpfPepTitular?: string;           // CPF do PEP titular (preenchido quando tipoPep === "relacionado")
  nomeResponsavel: string;
  cpfResponsavel: string;
  relacaoComEmpresa?: RelacaoEmpresa;
  cargoPep: string;
  orgaoPublico: string;
  cnae: string;
  atividadeEconomica: string;
  faturamentoMensal: string;
  capitalSocial: string;
  dataConstituicao: string;
  enderecoComercial: string;
  origemRecursos: string;
  rendaDeclarada: string;
  patrimonioEstimado: string;
  motivoRelacionamento: string;
  socios: Socio[];
  // Consulta Credilink/Tessera (obrigatória quando tipoPep === "relacionado")
  credilinkNumeroToken?: string;
  credilinkLinkDossie?: string;
}

export type TipoResultado =
  | "midia"
  | "processo"
  | "endereco"
  | "societario"
  | "pep"
  | "rede_social"
  | "governo";

export type NivelRisco = "baixo" | "medio" | "alto";

export interface ResultadoPesquisa {
  id: string;
  fonte: string;
  resumo: string;
  tipo: TipoResultado;
  risco: NivelRisco;
  link?: string;
  pendente_verificacao?: boolean;
  similaridade_nome?: string;
  descartado?: boolean;
  motivoDescarte?: string;
}

export interface ComentarioAnalise {
  timestamp: string;
  user_email: string;
  text: string;
  tipo?: "parecer" | "acao" | "decisao" | "observacao" | "sistema";
}

export interface Analise {
  id: string;
  data: string;
  /** draft_id de origem da Fila PLD (quando o caso vem de lá). */
  draftId?: string;
  cliente: ClienteData;
  parecerPrimeiraCamada: string;
  resultadosPesquisa: ResultadoPesquisa[];
  analiseGeral?: string;
  analiseConsolidadaLideranca?: string;
  status: StatusAnalise;
  recomendacao: string;
  parecerCompleto: string;
  camadaStatus: CamadaStatus;
  duracaoPrimeiraCamada?: number;
  duracaoSegundos?: number;
  /** Email do analista que fez a 1ª camada no Pepito. */
  analistaEmail?: string;
  createdAt: string;
  /** ISO timestamp da Decisão Final (camadaStatus = "concluido"). */
  concludedAt?: string;
  /** Histórico de comentários (importado do Retool ou criado durante análise). */
  historicoComentarios?: ComentarioAnalise[];
}

export interface Exclusao {
  id: string;
  analiseId: string;
  cnpj: string;
  razaoSocial: string;
  status: StatusAnalise;
  motivo: string;
  dataAnalise: string;
  dataExclusao: string;
}
