import type { RegistrationCase } from "@/types/registration";


function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matchesNormalizedSearch(query: string, values: unknown[]): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return normalizeSearchText(values.join(" ")).includes(normalizedQuery);
}

export function registrationCaseMatchesSearch(c: RegistrationCase, query: string): boolean {
  return matchesNormalizedSearch(query, [
    c.rf_nome_oficial,
    c.cnpj,
    c.cpf,
    c.full_name_pf,
    c.email,
    c.draft_id,
    c.uf,
    c.cidade,
    c.cnae,
    c.token_pf_cred,
    c.token_pj_cred,
  ]);
}
