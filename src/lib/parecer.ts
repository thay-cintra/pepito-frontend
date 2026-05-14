import type { Analise, ClienteData, ResultadoPesquisa, StatusAnalise } from "@/types/kyc";

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

function templateAprovado(c: ClienteData): string {
  return (
    `O único fator de risco é o relacionamento com PEP. Contudo, a atividade econômica da empresa (${c.cnae || "—"}) ` +
    `é de baixo risco para crimes de lavagem de dinheiro ou corrupção, sem aparente conflito de interesses ` +
    `com o cargo político ${c.tipoPep === "relacionado" ? "do parente" : "exercido"}. ` +
    `A ausência total de sanções, processos por improbidade ou mídia adversa para a empresa, seu titular e ` +
    `o PEP ${c.tipoPep === "relacionado" ? "relacionado" : "titular"}, mitiga significativamente o risco inicial.\n\n` +
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

function templateFalsoPositivo(c: ClienteData): string {
  const titular = c.nomeResponsavel || c.nomePessoaVinculada || "—";
  const cpf = c.cpfResponsavel || "—";
  return (
    `Após dupla verificação junto à base Credilink (Tessera) e varredura em fontes públicas ` +
    `(mídia, processos judiciais, sanções e contratos públicos), não foi confirmado vínculo ` +
    `com Pessoa Politicamente Exposta para o titular ${titular} (CPF ${cpf}). ` +
    `O acionamento da fila PLD decorreu de coincidência cadastral ou similaridade de dados, ` +
    `não se sustentando após investigação aprofundada.\n\n` +
    `Em análises reputacionais conduzidas para a empresa ${c.razaoSocial} (CNPJ ${c.cnpj}), ` +
    `não foram identificadas mídias adversas, processos por improbidade, sanções em listas ` +
    `restritivas ou contratos públicos que justifiquem restrição ao relacionamento.\n\n` +
    `Diante da ausência de vínculo PEP confirmado e da inexistência de achados adversos ` +
    `relevantes sob a ótica de PLD/FT, o caso é classificado como FALSO POSITIVO. ` +
    `Recomendo a APROVAÇÃO DO CADASTRO sem inclusão em monitoramento reforçado por ` +
    `característica PEP, seguindo fluxo padrão de monitoramento transacional, ` +
    `conforme Política PLD/FT vigente e Circular BACEN 3.978/2020.`
  );
}

function corpoTemplate(c: ClienteData, status: StatusAnalise): string {
  switch (status) {
    case "reprovado":
      return templateReprovado(c);
    case "falso_positivo":
      return templateFalsoPositivo(c);
    case "aprovado":
      return templateAprovado(c);
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
}): string {
  const { cliente, status, resultados, analiseConsolidada, parecerPrimeiraCamada } = params;
  const today = new Date().toLocaleDateString("pt-BR");

  const altoRisco = resultados.filter((r) => !r.descartado && r.risco === "alto").length;
  const medioRisco = resultados.filter((r) => !r.descartado && r.risco === "medio").length;

  const cabecalho = `Decisão: ${STATUS_LABEL[status]}\nCNPJ: ${cliente.cnpj} — ${cliente.razaoSocial}`;

  return [
    cabecalho,
    ``,
    corpoTemplate(cliente, status),
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
