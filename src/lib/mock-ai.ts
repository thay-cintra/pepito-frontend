import type { ClienteData, ResultadoPesquisa, StatusAnalise, Socio } from "@/types/kyc";
import { buscarPEP } from "./pep-data";
import { uid, normalizeName } from "./utils";

// Determinismo: mesmo CNPJ + mesmo nome PEP = mesmos resultados.
function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

const CNAES_RISCO = ["7112-0/00", "4120-4/00", "8550-3/02", "9499-5/00", "7020-4/00"];
const ORGAOS_GENERICOS = ["Câmara dos Deputados", "Senado Federal", "TCE", "Prefeitura", "Assembleia Legislativa"];

interface PesquisaParams {
  cliente: ClienteData;
  observacoesAnalista?: string;
}

export interface PesquisaResultado {
  resultados: ResultadoPesquisa[];
  analiseGeral: string;
  recomendacao: StatusAnalise;
  qsa: Socio[];
}

/**
 * Simula a Edge Function `kyc-due-diligence` (2ª camada) e
 * `gerar-parecer-primeira-camada` quando chamada pela 1ª.
 * Resultados determinísticos baseados em CNPJ + nome PEP.
 */
export async function pesquisarFontesPublicas(
  params: PesquisaParams,
): Promise<PesquisaResultado> {
  // Latência simulada (1.0s a 1.6s)
  const latency = 1000 + Math.floor(Math.random() * 600);
  await new Promise((res) => setTimeout(res, latency));

  const { cliente, observacoesAnalista } = params;
  const seed = seedFromString(`${cliente.cnpj}|${cliente.nomePessoaVinculada}|${cliente.cargoPep}`);
  const r = rng(seed);
  const nomePep = cliente.nomePessoaVinculada || cliente.nomeResponsavel || "PEP não informado";

  const pepRecord = buscarPEP(nomePep);
  const cnaeRisco = CNAES_RISCO.includes((cliente.cnae || "").trim());
  const empresaNova =
    cliente.dataConstituicao &&
    new Date(cliente.dataConstituicao).getTime() > Date.now() - 1000 * 60 * 60 * 24 * 365 * 2;

  const resultados: ResultadoPesquisa[] = [];

  // PEP — base local
  if (pepRecord) {
    resultados.push({
      id: uid(),
      fonte: pepRecord.fonte + " — TSE/Diário Oficial",
      resumo: `${pepRecord.nome} consta como ${pepRecord.cargo} (${pepRecord.orgao}, ${pepRecord.uf}), mandato ${pepRecord.inicioMandato} a ${pepRecord.fimMandato}.`,
      tipo: "pep",
      risco: "alto",
      link: `https://www.tse.jus.br/eleicoes/eleitos`,
      similaridade_nome: "100%",
    });
  } else {
    resultados.push({
      id: uid(),
      fonte: "Base PEP unificada (Nov/Dez 2025 + Jan 2026)",
      resumo: `Nome "${nomePep}" não encontrado em base PEP local com match exato. Recomendado verificar fontes secundárias.`,
      tipo: "pep",
      risco: "baixo",
      pendente_verificacao: true,
      similaridade_nome: "0%",
    });
  }

  // Mídia nacional
  const seedMedia = r();
  if (seedMedia > 0.55 || cnaeRisco) {
    resultados.push({
      id: uid(),
      fonte: "Folha de S.Paulo — Política",
      resumo: `Reportagem cita ${nomePep} em contexto de obras públicas municipais; sem indiciamento formal.`,
      tipo: "midia",
      risco: cnaeRisco ? "alto" : "medio",
      link: `https://www.folha.uol.com.br/buscar?q=${encodeURIComponent(nomePep)}`,
      similaridade_nome: "98%",
    });
  } else {
    resultados.push({
      id: uid(),
      fonte: "G1 / Globo",
      resumo: `Não foram localizadas matérias desabonadoras sobre ${nomePep} no período analisado.`,
      tipo: "midia",
      risco: "baixo",
      link: `https://g1.globo.com/busca/?q=${encodeURIComponent(nomePep)}`,
      similaridade_nome: "100%",
    });
  }

  // Mídia regional / blog político local — combinando nome + município + cargo
  if (pepRecord) {
    const queryRegional = `${nomePep} ${pepRecord.orgao || ""} ${pepRecord.cargo || ""}`.trim();
    const regionalRisco = r() > 0.7 ? "alto" : r() > 0.4 ? "medio" : "baixo";
    resultados.push({
      id: uid(),
      fonte: `Imprensa regional — blogs políticos ${pepRecord.uf || ""}`,
      resumo: `Varredura por nome + município (${pepRecord.orgao}) + cargo (${pepRecord.cargo}) + período do mandato em portais locais e blogs jornalísticos do estado. ${
        regionalRisco === "alto"
          ? `Possíveis matérias adversas localizadas — verificar manualmente.`
          : `Sem matérias adversas materiais identificadas no período do mandato.`
      }`,
      tipo: "midia",
      risco: regionalRisco,
      link: `https://www.google.com/search?q=${encodeURIComponent(queryRegional + " cassação OR improbidade OR operação")}`,
      similaridade_nome: "98%",
    });
  }

  // TRE — Justiça Eleitoral (cassação, desincompatibilização, contas de campanha)
  if (pepRecord && pepRecord.uf) {
    resultados.push({
      id: uid(),
      fonte: `TRE-${pepRecord.uf} — Justiça Eleitoral`,
      resumo: `Consulta ao TRE-${pepRecord.uf} sobre ${nomePep} (cassação, desincompatibilização, prestação de contas, processos eleitorais). Sem decisões adversas localizadas no período.`,
      tipo: "governo",
      risco: "baixo",
      link: `https://www.google.com/search?q=TRE+${pepRecord.uf}+${encodeURIComponent(nomePep)}+cassa%C3%A7%C3%A3o`,
      similaridade_nome: "100%",
    });
  }

  // MP estadual — improbidade administrativa
  if (pepRecord && pepRecord.uf) {
    resultados.push({
      id: uid(),
      fonte: `MP-${pepRecord.uf} — Improbidade`,
      resumo: `Consulta ao Ministério Público de ${pepRecord.uf} para ${nomePep}: sem ações de improbidade administrativa registradas.`,
      tipo: "governo",
      risco: "baixo",
      link: `https://www.google.com/search?q=mp${(pepRecord.uf || "").toLowerCase()}+${encodeURIComponent(nomePep)}+improbidade`,
      similaridade_nome: "100%",
    });
  }

  // Câmara Municipal / Assembleia Legislativa — atas, processos
  if (pepRecord && pepRecord.orgao) {
    resultados.push({
      id: uid(),
      fonte: `Câmara/ALE — ${pepRecord.orgao}`,
      resumo: `Atas e registros oficiais do mandato de ${nomePep} em ${pepRecord.orgao}: sem processos disciplinares ou cassação localizados.`,
      tipo: "governo",
      risco: "baixo",
      link: `https://www.google.com/search?q=${encodeURIComponent("câmara " + pepRecord.orgao + " " + nomePep)}`,
      similaridade_nome: "100%",
    });
  }

  // Polícia Federal / Civil — operações nominais
  resultados.push({
    id: uid(),
    fonte: "Polícia Federal / Civil — operações",
    resumo: `Busca por ${nomePep} em listas de operações nominais (PF/PC) no período do mandato: sem citações.`,
    tipo: "processo",
    risco: r() > 0.85 ? "alto" : "baixo",
    link: `https://www.google.com/search?q=${encodeURIComponent("operação policial " + nomePep)}`,
    similaridade_nome: "98%",
  });

  // Processos
  if (r() > 0.6) {
    resultados.push({
      id: uid(),
      fonte: "JusBrasil",
      resumo: `Localizado processo cível envolvendo ${nomePep}; matéria sem condenação transitada em julgado.`,
      tipo: "processo",
      risco: "medio",
      link: `https://www.jusbrasil.com.br/busca?q=${encodeURIComponent(nomePep)}`,
      similaridade_nome: "97%",
    });
  } else {
    resultados.push({
      id: uid(),
      fonte: "CNJ — Cadastro de Improbidade",
      resumo: `Sem condenações registradas para ${nomePep} no Cadastro Nacional de Improbidade Administrativa.`,
      tipo: "processo",
      risco: "baixo",
      link: `https://www.cnj.jus.br/improbidade_adm/consultar_requerido.php`,
      similaridade_nome: "100%",
    });
  }

  // Sanções
  resultados.push({
    id: uid(),
    fonte: "Portal da Transparência — CEIS/CNEP/CEPIM",
    resumo: `${cliente.razaoSocial} (${cliente.cnpj}) sem registros em listas de sanções.`,
    tipo: "governo",
    risco: "baixo",
    link: `https://portaldatransparencia.gov.br/sancoes/consulta?cadastro=&cpfCnpj=${cliente.cnpj.replace(/\D/g, "")}`,
    similaridade_nome: "100%",
  });

  // Endereço
  resultados.push({
    id: uid(),
    fonte: "Casa dos Dados / Receita Federal",
    resumo: `Endereço comercial "${cliente.enderecoComercial || "—"}" verificado contra base de partidos e comitês políticos: sem coincidências diretas.`,
    tipo: "endereco",
    risco: "baixo",
    link: `https://casadosdados.com.br/solucao/cnpj/${cliente.cnpj.replace(/\D/g, "")}`,
    similaridade_nome: "100%",
  });

  // QSA — sócios mockados (reproduzíveis)
  const qsa: Socio[] = (cliente.socios && cliente.socios.length > 0
    ? cliente.socios
    : [
        { nome: cliente.nomeResponsavel || "Sócio Administrador", cpf: cliente.cpfResponsavel || "000.000.000-00", participacao: "70%" },
        { nome: `Sócio ${pick(["Comercial", "Financeiro"], r)}`, cpf: "111.111.111-11", participacao: "30%" },
      ]
  ).slice(0, 5);

  resultados.push({
    id: uid(),
    fonte: "BrasilAPI / Receita Federal",
    resumo: `Quadro societário (${qsa.length} sócios): ${qsa.map((s) => s.nome).join(", ")}.`,
    tipo: "societario",
    risco: qsa.length >= 3 ? "medio" : "baixo",
    link: `https://brasilapi.com.br/api/cnpj/v1/${cliente.cnpj.replace(/\D/g, "")}`,
    similaridade_nome: "100%",
  });

  // TCE — se PEP estadual
  if (pepRecord && pepRecord.uf) {
    resultados.push({
      id: uid(),
      fonte: `TCE-${pepRecord.uf}`,
      resumo: `Consulta ao TCE-${pepRecord.uf} para ${nomePep}: sem julgamentos com reprovação de contas registrados.`,
      tipo: "governo",
      risco: "baixo",
      link: `https://www.google.com/search?q=TCE+${pepRecord.uf}+${encodeURIComponent(nomePep)}`,
      similaridade_nome: "100%",
    });
  }

  if (observacoesAnalista && observacoesAnalista.trim().length > 0) {
    resultados.push({
      id: uid(),
      fonte: "Observação do Analista — direcionamento",
      resumo: `Direcionamento prioritário: "${observacoesAnalista.trim().slice(0, 200)}".`,
      tipo: "midia",
      risco: "medio",
      similaridade_nome: "100%",
    });
  }

  // Recomendação determinística
  const altos = resultados.filter((x) => x.risco === "alto").length;
  const medios = resultados.filter((x) => x.risco === "medio").length;
  let recomendacao: StatusAnalise = "aprovado";
  if (altos >= 2) recomendacao = "reprovado";
  else if (altos === 1 || medios >= 2) recomendacao = "monitoramento";
  else if (!pepRecord) recomendacao = "falso_positivo";

  // Análise geral cruzando fatores
  const cruzamentos: string[] = [];
  if (empresaNova && pepRecord) {
    cruzamentos.push(
      `Empresa constituída há menos de 2 anos durante mandato ativo do PEP — atenção redobrada à racionalidade econômica.`,
    );
  }
  if (cnaeRisco) {
    cruzamentos.push(
      `CNAE ${cliente.cnae} é sensível (engenharia/consultoria/ONG) — risco de conflito de interesses com a função pública.`,
    );
  }
  if (pepRecord && cliente.enderecoComercial?.includes(pepRecord.uf)) {
    cruzamentos.push(
      `Endereço comercial em ${pepRecord.uf} coincide com UF de atuação pública do PEP.`,
    );
  }
  if (cruzamentos.length === 0) {
    cruzamentos.push(`Ausência de fatores cruzados de risco material entre PEP, CNAE, endereço e capital.`);
  }

  const analiseGeral =
    `Análise consolidada de ${resultados.filter((r) => !r.descartado).length} achados. ` +
    `${altos} de risco ALTO, ${medios} de risco MÉDIO. ` +
    cruzamentos.join(" ") +
    ` Recomendação: ${recomendacao.toUpperCase()}.`;

  return { resultados, analiseGeral, recomendacao, qsa };
}

/** Simula `consolidar-parecer-lideranca` */
export async function consolidarParecerLideranca(params: {
  cliente: ClienteData;
  resultados: ResultadoPesquisa[];
  parecerPrimeiraCamada: string;
}): Promise<string> {
  await new Promise((res) => setTimeout(res, 900));
  const { cliente, resultados } = params;
  const altos = resultados.filter((r) => !r.descartado && r.risco === "alto").length;
  const medios = resultados.filter((r) => !r.descartado && r.risco === "medio").length;
  const pep = buscarPEP(cliente.nomePessoaVinculada || cliente.nomeResponsavel);

  return [
    `1) Identidade: ${pep ? "PEP CONFIRMADO em base unificada (match exato)" : "PEP não confirmado em base local — verificar fontes secundárias"}.`,
    `2) Materialidade: ${altos} achado(s) de risco alto e ${medios} de risco médio sobre o cadastro.`,
    `3) Cruzamento: relacionamento ${cliente.tipoPep === "titular" ? "TITULAR" : "RELACIONADO"} ` +
      `+ CNAE ${cliente.cnae || "não informado"} + endereço ${cliente.enderecoComercial || "—"}.`,
    `4) Apetite de risco: ${altos >= 2 ? "INCOMPATÍVEL" : altos >= 1 || medios >= 2 ? "COMPATÍVEL com monitoramento reforçado" : "COMPATÍVEL com aprovação"}.`,
    `5) Justificativa técnica: ${altos >= 2 ? "Reprovação fundamentada em concentração de achados de alto risco." : altos >= 1 || medios >= 2 ? "Aprovação sob monitoramento reforçado, com revisão semestral." : "Aprovação simples, sem ressalvas materiais identificadas."}`,
  ].join(" ");
}

/** Simula `reanalisar-resultado` — analista fornece input e a IA devolve resultado refinado. */
export interface CredilinkResultado {
  numeroToken: string;
  linkDossie: string;
  consultadoEm: string;
  nomeConsultado: string;
}

/**
 * Simula a consulta à API da Credilink/Tessera para geração de token e dossiê
 * a partir do CPF do PEP titular. Determinístico: mesmo CPF → mesmo token.
 * Latência simulada de 1.2–1.8s.
 */
export async function consultarCredilink(cpfPep: string, nomePep: string): Promise<CredilinkResultado> {
  const cpfDigits = cpfPep.replace(/\D/g, "");
  const seed = seedFromString(cpfDigits);
  const r = rng(seed);

  // Simula latência de API externa
  const latencia = 1200 + Math.floor(r() * 600);
  await new Promise((res) => setTimeout(res, latencia));

  // Token determinístico baseado no CPF
  const tokenSuffix = (seed % 100000000).toString().padStart(8, "0");
  const ano = new Date().getFullYear();
  const numeroToken = `TK-${ano}-${tokenSuffix}`;

  // Link do dossiê
  const dossieHash = cpfDigits.split("").reverse().join("") + tokenSuffix.slice(0, 6);
  const linkDossie = `https://tessera.credilink.com.br/dossies/${dossieHash}`;

  return {
    numeroToken,
    linkDossie,
    consultadoEm: new Date().toISOString(),
    nomeConsultado: nomePep,
  };
}

export async function reanalisarResultado(params: {
  resultado: ResultadoPesquisa;
  observacao: string;
  cliente: ClienteData;
}): Promise<ResultadoPesquisa> {
  await new Promise((res) => setTimeout(res, 700));
  const { resultado, observacao, cliente } = params;
  const obs = observacao.trim();
  const lower = obs.toLowerCase();

  // Heurística simples para o protótipo
  if (lower.includes("homônimo") || lower.includes("homonimo") || lower.includes("descart")) {
    return {
      ...resultado,
      descartado: true,
      motivoDescarte: `Descartado por análise do analista: "${obs.slice(0, 200)}".`,
    };
  }
  if (lower.includes("alto") || lower.includes("grave")) {
    return { ...resultado, risco: "alto", resumo: `${resultado.resumo} [Reanálise: ${obs.slice(0, 120)}]` };
  }
  if (lower.includes("baixo") || lower.includes("falso positivo")) {
    return { ...resultado, risco: "baixo", resumo: `${resultado.resumo} [Reanálise: ${obs.slice(0, 120)}]` };
  }
  return {
    ...resultado,
    resumo: `${resultado.resumo} [Reanálise (${cliente.razaoSocial}): ${obs.slice(0, 160)}]`,
    pendente_verificacao: false,
  };
}
