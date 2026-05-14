import { useState } from "react";
import {
  ExternalLink,
  AlertTriangle,
  Newspaper,
  Gavel,
  MapPin,
  Users,
  Crown,
  Building2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ResultadoPesquisa, TipoResultado } from "@/types/kyc";
import { RiscoBadge } from "./RiscoBadge";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { cn } from "@/lib/utils";

const TIPO_LABEL: Record<TipoResultado, string> = {
  midia: "Mídia",
  processo: "Processo",
  endereco: "Endereço",
  societario: "Societário",
  pep: "PEP",
  rede_social: "Rede Social",
  governo: "Governo / Sanções",
};

const TIPO_ICON: Record<TipoResultado, typeof Newspaper> = {
  midia: Newspaper,
  processo: Gavel,
  endereco: MapPin,
  societario: Users,
  pep: Crown,
  rede_social: Newspaper,
  governo: Building2,
};

interface Props {
  resultado: ResultadoPesquisa;
  onReanalisar?: (observacao: string) => Promise<void> | void;
  onDescartar?: () => void;
  onRestaurar?: () => void;
  readOnly?: boolean;
}

export function ResultadoCard({ resultado, onReanalisar, onDescartar, onRestaurar, readOnly }: Props) {
  const [openReanalise, setOpenReanalise] = useState(false);
  const [obs, setObs] = useState("");
  const [loading, setLoading] = useState(false);
  const Icon = TIPO_ICON[resultado.tipo];

  const handleReanalisar = async () => {
    if (!onReanalisar || !obs.trim()) return;
    setLoading(true);
    try {
      await onReanalisar(obs);
      setObs("");
      setOpenReanalise(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 transition-all",
        resultado.descartado && "opacity-60 bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            resultado.risco === "alto" && "bg-destructive/15 text-destructive",
            resultado.risco === "medio" && "bg-warning/15 text-warning",
            resultado.risco === "baixo" && "bg-success/15 text-success",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge variant="muted">{TIPO_LABEL[resultado.tipo]}</Badge>
            <RiscoBadge risco={resultado.risco} />
            {resultado.pendente_verificacao && (
              <Badge variant="warning">
                <AlertTriangle className="h-3 w-3 mr-1" /> Pendente verificação
              </Badge>
            )}
            {resultado.similaridade_nome && (
              <Badge variant="outline">Similaridade: {resultado.similaridade_nome}</Badge>
            )}
          </div>
          <p className="text-sm font-medium text-foreground">{resultado.fonte}</p>
          <p className="text-sm text-muted-foreground mt-1">{resultado.resumo}</p>
          {resultado.descartado && resultado.motivoDescarte && (
            <p className="text-xs text-destructive mt-2 italic">
              Descartado: {resultado.motivoDescarte}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            {resultado.link && (
              <a
                href={resultado.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Abrir fonte
              </a>
            )}
            {!readOnly && onReanalisar && !resultado.descartado && (
              <button
                onClick={() => setOpenReanalise((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <RefreshCw className="h-3 w-3" /> Reanalisar
              </button>
            )}
            {!readOnly && onDescartar && !resultado.descartado && (
              <button
                onClick={onDescartar}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" /> Descartar
              </button>
            )}
            {!readOnly && onRestaurar && resultado.descartado && (
              <button
                onClick={onRestaurar}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <RefreshCw className="h-3 w-3" /> Restaurar
              </button>
            )}
          </div>
          {openReanalise && (
            <div className="mt-3 space-y-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">
                Suas observações têm prioridade máxima sobre a pesquisa automática.
              </p>
              <Textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder='Ex.: "homônimo, descartar" / "reclassificar como alto risco" / "verificar processo TJ-SP n. ..."'
                rows={3}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setOpenReanalise(false)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleReanalisar} disabled={loading || !obs.trim()}>
                  {loading ? "Reanalisando..." : "Reanalisar"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
