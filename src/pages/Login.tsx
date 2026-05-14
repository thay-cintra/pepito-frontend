import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const ERROR_MSG: Record<string, string> = {
  dominio_invalido: "Acesso restrito a contas @cora.com.br.",
  falha_oauth:      "Falha na autenticação Google. Tente novamente.",
  sem_codigo:       "Fluxo OAuth interrompido. Tente novamente.",
};

export function Login() {
  const [params] = useSearchParams();
  const erro = params.get("error");
  const [loading, setLoading] = useState(false);
  // Redirecionamento pós-auth é feito pelo App.tsx via getAuthUser() — sem useEffect aqui.

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-8 px-4">
      {/* Logo / identidade */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center shadow-md">
          <span className="text-primary-foreground font-black text-2xl">P</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pepito</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Plataforma PLD/FTP — acesso restrito à equipe Cora
          </p>
        </div>
      </div>

      {/* Card de login */}
      <div className="w-full max-w-sm rounded-2xl border bg-card shadow-sm p-8 space-y-6">
        {erro && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {ERROR_MSG[erro] ?? "Erro desconhecido."}
          </div>
        )}

        <div className="space-y-2 text-center">
          <h2 className="text-lg font-semibold">Entrar</h2>
          <p className="text-xs text-muted-foreground">
            Use sua conta <span className="font-medium">@cora.com.br</span> para continuar.
          </p>
        </div>

        <a
          href="/auth/google"
          onClick={() => setLoading(true)}
          className="flex w-full items-center justify-center gap-3 rounded-lg border bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-muted transition-colors"
        >
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          {loading ? "Redirecionando…" : "Continuar com Google"}
        </a>

        <p className="text-center text-[11px] text-muted-foreground">
          Apenas contas <strong>@cora.com.br</strong> têm acesso.
          <br />Em caso de problemas, fale com o time de Compliance.
        </p>
      </div>
    </div>
  );
}
