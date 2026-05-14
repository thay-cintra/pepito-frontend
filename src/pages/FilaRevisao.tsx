import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Inbox, Crown, Filter, Search, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { listByBucket } from "@/lib/registration-queue";
import { KEY_VERSION } from "@/lib/storage";
import type {
  RegistrationCase,
  RegistrationStatus,
} from "@/types/registration";
import type { StatusAnalise } from "@/types/kyc";
import { getDecisaoIA } from "@/data/registration-enrich";
import { RegistrationCaseCard } from "@/components/RegistrationCaseCard";
import { QueueRefreshHeader } from "@/components/QueueRefreshHeader";

const STATUS_OPTIONS: ("todos" | RegistrationStatus)[] = [
  "todos",
  "DOUBLE_CHECK",
  "IN_ANALYSIS",
];

const DECISAO_OPTIONS: ("todas" | StatusAnalise)[] = [
  "todas",
  "aprovado",
  "monitoramento",
  "reprovado",
  "falso_positivo",
];

const DECISAO_LABEL: Record<"todas" | StatusAnalise, string> = {
  todas: "Todas",
  aprovado: "Aprovado",
  monitoramento: "Monitoramento Reforçado",
  reprovado: "Reprovado",
  falso_positivo: "Falso Positivo",
};

export function FilaRevisao() {
  const location = useLocation();
  const [escalados, setEscalados] = useState<RegistrationCase[]>([]);
  const [statusFiltro, setStatusFiltro] = useState<"todos" | RegistrationStatus>("todos");
  const [decisaoFiltro, setDecisaoFiltro] = useState<"todas" | StatusAnalise>("todas");
  const [busca, setBusca] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setEscalados(listByBucket("CHECK_LIDERANCA"));
  }, [refreshKey, location.pathname]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_VERSION) setEscalados(listByBucket("CHECK_LIDERANCA"));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const filtrados = useMemo(() => {
    return escalados.filter((c) => {
      if (statusFiltro !== "todos" && c.status !== statusFiltro) return false;
      if (decisaoFiltro !== "todas" && getDecisaoIA(c) !== decisaoFiltro) return false;
      if (busca) {
        const q = busca.toLowerCase();
        const hay = `${c.rf_nome_oficial} ${c.cnpj} ${c.cpf} ${c.full_name_pf} ${c.email} ${c.draft_id} ${c.uf} ${c.cidade} ${c.cnae}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [escalados, statusFiltro, decisaoFiltro, busca]);

  const distribuicaoDecisao = useMemo(() => {
    const map: Record<StatusAnalise, number> = {
      aprovado: 0,
      monitoramento: 0,
      reprovado: 0,
      falso_positivo: 0,
    };
    escalados.forEach((c) => (map[getDecisaoIA(c)] += 1));
    return map;
  }, [escalados]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Inbox className="h-6 w-6 text-primary" /> Fila de Revisão
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Casos da Fila PLD do Retool com bucket{" "}
          <span className="font-medium">CHECK_LIDERANÇA</span> — escalonados para
          a Mesa de Decisão. A investigação já foi concluída pelo pipeline
          KYC/PLD; a Liderança apenas decide o parecer final.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-destructive" />
            <h2 className="text-lg font-semibold">
              CHECK_LIDERANÇA — escalonados ({escalados.length})
            </h2>
          </div>
          <QueueRefreshHeader onRefresh={() => setRefreshKey((k) => k + 1)} />
        </div>
        <p className="text-xs text-muted-foreground max-w-4xl">
          Filtros aplicados:{" "}
          <code className="bg-muted px-1 rounded">status ∈ {"{DOUBLE_CHECK, IN_ANALYSIS}"}</code>{" "}
          + <code className="bg-muted px-1 rounded">sub_status = PLD_SCORE</code> +{" "}
          <code className="bg-muted px-1 rounded">person_type = OWNER</code> +{" "}
          <code className="bg-muted px-1 rounded">bucket = CHECK_LIDERANÇA</code>{" "}
          (definido manualmente no Retool — não há coluna discriminadora no Athena).
        </p>

        {/* Resumo IA */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mr-2 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Sugestão IA:
              </p>
              <Badge variant="success" className="font-mono">Aprovado: {distribuicaoDecisao.aprovado}</Badge>
              <Badge variant="warning" className="font-mono">Monitoramento: {distribuicaoDecisao.monitoramento}</Badge>
              <Badge variant="destructive" className="font-mono">Reprovado: {distribuicaoDecisao.reprovado}</Badge>
              <Badge variant="info" className="font-mono">Falso Positivo: {distribuicaoDecisao.falso_positivo}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Filtros */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="flex items-center gap-1">
                  <Filter className="h-3.5 w-3.5" /> Status
                </Label>
                <Select
                  value={statusFiltro}
                  onChange={(e) =>
                    setStatusFiltro(e.target.value as typeof statusFiltro)
                  }
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" /> Sugestão IA
                </Label>
                <Select
                  value={decisaoFiltro}
                  onChange={(e) =>
                    setDecisaoFiltro(e.target.value as typeof decisaoFiltro)
                  }
                >
                  {DECISAO_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {DECISAO_LABEL[d]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  <Search className="h-3.5 w-3.5" /> Buscar
                </Label>
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="CNPJ, CPF, razão social, sócio, UF, CNAE..."
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {filtrados.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              {escalados.length === 0
                ? "Sem casos escalonados no momento."
                : "Nenhum caso para os filtros aplicados."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtrados.map((caso) => (
              <RegistrationCaseCard key={caso.draft_id} caso={caso} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
