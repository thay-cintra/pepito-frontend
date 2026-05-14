import type { Analise, Exclusao } from "@/types/kyc";

const KEY_ANALISES = "pepito.analises";
const KEY_EXCLUSOES = "pepito.exclusoes";
/** Versão incrementada a cada saveAnalise — permite que outros componentes
 * detectem mudanças. O localStorage storage-event só dispara em outras abas;
 * usamos um CustomEvent para notificar a mesma aba de forma garantida. */
export const KEY_VERSION = "pepito.version";
export const ANALISE_SAVED_EVENT = "pepito:analise-saved";

const API_URL = "/api/analises";

export function bumpVersion() {
  const v = parseInt(localStorage.getItem(KEY_VERSION) || "0", 10);
  localStorage.setItem(KEY_VERSION, String(v + 1));
  window.dispatchEvent(new CustomEvent(ANALISE_SAVED_EVENT));
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Persiste analises + exclusoes no arquivo local src/data/analises-salvas.json
 *  via API do plugin Vite. Fire-and-forget — nunca bloqueia a UI. */
async function persistToDisk(): Promise<void> {
  try {
    const analises = read<Analise>(KEY_ANALISES);
    const exclusoes = read<Exclusao>(KEY_EXCLUSOES);
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analises, exclusoes }),
    });
  } catch {
    // Silencioso — a persistência em disco é best-effort.
    // localStorage continua sendo a fonte primária durante a sessão.
  }
}

/** Carrega analises do arquivo local para o localStorage.
 *  Chamado na inicialização do app — restaura dados após limpeza de cache.
 *  Só sobrescreve se o localStorage estiver vazio. */
export async function restoreFromDisk(): Promise<{ restored: number }> {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return { restored: 0 };
    const data: { analises: Analise[]; exclusoes: Exclusao[] } = await res.json();

    const localAnalises = read<Analise>(KEY_ANALISES);
    const localExclusoes = read<Exclusao>(KEY_EXCLUSOES);

    let restored = 0;

    // Merge: adiciona do disco o que não está no localStorage (por ID)
    if (data.analises?.length) {
      const localIds = new Set(localAnalises.map((a) => a.id));
      const novos = data.analises.filter((a) => !localIds.has(a.id));
      if (novos.length > 0) {
        write(KEY_ANALISES, [...localAnalises, ...novos]);
        restored = novos.length;
      }
    }

    if (data.exclusoes?.length) {
      const localExcIds = new Set(localExclusoes.map((e) => e.id));
      const novosExc = data.exclusoes.filter((e) => !localExcIds.has(e.id));
      if (novosExc.length > 0) {
        write(KEY_EXCLUSOES, [...localExclusoes, ...novosExc]);
      }
    }

    if (restored > 0) bumpVersion();
    return { restored };
  } catch {
    return { restored: 0 };
  }
}

export const storage = {
  listAnalises(): Analise[] {
    return read<Analise>(KEY_ANALISES).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },

  getAnalise(id: string): Analise | undefined {
    return read<Analise>(KEY_ANALISES).find((a) => a.id === id);
  },

  saveAnalise(a: Analise): void {
    const all = read<Analise>(KEY_ANALISES);
    const idx = all.findIndex((x) => x.id === a.id);
    if (idx >= 0) all[idx] = a;
    else all.push(a);
    write(KEY_ANALISES, all);
    bumpVersion();
    // Persiste no arquivo local em background
    void persistToDisk();
  },

  deleteAnalise(id: string, motivo: string): void {
    const all = read<Analise>(KEY_ANALISES);
    const target = all.find((x) => x.id === id);
    if (target) {
      const exclusao: Exclusao = {
        id: Math.random().toString(36).slice(2),
        analiseId: target.id,
        cnpj: target.cliente.cnpj,
        razaoSocial: target.cliente.razaoSocial,
        status: target.status,
        motivo,
        dataAnalise: target.data,
        dataExclusao: new Date().toISOString(),
      };
      const exc = read<Exclusao>(KEY_EXCLUSOES);
      exc.push(exclusao);
      write(KEY_EXCLUSOES, exc);
    }
    write(KEY_ANALISES, all.filter((x) => x.id !== id));
    void persistToDisk();
  },

  listExclusoes(): Exclusao[] {
    return read<Exclusao>(KEY_EXCLUSOES).sort(
      (a, b) =>
        new Date(b.dataExclusao).getTime() - new Date(a.dataExclusao).getTime(),
    );
  },
};
