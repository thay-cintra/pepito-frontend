import { normalizeName } from "./utils";

// Sample base PEP unificada (Nov/Dez 2025 + Jan 2026) — match exato (sem similaridade)
export interface PepRecord {
  nome: string;
  cargo: string;
  orgao: string;
  uf: string;
  inicioMandato: string;
  fimMandato: string;
  fonte: string;
}

export const PEP_DATABASE: PepRecord[] = [
  {
    nome: "Carlos Henrique Almeida",
    cargo: "Deputado Estadual",
    orgao: "Assembleia Legislativa de São Paulo",
    uf: "SP",
    inicioMandato: "2023-02-01",
    fimMandato: "2027-01-31",
    fonte: "Base PEP 2026-01",
  },
  {
    nome: "Mariana Souza Lima",
    cargo: "Prefeita",
    orgao: "Prefeitura de Belo Horizonte",
    uf: "MG",
    inicioMandato: "2025-01-01",
    fimMandato: "2028-12-31",
    fonte: "Base PEP 2026-01",
  },
  {
    nome: "Roberto Pereira da Silva",
    cargo: "Senador",
    orgao: "Senado Federal",
    uf: "DF",
    inicioMandato: "2023-02-01",
    fimMandato: "2031-01-31",
    fonte: "Base PEP 2026-01",
  },
  {
    nome: "Ana Beatriz Cardoso",
    cargo: "Vereadora",
    orgao: "Câmara Municipal do Rio de Janeiro",
    uf: "RJ",
    inicioMandato: "2025-01-01",
    fimMandato: "2028-12-31",
    fonte: "Base PEP 2026-01",
  },
  {
    nome: "Eduardo Martins Ribeiro",
    cargo: "Secretário Municipal de Obras",
    orgao: "Prefeitura de Curitiba",
    uf: "PR",
    inicioMandato: "2025-01-15",
    fimMandato: "2028-12-31",
    fonte: "Base PEP 2026-01",
  },
  {
    nome: "Fernanda Oliveira",
    cargo: "Desembargadora",
    orgao: "Tribunal de Justiça de Pernambuco",
    uf: "PE",
    inicioMandato: "2018-06-01",
    fimMandato: "indeterminado",
    fonte: "Base PEP 2025-12",
  },
  {
    nome: "José Carlos Azevedo",
    cargo: "Deputado Federal",
    orgao: "Câmara dos Deputados",
    uf: "BA",
    inicioMandato: "2023-02-01",
    fimMandato: "2027-01-31",
    fonte: "Base PEP 2025-12",
  },
  {
    nome: "Patricia Mendes",
    cargo: "Conselheira do TCE-SP",
    orgao: "Tribunal de Contas do Estado de São Paulo",
    uf: "SP",
    inicioMandato: "2020-03-15",
    fimMandato: "indeterminado",
    fonte: "Base PEP 2025-11",
  },
  {
    nome: "Lucas Gabriel Ferreira",
    cargo: "Vice-prefeito",
    orgao: "Prefeitura de Fortaleza",
    uf: "CE",
    inicioMandato: "2025-01-01",
    fimMandato: "2028-12-31",
    fonte: "Base PEP 2026-01",
  },
  {
    nome: "Beatriz Costa Nogueira",
    cargo: "Procuradora-Geral de Justiça",
    orgao: "Ministério Público do Estado de Goiás",
    uf: "GO",
    inicioMandato: "2024-01-15",
    fimMandato: "2026-01-14",
    fonte: "Base PEP 2025-12",
  },
];

export function buscarPEP(nome: string): PepRecord | null {
  const target = normalizeName(nome);
  if (!target) return null;
  // Match EXATO (regra de negócio: sem similaridade)
  return (
    PEP_DATABASE.find((p) => normalizeName(p.nome) === target) ?? null
  );
}
