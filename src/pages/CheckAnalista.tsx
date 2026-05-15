import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Users, Filter, Search, Sparkles } from "lucide-react";
import { QueueRefreshHeader } from "@/components/QueueRefreshHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { listByBucket, countTotalPLD, QUEUE_UPDATED_EVENT } from "@/lib/registration-queue";
import { KEY_VERSION } from "@/lib/storage";
import type {
  RegistrationCase,
  RegistrationStatus,
} from "@/types/registration";
import type { StatusAnalise } from "@/types/kyc";
import { getDecisaoIA } from "@/data/registration-enrich";
import { RegistrationCaseCard } from "@/components/RegistrationCaseCard";

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

export function CheckAnalista() {
  const location = useLocation();
  const [casos, setCasos] = useState<RegistrationCase[]>([]);
  const [statusFiltro, setStatusFiltro] = useState<"todos" | RegistrationStatus>("todos");
  const [decisaoFiltro, setDecisaoFiltro] = useState<"todas" | StatusAnalise>("todas");
  const [busca, setBusca] = useState("");
  const [totalPLD, setTotalPLD] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setCasos(listByBucket("CHECK_ANALISTA"));
    setTotalPLD(countTotalPLD());
  }, [refreshKey, location.pathname]);

  useEffect(() => {
    const reload = () => { setCasos(listByBucket("CHECK_ANALISTA")); setTotalPLD(countTotalPLD()); };
    const onStorage = (e: StorageEvent) => { if (e.key === KEY_VERSION) reload(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(QUEUE_UPDATED_EVENT, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(QUEUE_UPDATED_EVENT, reload);
    };
  }, []);

  const filtrados = useMemo(() => {
    return casos.filter((c) => {
      if (statusFiltro !== "todos" && c.status !== statusFiltro) return false;
      if (decisaoFiltro !== "todas" && getDecisaoIA(c) !== decisaoFiltro) return false;
      if (busca) {
        const q = busca.toLowerCase();
        const hay = `${c.rf_nome_oficial} ${c.cnpj} ${c.cpf} ${c.full_name_pf} ${c.email} ${c.draft_id} ${c.uf} ${c.cidade} ${c.cnae}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [casos, statusFiltro, decisaoFiltro, busca]);

  const distribuicaoDecisao = useMemo(() => {
    const map: Record<StatusAnalise, number> = {
      aprovado: 0,
      monitoramento: 0,
      reprovado: 0,
      falso_positivo: 0,
    };
    casos.forEach((c) => (map[getDecisaoIA(c)] += 1));
    return map;
  }, [casos]);

  const distribuicaoStatus = useMemo(() => {
    const map: Record<RegistrationStatus, number> = {
      DOUBLE_CHECK: 0,
      IN_ANALYSIS: 0,
    };
    casos.forEach((c) => (map[c.status] += 1));
    return map;
  }, [casos]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-warning" />
            CHECK_ANALISTA — Fila PLD (1ª linha)
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Cadastros da Fila PLD do Retool com bucket{" "}
            <code className="bg-muted px-1 rounded">CHECK_ANALISTA</code>. Investigação
            já concluída pelo pipeline (8 fontes: PEP, sanções, mídia, processos,
            endereço, QSA, CNAE×Cargo, TCE/TJ/MP). Analista revisa e decide o parecer
            antes de encaminhar à Mesa.
          </p>
        </div>
        <QueueRefreshHeader onRefresh={() => setRefreshKey((k) => k + 1)} />
      </div>

      {/* Resumo */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mr-2">
              Fila PLD total: {totalPLD} casos · CHECK_ANALISTA: {casos.length}
            </p>
            <Badge variant="outline" className="font-mono">
              DOUBLE_CHECK: {distribuicaoStatus.DOUBLE_CHECK}
            </Badge>
            <Badge variant="outline" className="font-mono">
              IN_ANALYSIS: {distribuicaoStatus.IN_ANALYSIS}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mr-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Sugestão IA:
            </p>
            <Badge variant="success" className="font-mono">Aprovado: {distribuicaoDecisao.aprovado}</Badge>
            <Badge variant="warning" className="font-mono">Monitoramento: {distribuicaoDecisao.monitoramento}</Badge>
            <Badge variant="destructive" className="font-mono">Reprovado: {distribuicaoDecisao.reprovado}</Badge>
            <Badge variant="info" className="font-mono">Falso Positivo: {distribuicaoDecisao.falso_positivo}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Filtros aplicados:{" "}
            <code className="bg-muted px-1 rounded">status ∈ {"{DOUBLE_CHECK, IN_ANALYSIS}"}</code>{" "}
            +{" "}
            <code className="bg-muted px-1 rounded">sub_status = PLD_SCORE</code>{" "}
            +{" "}
            <code className="bg-muted px-1 rounded">person_type = OWNER</code>{" "}
            +{" "}
            <code className="bg-muted px-1 rounded">evaluation_reason = HIGH_PLD</code>.
          </p>
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

      {/* Lista */}
      {filtrados.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">
              {casos.length === 0
                ? "Nenhum caso na fila CHECK_ANALISTA no momento."
                : "Nenhum caso para os filtros aplicados."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtrados.map((c) => (
            <RegistrationCaseCard key={c.draft_id} caso={c} />
          ))}
        </div>
      )}
    </div>
  );
}
