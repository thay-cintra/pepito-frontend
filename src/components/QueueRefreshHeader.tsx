import { RefreshCw, Database, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { getQueueSnapshotMeta } from "@/lib/registration-queue";

type RefreshState = "idle" | "running" | "done" | "error";

/** Aciona refresh-daily.sh via POST /api/refresh (Vite plugin).
 *  Faz polling em /api/refresh a cada 2.5s e recarrega a página ao concluir. */
export function QueueRefreshHeader({ onRefresh }: { onRefresh?: () => void }) {
  const meta = getQueueSnapshotMeta();
  const { toast } = useToast();
  const [state, setState] = useState<RefreshState>("idle");
  const [lastLine, setLastLine] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchedAt = meta.fetched_at ? new Date(meta.fetched_at) : null;
  const tempoRelativo = fetchedAt ? formatRelative(fetchedAt) : "—";

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  // Detecta refresh em andamento ao montar (ex.: tab reaberta durante update)
  useEffect(() => {
    fetch("/api/refresh").then((r) => r.json()).then((d) => {
      if (d.running) startPolling();
    }).catch(() => {});
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = () => {
    setState("running");
    pollRef.current = setInterval(async () => {
      try {
        const d = await fetch("/api/refresh").then((r) => r.json());
        if (d.lastLine) setLastLine(d.lastLine);
        if (!d.running) {
          stopPolling();
          setState("done");
          toast({ variant: "success", title: "Fila atualizada", description: "Recarregando em 2s…" });
          setTimeout(() => { onRefresh?.(); window.location.reload(); }, 2000);
        }
      } catch { stopPolling(); setState("error"); }
    }, 2500);
  };

  const handleRefresh = async () => {
    if (state === "running") return;
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      if (r.status === 409) { toast({ title: "Refresh já em andamento" }); startPolling(); return; }
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Atualizando fila PLD…", description: "Consultando Athena + regenerando pareceres." });
      startPolling();
    } catch {
      toast({
        variant: "destructive",
        title: "Disponível apenas no dev server",
        description: "Rode: bash '.tools/refresh-daily.sh' na pasta pepito-frontend",
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="muted" className="font-mono text-[10px]">
        <Database className="h-3 w-3 mr-1" />
        {meta.source_table || "registration_notebook_output_single"}
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        <Clock className="h-3 w-3 mr-1" />
        Última atualização: {tempoRelativo}
      </Badge>
      {state === "running" && lastLine && (
        <span className="text-[10px] text-muted-foreground max-w-[280px] truncate italic">{lastLine}</span>
      )}
      {state === "done" && (
        <Badge variant="outline" className="text-[10px] text-green-600 border-green-400">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Atualizado
        </Badge>
      )}
      {state === "error" && (
        <Badge variant="outline" className="text-[10px] text-destructive border-destructive">
          <AlertCircle className="h-3 w-3 mr-1" /> Erro — veja refresh-daily.log
        </Badge>
      )}
      <Button variant="outline" size="sm" onClick={handleRefresh}
        disabled={state === "running"} className="h-7 text-xs">
        <RefreshCw className={`h-3 w-3 ${state === "running" ? "animate-spin" : ""}`} />
        {state === "running" ? "Atualizando…" : "Atualizar fila"}
      </Button>
    </div>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "ontem"; return `há ${days} dias`;
}
