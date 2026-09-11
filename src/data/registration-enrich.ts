/**
 * Enriquece cada caso REAL da Fila PLD com:
 *   - Lista de `ResultadoPesquisa` apontando para fontes públicas via deep-link
 *     parametrizado (CNPJ, CPF, nome).
 *   - Análise consolidada baseada nos sinais já disponíveis (mídia negativa,
 *     processos, RUFRA, PEP info real).
 *   - Parecer sugerido em PT-BR.
 *
 * O analista clica nos links e valida em tempo real — nada é fabricado sobre
 * pessoas reais.
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

function toResultado(
  link: VerifyLink,
  hint: {
    tipo: ResultadoPesquisa["tipo"];
    risco: ResultadoPesquisa["risco"];
    resumo: string;
    pendente?: boolean;
  },
): ResultadoPesquisa {
  return {
    id: uid(),
    fonte: link.fonte,
    resumo: hint.resumo,
    tipo: hint.tipo,
    risco: hint.risco,
    link: link.url,
    // Sem similaridade_nome: toResultado() sempre monta um DEEP-LINK de busca
    // (URL pré-preenchida), nunca um achado já verificado — nada aqui foi de
    // fato confirmado, então não existe "% de similaridade" a reportar. Um
    // badge "Similaridade: 100%" aqui passaria a falsa impressão de match
    // positivo mesmo quando o resumo diz "nada identificado" (apontado por
    // thay@cora.com.br, 2026-09-11). Use `pendente: true` sempre que o resumo
    // afirmar algo (ex.: risco alto, "confirmar mandato X") em vez de
    // reportar ausência de sinal — isso já sinaliza "não verificado ainda"
    // sem precisar de badge de similaridade (caso real: draft d309057d,
    // 2026-08-11).
    pendente_verificacao: hint.pendente ?? false,
  };
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
  const cargoOrgao = inferCargoOrgao(c);
  const links = buildVerifyLinks({
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
  const get = (fonte: string) => links.find((l) => l.fonte === fonte);

  const r: ResultadoPesquisa[] = [];

  // ===== Achados REAIS de mídia (WebSearch concluído) — entram primeiro =====
  const findings = getFindingsFor(c.draft_id);
  findings.forEach((f) => {
    const matchInfo = f.match ? ` [Match: ${f.match}]` : "";
    const homo = f.homonimo_alerta ? ` [⚠️ HOMÔNIMO: ${f.homonimo_alerta}]` : "";
    r.push({
      id: uid(),
      fonte: f.source,
      resumo: `${f.title} — ${f.snippet}${matchInfo}${homo}`,
      tipo: (f.tipo as ResultadoPesquisa["tipo"]) || "midia",
      risco: f.risk_indicator,
      link: f.url,
      // Similaridade 100% APENAS quando há match explícito sem alerta de homônimo
      similaridade_nome: f.homonimo_alerta ? "verificar identidade" : "100%",
      pendente_verificacao: !!f.homonimo_alerta,
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

  // ===== Eleitoral =====
  // Deep-link de busca — nada foi verificado automaticamente aqui, por isso
  // `pendente: true` (badge "Pendente verificação"), diferente dos registros
  // "Base PEP unificada" acima, que são dado real já confirmado na base.
  const tseCand = get("TSE — Divulgação de Candidaturas");
  if (tseCand) {
    r.push(toResultado(tseCand, {
      tipo: "pep", risco: "alto", pendente: true,
      resumo: `Confirmar mandato/candidaturas de ${cargoOrgao.nomePEP} no TSE — bens declarados, partido, ${c.uf}. Link de busca; analista deve abrir e conferir manualmente (não verificado automaticamente).`,
    }));
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

  // Mídia: busca direta nos acervos das publicações.
  // Para cada publicação, mostra "Nada desabonador identificado" a menos que
  // haja achado real (já adicionado acima a partir de media-findings.json).
  const findingSources = new Set(findings.map((f) => f.source.toLowerCase()));
  links
    .filter((l) => l.categoria === "Mídia")
    .forEach((m) => {
      const fonteLower = m.fonte.toLowerCase();
      const jaTemAchado = Array.from(findingSources).some((s) =>
        fonteLower.includes(s.split(" ")[0]) || s.includes(fonteLower.split(" ")[0]),
      );
      if (jaTemAchado) return; // já mostrado acima como achado real
      r.push(toResultado(m, {
        tipo: "midia",
        risco: "baixo",
        resumo: `Nada desabonador identificado em ${m.fonte} para ${c.full_name_pf} (CPF ${c.cpf}, ${c.cidade}/${c.uf}). Link aberto para validação manual se necessário.`,
      }));
    });

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

  // CNJ + JusBrasil (CPF do titular) + Escavador + TJ-{UF} + MP-{UF} + TCU + MPF
  // — todas fontes de busca por NOME/CPF da pessoa física. JusBrasil por CNPJ
  // e por CPF do PEP têm resumo próprio (empresa/PEP, não o titular) logo abaixo.
  ["CNJ — Improbidade Administrativa", "JusBrasil — busca por CPF",
   "Escavador — perfil pessoa", "TCU — Acórdãos", "MPF — Processos e investigações",
   `TJ-${c.uf} — consulta processual`, `MP-${c.uf} — Ministério Público`].forEach((nome) => {
    const link = get(nome);
    if (link) {
      const fonteLower = nome.toLowerCase();
      const jaTemAchado = Array.from(findingSources).some((s) =>
        fonteLower.includes(s.split(" ")[0]) || s.includes(fonteLower.split(" ")[0]),
      );
      if (jaTemAchado) return;
      r.push(toResultado(link, {
        tipo: link.categoria === "Estadual" ? "governo" : "processo",
        risco: "baixo",
        resumo: `Nada identificado sobre ${c.full_name_pf} (CPF ${c.cpf}) em ${nome}. Link aberto para validação manual se necessário.`,
      }));
    }
  });

  const jaTemAchadoJusBrasil = Array.from(findingSources).some((s) => s.includes("jusbrasil"));

  // JusBrasil — CNPJ da empresa (pessoa jurídica em análise, não o titular).
  const jusBrasilCnpj = get("JusBrasil — busca por CNPJ");
  if (jusBrasilCnpj && !jaTemAchadoJusBrasil) {
    r.push(toResultado(jusBrasilCnpj, {
      tipo: "processo",
      risco: "baixo",
      resumo: `Nada identificado sobre ${c.rf_nome_oficial} (CNPJ ${c.cnpj}) em JusBrasil. Link aberto para validação manual se necessário.`,
    }));
  }

  // JusBrasil — CPF do PEP identificado via Credilink (quando o owner é
  // vínculo, não o próprio titular). Busca separada da do owner acima.
  const jusBrasilPep = get("JusBrasil — busca por CPF do PEP");
  if (jusBrasilPep && !jaTemAchadoJusBrasil) {
    r.push(toResultado(jusBrasilPep, {
      tipo: "processo",
      risco: "baixo",
      resumo: `Nada identificado sobre ${cargoOrgao.nomePEP} (CPF do PEP ${cargoOrgao.cpfTitular}) em JusBrasil. Link aberto para validação manual se necessário.`,
    }));
  }

  // ===== Sanções =====
  ["Portal da Transparência — CEIS / CNEP / CEPIM (CNPJ)",
   "Portal da Transparência — Sanções (CPF)",
   "CGU — Servidores Federais"].forEach((nome) => {
    const link = get(nome);
    if (link) {
      r.push(toResultado(link, {
        tipo: "governo", risco: "baixo",
        resumo: `Nada identificado em ${nome} para ${c.rf_nome_oficial} / ${c.full_name_pf} (CNPJ ${c.cnpj}, CPF ${c.cpf}).`,
      }));
    }
  });

  // ===== Receita / QSA — esses são links de validação cadastral, não pesquisa adversa =====
  ["Receita Federal — Comprovante CNPJ",
   "Casa dos Dados — CNPJ + Sócios",
   "BrasilAPI — CNPJ (JSON)"].forEach((nome) => {
    const link = get(nome);
    if (link) {
      r.push(toResultado(link, {
        tipo: "societario", risco: "baixo",
        resumo: `${nome}: confirmar situação cadastral, QSA e atividade do CNPJ ${c.cnpj} (${c.rf_nome_oficial}).`,
      }));
    }
  });

  // ===== TCE estadual =====
  const tce = get(`TCE-${c.uf} — busca interna`);
  if (tce) {
    r.push(toResultado(tce, {
      tipo: "governo", risco: "baixo",
      resumo: `Nada identificado no TCE-${c.uf} para ${c.full_name_pf} (${c.cidade}/${c.uf}). Link aberto para validação.`,
    }));
  }

  // ===== ALE / Câmara Municipal =====
  const ale = get(`Câmara/ALE-${c.uf} — Portal de Transparência`);
  if (ale) {
    r.push(toResultado(ale, {
      tipo: "governo", risco: "baixo",
      resumo: `Validar atuação parlamentar de ${cargoOrgao.nomePEP} (${cargoOrgao.cargo}, ${c.uf}) no portal Câmara/ALE-${c.uf}.`,
    }));
  }

  // ===== DOU =====
  const dou = get("Diário Oficial da União (DOU)");
  if (dou) {
    r.push(toResultado(dou, {
      tipo: "governo", risco: "baixo",
      resumo: `Nada identificado no DOU para ${c.full_name_pf} (CPF ${c.cpf}). Link aberto para validação.`,
    }));
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
  const isCtxRegional = (f: MediaFinding) =>
    !!(f.match?.includes("M7") || f.homonimo_alerta?.includes("Contexto regional"));
  const altoExterno = findings.some((f) => f.risk_indicator === "alto" && !isCtxRegional(f));
  const homonimo = findings.some((f) => f.homonimo_alerta && !isCtxRegional(f));

  const cpfPepInfo = tipoPep === "relacionado" && cargoOrgao.cpfTitular
    ? ` (CPF PEP: ${cargoOrgao.cpfTitular})`
    : "";
  const inicio = tipoPep === "titular"
    ? `Owner ${c.full_name_pf} é o PEP titular (${cargoOrgao.cargo}).`
    : `Owner ${c.full_name_pf} é vínculo de PEP titular: ${cargoOrgao.nomePEP}${cpfPepInfo} (${cargoOrgao.cargo}).`;

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

  return [inicio, meio, fim].join(" ");
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
