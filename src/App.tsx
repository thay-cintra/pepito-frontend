import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { AnalisePrimeiraCamada } from "@/pages/AnalisePrimeiraCamada";
import { CheckAnalista } from "@/pages/CheckAnalista";
import { FilaRevisao } from "@/pages/FilaRevisao";
import { NovaAnalise } from "@/pages/NovaAnalise";
import { NovoCasoManual } from "@/pages/NovoCasoManual";
import { Dashboard } from "@/pages/Dashboard";
import { Login } from "@/pages/Login";
import { seedIfEmpty } from "@/lib/seed";
import { restoreFromDisk } from "@/lib/storage";
import { getAuthUser, type AuthUser } from "@/lib/auth";

function AppInner() {
  const { toast } = useToast();
  const [pronto, setPronto] = useState(false);
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined); // undefined = verificando

  useEffect(() => {
    // Verifica SSO. Em modo dev (Vite), /auth/me não existe → trata como autenticado.
    getAuthUser().then((u) => setUser(u ?? null));
  }, []);

  useEffect(() => {
    async function init() {
      // 1. Remove seeds fictícios legados
      try {
        const all = JSON.parse(localStorage.getItem("pepito.analises") || "[]");
        const filtered = all.filter((a: { id: string }) => !a.id?.startsWith("seed-"));
        if (filtered.length !== all.length) {
          localStorage.setItem("pepito.analises", JSON.stringify(filtered));
        }
      } catch { /* noop */ }

      // 2. Restaura análises do arquivo local (src/data/analises-salvas.json)
      //    caso o localStorage esteja vazio ou incompleto após limpeza de cache.
      const { restored } = await restoreFromDisk();
      if (restored > 0) {
        toast({
          variant: "success",
          title: `${restored} análise${restored > 1 ? "s" : ""} restaurada${restored > 1 ? "s" : ""} do arquivo local`,
          description: "Dados recuperados de analises-salvas.json",
        });
      }

      // 3. Seed apenas se ainda não houver dados
      seedIfEmpty();
      setPronto(true);
    }

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aguarda verificação SSO (máx ~2s; undefined = ainda verificando)
  // Em dev mode (Vite sem server.cjs) user fica null e a app carrega normalmente.
  if (user === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Em dev mode local (user === null, sem SSO configurado) deixa passar direto
  const ssoAtivo = !!import.meta.env.VITE_SSO_ATIVO;
  const autenticado = ssoAtivo ? user !== null : true;

  if (!pronto) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Carregando Pepito…</p>
      </div>
    );
  }

  return (
    <Routes>
      {/* Rota pública de login */}
      <Route path="/login" element={autenticado ? <Navigate to="/dashboard" replace /> : <Login />} />

      {/* Rotas protegidas */}
      <Route path="/" element={autenticado ? <Layout /> : <Navigate to="/login" replace />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="primeira-camada" element={<AnalisePrimeiraCamada />} />
        <Route path="check-analista" element={<CheckAnalista />} />
        <Route path="fila-revisao" element={<FilaRevisao />} />
        <Route path="nova-analise" element={<NovaAnalise />} />
        <Route path="novo-caso-manual" element={<NovoCasoManual />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
