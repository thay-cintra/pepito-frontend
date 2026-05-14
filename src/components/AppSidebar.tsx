import { NavLink } from "react-router-dom";
import {
  ClipboardList,
  Inbox,
  Gavel,
  LayoutDashboard,
  Sparkles,
  Users,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { getAuthUser, logout, type AuthUser } from "@/lib/auth";

const items = [
  { to: "/primeira-camada", label: "1ª Camada", icon: ClipboardList, hint: "Cadastro & análise inicial" },
  { to: "/check-analista", label: "Check Analista", icon: Users, hint: "Fila PLD — 1ª linha" },
  { to: "/fila-revisao", label: "Fila de Revisão", icon: Inbox, hint: "CHECK_LIDERANÇA + 2ª camada" },
  { to: "/nova-analise", label: "2ª Camada (Mesa)", icon: Gavel, hint: "Decisão da liderança" },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Histórico & métricas" },
];

export function AppSidebar() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => { getAuthUser().then((u) => setUser(u)); }, []);
  return (
    <aside className="w-64 shrink-0 border-r bg-card flex flex-col">
      <div className="p-5 border-b">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl pepito-gradient flex items-center justify-center text-white font-bold text-lg shadow-md shadow-primary/30">
            P
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight pepito-text-gradient">Pepito</h1>
            <p className="text-[11px] text-muted-foreground leading-tight">KYC/PLD para PEPs</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              cn(
                "flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "text-foreground hover:bg-muted",
              )
            }
          >
            {({ isActive }) => (
              <>
                <it.icon className={cn("h-4 w-4 mt-0.5 shrink-0", isActive ? "text-primary-foreground" : "text-primary")} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-tight">{it.label}</div>
                  <div
                    className={cn(
                      "text-[11px] leading-tight mt-0.5",
                      isActive ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {it.hint}
                  </div>
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 mx-3 mb-3 rounded-md bg-secondary/60 border border-secondary text-secondary-foreground text-xs leading-relaxed">
        <div className="flex items-center gap-1.5 font-semibold mb-1">
          <Sparkles className="h-3.5 w-3.5" />
          Apoio à decisão
        </div>
        <p className="text-secondary-foreground/80">
          A IA produz subsídios. A decisão final é da Mesa, sob Circular BACEN 3.978/2020 e diretrizes COAF.
        </p>
      </div>

      {user && (
        <div className="px-4 pb-4 flex items-center gap-2">
          {user.picture ? (
            <img src={user.picture} alt={user.name} className="h-6 w-6 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
          ) : (
            <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium truncate leading-tight">{user.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
          </div>
          <button onClick={logout} title="Sair" className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </aside>
  );
}
