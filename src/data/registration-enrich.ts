/**
 * Enriquece cada caso REAL da Fila PLD com:
 *   - Lista de `ResultadoPesquisa` (gerarResultados) com o que foi de fato
 *     CONSULTADO (WebSearch M1-M13, Credilink, JusBrasil, RUFRA, pipeline KYC
 *     pré-apurado) — nunca um deep-link não verificado (thay@cora.com.br,
 *     2026-09-12: "se um site não for consultado, nem inclua nos Resultados
 *     de Pesquisas"). Deep-links de referência pra consulta manual pontual
 *     ficam à parte, em getLinksManuais().
 *   - Análise consolidada baseada nos sinais já disponíveis (mídia negativa,
 *     processos, RUFRA, PEP info real).
 *   - Parecer sugerido em PT-BR.
 *
 * Nada é fabricado sobre pessoas reais.
 */

import type { ResultadoPesquisa, StatusAnalise } from "@/types/kyc";
import type { PepPfItem, RegistrationCase, ComentarioHistorico } from "@/types/registration";
import { perfilPepLabel } from "@/types/registration";
import { buildVerifyLinks, type VerifyLink } from "@/lib/verify-links";
import { uid } from "@/lib/utils";
import mediaFindingsRaw from "./media-findings.json";
import pareceresLlmRaw from "./pareceres-llm.json";
import pareceresRealRaw from "./pareceres-real.json";
import pareceresSugestaoRaw from "./pareceres-sugestao.json";
import pareceresLiderancaRaw from "./pareceres-lideranca.json";
import pldRiskScoresRaw from "./pld-risk-scores.json";
import credilinkPepConsultasRaw from "./credilink-pep-consultas.json";

interface MediaFinding {
  title: string;
  url: string;
  snippet: string;
  source: string;
  risk_indicator: "baixo" | "medio" | "alto";
  tipo?: string;
  match?: string;            // descrição do critério multi-fator que confirmou identidade
  homonimo_alerta?: string;
}

const MEDIA_FINDINGS = mediaFindingsRaw as Record<string, MediaFinding[] | { description?: string }>;

function getFindingsFor(draftId: string): MediaFinding[] {
  const v = MEDIA_FINDINGS[draftId];
  if (Array.isArray(v)) return v;
  return [];
}

/** Achado do bloco M7 (contexto regional — operação/mídia no MUNICÍPIO, sem
 * menção nominal direta ao PEP/owner) NÃO é uma identificação de verdade —
 * é sinal contextual. Compartilhado entre gerarResultados() (badge de
 * similaridade) e gerarParecerSugerido() (decisão preliminar). */
function isCtxRegional(f: MediaFinding): boolean {
  return !!(f.match?.includes("M7") || f.homonimo_alerta?.includes("Contexto regional"));
}

interface CredilinkPepConsulta {
  cpf: string;
  nome: string;
  consultado_em: string;
  pep?: unknown;
  token_compliance?: string;
  compliance?: unknown;
  [erro: `erro_${string}`]: unknown;
}

const CREDILINK_PEP_CONSULTAS = credilinkPepConsultasRaw as Record<string, CredilinkPepConsulta>;

/** Guardrail (thay@cora.com.br, 2026-09-11): um caso só pode ir pra Fila de
 * Liderança se JusBrasil e Credilink tiverem sido de fato consultados —
 * nunca mock, nunca placeholder de cota estourada. Ver
 * .tools/INCIDENT-REPORT-2026-09-11-CREDILINK-PEP-NAO-CONSULTADO.md. */
export interface ConsultaStatus {
  jusbrasilOk: boolean;
  jusbrasilMotivo: string;
  credilinkPepOk: boolean;
  credilinkPepMotivo: string;
  tudoOk: boolean;
}

/** Uma entrada do ledger só conta como consulta Credilink CONCLUÍDA com
 * sucesso se o polling do Compliance realmente terminou (não ficou só no
 * "Processando") — token sozinho não basta, precisa do resultado consolidado
 * (achado Codex #3, 2026-09-11: entrada sem `compliance` passava como OK). */
function credilinkEntryOk(entry: CredilinkPepConsulta | undefined): boolean {
  if (!entry) return false;
  if (Object.keys(entry).some((k) => k.startsWith("erro"))) return false;
  const compliance = entry.compliance as { code?: number; message?: string } | undefined;
  return !!compliance && compliance.code === 200 && compliance.message !== "Processando";
}

export function getConsultaStatus(
  c: Pick<RegistrationCase, "draft_id" | "cpf" | "token_pf_cred" | "pep_pf">,
  tipoPep: "titular" | "relacionado",
): ConsultaStatus {
  const findings = getFindingsFor(c.draft_id);
  const isPlaceholder = (f: MediaFinding) => f.source.includes("Controle de Quota") || f.source.includes("Erro de Consulta");
  const reais = findings.filter((f) => !isPlaceholder(f));
  // Evidência real de que AMBAS as fontes rodaram — não basta "tem algum
  // achado" (podia ser só mídia/TSE de um pipeline antigo, sem JusBrasil nem
  // Credilink terem sido de fato chamados; achado Codex #2, 2026-09-11).
  // Credilink e Tesserati são o MESMO serviço — nunca tratar como fontes
  // diferentes (thay@cora.com.br, 2026-09-12).
  const temJusBrasil = reais.some((f) => f.source.includes("JusBrasil") || f.source.includes("BNMP") || f.source.includes("MP "));
  const temCredilinkAntecedentes = reais.some((f) => f.source.includes("Credilink"));

  let jusbrasilOk = true;
  let jusbrasilMotivo = "";
  if (findings.length === 0) {
    jusbrasilOk = false;
    jusbrasilMotivo = "Nunca consultado (sem dupla-verificação JusBrasil/Credilink/WebSearch registrada para este caso).";
  } else if (findings.some((f) => f.source.includes("Controle de Quota"))) {
    jusbrasilOk = false;
    jusbrasilMotivo = "Cota do JusBrasil esgotada no momento da consulta — verificação manual necessária (ver achado 'VERIFICAÇÃO MANUAL NECESSÁRIA').";
  } else if (findings.some((f) => f.source.includes("Erro de Consulta"))) {
    jusbrasilOk = false;
    jusbrasilMotivo = "Consulta JusBrasil/Credilink falhou tecnicamente (ver achado 'Erro de Consulta') — não é resultado negativo, precisa reconsultar ou verificar manualmente.";
  } else if (!temJusBrasil || !temCredilinkAntecedentes) {
    jusbrasilOk = false;
    jusbrasilMotivo = `Achados existem, mas sem evidência de ${!temJusBrasil ? "JusBrasil" : "Credilink"} ter rodado para este caso.`;
  }

  let credilinkPepOk = true;
  const motivos: string[] = [];
  if (tipoPep === "titular") {
    // Owner é o próprio PEP: dado já vem real da tabela squad_core via
    // token_pf_cred — token nulo/vazio significa que a Credilink upstream
    // não tem nada registrado (achado Codex #4: badge "OK" incondicional).
    if (!c.token_pf_cred) {
      credilinkPepOk = false;
      motivos.push("token_pf_cred ausente na tabela squad_core — sem evidência de consulta Credilink para o titular.");
    }
  } else {
    // Verifica TODOS os CPFs de PEP relacionado distintos do owner — não só
    // o "principal" (achado Codex #4: caso com 2+ PEPs relacionados podia
    // ficar verde com só 1 consultado).
    const ownerCpf = (c.cpf || "").replace(/\D/g, "");
    const cpfsPep = Array.from(
      new Set((c.pep_pf || []).map((p) => (p.cpf_titular || "").replace(/\D/g, "")).filter((cpf) => cpf && cpf !== ownerCpf)),
    );
    if (cpfsPep.length === 0) {
      credilinkPepOk = false;
      motivos.push("PEP relacionado sem CPF identificado — não é possível confirmar consulta.");
    }
    for (const cpf of cpfsPep) {
      if (!credilinkEntryOk(CREDILINK_PEP_CONSULTAS[cpf])) {
        credilinkPepOk = false;
        motivos.push(`PEP CPF ${cpf} ainda não tem consulta Credilink concluída com sucesso.`);
      }
    }
  }

  return {
    jusbrasilOk,
    jusbrasilMotivo,
    credilinkPepOk,
    credilinkPepMotivo: motivos.join(" "),
    tudoOk: jusbrasilOk && credilinkPepOk,
  };
}

/** Só os números de token Credilink (titular + PEP), sem status/motivo —
 * pedido de thay@cora.com.br (2026-09-12): "Na fila da Liderança traga
 * apenas o números dos tokens: Titular da Conta e do PEP, para consultar,
 * se necessário." A investigação em si já foi validada antes do caso chegar
 * na Mesa; o token serve só de atalho pra reconsulta manual pontual. */
export interface CredilinkTokens {
  titular: string | null;
  peps: Array<{ cpf: string; token: string | null }>;
}

export function getCredilinkTokens(
  c: Pick<RegistrationCase, "cpf" | "token_pf_cred" | "pep_pf">,
  tipoPep: "titular" | "relacionado",
): CredilinkTokens {
  const titular = c.token_pf_cred || null;
  if (tipoPep === "titular") {
    return { titular, peps: [] };
  }
  const ownerCpf = (c.cpf || "").replace(/\D/g, "");
  const cpfsPep = Array.from(
    new Set((c.pep_pf || []).map((p) => (p.cpf_titular || "").replace(/\D/g, "")).filter((cpf) => cpf && cpf !== ownerCpf)),
  );
  return {
    titular,
    peps: cpfsPep.map((cpf) => ({ cpf, token: CREDILINK_PEP_CONSULTAS[cpf]?.token_compliance || null })),
  };
}

interface ParecerLlm {
  text?: string;
  model?: string;
  generated_at?: string;
  case_summary?: string;
  error?: string;
}

const PARECERES_LLM = pareceresLlmRaw as Record<string, ParecerLlm>;

interface RealComentario {
  timestamp: string;
  user_email: string;
  tipo: string;
  acao?: string;
  text: string;
}

interface RealCaso {
  _caso?: string;
  comentarios: RealComentario[];
}

const PARECERES_REAL = pareceresRealRaw as Record<string, RealCaso | { description?: string }>;

/** Retorna parecer LLM se houver, senão retorna null (cliente usa template). */
export function getParecerLlm(draftId: string): string | null {
  const p = PARECERES_LLM[draftId];
  if (p && p.text && !p.error) return p.text;
  return null;
}

/** Retorna comentários reais do Retool (se foram extraídos manualmente). */
export function getComentariosReais(draftId: string): RealComentario[] {
  const v = PARECERES_REAL[draftId];
  if (v && "comentarios" in v && Array.isArray(v.comentarios)) return v.comentarios;
  return [];
}

/**
 * E-mail do analista que fez a 1ª camada, recuperado do comentário de parecer
 * real do Retool — usado como fallback para `Analise.analistaEmail`, que
 * ficou vazio em todo o histórico anterior à captura desse campo (só passou
 * a ser preenchido nas análises criadas depois da mudança).
 * Prioriza o comentário de envio à Mesa (ENVIAR_LIDERANCA_PLD, o parecer que
 * o analista redige ao concluir a 1ª camada); na ausência dele, cai para o
 * primeiro comentário do tipo "parecer" e, por último, o comentário mais
 * antigo do caso.
 */
export function getAnalistaInicial(draftId: string): string | undefined {
  const comentarios = getComentariosReais(draftId);
  if (comentarios.length === 0) return undefined;
  const envio = comentarios.find((c) => c.acao === "ENVIAR_LIDERANCA_PLD" && c.user_email);
  if (envio) return envio.user_email;
  const parecer = comentarios.find((c) => c.tipo === "parecer" && c.user_email);
  if (parecer) return parecer.user_email;
  const maisAntigo = [...comentarios]
    .filter((c) => c.user_email)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
  return maisAntigo?.user_email;
}

const PARECERES_SUGESTAO = pareceresSugestaoRaw as Record<string, { text?: string; model?: string; generated_at?: string }>;

/**
 * Sugestão CONCISA de parecer (1 parágrafo, no estilo do exemplo Josinalva)
 * gerada por Claude para os casos CHECK_ANALISTA. NÃO é o parecer real do
 * analista — apenas um rascunho para acelerar a análise.
 */
export function getSugestaoParecer(draftId: string): string | null {
  const s = PARECERES_SUGESTAO[draftId];
  if (s && s.text) return s.text;
  return null;
}

const PARECERES_LIDERANCA = pareceresLiderancaRaw as Record<
  string,
  { text?: string; decisao?: "aprovado" | "reprovado" | "monitoramento" | "falso_positivo"; model?: string; generated_at?: string }
>;

/**
 * Sugestão completa de parecer da LIDERANÇA (Mesa de Decisão), em um dos 4
 * templates: APROVADO / REPROVADO / MONITORAMENTO REFORÇADO / FALSO POSITIVO.
 * Gerada por Claude com base nos achados externos + dados Credilink.
 */
export function getSugestaoLideranca(draftId: string): {
  text: string;
  resumo: string;
  decisao: StatusAnalise;
} | null {
  const s = PARECERES_LIDERANCA[draftId];
  if (s && s.text && s.decisao) {
    const resumo = (s as { resumo?: string }).resumo || extrairResumoParecer(s.text, s.decisao);
    return { text: s.text, resumo, decisao: s.decisao };
  }
  return null;
}

/** Extrai a frase central do parecer completo como resumo conciso. */
function extrairResumoParecer(texto: string, decisao: StatusAnalise): string {
  const labels: Record<StatusAnalise, string> = {
    aprovado: "APROVAR",
    monitoramento: "APROVAR com Diligência Reforçada",
    reprovado: "REPROVAR",
    falso_positivo: "FALSO POSITIVO",
  };
  const prefixo = labels[decisao] ?? "REVISAR";

  // Remove linhas de cabeçalho
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const corpo = linhas.filter(
    (l) => !l.startsWith("Decisão:") && !l.startsWith("CNPJ:")
  );
  if (!corpo.length) return `${prefixo} — ${texto.slice(0, 180)}…`;

  // Pega a primeira frase significativa (termina em ponto)
  const parag = corpo[0] || "";
  const firstDot = parag.indexOf(". ");
  const fraseCurta = firstDot > 20 && firstDot < 200
    ? parag.slice(0, firstDot + 1)
    : parag.slice(0, 180);

  return `${prefixo} — ${fraseCurta}${fraseCurta.endsWith(".") ? "" : "…"}`;
}

/**
 * Detecta a decisão sugerida pela IA a partir do texto do rascunho do
 * ANALISTA (estilo Josinalva). O template pede a recomendação na frase
 * final ("Considerando [...], sugerimos [...]") — busca só nela, nunca no
 * texto inteiro: uma palavra-chave usada no corpo em outro sentido (ex.:
 * "recomendação de que os dados do PEP sejam complementados... para fins
 * de monitoramento contínuo" não é "Monitoramento Reforçado"; "descartado
 * como falso positivo" sobre um achado de mídia não é o desfecho do caso)
 * pode colidir com a busca ingênua no texto todo e inverter a decisão real.
 * Bug real: draft 036e1466 (2026-08-13) — frase final dizia claramente
 * "sugerindo a APROVAÇÃO", mas `t.includes("MONITORAMENTO")` (fallback
 * solto que anulava o regex mais preciso logo antes dele) classificava
 * como monitoramento por causa de "monitoramento contínuo" alhures no
 * texto. Mesma causa raiz do bug em detect_decisao() (Python, Liderança) —
 * ver .tools/generate-sugestao-lideranca.py e
 * INCIDENT-REPORT-2026-08-12-TRUNCAMENTO-CAMPOS-PIPELINE.md.
 *
 * NOTA: quando a frase final não conclui em nenhuma das 3 recomendações
 * exigidas pelo SYSTEM_PROMPT (APROVAÇÃO / MONITORAMENTO REFORÇADO /
 * REPROVAÇÃO) — ex.: drafts 719f82b4/e59f5e1a, cuja frase final pede
 * diligência complementar por dados do PEP incompletos em vez de decidir —
 * o texto está fora do contrato do prompt. Cair no fallback estrutural
 * (`recomendacaoSugerida`) foi avaliado e descartado: para esses 2 casos
 * ele decide "falso_positivo" (porque o `pep_pf` estruturado está vazio),
 * o que contradiz o próprio texto da IA (que registra um vínculo PEP via
 * Credilink só com dados incompletos) — pior que o default atual. Mantido
 * "monitoramento" como default conservador enquanto isso não é resolvido
 * na origem (regenerar o parecer / SYSTEM_PROMPT sem contemplar esse
 * cenário); ver INCIDENT-REPORT-2026-08-18-SUGESTAO-SEM-DECISAO.md.
 */
function decisaoFromTextoAnalista(text: string): StatusAnalise {
  const frases = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const t = (frases[frases.length - 1] || text).toUpperCase();
  if (t.includes("FALSO POSITIVO")) return "falso_positivo";
  if (/(N[ÃA]O\s+APROVA|REPROVA|N[ÃA]O\s+TEMOS\s+OBJE.*REPROVA|RECUSA)/.test(t)) return "reprovado";
  if (/MONITORAMENTO\s+REFOR/.test(t)) return "monitoramento";
  // "Não temos objeções"/"sem objeções" é o mesmo desfecho de APROVAÇÃO no
  // estilo do template (ver EXEMPLO no SYSTEM_PROMPT), mesmo quando a frase
  // final não chega a repetir a palavra "APROVA" por extenso. Bug real:
  // draft f2a4b186 — "...não temos objeções ao início do relacionamento."
  // caía no default "monitoramento" por não conter "APROVA".
  if (t.includes("APROVA") || /N[ÃA]O\s+TEMOS\s+OBJE|SEM\s+OBJE[ÇC][ÃA]O/.test(t)) return "aprovado";
  return "monitoramento";
}

/**
 * Decisão sugerida pela IA para um caso da fila. Para LIDERANÇA usa o campo
 * estruturado `decisao` do JSON; para ANALISTA deriva do texto do rascunho.
 * Fallback: heurística antiga (`recomendacaoSugerida`).
 */
export function getDecisaoIA(c: Raw): StatusAnalise {
  if (c.bucket === "CHECK_LIDERANCA") {
    const sug = getSugestaoLideranca(c.draft_id);
    if (sug) return sug.decisao;
  } else {
    const txt = getSugestaoParecer(c.draft_id);
    if (txt) return decisaoFromTextoAnalista(txt);
  }
  return recomendacaoSugerida(c);
}

type Raw = Omit<
  RegistrationCase,
  "resultados_pesquisa" | "analise_geral" | "parecer_sugerido" | "recomendacao_sugerida" | "historico_comentarios"
>;

// toResultado() (deep-link genérico pra fonte não consultada) foi removida
// em 2026-09-12 — ver gerarResultados() abaixo: "se um site não for
// consultado, nem inclua nos Resultados de Pesquisas" (thay@cora.com.br).

/** Links de referência pra consulta manual — deliberadamente SEPARADO de
 * gerarResultados()/ResultadoCard: não afirma "nada identificado" nem carrega
 * risco/similaridade, é só um atalho de URL pré-preenchida (TSE, CNJ,
 * sanções, TCE/ALE/UF, DOU, Receita/QSA, mídia). Sem isso, remover os
 * deep-links de gerarResultados() (item 4, 2026-09-12) deixava o
 * Analista/Liderança sem NENHUM caminho dentro do Pepito pra conferir uma
 * fonte que o WebSearch não cobriu ou falhou em cobrir (achado Codex,
 * 2026-09-12: 63/78 casos da fila ficaram com zero links de verificação
 * depois da remoção). Consumido só pelo toggle "Ver links de verificação"
 * em RegistrationCaseCard.tsx — nunca pela lista de Resultados de Pesquisa. */
export function getLinksManuais(c: Raw): VerifyLink[] {
  const cargoOrgao = inferCargoOrgao(c);
  return buildVerifyLinks({
    cnpj: c.cnpj,
    cpf: c.cpf,
    fullNamePf: c.full_name_pf,
    rfNome: c.rf_nome_oficial,
    uf: c.uf,
    cidade: c.cidade,
    cargoPep: cargoOrgao.cargo,
    orgaoPublico: cargoOrgao.orgao,
    cpfPep: cargoOrgao.cpfTitular,
  });
}

/** Parseia data no formato dd/mm/yyyy usado pela Credilink em pep_pf. */
function parseDataBr(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type MandatoStatus = "ativo" | "carencia" | "encerrado" | "indeterminado";

/**
 * Status do mandato de UM registro pep_pf, comparando hoje com data_fim/
 * data_fim_carencia. "Carência" (3-5 anos pós-mandato) ainda conta como PEP
 * para fins de PLD/FT — ver README §Proteções contra erros comuns.
 */
export function statusMandato(p: PepPfItem): { status: MandatoStatus; label: string } {
  const fim = parseDataBr(p.data_fim);
  if (!fim) return { status: "indeterminado", label: "vigência não informada" };
  const hoje = new Date();
  if (hoje <= fim) return { status: "ativo", label: `mandato ATIVO até ${p.data_fim}` };
  const carencia = parseDataBr(p.data_fim_carencia);
  if (carencia && hoje <= carencia) {
    return { status: "carencia", label: `mandato encerrado em ${p.data_fim} — em carência PLD até ${p.data_fim_carencia}` };
  }
  return { status: "encerrado", label: `mandato encerrado em ${p.data_fim} (fora do período de carência)` };
}

/**
 * Entre múltiplos registros pep_pf (ex.: reeleição gera um registro por
 * mandato), escolhe o mais relevante: o mandato ATIVO agora, se houver;
 * senão o de data_fim mais recente. O campo `tipo` (T/R) da Credilink NÃO
 * indica recência — o mandato vigente pode vir com `tipo: "R"` e um mandato
 * já encerrado com `tipo: "T"` (caso real: draft d309057d, Vereador
 * reeleito em SÃO VICENTE DE MINAS-MG, 2026-08-11).
 */
function registroPepPrincipal(entradas: PepPfItem[]): PepPfItem | undefined {
  if (!entradas.length) return undefined;
  const comMeta = entradas.map((p) => {
    const inicio = parseDataBr(p.data_inicio);
    const fim = parseDataBr(p.data_fim);
    const hoje = new Date();
    const ativoAgora = !!fim && hoje <= fim && (!inicio || hoje >= inicio);
    return { p, fim, ativoAgora };
  });
  const ativos = comMeta.filter((x) => x.ativoAgora)
    .sort((a, b) => (b.fim?.getTime() ?? 0) - (a.fim?.getTime() ?? 0));
  if (ativos.length) return ativos[0].p;
  const comFim = comMeta.filter((x) => x.fim)
    .sort((a, b) => b.fim!.getTime() - a.fim!.getTime());
  if (comFim.length) return comFim[0].p;
  // Sem datas parseáveis em nenhum registro — mantém heurística antiga.
  return entradas.find((p) => p.tipo === "T") || entradas[0];
}

/** PEP titular vs relacionado: TITULAR se o owner é o próprio PEP; RELACIONADO se o owner é vínculo. */
export function inferTipoPep(c: Raw): "titular" | "relacionado" {
  const ownerCpf = (c.cpf || "").replace(/\D/g, "");
  const titulares = (c.pep_pf || []).filter((p) => p.tipo === "T");
  if (!titulares.length) return "relacionado";
  const isOwnerTitular = titulares.some((p) => (p.cpf_titular || "").replace(/\D/g, "") === ownerCpf);
  return isOwnerTitular ? "titular" : "relacionado";
}

/** Cargo + Órgão derivados do registro PEP mais atual vinculado (Credilink). */
export function inferCargoOrgao(c: Raw): {
  cargo: string;
  orgao: string;
  nomePEP: string;
  cpfTitular: string;
  cidadeUf: string;
  vinculo: string;
  dataInicio: string;
  dataFim: string;
  statusMandato: MandatoStatus;
  statusMandatoLabel: string;
} {
  const principal = registroPepPrincipal(c.pep_pf || []);
  if (!principal) {
    return {
      cargo: "(sem PEP titular vinculado)",
      orgao: "(verificar TSE)",
      nomePEP: c.full_name_pf,
      cpfTitular: "",
      cidadeUf: c.uf || "",
      vinculo: "",
      dataInicio: "",
      dataFim: "",
      statusMandato: "indeterminado",
      statusMandatoLabel: "",
    };
  }
  // Cargo formal vem da Credilink (Descrição_Função). Fallback para perfilPepLabel.
  const cargo = principal.cargo_formal
    ? principal.cargo_formal.charAt(0).toUpperCase() + principal.cargo_formal.slice(1).toLowerCase()
    : perfilPepLabel(principal.perfil);
  const orgaoLabel = principal.orgao || `(consultar TSE/${principal.uf || c.uf})`;
  const { status, label } = statusMandato(principal);
  return {
    cargo,
    orgao: orgaoLabel,
    nomePEP: principal.nome_titular || c.full_name_pf,
    cpfTitular: principal.cpf_titular || "",
    cidadeUf: principal.orgao || `${c.uf}`,
    vinculo: principal.ds_vinculo || "",
    dataInicio: principal.data_inicio || "",
    dataFim: principal.data_fim || "",
    statusMandato: status,
    statusMandatoLabel: label,
  };
}

/** Normaliza o DSVINCULO para texto natural ("Irmã/Irmão" → "irmão/irmã"). */
export function vinculoLabel(ds: string | null | undefined): string {
  if (!ds) return "";
  const map: Record<string, string> = {
    "IRMA(O)": "irmão/irmã",
    "PAI": "pai",
    "MAE": "mãe",
    "FILHA(O)": "filho/filha",
    "FILHO": "filho",
    "FILHA": "filha",
    "CONJUGE": "cônjuge",
    "COMPANHEIRO(A)": "companheiro/companheira",
    "TIA(O)": "tio/tia",
    "SOBRINHA(O)": "sobrinho/sobrinha",
    "PRIMA(O)": "primo/prima",
    "AVO": "avó/avô",
    "NETA(O)": "neto/neta",
    "GENRO": "genro",
    "NORA": "nora",
    "SOGRA(O)": "sogro/sogra",
    "CUNHADA(O)": "cunhado/cunhada",
    "PADRASTO": "padrasto",
    "MADRASTA": "madrasta",
    "ENTEADA(O)": "enteado/enteada",
  };
  const key = ds.trim().toUpperCase();
  return map[key] || ds.toLowerCase();
}

function clean(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/^"+|"+$/g, "").trim();
}

function isEmptyMessage(s: string | null | undefined, kind: "midia" | "processo"): boolean {
  const t = clean(s).toLowerCase();
  if (!t) return true;
  if (kind === "midia") return t.includes("mídias negativas não encontrad") || t.includes("midias negativas nao encontrad");
  return t.includes("processos judiciais não encontrad") || t.includes("processos judiciais nao encontrad");
}

export function gerarResultados(c: Raw): ResultadoPesquisa[] {
  const r: ResultadoPesquisa[] = [];

  // ===== Achados REAIS de mídia (WebSearch concluído) — entram primeiro =====
  // Pedido de thay@cora.com.br (2026-09-12): "Se um site não for consultado,
  // nem inclua nos Resultados de Pesquisas para não poluir a lista." Antes,
  // dezenas de deep-links pré-montados (TSE, DOU, TCE, ALE, Sanções, CNJ,
  // Escavador, TCU, MPF, TJ, MP, JusBrasil CNPJ/CPF do PEP, Receita/QSA,
  // mídia por veículo) entravam aqui via toResultado() sempre que o link
  // existia, mesmo quando NADA foi de fato consultado — eram só URLs
  // template pra clique manual, com badge "Pendente verificação" disfarçado
  // de resultado de pesquisa. Removido: a lista agora só mostra o que foi
  // realmente consultado (WebSearch M1-M13 em fetch-media-findings.py,
  // Credilink, JusBrasil, RUFRA, pipeline KYC pré-apurado).
  const findings = getFindingsFor(c.draft_id);
  findings.forEach((f) => {
    const matchInfo = f.match ? ` [Match: ${f.match}]` : "";
    const homo = f.homonimo_alerta ? ` [⚠️ HOMÔNIMO: ${f.homonimo_alerta}]` : "";
    // Placeholder de cota JusBrasil estourada (_FINDING_LIMITE_ATINGIDO em
    // fetch-media-findings.py) explicitamente NÃO é uma consulta real — sem
    // esse tratamento ele herdava similaridade_nome:"100%" e
    // pendente_verificacao:false igual a um achado de verdade, disfarçando
    // "não consultamos" como "consultamos e confirmamos" (achado Codex, 2026-09-11).
    const isPlaceholderCota = f.source.includes("Controle de Quota") || f.source.includes("Erro de Consulta");
    // M7 (contexto regional) não identifica NINGUÉM nominalmente — badge de
    // similaridade "100%" nesse achado dava a entender que o PEP/titular/
    // empresa foi de fato encontrado, quando o próprio texto diz "sem
    // vínculo"/"não citado nominalmente" (achado thay@cora.com.br,
    // 2026-09-12: "se o match foi realmente de 100%, é porque alguém teria
    // sido identificado, não o contrário").
    const semIdentificacao = isCtxRegional(f);
    r.push({
      id: uid(),
      fonte: f.source,
      resumo: `${f.title} — ${f.snippet}${matchInfo}${homo}`,
      tipo: (f.tipo as ResultadoPesquisa["tipo"]) || "midia",
      risco: f.risk_indicator,
      link: f.url,
      // Similaridade só aparece quando ALGUÉM foi de fato identificado:
      // nem placeholder de cota/erro, nem contexto regional sem nexo nominal.
      ...(isPlaceholderCota || semIdentificacao
        ? {}
        : { similaridade_nome: f.homonimo_alerta ? "verificar identidade" : "100%" }),
      pendente_verificacao: isPlaceholderCota || !!f.homonimo_alerta,
    });
  });

  // ===== PEP — informação REAL da base unificada =====
  // OBS: `tipo` (T/R) da Credilink não indica qual registro é o vigente —
  // em reeleição, o mandato ATIVO pode vir com tipo "R" e o encerrado com
  // tipo "T". O status de mandato abaixo vem de comparar data_fim/
  // data_fim_carencia com hoje (statusMandato), não do campo `tipo`.
  if (c.pep_pf && c.pep_pf.length > 0) {
    c.pep_pf.forEach((p, i) => {
      const tipoLabel = p.tipo === "T" ? "Titular" : p.tipo === "R" ? "Relacionado" : `Tipo ${p.tipo}`;
      const cargoLabel = perfilPepLabel(p.perfil);
      const isOwnerTitular = (p.cpf_titular || "").replace(/\D/g, "") === (c.cpf || "").replace(/\D/g, "");
      const { status: statusM, label: statusLabel } = statusMandato(p);
      const statusEmoji = statusM === "ativo" ? "🟢" : statusM === "carencia" ? "🟡" : statusM === "encerrado" ? "⚪" : "";
      const periodo = p.data_inicio || p.data_fim ? ` — mandato ${p.data_inicio || "?"}–${p.data_fim || "?"}` : "";
      r.push({
        id: uid(),
        fonte: `Base PEP unificada (registro #${i + 1})`,
        resumo: `${tipoLabel}: ${p.nome_titular} — ${cargoLabel}` +
                (p.uf ? ` (${p.uf})` : "") +
                (p.orgao ? ` em ${p.orgao}` : "") +
                periodo +
                (statusLabel ? `. ${statusEmoji} ${statusLabel.charAt(0).toUpperCase()}${statusLabel.slice(1)}` : "") +
                (isOwnerTitular ? `. ⚠️ O próprio owner é o PEP.` : `. Owner é vínculo do PEP titular.`),
        tipo: "pep",
        risco: "alto",
        similaridade_nome: "100%",
      });
    });
  }

  // ===== Mídia negativa — usa o conteúdo já apurado =====
  const sinalMidiaPj = !isEmptyMessage(c.pj_midianegativas, "midia");
  const sinalMidiaPf = !isEmptyMessage(c.pf_midianegativas, "midia");
  if (sinalMidiaPj || sinalMidiaPf) {
    r.push({
      id: uid(),
      fonte: "Pipeline KYC — Mídia adversa pré-apurada",
      resumo: `Sinais de mídia negativa ${sinalMidiaPj ? "PJ" : ""}${sinalMidiaPj && sinalMidiaPf ? " e " : ""}${sinalMidiaPf ? "PF" : ""} encontrados na busca interna. Validar conteúdo: ${clean(c.pf_midianegativas || c.pj_midianegativas).slice(0, 200)}`,
      tipo: "midia",
      risco: "alto",
      similaridade_nome: "100%", // achado real do pipeline pré-apurado
    });
  } else {
    r.push({
      id: uid(),
      fonte: "Pipeline KYC — Mídia adversa pré-apurada",
      resumo: `Pipeline interno: ${clean(c.pf_midianegativas || c.pj_midianegativas) || "sem mídia adversa material"}.`,
      tipo: "midia",
      risco: "baixo",
      // Sem similaridade_nome: nada foi encontrado — badge de "match" aqui
      // seria enganoso.
    });
  }

  // ===== Processos =====
  const sinalProcPj = !isEmptyMessage(c.processosjudiciais_pj, "processo");
  const sinalProcPf = !isEmptyMessage(c.processosjudiciais_pf, "processo");
  if (sinalProcPj || sinalProcPf) {
    r.push({
      id: uid(),
      fonte: "Pipeline KYC — Processos judiciais pré-apurados",
      resumo: `Sinais de processos judiciais (${sinalProcPj ? "PJ " : ""}${sinalProcPf ? "PF" : ""}). Conteúdo: ${clean(c.processosjudiciais_pf || c.processosjudiciais_pj).slice(0, 200)}`,
      tipo: "processo",
      risco: "alto",
      similaridade_nome: "100%", // achado real do pipeline pré-apurado
    });
  } else {
    r.push({
      id: uid(),
      fonte: "Pipeline KYC — Processos judiciais",
      resumo: `Pipeline: ${clean(c.processosjudiciais_pf || c.processosjudiciais_pj) || "sem processos materiais"}.`,
      tipo: "processo",
      risco: "baixo",
      // Sem similaridade_nome: nada foi encontrado — badge de "match" aqui
      // seria enganoso.
    });
  }

  // ===== RUFRA (sinal interno) =====
  if (clean(c.rufra_pf_fraude_confirmada).toLowerCase() !== "none" && c.rufra_pf_fraude_confirmada) {
    r.push({
      id: uid(),
      fonte: "RUFRA — fraude confirmada",
      resumo: `Sinalização interna RUFRA para PF: "${clean(c.rufra_pf_fraude_confirmada)}".`,
      tipo: "governo",
      risco: "alto",
      similaridade_nome: "100%",
    });
  }

  return r;
}

export function gerarAnaliseGeral(c: Raw): string {
  const cargoOrgao = inferCargoOrgao(c);
  const tipoPep = inferTipoPep(c);
  const sinalMidia = !isEmptyMessage(c.pj_midianegativas, "midia") || !isEmptyMessage(c.pf_midianegativas, "midia");
  const sinalProc = !isEmptyMessage(c.processosjudiciais_pj, "processo") || !isEmptyMessage(c.processosjudiciais_pf, "processo");
  const findings = getFindingsFor(c.draft_id);
  const isCtxReg = (f: MediaFinding) =>
    !!(f.match?.includes("M7") || f.homonimo_alerta?.includes("Contexto regional"));
  const homonimo = findings.some((f) => f.homonimo_alerta && !isCtxReg(f));
  const altoExterno = findings.some((f) => f.risk_indicator === "alto" && !isCtxReg(f));

  const partes: string[] = [];
  partes.push(`Score PLD ${c.score_pld} (${c.score_level}). Bucket Retool: ${c.bucket}. Reason: ${c.evaluation_reason}.`);
  const pepDesc = tipoPep === "titular"
    ? `é o próprio PEP`
    : `vinculado ao PEP "${cargoOrgao.nomePEP}"${cargoOrgao.cpfTitular ? ` (CPF PEP: ${cargoOrgao.cpfTitular})` : ""}`;
  partes.push(`Owner: ${c.full_name_pf} (CPF ${c.cpf}) — ${pepDesc} (${cargoOrgao.cargo}).`);
  partes.push(`PJ: ${c.rf_nome_oficial} (CNPJ ${c.cnpj}, CNAE "${c.cnae}", ${c.uf}/${c.cidade}).`);

  if (findings.length) {
    partes.push(`✅ Pesquisa real em mídia/justiça: ${findings.length} achado(s) verificável(eis).`);
    if (altoExterno) partes.push(`🔴 Há achado externo de alto risco — abrir os links e validar gravidade.`);
    if (homonimo) partes.push(`⚠️ POSSÍVEL HOMÔNIMO: alguns achados podem se referir a outra pessoa — confirmar identidade antes de decidir.`);
  } else {
    partes.push(`Pesquisa em fontes públicas não retornou matérias adversas materiais para o nome ${c.full_name_pf} (validar via links se houver dúvida).`);
  }

  if (sinalMidia) partes.push(`Pipeline interno (PJ/PF mídia negativa): "${(c.pf_midianegativas || c.pj_midianegativas || "").slice(0, 120)}".`);
  if (sinalProc) partes.push(`Pipeline interno (processos): "${(c.processosjudiciais_pf || c.processosjudiciais_pj || "").slice(0, 120)}".`);
  if (!sinalMidia && !sinalProc && !findings.length) partes.push(`Sem sinais materiais; cadastro candidato a aprovação pelo fluxo PLD padrão.`);

  return partes.join(" ");
}

export function gerarParecerSugerido(c: Raw): string {
  const tipoPep = inferTipoPep(c);
  const cargoOrgao = inferCargoOrgao(c);
  const sinalMidia = !isEmptyMessage(c.pj_midianegativas, "midia") || !isEmptyMessage(c.pf_midianegativas, "midia");
  const sinalProc = !isEmptyMessage(c.processosjudiciais_pj, "processo") || !isEmptyMessage(c.processosjudiciais_pf, "processo");
  const findings = getFindingsFor(c.draft_id);
  // isCtxRegional() compartilhado com gerarResultados() — definido no topo do arquivo.
  const altoExterno = findings.some((f) => f.risk_indicator === "alto" && !isCtxRegional(f));
  const homonimo = findings.some((f) => f.homonimo_alerta && !isCtxRegional(f));

  const cpfPepInfo = tipoPep === "relacionado" && cargoOrgao.cpfTitular
    ? ` (CPF PEP: ${cargoOrgao.cpfTitular})`
    : "";
  const inicio = tipoPep === "titular"
    ? `Owner ${c.full_name_pf} é o PEP titular (${cargoOrgao.cargo}).`
    : `Owner ${c.full_name_pf} é vínculo de PEP titular: ${cargoOrgao.nomePEP}${cpfPepInfo} (${cargoOrgao.cargo}).`;

  // Vínculo SOCIETÁRIO (sócio/representante em outra empresa): a Credilink
  // não informa em qual empresa titular e PEP são sócios, nem CNPJ nem
  // situação cadastral — essa empresa pode ou não ser a mesma do cadastro.
  // Sem esse dado não dá pra aferir o risco real do vínculo, então o
  // parecer precisa sinalizar a lacuna e a necessidade de validação manual
  // (empresa ativa ou baixada) em vez de ficar silencioso a respeito.
  const vinculoSocietario = tipoPep === "relacionado" && cargoOrgao.vinculo.trim().toUpperCase() === "SOCIO"
    ? ` ⚠️ Vínculo societário (sócio) sem identificação da empresa em comum entre titular e PEP — validar manualmente qual é essa empresa e se está ativa ou baixada na Receita Federal.`
    : "";

  const meio = `Score PLD ${c.score_pld}. CNAE "${c.cnae}", PJ ${c.rf_nome_oficial} (${c.uf}/${c.cidade}). Reason: ${c.evaluation_reason}.`;

  let fim: string;
  if (homonimo) {
    fim = `⚠️ HOMÔNIMO DETECTADO em pesquisa externa — VALIDAR identidade antes de decidir. Sugestão preliminar: REVISAR e descartar achados de homônimo; se confirmados, atualizar para reprovação ou monitoramento conforme gravidade.`;
  } else if (altoExterno || (sinalMidia && sinalProc)) {
    fim = `Achados externos de alto risco e/ou sinais cumulativos de pipeline. Sugestão preliminar: ${c.bucket === "CHECK_LIDERANCA" ? "REPROVAÇÃO" : "MONITORAMENTO REFORÇADO com escalação à Liderança"}.`;
  } else if (sinalMidia || sinalProc || findings.length > 0) {
    fim = `Sinais não-materiais detectados (mídia/processos pré-apurados ou achados externos de baixo/médio risco). Sugestão preliminar: ${c.bucket === "CHECK_LIDERANCA" ? "MONITORAMENTO REFORÇADO" : "APROVAÇÃO"}.`;
  } else {
    fim = `Sem sinais materiais. Sugestão preliminar: APROVAÇÃO (fluxo PLD padrão para PEP).`;
  }

  return [inicio + vinculoSocietario, meio, fim].join(" ");
}

/**
 * Gera o 1º parecer do analista no template oficial Cora — adapta ao tipo PEP
 * (titular vs relacionado), achados em mídia e o cargo/UF do PEP.
 *
 * Template-base (fornecido pela analista, exemplo Josinalva Guerra Lins Silva):
 *   "Trata-se de empresa cujo titular [...] possui relacionamento com a PEP
 *    [NOME] ([CARGO] de [CIDADE/UF]) [...]. Em análises reputacionais, [findings].
 *    Dito isso [...], sugerimos a inclusão em monitoramento reforçado [...]."
 */
export function gerarParecerAnalista(c: Raw): string {
  const cargoOrgao = inferCargoOrgao(c);
  const tipoPep = inferTipoPep(c);
  const findings = getFindingsFor(c.draft_id);
  const isCtxRegAn = (f: MediaFinding) =>
    !!(f.match?.includes("M7") || f.homonimo_alerta?.includes("Contexto regional"));
  const altoExterno = findings.some((f) => f.risk_indicator === "alto" && !isCtxRegAn(f));
  const homonimo = findings.some((f) => f.homonimo_alerta && !isCtxRegAn(f));
  const sinalMidia =
    !isEmptyMessage(c.pj_midianegativas, "midia") ||
    !isEmptyMessage(c.pf_midianegativas, "midia");
  const sinalProc =
    !isEmptyMessage(c.processosjudiciais_pj, "processo") ||
    !isEmptyMessage(c.processosjudiciais_pf, "processo");
  const algumSinal = altoExterno || sinalMidia || sinalProc;

  // Frase 1: enquadramento do vínculo
  const localPep = `${cargoOrgao.cargo}${cargoOrgao.orgao && !cargoOrgao.orgao.includes("(consultar") ? ` em ${cargoOrgao.orgao}` : ""} (${c.uf || "UF não confirmada"})`;
  const cnaeFrase = c.cnae ? ` que possui atividade de ${c.cnae.replace(/^\d{2}\.\d{2}-\d-\d{2}\s*-\s*/, "")}` : "";

  let frase1: string;
  if (tipoPep === "titular") {
    frase1 = `Trata-se de empresa cujo titular ${c.full_name_pf} (CPF ${c.cpf}) é a própria PEP — ${localPep} — sócio da PJ ${c.rf_nome_oficial} (CNPJ ${c.cnpj}${cnaeFrase}).`;
  } else {
    const cpfPepInfo = cargoOrgao.cpfTitular ? `, CPF ${cargoOrgao.cpfTitular}` : "";
    frase1 = `Trata-se de empresa cujo titular ${c.full_name_pf} (CPF ${c.cpf}) possui relacionamento com a PEP ${cargoOrgao.nomePEP}${cpfPepInfo} (${localPep}) — sócio da PJ ${c.rf_nome_oficial} (CNPJ ${c.cnpj}${cnaeFrase}).`;
  }

  // Frase 2: análise reputacional (achados externos + sinais internos)
  let frase2: string;
  if (homonimo) {
    frase2 = `Em análises reputacionais, foi identificado possível homônimo nas fontes públicas — antes de qualquer decisão é necessária validação inequívoca de identidade nos links anexos.`;
  } else if (altoExterno) {
    const fonte = findings.find((f) => f.risk_indicator === "alto");
    frase2 = `Em análises reputacionais, foi identificado apontamento adverso de risco ALTO em ${fonte?.source ?? "fonte pública"} (${fonte?.title?.slice(0, 100) ?? "—"}). Validação obrigatória do conteúdo antes da decisão final.`;
  } else if (algumSinal) {
    frase2 = `Em análises reputacionais, foram identificados sinais não-materiais (mídia ou processos sem matéria de improbidade/corrupção). Pipeline interno do Cora apontou: "${(c.pf_midianegativas || c.pj_midianegativas || c.processosjudiciais_pf || c.processosjudiciais_pj || "—").slice(0, 120)}".`;
  } else {
    frase2 = `Em análises reputacionais, não foram identificadas mídias ou processos desabonadores face à empresa, ao seu titular${tipoPep === "relacionado" ? " ou à PEP" : ""}.`;
  }

  // Frase 3: recomendação
  let frase3: string;
  if (homonimo) {
    frase3 = `Recomendamos suspender a decisão até validação de identidade. Em caso de confirmação de homônimo, sugerimos APROVAÇÃO COM MONITORAMENTO REFORÇADO.`;
  } else if (altoExterno && c.bucket === "CHECK_LIDERANCA") {
    frase3 = `Considerando o conjunto de evidências e o apetite de risco da instituição, sugerimos a NÃO APROVAÇÃO do relacionamento, conforme Circular BACEN 3.978/2020.`;
  } else if (altoExterno || (c.bucket === "CHECK_LIDERANCA" && algumSinal)) {
    // Monitoramento Reforçado exige achado materializado (mídia/processo/achado externo) —
    // estar em CHECK_LIDERANCA (PEP/vínculo ativo) isoladamente não é fator suficiente.
    frase3 = `Dito isso, considerando o ${altoExterno ? "achado externo de risco alto" : "sinal reputacional identificado"} e o ${tipoPep === "titular" ? "exercício direto de mandato pelo titular" : "vínculo ativo com PEP em mandato"}, sugerimos a APROVAÇÃO SOB MONITORAMENTO REFORÇADO, com revisão semestral, conforme Circular BACEN 3.978/2020.`;
  } else {
    frase3 = `Considerando que não foram identificados desabonos relevantes sob a ótica de LD, não temos objeções ao início do relacionamento. O cadastro segue fluxo PLD padrão de derivação PEP, conforme Circular BACEN 3.978/2020.`;
  }

  return `${frase1} ${frase2} ${frase3}`;
}

/**
 * Gera o histórico/timeline de comentários para o caso, combinando:
 *   - Audit real do Athena (`dumps.registration_draft_membership_registration_audit`)
 *   - Parecer técnico do analista responsável (lucasfeller / jeniffer / m.matos)
 *     atribuído via hash determinístico do draft_id
 *   - Para CHECK_LIDERANCA: ação ENVIAR_LIDERANCA_PLD pelo mesmo analista
 *   - thay@cora.com.br só aparece em decisões finais (REJECTED/APPROVED no audit)
 */
export function gerarHistoricoComentarios(c: Raw): ComentarioHistorico[] {
  const historico: ComentarioHistorico[] = [];
  const timestamps = new Set<string>();

  const pushUnique = (entry: ComentarioHistorico) => {
    const key = `${entry.timestamp}|${entry.user_email}|${entry.text?.slice(0, 50)}`;
    if (!timestamps.has(key)) {
      timestamps.add(key);
      historico.push(entry);
    }
  };

  // === 1) Webhook Retool PLD — fonte primária (project_webhook.event_acompanhamento_analise_cadastral) ===
  ((c as any).webhook_historico ?? []).forEach((ev: {
    timestamp: string; user_email: string; text: string; acao: string; tipo: string;
  }) => {
    if (!ev.text && !ev.acao) return;
    pushUnique({
      timestamp: ev.timestamp,
      user_email: ev.user_email,
      text: ev.text || ev.acao,
      tipo: (ev.tipo as ComentarioHistorico["tipo"]) ?? "acao",
    });
  });

  // === 2) Comentários manuais do pareceres-real.json ===
  const reais = getComentariosReais(c.draft_id);
  reais.forEach((r) => {
    pushUnique({
      timestamp: r.timestamp,
      user_email: r.user_email,
      text: r.text,
      tipo: (r.tipo as ComentarioHistorico["tipo"]) ?? "acao",
    });
  });

  // === 3) Audit logs do Athena (fallback) ===
  (c.audit_real ?? []).forEach((a) => {
    pushUnique({
      timestamp: a.timestamp,
      user_email: a.email,
      text: `${a.original_status} → ${a.new_status}${a.team ? ` (${a.team})` : ""}`,
      tipo: a.email.includes("notebook") ? "sistema" : "acao",
    });
  });

  // Ordenar por timestamp (mais recentes primeiro)
  return historico.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function recomendacaoSugerida(c: Raw): StatusAnalise {
  const sinalMidia = !isEmptyMessage(c.pj_midianegativas, "midia") || !isEmptyMessage(c.pf_midianegativas, "midia");
  const sinalProc = !isEmptyMessage(c.processosjudiciais_pj, "processo") || !isEmptyMessage(c.processosjudiciais_pf, "processo");
  const findings = getFindingsFor(c.draft_id);
  // M7 = contexto regional sem nexo direto → não conta como alto confirmado
  const isContextoRegional = (f: MediaFinding) =>
    !!(f.match?.includes("M7") || f.homonimo_alerta?.includes("Contexto regional"));
  const altoConfirmado = findings.some(
    (f) => f.risk_indicator === "alto" && !f.homonimo_alerta && !isContextoRegional(f),
  );
  const algumConfirmado = findings.some((f) => !f.homonimo_alerta && !isContextoRegional(f));
  const homonimoSemConfirmacao = findings.some((f) => f.homonimo_alerta) && !algumConfirmado;

  // pep_pf vazio = Credilink consultada e nenhum PEP identificado.
  // Se a dupla-verificação (JusBrasil + Tesserati + WebSearch) também não trouxer
  // nada adverso, o caso é falso positivo.
  const pepNaoIdentificado = !c.pep_pf || c.pep_pf.length === 0;
  if (pepNaoIdentificado && !altoConfirmado && !sinalMidia && !sinalProc) {
    return "falso_positivo";
  }

  // Todos os findings são alertas de homônimo: pré-decisão é monitoramento (identidade incerta)
  if (homonimoSemConfirmacao) return "monitoramento";
  // Alto risco confirmado → reprovado
  if (altoConfirmado) return "reprovado";
  // Liderança: sinais cumulativos → reprovado
  if (c.bucket === "CHECK_LIDERANCA" && (sinalMidia && sinalProc)) return "reprovado";
  // Sem achados materiais: fluxo PLD padrão cobre PEPs; não escalar para monitoramento reforçado
  return "aprovado";
}

// ─── Score de Risco de Lavagem de Dinheiro ───────────────────────────────────

export interface PldRiskScore {
  probabilidade: number;
  nivel: "critico" | "alto" | "medio" | "baixo";
  score_modelo: number;
  score_max: number;
  fatores: Array<{ id: string; label: string; nivel: "alto" | "medio" | "baixo"; orgao_url?: string }>;
  pep_cargo: string;
  pep_vinculo: string;
  gerado_em: string;
}

const PLD_RISK_SCORES = (pldRiskScoresRaw as { _meta: unknown; scores: Record<string, PldRiskScore> }).scores;

/** Retorna o score de risco de LD para um draft_id, ou null se não calculado. */
export function getPldRiskScore(draftId: string): PldRiskScore | null {
  return PLD_RISK_SCORES[draftId] ?? null;
}
