import type { Analise, ClienteData, ResultadoPesquisa, StatusAnalise } from "@/types/kyc";
import type { ConsultaStatus } from "@/data/registration-enrich";

const STATUS_LABEL: Record<StatusAnalise, string> = {
  aprovado: "CADASTRO APROVADO",
  reprovado: "CADASTRO REPROVADO",
  monitoramento: "CADASTRO APROVADO SOB MONITORAMENTO REFORÇADO",
  falso_positivo: "FALSO POSITIVO — CADASTRO APROVADO",
};

export function statusLabel(s: StatusAnalise): string {
  return STATUS_LABEL[s];
}

/**
 * Templates de Parecer da Liderança — fixados a partir de exemplares reais da
 * área de Compliance/PLD da Cora. Cada template é parametrizado pelo cadastro
 * para soar específico ao caso, mantendo o vocabulário, tom e fundamentação
 * da diretora/lideranca.
 */
function templateReprovado(c: ClienteData): string {
  const cidadeUf = c.enderecoComercial.match(/([A-Za-zÀ-ú\s]+)\/([A-Z]{2})/)?.[0] || c.enderecoComercial || "";
  return (
    `A análise evidencia uma convergência de fatores de risco elevado. A atividade econômica de '${c.cnae || "—"}' ` +
    `e a sede da empresa ${cidadeUf ? `na mesma cidade de sua atuação política (${cidadeUf})` : "na localidade declarada"} ` +
    `criam um cenário de alto risco para conflito de interesses. Apesar da ausência de mídia adversa ou sanções no momento, ` +
    `a estrutura societária e operacional é considerada de altíssimo risco.\n\n` +
    `Diante dos fatores de risco identificados, recomendo a NÃO APROVAÇÃO do relacionamento comercial, ` +
    `por incompatibilidade com o apetite de risco da instituição, conforme Circular BACEN 3.978/2020.`
  );
}

function templateAprovado(c: ClienteData, achadosRelevantes: ResultadoPesquisa[]): string {
  const clausulaAchados = achadosRelevantes.length === 0
    ? `A ausência total de sanções, processos por improbidade ou mídia adversa para a empresa, seu titular e ` +
      `o PEP ${c.tipoPep === "relacionado" ? "relacionado" : "titular"}, mitiga significativamente o risco inicial.`
    : `Foram identificados ${achadosRelevantes.length} apontamento(s) de risco médio/alto (${achadosRelevantes
        .slice(0, 3)
        .map((r) => r.fonte)
        .join(", ")}${achadosRelevantes.length > 3 ? ", entre outros" : ""}) — revisados e considerados não impeditivos ` +
      `para a decisão abaixo, mas que devem ser conferidos antes de finalizar.`;
  return (
    `O único fator de risco estrutural é o relacionamento com PEP. A atividade econômica da empresa (${c.cnae || "—"}) ` +
    `é de baixo risco para crimes de lavagem de dinheiro ou corrupção, sem aparente conflito de interesses ` +
    `com o cargo político ${c.tipoPep === "relacionado" ? "do parente" : "exercido"}. ` +
    `${clausulaAchados}\n\n` +
    `Após análise aprofundada, os apontamentos não configuram risco impeditivo. ` +
    `Recomendo a APROVAÇÃO DO CADASTRO conforme política PLD/FT vigente.`
  );
}

function templateMonitoramento(c: ClienteData): string {
  const parentesco = c.tipoPep === "relacionado" ? "parentesco próximo" : "exercício direto de cargo público pelo titular";
  return (
    `A combinação de ${parentesco}, sobreposição geográfica e temporal entre a atividade empresarial ` +
    `(${c.cnae || "—"}) e o mandato político ${c.cargoPep ? `(${c.cargoPep})` : ""}, somada ao histórico do PEP, ` +
    `eleva o risco de conflito de interesses.\n\n` +
    `Recomendo a APROVAÇÃO SOB MONITORAMENTO REFORÇADO, com revisão periódica dos fatores de risco, ` +
    `conforme Circular BACEN 3.978/2020.`
  );
}

function templateFalsoPositivo(c: ClienteData, achadosRelevantes: ResultadoPesquisa[]): string {
  const titular = c.nomeResponsavel || c.nomePessoaVinculada || "—";
  const cpf = c.cpfResponsavel || "—";
  const clausulaAchados = achadosRelevantes.length === 0
    ? `não foram identificadas mídias adversas, processos por improbidade, sanções em listas ` +
      `restritivas ou contratos públicos que justifiquem restrição ao relacionamento.`
    : `⚠️ foram identificados ${achadosRelevantes.length} apontamento(s) de risco médio/alto (${achadosRelevantes
        .slice(0, 3)
        .map((r) => r.fonte)
        .join(", ")}) — CONFERIR antes de confirmar falso positivo, pois esse número diverge do ` +
      `esperado para essa classificação.`;
  return (
    `Após dupla verificação junto à base Credilink (Tessera) e varredura em fontes públicas ` +
    `(mídia, processos judiciais, sanções e contratos públicos), não foi confirmado vínculo ` +
    `com Pessoa Politicamente Exposta para o titular ${titular} (CPF ${cpf}). ` +
    `O acionamento da fila PLD decorreu de coincidência cadastral ou similaridade de dados, ` +
    `não se sustentando após investigação aprofundada.\n\n` +
    `Em análises reputacionais conduzidas para a empresa ${c.razaoSocial} (CNPJ ${c.cnpj}), ${clausulaAchados}\n\n` +
    `Diante da ausência de vínculo PEP confirmado, o caso é classificado como FALSO POSITIVO. ` +
    `Recomendo a APROVAÇÃO DO CADASTRO sem inclusão em monitoramento reforçado por ` +
    `característica PEP, seguindo fluxo padrão de monitoramento transacional, ` +
    `conforme Política PLD/FT vigente e Circular BACEN 3.978/2020.`
  );
}

function corpoTemplate(c: ClienteData, status: StatusAnalise, resultados: ResultadoPesquisa[]): string {
  // Achados que uma alegação de "ausência total" precisa respeitar: reais
  // (não descartados) e CONFIRMADOS (não pendente_verificacao — deep-link
  // nunca aberto não é achado, é só um link). Risco "baixo" NÃO é excluído:
  // um processo cível/trabalhista real do Tesserati (risco baixo, mas achado
  // de fato confirmado) contradiz "ausência total" tanto quanto um achado de
  // risco alto — a v1 deste filtro excluía todo risco baixo e continuava
  // deixando esses achados reais invisíveis pro parecer (achado Codex #8,
  // 2026-09-11, revisão da correção anterior).
  const achadosRelevantes = resultados.filter((r) => !r.descartado && !r.pendente_verificacao);
  switch (status) {
    case "reprovado":
      return templateReprovado(c);
    case "falso_positivo":
      return templateFalsoPositivo(c, achadosRelevantes);
    case "aprovado":
      return templateAprovado(c, achadosRelevantes);
    case "monitoramento":
    default:
      return templateMonitoramento(c);
  }
}

export function gerarParecerLideranca(params: {
  cliente: ClienteData;
  status: StatusAnalise;
  resultados: ResultadoPesquisa[];
  analiseConsolidada: string;
  parecerPrimeiraCamada: string;
  consultaStatus?: ConsultaStatus | null;
}): string {
  const { cliente, status, resultados, analiseConsolidada, parecerPrimeiraCamada, consultaStatus } = params;
  const today = new Date().toLocaleDateString("pt-BR");

  const altoRisco = resultados.filter((r) => !r.descartado && r.risco === "alto").length;
  const medioRisco = resultados.filter((r) => !r.descartado && r.risco === "medio").length;

  const cabecalho = `Decisão: ${STATUS_LABEL[status]}\nCNPJ: ${cliente.cnpj} — ${cliente.razaoSocial}`;

  // Template afirma "dupla verificação junto à Credilink"/"varredura em
  // fontes públicas" incondicionalmente — se a consulta real está pendente
  // (ver getConsultaStatus), isso é falso. Prepend um aviso em vez de deixar
  // a alegação incorreta passar (achado Codex #8, 2026-09-11).
  const avisoConsultaPendente = consultaStatus && !consultaStatus.tudoOk
    ? [
        `⚠️ ATENÇÃO: consulta real pendente no momento da geração deste parecer — ` +
        `${!consultaStatus.jusbrasilOk ? consultaStatus.jusbrasilMotivo : ""} ${!consultaStatus.credilinkPepOk ? consultaStatus.credilinkPepMotivo : ""}`.trim(),
        ``,
      ]
    : [];

  return [
    cabecalho,
    ``,
    ...avisoConsultaPendente,
    corpoTemplate(cliente, status, resultados),
    ``,
    `---`,
    `**Data da Análise:** ${today}`,
    `**Vinculação PEP:** ${cliente.tipoPep === "titular" ? "titular" : "relacionado"} — ${cliente.nomePessoaVinculada || cliente.nomeResponsavel} ` +
      `(${cliente.cargoPep || "cargo não informado"}, ${cliente.orgaoPublico || "órgão não informado"}).`,
    `**Apontamentos coletados:** ${resultados.length} (alto: ${altoRisco}, médio: ${medioRisco}).`,
    analiseConsolidada ? `**Análise consolidada da Liderança:** ${analiseConsolidada}` : "",
    parecerPrimeiraCamada ? `**Parecer da 1ª Camada:** ${parecerPrimeiraCamada}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function exportarAnaliseTexto(a: Analise): string {
  const linhas = [
    `===== Análise Pepito =====`,
    `ID: ${a.id}`,
    `Data: ${new Date(a.data).toLocaleString("pt-BR")}`,
    `CNPJ: ${a.cliente.cnpj}`,
    `Razão Social: ${a.cliente.razaoSocial}`,
    `PEP (${a.cliente.tipoPep}): ${a.cliente.nomePessoaVinculada || a.cliente.nomeResponsavel}`,
    `Cargo: ${a.cliente.cargoPep} — ${a.cliente.orgaoPublico}`,
    `Status: ${STATUS_LABEL[a.status]}`,
    ``,
    `--- Parecer 1ª Camada ---`,
    a.parecerPrimeiraCamada || "—",
    ``,
    `--- Parecer Final ---`,
    a.parecerCompleto || "—",
    ``,
    `--- Resultados (${a.resultadosPesquisa.length}) ---`,
    ...a.resultadosPesquisa.map(
      (r, i) =>
        `${i + 1}. [${r.risco.toUpperCase()}] (${r.tipo}) ${r.fonte} — ${r.resumo}` +
        (r.link ? `\n   ${r.link}` : "") +
        (r.descartado ? `\n   [DESCARTADO] ${r.motivoDescarte ?? ""}` : ""),
    ),
  ];
  return linhas.join("\n");
}
