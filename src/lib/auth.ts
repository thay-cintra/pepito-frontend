export interface AuthUser {
  email: string;
  name: string;
  picture: string;
}

let _cache: AuthUser | null | undefined = undefined; // undefined = não verificado ainda

export async function getAuthUser(): Promise<AuthUser | null> {
  if (_cache !== undefined) return _cache;
  try {
    const r = await fetch("/auth/me");
    // Verifica content-type: Vite devolve index.html (text/html) para rotas desconhecidas.
    // Só considera autenticado se a resposta for JSON real do servidor de produção.
    const ct = r.headers.get("content-type") || "";
    if (r.ok && ct.includes("application/json")) {
      _cache = await r.json();
      return _cache!;
    }
  } catch { /* offline ou sem servidor */ }
  _cache = null;
  return null;
}

export function clearAuthCache() { _cache = undefined; }

export function logout() {
  clearAuthCache();
  window.location.href = "/auth/logout";
}
