import { RefreshCw, Database, Clock, CheckCircle2, AlertCircle, Zap } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { getQueueSnapshotMeta, refreshQueueFromServer, QUEUE_UPDATED_EVENT } from "@/lib/registration-queue";
import { getAuthUser } from "@/lib/auth";

const POLL_INTERVAL_MS = 90_000; // auto-refresh da fila a cada 90 segundos

type SyncState = "idle" | "running" | "done" | "error";

export function QueueRefreshHeader({ onRefresh }: { onRefresh?: () => void }) {
  const { toast } = useToast();
  const [meta, setMeta] = useState(getQueueSnapshotMeta());
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastLine, setLastLine] = useState("");
  const [novosDetectados, setNovosDetectados] = useState(0);
  const [canSync, setCanSync] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getAuthUser().then((u) => { if (mounted) setCanSync(!!u?.canSync); });
    return () => { mounted = false; };
  }, []);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Atualiza meta quando a fila recarrega
  useEffect(() => {
    const onUpdate = () => { setMeta(getQueueSnapshotMeta()); };
    window.addEventListener(QUEUE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(QUEUE_UPDATED_EVENT, onUpdate);
  }, []);

  // Auto-polling: busca /api/queue a cada 90s e atualiza silenciosamente
  const silentRefresh = useCallback(async () => {
    const { novos } = await refreshQueueFromServer();
    if (novos > 0) {
      setNovosDetectados((n) => n + novos);
      toast({
        variant: "success",
        title: `${novos} novo${novos > 1 ? "s" : ""} caso${novos > 1 ? "s" : ""} na fila`,
        description: "A lista foi atualizada automaticamente.",
      });
      onRefresh?.();
    }
  }, [onRefresh, toast]);

  useEffect(() => {
    autoPollRef.current = setInterval(silentRefresh, POLL_INTERVAL_MS);
    return () => { if (autoPollRef.current) clearInterval(autoPollRef.current); };
  }, [silentRefresh]);

  // Botão "Atualizar" — relê /api/queue imediatamente (sem Athena)
  const handleRefreshImediato = async () => {
    const { total, novos } = await refreshQueueFromServer();
    setMeta(getQueueSnapshotMeta());
    onRefresh?.();
    toast({
      variant: "success",
      title: novos > 0 ? `${novos} novo${novos > 1 ? "s" : ""} caso${novos > 1 ? "s" : ""} detectado${novos > 1 ? "s" : ""}` : "Fila atualizada",
      description: `${total} casos na fila.`,
    });
  };

  // Botão "Sincronizar Athena" — dispara build-real-queue.py (sem rebuild do bundle)
  const stopSyncPolling = () => {
    if (syncPollRef.current) { clearInterval(syncPollRef.current); syncPollRef.current = null; }
  };

  const handleSincronizarAthena = async () => {
    if (syncState === "running") return;
    try {
      const r = await fetch("/api/queue/sync", { method: "POST" });
      if (r.status === 409) { toast({ title: "Sincronização já em andamento" }); return; }
      if (!r.ok) throw new Error();
      setSyncState("running");
      toast({ title: "Sincronizando com Athena…", description: "Consultando squad_core.registration_notebook_output_single" });

      // Polling do status da sincronização
      syncPollRef.current = setInterval(async () => {
        try {
          const d = await fetch("/api/queue/sync").then((r) => r.json());
          if (d.lastLine) setLastLine(d.lastLine);
          if (!d.running) {
            stopSyncPolling();
            if (d.lastExit !== 0 && d.lastExit !== null) {
              // Sync rodou mas falhou — não substituir os números pelos antigos sem avisar
              setSyncState("error");
              const detail = d.lastErrorTail || d.lastLine || "Verifique credenciais AWS/Athena (.env).";
              toast({
                variant: "destructive",
                title: `Sincronização falhou (exit ${d.lastExit})`,
                description: detail.slice(0, 300),
              });
              return;
            }
            // Após sincronização bem-sucedida, relê a fila atualizada
            const { total, novos } = await refreshQueueFromServer();
            setMeta(getQueueSnapshotMeta());
            setSyncState("done");
            onRefresh?.();
            toast({
              variant: "success",
              title: `Athena sincronizado — ${total} casos`,
              description: novos > 0 ? `${novos} novo${novos > 1 ? "s" : ""} caso${novos > 1 ? "s" : ""} adicionado${novos > 1 ? "s" : ""}.` : "Nenhum caso novo.",
            });
          }
        } catch { stopSyncPolling(); setSyncState("error"); }
      }, 3000);
    } catch {
      setSyncState("error");
      toast({ variant: "destructive", title: "Erro ao sincronizar", description: "Verifique a conexão com o Athena." });
    }
  };

  const fetchedAt = meta.fetched_at ? new Date(meta.fetched_at) : null;
  const tempoRelativo = fetchedAt ? formatRelative(fetchedAt) : "—";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="muted" className="font-mono text-[10px]">
        <Database className="h-3 w-3 mr-1" />
        {meta.source_table || "registration_notebook_output_single"}
      </Badge>
      <Badge variant="outline" className="text-[10px]">
        <Clock className="h-3 w-3 mr-1" />
        {tempoRelativo}
      </Badge>
      {novosDetectados > 0 && (
        <Badge variant="outline" className="text-[10px] text-primary border-primary">
          +{novosDetectados} novos detectados
        </Badge>
      )}
      {syncState === "running" && lastLine && (
        <span className="text-[10px] text-muted-foreground max-w-[280px] truncate italic">{lastLine}</span>
      )}
      {syncState === "done" && (
        <Badge variant="outline" className="text-[10px] text-green-600 border-green-400">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Athena sincronizado
        </Badge>
      )}
      {syncState === "error" && (
        <Badge variant="outline" className="text-[10px] text-destructive border-destructive">
          <AlertCircle className="h-3 w-3 mr-1" /> Erro na sincronização
        </Badge>
      )}

      {/* Atualizar: relê /api/queue imediatamente, sem consultar Athena */}
      <Button variant="outline" size="sm" onClick={handleRefreshImediato} className="h-7 text-xs">
        <RefreshCw className="h-3 w-3" /> Atualizar
      </Button>

      {/* Sincronizar: consulta Athena via Python e atualiza o JSON.
          Restrito a usuários autorizados (canSync). */}
      {canSync && (
        <Button
          variant="outline" size="sm"
          onClick={handleSincronizarAthena}
          disabled={syncState === "running"}
          className="h-7 text-xs"
          title="Consulta o Athena agora e atualiza a fila sem precisar reiniciar o servidor"
        >
          <Zap className={`h-3 w-3 ${syncState === "running" ? "animate-pulse" : ""}`} />
          {syncState === "running" ? "Sincronizando…" : "Sincronizar Athena"}
        </Button>
      )}
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
  if (days === 1) return "ontem";
  return `há ${days} dias`;
}
