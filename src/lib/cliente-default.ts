import type { ClienteData } from "@/types/kyc";

export function clienteVazio(): ClienteData {
  return {
    cnpj: "",
    razaoSocial: "",
    tipoPep: "titular",
    tipoVinculo: "",
    grauParentesco: "",
    nomePessoaVinculada: "",
    cpfPepTitular: "",
    nomeResponsavel: "",
    cpfResponsavel: "",
    relacaoComEmpresa: "",
    cargoPep: "",
    orgaoPublico: "",
    cnae: "",
    atividadeEconomica: "",
    faturamentoMensal: "",
    capitalSocial: "",
    dataConstituicao: "",
    enderecoComercial: "",
    origemRecursos: "",
    rendaDeclarada: "",
    patrimonioEstimado: "",
    motivoRelacionamento: "",
    socios: [],
    credilinkNumeroToken: "",
    credilinkLinkDossie: "",
  };
}
