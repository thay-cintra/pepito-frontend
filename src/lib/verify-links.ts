/**
 * Gerador de deep-links parametrizados para verificação KYC/PLD de PEP.
 *
 * Cada link aponta para a busca pré-preenchida em uma fonte pública específica.
 * O analista clica e vê o resultado real — nada é fabricado, apenas roteado.
 *
 * Cobertura:
 *   - Eleitoral: TSE Divulgação de Candidaturas (filiações, candidaturas, eleitos)
 *   - Sanções: Portal da Transparência (CEIS/CNEP/CEPIM/Sanções), CGU servidores
 *   - Receita / QSA: Receita Federal, Casa dos Dados, BrasilAPI
 *   - Justiça: CNJ Improbidade, JusBrasil, Escavador, TCU acórdãos
 *   - Diário Oficial: DOU (busca textual)
 *   - Mídia confiável: Folha, G1/Globo, Estadão, Metropoles, Poder360, Intercept,
 *     Valor, ConJur, BBC Brasil, Carta Capital
 *   - Estaduais por UF: TCE, TJ, MP, ALE (via site:search Google e portal direto)
 */

export interface VerifyLinksParams {
  cnpj: string;
  cpf: string;
  fullNamePf: string;
  rfNome: string;
  uf: string;
  cidade: string;
  cargoPep: string;
  orgaoPublico: string;
}

export type LinkCategoria =
  | "Eleitoral"
  | "Sanções"
  | "Receita / QSA"
  | "Justiça"
  | "Diário Oficial"
  | "Mídia"
  | "Estadual";

export interface VerifyLink {
  fonte: string;
  categoria: LinkCategoria;
  url: string;
  descricao: string;
}

const TCE_DOMAIN: Record<string, string> = {
  AC: "tceac.tc.br", AL: "tce.al.gov.br", AM: "tce.am.gov.br", AP: "tce.ap.gov.br",
  BA: "tce.ba.gov.br", CE: "tce.ce.gov.br", DF: "tc.df.gov.br", ES: "tcees.tc.br",
  GO: "tce.go.gov.br", MA: "tce.ma.gov.br", MG: "tce.mg.gov.br", MS: "tce.ms.gov.br",
  MT: "tce.mt.gov.br", PA: "tce.pa.gov.br", PB: "tce.pb.gov.br", PE: "tce.pe.gov.br",
  PI: "tce.pi.gov.br", PR: "tce.pr.gov.br", RJ: "tce.rj.gov.br", RN: "tce.rn.gov.br",
  RO: "tce.ro.gov.br", RR: "tce.rr.gov.br", RS: "tce.rs.gov.br", SC: "tcesc.tc.br",
  SE: "tce.se.gov.br", SP: "tce.sp.gov.br", TO: "tce.to.gov.br",
};

const TJ_DOMAIN: Record<string, string> = {
  AC: "tjac.jus.br", AL: "tjal.jus.br", AM: "tjam.jus.br", AP: "tjap.jus.br",
  BA: "tjba.jus.br", CE: "tjce.jus.br", DF: "tjdft.jus.br", ES: "tjes.jus.br",
  GO: "tjgo.jus.br", MA: "tjma.jus.br", MG: "tjmg.jus.br", MS: "tjms.jus.br",
  MT: "tjmt.jus.br", PA: "tjpa.jus.br", PB: "tjpb.jus.br", PE: "tjpe.jus.br",
  PI: "tjpi.jus.br", PR: "tjpr.jus.br", RJ: "tjrj.jus.br", RN: "tjrn.jus.br",
  RO: "tjro.jus.br", RR: "tjrr.jus.br", RS: "tjrs.jus.br", SC: "tjsc.jus.br",
  SE: "tjse.jus.br", SP: "tjsp.jus.br", TO: "tjto.jus.br",
};

const MP_DOMAIN: Record<string, string> = {
  AC: "mpac.mp.br", AL: "mpal.mp.br", AM: "mpam.mp.br", AP: "mpap.mp.br",
  BA: "mpba.mp.br", CE: "mpce.mp.br", DF: "mpdft.mp.br", ES: "mpes.mp.br",
  GO: "mpgo.mp.br", MA: "mpma.mp.br", MG: "mpmg.mp.br", MS: "mpms.mp.br",
  MT: "mpmt.mp.br", PA: "mppa.mp.br", PB: "mppb.mp.br", PE: "mppe.mp.br",
  PI: "mppi.mp.br", PR: "mppr.mp.br", RJ: "mprj.mp.br", RN: "mprn.mp.br",
  RO: "mpro.mp.br", RR: "mprr.mp.br", RS: "mprs.mp.br", SC: "mpsc.mp.br",
  SE: "mpse.mp.br", SP: "mpsp.mp.br", TO: "mpto.mp.br",
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function siteSearch(domain: string, query: string): string {
  return `https://www.google.com/search?q=site%3A${encodeURIComponent(domain)}+%22${encodeURIComponent(query)}%22`;
}

function publisherSearch(searchUrl: string, name: string): string {
  return searchUrl.replace("{q}", encodeURIComponent(name));
}

const PUBLISHERS: Array<{ name: string; url: string }> = [
  { name: "Folha de S.Paulo", url: "https://search.folha.uol.com.br/?q={q}&site=todos" },
  { name: "G1 / Globo",       url: "https://g1.globo.com/busca/?q={q}" },
  { name: "Estadão",          url: "https://busca.estadao.com.br/?q={q}" },
  { name: "Metrópoles",       url: "https://www.metropoles.com/?s={q}" },
  { name: "Poder360",         url: "https://www.poder360.com.br/?s={q}" },
  { name: "The Intercept BR", url: "https://www.intercept.com.br/?s={q}" },
  { name: "Valor Econômico",  url: "https://valor.globo.com/busca/?q={q}" },
  { name: "ConJur",           url: "https://www.conjur.com.br/?s={q}" },
  { name: "Carta Capital",    url: "https://www.cartacapital.com.br/?s={q}" },
  { name: "BBC Brasil",       url: "https://www.bbc.com/portuguese/topics/c2dwqdl5e9zt?q={q}" },
];

export function buildVerifyLinks(p: VerifyLinksParams): VerifyLink[] {
  const cnpj = digitsOnly(p.cnpj);
  const cpf = digitsOnly(p.cpf);
  const name = p.fullNamePf;
  const nameQ = encodeURIComponent(name);
  const uf = p.uf.toUpperCase();
  const links: VerifyLink[] = [];

  // ===== Eleitoral =====
  links.push({
    fonte: "TSE — Divulgação de Candidaturas",
    categoria: "Eleitoral",
    url: `https://divulgacandcontas.tse.jus.br/divulga/#/buscar/2024/2045202024/${uf || "BR"}/candidato/${nameQ}`,
    descricao: "Histórico de candidaturas, filiações partidárias e bens declarados.",
  });
  links.push({
    fonte: "TSE — Eleitos (resultado oficial)",
    categoria: "Eleitoral",
    url: `https://www.tse.jus.br/eleicoes/eleitos`,
    descricao: "Lista oficial dos eleitos por mandato/UF. Confirmar mandato ativo.",
  });

  // ===== Sanções =====
  links.push({
    fonte: "Portal da Transparência — CEIS / CNEP / CEPIM (CNPJ)",
    categoria: "Sanções",
    url: `https://portaldatransparencia.gov.br/sancoes/consulta?cpfCnpj=${cnpj}`,
    descricao: "Inscrições em listas administrativas pelo CNPJ.",
  });
  links.push({
    fonte: "Portal da Transparência — Sanções (CPF)",
    categoria: "Sanções",
    url: `https://portaldatransparencia.gov.br/sancoes/consulta?cpfCnpj=${cpf}`,
    descricao: "Inscrições em listas administrativas pelo CPF.",
  });
  links.push({
    fonte: "CGU — Servidores Federais",
    categoria: "Sanções",
    url: `https://portaldatransparencia.gov.br/servidores/busca/lista?termo=${nameQ}`,
    descricao: "Busca por servidor federal pelo nome completo.",
  });

  // ===== Receita / QSA =====
  links.push({
    fonte: "Receita Federal — Comprovante CNPJ",
    categoria: "Receita / QSA",
    url: `https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp?cnpj=${cnpj}`,
    descricao: "Cartão CNPJ oficial (situação cadastral, atividade principal, sócios).",
  });
  links.push({
    fonte: "Casa dos Dados — CNPJ + Sócios",
    categoria: "Receita / QSA",
    url: `https://casadosdados.com.br/solucao/cnpj/${cnpj}`,
    descricao: "QSA, sócios, empresas relacionadas, mapa de relações.",
  });
  links.push({
    fonte: "BrasilAPI — CNPJ (JSON)",
    categoria: "Receita / QSA",
    url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    descricao: "JSON estruturado da Receita: QSA, capital, situação cadastral.",
  });

  // ===== Justiça =====
  links.push({
    fonte: "CNJ — Improbidade Administrativa",
    categoria: "Justiça",
    url: `https://www.cnj.jus.br/improbidade_adm/consultar_requerido.php`,
    descricao: "Cadastro Nacional de Improbidade. Consultar por nome/CPF.",
  });
  links.push({
    fonte: "JusBrasil — busca por nome",
    categoria: "Justiça",
    url: `https://www.jusbrasil.com.br/busca?q=${nameQ}`,
    descricao: "Processos, decisões e jurisprudência citando o nome.",
  });
  links.push({
    fonte: "Escavador — perfil pessoa",
    categoria: "Justiça",
    url: `https://www.escavador.com/busca?q=${nameQ}&tipo=p`,
    descricao: "Currículo público, processos, sociedades, vínculos.",
  });
  links.push({
    fonte: "TCU — Acórdãos",
    categoria: "Justiça",
    url: `https://pesquisa.apps.tcu.gov.br/#/pesquisa/acordao-completo?termo=${nameQ}`,
    descricao: "Acórdãos do Tribunal de Contas da União.",
  });
  links.push({
    fonte: "MPF — Processos e investigações",
    categoria: "Justiça",
    url: siteSearch("mpf.mp.br", name),
    descricao: "Notícias e processos do Ministério Público Federal.",
  });

  // ===== Diário Oficial =====
  links.push({
    fonte: "Diário Oficial da União (DOU)",
    categoria: "Diário Oficial",
    url: `https://www.in.gov.br/consulta/-/buscar/dou?q=${nameQ}`,
    descricao: "Atos oficiais publicados (nomeações, exonerações, sanções).",
  });

  // ===== Mídia confiável (busca parametrizada por publicador, não Google) =====
  PUBLISHERS.forEach((pub) => {
    links.push({
      fonte: pub.name,
      categoria: "Mídia",
      url: publisherSearch(pub.url, name),
      descricao: `Busca pelo nome no acervo ${pub.name}.`,
    });
  });

  // ===== Estadual (TCE, TJ, MP, ALE) — específicos por UF =====
  const tceDomain = TCE_DOMAIN[uf];
  const tjDomain = TJ_DOMAIN[uf];
  const mpDomain = MP_DOMAIN[uf];

  if (tceDomain) {
    links.push({
      fonte: `TCE-${uf} — busca interna`,
      categoria: "Estadual",
      url: siteSearch(tceDomain, name),
      descricao: `Apontamentos, julgamentos de contas, sanções no TCE-${uf}.`,
    });
  }
  if (tjDomain) {
    links.push({
      fonte: `TJ-${uf} — consulta processual`,
      categoria: "Estadual",
      url: siteSearch(tjDomain, name),
      descricao: `Processos cíveis e criminais no Tribunal de Justiça do ${uf}.`,
    });
  }
  if (mpDomain) {
    links.push({
      fonte: `MP-${uf} — Ministério Público`,
      categoria: "Estadual",
      url: siteSearch(mpDomain, name),
      descricao: `Notícias e ações do Ministério Público do ${uf}.`,
    });
  }
  links.push({
    fonte: `Câmara/ALE-${uf} — Portal de Transparência`,
    categoria: "Estadual",
    url: `https://www.google.com/search?q=%22${nameQ}%22+ALE+${uf}+OR+camara+${uf}+transpar%C3%AAncia`,
    descricao: "Atuação parlamentar, votações, despesas, comissões.",
  });

  return links;
}
