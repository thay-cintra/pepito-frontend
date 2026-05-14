import { Badge } from "@/components/ui/badge";
import type { NivelRisco, StatusAnalise } from "@/types/kyc";

const RISCO_VARIANT: Record<NivelRisco, "success" | "warning" | "destructive"> = {
  baixo: "success",
  medio: "warning",
  alto: "destructive",
};

const RISCO_LABEL: Record<NivelRisco, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

export function RiscoBadge({ risco }: { risco: NivelRisco }) {
  return <Badge variant={RISCO_VARIANT[risco]}>Risco {RISCO_LABEL[risco]}</Badge>;
}

const STATUS_VARIANT: Record<StatusAnalise, "success" | "warning" | "destructive" | "info"> = {
  aprovado: "success",
  monitoramento: "warning",
  reprovado: "destructive",
  falso_positivo: "info",
};

const STATUS_LABEL_SHORT: Record<StatusAnalise, string> = {
  aprovado: "Aprovado",
  monitoramento: "Monitoramento",
  reprovado: "Reprovado",
  falso_positivo: "Falso Positivo",
};

export function StatusBadge({ status }: { status: StatusAnalise }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL_SHORT[status]}</Badge>;
}

export const STATUS_LABELS = STATUS_LABEL_SHORT;
