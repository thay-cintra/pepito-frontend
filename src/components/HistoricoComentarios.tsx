import { useState, useEffect } from "react";
import { MessageSquare, Send, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import type { ComentarioHistorico } from "@/types/registration";

interface Props {
  comentarios: ComentarioHistorico[];
  /** Email/nome de quem está adicionando o comentário. Obrigatório quando onAdicionar é fornecido. */
  usuarioAtual?: string;
  /** Se omitido, esconde o input de novo comentário. */
  onAdicionar?: (comentario: ComentarioHistorico) => void;
  /** Mostrar de forma compacta (resumo, máx 1 visível). */
  compact?: boolean;
  className?: string;
}

const TIPO_VARIANT: Record<string, "info" | "warning" | "success" | "muted" | "destructive"> = {
  parecer: "info",
  acao: "warning",
  decisao: "success",
  observacao: "muted",
};

const TIPO_LABEL: Record<string, string> = {
  parecer: "Parecer",
  acao: "Ação",
  decisao: "Decisão",
  observacao: "Observação",
};

const LS_EMAIL_KEY = "pepito.usuario_email";

export function HistoricoComentarios({
  comentarios,
  usuarioAtual,
  onAdicionar,
  compact = false,
  className,
}: Props) {
  const [expandido, setExpandido] = useState(!compact);
  const [novoTexto, setNovoTexto] = useState("");
  // Email do usuário atual: prop tem prioridade, senão localStorage, senão vazio (usuário preenche)
  const [emailLocal, setEmailLocal] = useState(() => {
    if (usuarioAtual) return usuarioAtual;
    return localStorage.getItem(LS_EMAIL_KEY) || "";
  });

  useEffect(() => {
    if (usuarioAtual) setEmailLocal(usuarioAtual);
  }, [usuarioAtual]);

  const emailEfetivo = usuarioAtual || emailLocal;

  const handleEmailChange = (v: string) => {
    setEmailLocal(v);
    if (v.trim()) localStorage.setItem(LS_EMAIL_KEY, v.trim());
  };

  const ordered = [...comentarios].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const visiveis = compact && !expandido ? ordered.slice(0, 1) : ordered;

  const handleAdicionar = () => {
    if (!novoTexto.trim() || !onAdicionar) return;
    onAdicionar({
      timestamp: new Date().toISOString(),
      user_email: emailEfetivo || "usuario@cora.com.br",
      text: novoTexto.trim(),
      tipo: "observacao",
    });
    setNovoTexto("");
  };

  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary"
        >
          {expandido ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <MessageSquare className="h-3.5 w-3.5" />
          Histórico e inclusão de comentários ({ordered.length})
        </button>
      </div>

      {expandido && (
        <div className="space-y-2 rounded-md border bg-card p-3">
          {/* Timeline */}
          <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
            {visiveis.length === 0 ? (
              <div className="rounded-md bg-muted/40 border border-dashed p-3 text-center">
                <p className="text-xs text-muted-foreground italic">
                  Aguardando análise.
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-1">
                  Os pareceres serão registrados pelo analista responsável diretamente
                  no Retool. Esta tela reflete o estado atual da fila.
                </p>
              </div>
            ) : (
              visiveis.map((c, i) => (
                <div
                  key={`${c.timestamp}-${i}`}
                  className="rounded-md border bg-muted/20 p-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-muted-foreground">
                        {formatDate(c.timestamp)}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium truncate">{c.user_email}</span>
                    </div>
                    {c.tipo && (
                      <Badge variant={TIPO_VARIANT[c.tipo] ?? "muted"} className="text-[10px]">
                        {TIPO_LABEL[c.tipo] ?? c.tipo}
                      </Badge>
                    )}
                  </div>
                  <p
                    className={cn(
                      "text-xs leading-relaxed whitespace-pre-wrap",
                      c.tipo === "acao" && !c.text.includes("ENVIAR_") && "font-mono uppercase text-warning",
                      c.tipo === "sistema" && "font-mono text-muted-foreground",
                    )}
                  >
                    {c.text}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Input — só na Mesa (quando onAdicionar é fornecido) */}
          {onAdicionar && (
            <div className="space-y-2 pt-2 border-t">
              {!usuarioAtual && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground shrink-0">Seu e-mail:</span>
                  <input
                    type="email"
                    value={emailLocal}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    placeholder="seuemail@cora.com.br"
                    className="flex-1 h-6 rounded border border-input bg-background px-2 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}
              <Textarea
                value={novoTexto}
                onChange={(e) => setNovoTexto(e.target.value)}
                placeholder="Adicionar observação ao histórico..."
                rows={2}
                className="text-xs"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Como: <span className="font-mono">{emailEfetivo || <em>preencha o e-mail acima</em>}</span></span>
                <Button size="sm" onClick={handleAdicionar} disabled={!novoTexto.trim() || !emailEfetivo}>
                  <Send className="h-3 w-3" /> Adicionar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
