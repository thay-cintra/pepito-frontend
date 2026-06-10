import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  LayoutDashboard,
  Download,
  Trash2,
  Eye,
  Plus,
  Filter,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { storage, KEY_VERSION, ANALISE_SAVED_EVENT } from "@/lib/storage";
import { exportarAnaliseTexto } from "@/lib/parecer";
import { formatDate, formatDuration } from "@/lib/utils";
import type { Analise, StatusAnalise } from "@/types/kyc";
import { STATUS_LABELS, StatusBadge } from "@/components/RiscoBadge";
import { Badge } from "@/components/ui/badge";
import pepHistoryRaw from "@/data/pep-history.json";

interface PepHistoryItem {
  draft_membership_id: string;
  status_pepito: "aprovado" | "reprovado" | "em_andamento" | "aguardando_cliente" | "falso_positivo";
  tipo_pep?: "titular" | "relacionado" | null;
  ds_vinculo?: string | null;
  raw_status: string;
  motivo: string | null;
  motivo_label: string;
  decision_at: string | null;
  pld_entered_at: string | null;
  /** Mês de competência da planilha de controle (quando o time analisou).
   * Pode diferir de pld_entered_at (quando o caso entrou na fila PLD no Athena). */
  competencia_at?: string | null;
}
interface PepHistoryPayload {
  _meta: {
    fetched_at: string;
    source_table: string;
    universe_filter: string;
    total: number;
    by_status: Record<string, number>;
    by_motivo: Record<string, number>;
  };
  items: PepHistoryItem[];
}
const PEP_HISTORY = pepHistoryRaw as PepHistoryPayload;

const MOTIVO_LABEL_PT: Record<string, string> = {
  PLD_SCORE: "Score PLD elevado",
  COMPLIANCE_PLD_SCORE: "Score PLD elevado (compliance)",
  COMPLIANCE: "Análise de compliance reprovada",
  COMPLIANCE_HAS_DICT_CONFIRMED_REPORT: "Mídia adversa confirmada",
  COMPLIANCE_HAS_RUFRA_CONFIRMED_REPORT: "Fraude confirmada (RUFRA)",
  COMPLIANCE_SUS_NAME_FAIL: "Nome em lista suspeita",
  COMPLIANCE_BACEN_PROTEGE_OWNER: "Bacen Protege — owner",
  COMPLIANCE_DATA_CHECK_PASS: "Falha em verificação de dados",
  COMPLIANCE_PJ_STATUS: "Status PJ inválido",
  COMPLIANCE_CNAE_ALLOWED: "CNAE não permitido",
  NOT_IN_QSA: "PEP/sócio fora do QSA",
};
const motivoPt = (k: string): string => MOTIVO_LABEL_PT[k] || k.replace(/_/g, " ");

const STATUS_COLORS: Record<StatusAnalise, string> = {
  aprovado: "#16a34a",
  monitoramento: "#f59e0b",
  reprovado: "#dc2626",
  falso_positivo: "#3b82f6",
};

const FILTROS: ("todos" | StatusAnalise)[] = [
  "todos",
  "aprovado",
  "monitoramento",
  "reprovado",
  "falso_positivo",
];

export function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [analises, setAnalises] = useState<Analise[]>([]);
  const [filtro, setFiltro] = useState<"todos" | StatusAnalise>("todos");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [busca, setBusca] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [verAnalise, setVerAnalise] = useState<Analise | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = () => setAnalises(storage.listAnalises());

  // Re-carrega ao navegar para o Dashboard e ao detectar salvamentos em outras abas/rotas
  useEffect(() => {
    reload();
  }, [location.pathname]);

  useEffect(() => {
    // storage event = notificação cross-tab; ANALISE_SAVED_EVENT = notificação same-tab
    const onStorage = (e: StorageEvent) => { if (e.key === KEY_VERSION) reload(); };
    const onSaved = () => reload();
    window.addEventListener("storage", onStorage);
    window.addEventListener(ANALISE_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ANALISE_SAVED_EVENT, onSaved);
    };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      reload();
      setRefreshing(false);
      toast({ variant: "success", title: "Dashboard atualizado" });
    }, 400);
  };

  const concluidas = useMemo(
    () => analises.filter((a) => a.camadaStatus === "concluido"),
    [analises],
  );

  const filtradas = useMemo(() => {
    return concluidas.filter((a) => {
      if (filtro !== "todos" && a.status !== filtro) return false;
      if (busca && !`${a.cliente.razaoSocial} ${a.cliente.cnpj}`.toLowerCase().includes(busca.toLowerCase()))
        return false;
      // Filtra pela data da DECISÃO FINAL (concludedAt), não pela data de abertura (createdAt)
      const dataDecisao = a.concludedAt || a.createdAt;
      if (dataIni && new Date(dataDecisao) < new Date(dataIni)) return false;
      if (dataFim && new Date(dataDecisao) > new Date(dataFim + "T23:59:59")) return false;
      return true;
    });
  }, [concluidas, filtro, busca, dataIni, dataFim]);

  // Determina se algum filtro local está ativo (para sinalizar nos KPIs de período)
  const filtroPeriodoAtivo = !!(dataIni || dataFim || filtro !== "todos" || busca);

  // Pizza e barras sempre refletem a seleção ativa (filtradas)
  const dadosPizza = useMemo(() => {
    const counts: Record<StatusAnalise, number> = { aprovado: 0, monitoramento: 0, reprovado: 0, falso_positivo: 0 };
    filtradas.forEach((a) => (counts[a.status] += 1));
    return (Object.keys(counts) as StatusAnalise[]).map((k) => ({
      name: STATUS_LABELS[k],
      key: k,
      value: counts[k],
    }));
  }, [filtradas]);

  const dadosBarras = useMemo(() => {
    const buckets: Record<string, { label: string; total: number; aprovado: number; monitoramento: number; reprovado: number; falso_positivo: number }> = {};
    // Barras mostram sempre o histórico completo para dar contexto temporal
    concluidas.forEach((a) => {
      const dt = new Date(a.concludedAt || a.createdAt);
      const k = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      buckets[k] ||= { label: k, total: 0, aprovado: 0, monitoramento: 0, reprovado: 0, falso_positivo: 0 };
      buckets[k].total += 1;
      buckets[k][a.status] += 1;
    });
    return Object.values(buckets).slice(-10);
  }, [concluidas]);

  /** Agrupa análises por analista (1ª camada) usando:
   *  1. campo `analistaEmail` (casos Pepito-native)
   *  2. fallback: email de analista no historicoComentarios (casos Retool) */
  const porAnalista = useMemo(() => {
    const map: Record<string, { total: number; aprovado: number; monitoramento: number; reprovado: number; falso_positivo: number }> = {};
    const ANALISTA_EMAILS = new Set(["jeniffer@cora.com.br", "lucasfeller@cora.com.br", "m.matos@cora.com.br"]);

    const getEmail = (a: Analise): string | null => {
      if (a.analistaEmail) return a.analistaEmail;
      const hc = a.historicoComentarios ?? [];
      const envio = hc.find(
        (h) => ANALISTA_EMAILS.has(h.user_email) &&
          (h.tipo === "acao" || h.tipo === "parecer") &&
          h.text?.includes("ENVIAR_LIDERANCA_PLD")
      );
      if (envio) return envio.user_email;
      const qualquer = hc.find((h) => ANALISTA_EMAILS.has(h.user_email));
      return qualquer?.user_email ?? null;
    };

    analises.forEach((a) => {
      const email = getEmail(a);
      if (!email) return;
      const nome = email.split("@")[0];
      map[nome] ||= { total: 0, aprovado: 0, monitoramento: 0, reprovado: 0, falso_positivo: 0 };
      map[nome].total += 1;
      map[nome][a.status] += 1;
    });

    return Object.entries(map)
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [analises]);

  const metricas = useMemo(() => {
    const aguardando = analises.filter((a) => a.camadaStatus === "aguardando_segunda").length;
    const rascunho = analises.filter((a) => a.camadaStatus === "rascunho").length;

    // Tempo médio Check Analista = SOMENTE Analises Pepito (timer real do
    // momento "Revisar e enviar" até "Enviar à Mesa"). Não usamos os casos
    // do Retool porque `created_at` é quando o cadastro entrou na fila, NÃO
    // quando o analista começou — incluir isso fazia a média estourar para
    // ~14 dias por causa do tempo parado em fila.
    const dur1 = analises
      .filter((a) => a.camadaStatus === "aguardando_segunda" || a.camadaStatus === "concluido")
      .map((a) => a.duracaoPrimeiraCamada || 0)
      .filter((n) => n > 0);
    const dur2 = concluidas.map((a) => a.duracaoSegundos || 0).filter(Boolean);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

    // byStatus e pct são baseados em `filtradas` para refletir o período selecionado
    const byStatus = { aprovado: 0, monitoramento: 0, reprovado: 0, falso_positivo: 0 } as Record<StatusAnalise, number>;
    filtradas.forEach((a) => (byStatus[a.status] += 1));
    const pct = (n: number) => filtradas.length > 0 ? Math.round((n / filtradas.length) * 100) : 0;

    return {
      total: analises.length,
      concluidas: concluidas.length,
      concluidasFiltradas: filtradas.length,
      aguardando,
      rascunho,
      avgPrimeira: avg(dur1),
      avgPrimeiraN: dur1.length,
      avgSegunda: avg(dur2),
      byStatus,
      pct,
    };
  }, [analises, concluidas, filtradas]);

  const handleExportarCSV = () => {
    const header = [
      "id",
      "data",
      "cnpj",
      "razao_social",
      "tipo_pep",
      "nome_pep",
      "cargo",
      "orgao",
      "status",
      "duracao_primeira_s",
      "duracao_segunda_s",
    ];
    const rows = filtradas.map((a) => [
      a.id,
      a.createdAt,
      a.cliente.cnpj,
      `"${a.cliente.razaoSocial.replace(/"/g, '""')}"`,
      a.cliente.tipoPep,
      `"${(a.cliente.nomePessoaVinculada || a.cliente.nomeResponsavel).replace(/"/g, '""')}"`,
      `"${(a.cliente.cargoPep || "").replace(/"/g, '""')}"`,
      `"${(a.cliente.orgaoPublico || "").replace(/"/g, '""')}"`,
      a.status,
      a.duracaoPrimeiraCamada ?? "",
      a.duracaoSegundos ?? "",
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    download(csv, "analises-pepito.csv", "text/csv");
    toast({ variant: "success", title: "CSV exportado" });
  };

  const handleExportarTexto = () => {
    const txt = filtradas.map((a) => exportarAnaliseTexto(a)).join("\n\n" + "=".repeat(60) + "\n\n");
    download(txt, "pareceres-pepito.txt", "text/plain");
    toast({ variant: "success", title: "Pareceres exportados" });
  };

  const handleExcluir = () => {
    if (!confirmDel) return;
    storage.deleteAnalise(confirmDel, motivo || "Sem motivo informado");
    setConfirmDel(null);
    setMotivo("");
    reload();
    toast({ variant: "success", title: "Análise excluída" });
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" /> Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Histórico, métricas e exportação das análises concluídas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing} title="Atualizar casos">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button variant="outline" onClick={handleExportarCSV} disabled={filtradas.length === 0}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={handleExportarTexto} disabled={filtradas.length === 0}>
            <Download className="h-4 w-4" /> Pareceres .txt
          </Button>
          <Button onClick={() => navigate("/primeira-camada")}>
            <Plus className="h-4 w-4" /> Nova análise
          </Button>
        </div>
      </div>

      {/* Histórico PEP (base histórica - Athena) */}
      <PepHistorySection analises={analises} />

      {/* Métricas locais (sessão / Pepito) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <KPI label="Total (acumulado)" value={metricas.total} />
        <KPI label="Concluídas (acumulado)" value={metricas.concluidas} variant="success" />
        <KPI label="Aguardando 2ª" value={metricas.aguardando} variant="warning" />
        <KPI label="Rascunhos" value={metricas.rascunho} variant="muted" />
        <KPI
          label="Tempo médio Check Analista"
          value={formatDuration(metricas.avgPrimeira)}
          subtitle={`${metricas.avgPrimeiraN} análise${metricas.avgPrimeiraN === 1 ? "" : "s"}`}
        />
        <KPI label="Tempo médio Check Liderança" value={formatDuration(metricas.avgSegunda)} />
      </div>
      {/* Status breakdown — reflete o filtro ativo (período/status/busca) */}
      <div>
        {filtroPeriodoAtivo && (
          <p className="text-[11px] text-primary font-medium mb-2">
            Filtro ativo — exibindo {metricas.concluidasFiltradas} de {metricas.concluidas} análises concluídas
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPI label="Aprovados" value={metricas.byStatus.aprovado} pct={metricas.pct(metricas.byStatus.aprovado)} variant="success" />
          <KPI label="Monitoramento" value={metricas.byStatus.monitoramento} pct={metricas.pct(metricas.byStatus.monitoramento)} variant="warning" />
          <KPI label="Reprovados" value={metricas.byStatus.reprovado} pct={metricas.pct(metricas.byStatus.reprovado)} variant="danger" />
          <KPI label="Falso Positivo" value={metricas.byStatus.falso_positivo} pct={metricas.pct(metricas.byStatus.falso_positivo)} variant="muted" />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Distribuição por status</CardTitle>
            <CardDescription>
              {filtroPeriodoAtivo
                ? `Período filtrado: ${filtradas.length} de ${concluidas.length} concluídas`
                : `Concluídas: ${concluidas.length}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {filtradas.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={dadosPizza} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {dadosPizza.map((d) => (
                      <Cell key={d.key} fill={STATUS_COLORS[d.key]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Volume diário</CardTitle>
            <CardDescription>Últimos {dadosBarras.length} dias com atividade.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {dadosBarras.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer>
                <BarChart data={dadosBarras}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="aprovado" name="Aprovado" stackId="a" fill={STATUS_COLORS.aprovado} />
                  <Bar dataKey="monitoramento" name="Monitoramento" stackId="a" fill={STATUS_COLORS.monitoramento} />
                  <Bar dataKey="reprovado" name="Reprovado" stackId="a" fill={STATUS_COLORS.reprovado} />
                  <Bar dataKey="falso_positivo" name="Falso positivo" stackId="a" fill={STATUS_COLORS.falso_positivo} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Análises por Analista (1ª Camada) */}
      {porAnalista.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Análises por Analista (1ª Camada)
            </CardTitle>
            <CardDescription>
              Baseado no comentário de envio à Liderança. Inclui todos os status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="text-left py-2 pr-4">Analista</th>
                    <th className="text-right py-2 px-3">Total</th>
                    <th className="text-right py-2 px-3 text-green-600">Aprovado</th>
                    <th className="text-right py-2 px-3 text-yellow-600">Monit.</th>
                    <th className="text-right py-2 px-3 text-red-600">Reprovado</th>
                    <th className="text-right py-2 px-3 text-blue-600">Falso+</th>
                  </tr>
                </thead>
                <tbody>
                  {porAnalista.map((row) => (
                    <tr key={row.nome} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-4 font-medium">{row.nome}</td>
                      <td className="text-right py-2 px-3 font-bold">{row.total}</td>
                      <td className="text-right py-2 px-3 text-green-600">{row.aprovado || "—"}</td>
                      <td className="text-right py-2 px-3 text-yellow-600">{row.monitoramento || "—"}</td>
                      <td className="text-right py-2 px-3 text-red-600">{row.reprovado || "—"}</td>
                      <td className="text-right py-2 px-3 text-blue-600">{row.falso_positivo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Status</Label>
              <Select
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as "todos" | StatusAnalise)}
              >
                {FILTROS.map((f) => (
                  <option key={f} value={f}>
                    {f === "todos" ? "Todos" : STATUS_LABELS[f]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>De</Label>
              <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
            <div>
              <Label>Buscar</Label>
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="CNPJ ou razão social"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle>Análises concluídas ({filtradas.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtradas.length === 0 ? (
            <div className="p-8">
              <Empty />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <Th>Data decisão</Th>
                    <Th>CNPJ</Th>
                    <Th>Razão Social</Th>
                    <Th>PEP</Th>
                    <Th>Status</Th>
                    <Th>Check Analista</Th>
                    <Th>Check Liderança</Th>
                    <Th>Tempo médio de análise</Th>
                    <Th align="right">Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((a) => (
                    <tr key={a.id} className="border-t hover:bg-muted/20">
                      <Td>{formatDate(a.concludedAt || a.createdAt)}</Td>
                      <Td className="font-mono text-xs">{a.cliente.cnpj}</Td>
                      <Td className="max-w-[260px] truncate">{a.cliente.razaoSocial}</Td>
                      <Td className="max-w-[200px] truncate">
                        {a.cliente.nomePessoaVinculada || a.cliente.nomeResponsavel}
                      </Td>
                      <Td>
                        <StatusBadge status={a.status} />
                      </Td>
                      <Td className="font-mono text-xs">
                        {a.duracaoPrimeiraCamada ? formatDuration(a.duracaoPrimeiraCamada) : "—"}
                      </Td>
                      <Td className="font-mono text-xs">
                        {a.duracaoSegundos ? formatDuration(a.duracaoSegundos) : "—"}
                      </Td>
                      <Td className="font-mono text-xs font-semibold">
                        {formatDuration((a.duracaoPrimeiraCamada || 0) + (a.duracaoSegundos || 0))}
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setVerAnalise(a)} title="Ver">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setConfirmDel(a.id)}
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!confirmDel}
        onOpenChange={(o) => !o && setConfirmDel(null)}
        title="Excluir análise"
        description="A exclusão é registrada na auditoria. Informe o motivo."
      >
        <div className="space-y-3">
          <Input
            placeholder="Motivo (obrigatório)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleExcluir} disabled={!motivo.trim()}>
              Excluir
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!verAnalise}
        onOpenChange={(o) => !o && setVerAnalise(null)}
        title={verAnalise?.cliente.razaoSocial}
        description={verAnalise ? `CNPJ ${verAnalise.cliente.cnpj}` : ""}
        className="max-w-3xl"
      >
        {verAnalise && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={verAnalise.status} />
              <span className="text-xs text-muted-foreground">
                {formatDate(verAnalise.createdAt)} · 1ª camada {formatDuration(verAnalise.duracaoPrimeiraCamada)} ·
                2ª camada {formatDuration(verAnalise.duracaoSegundos)}
              </span>
            </div>
            <details>
              <summary className="cursor-pointer font-medium">Parecer da 1ª Camada</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted p-3 rounded">
                {verAnalise.parecerPrimeiraCamada || "—"}
              </pre>
            </details>
            <details open>
              <summary className="cursor-pointer font-medium">Parecer Final (Mesa)</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted p-3 rounded">
                {verAnalise.parecerCompleto || "—"}
              </pre>
            </details>
            <details>
              <summary className="cursor-pointer font-medium">
                Resultados da pesquisa ({verAnalise.resultadosPesquisa.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {verAnalise.resultadosPesquisa.map((r) => (
                  <li key={r.id} className={r.descartado ? "line-through opacity-60" : ""}>
                    [{r.risco}] <span className="font-medium">{r.fonte}</span> — {r.resumo}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function KPI({
  label,
  value,
  pct,
  subtitle,
  variant = "default",
}: {
  label: string;
  value: string | number;
  pct?: number;
  subtitle?: string;
  variant?: "default" | "success" | "warning" | "muted" | "danger";
}) {
  const colors: Record<string, string> = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    muted: "text-muted-foreground",
    danger: "text-destructive",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${colors[variant]}`}>
          {value}
          {pct !== undefined && (
            <span className="text-sm font-normal text-muted-foreground ml-1.5">({pct}%)</span>
          )}
        </p>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th className={`px-4 py-2 ${align === "right" ? "text-right" : "text-left"} font-semibold`}>
      {children}
    </th>
  );
}
function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-2 ${align === "right" ? "text-right" : "text-left"} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
function Empty() {
  return (
    <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-8">
      <LayoutDashboard className="h-10 w-10 opacity-30 mb-2" />
      <p className="text-sm">Sem análises concluídas para exibir.</p>
    </div>
  );
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Mapeia StatusAnalise (Pepito) para o status_pepito equivalente do histórico. */
function pepStatusFromLocal(s: StatusAnalise): "aprovado" | "reprovado" {
  if (s === "reprovado") return "reprovado";
  return "aprovado"; // monitoramento, falso_positivo e aprovado = aprovado na base histórica
}

function PepHistorySection({ analises }: { analises: Analise[] }) {
  const meta = PEP_HISTORY._meta;

  // Carrega análises do servidor (persistidas em analises-salvas.json via git-push).
  // Garante que casos decididos em outras sessões (ou por outros analistas) também
  // entrem no mapa de overrides, zerando o "em andamento" residual.
  const [serverAnalises, setServerAnalises] = React.useState<Analise[]>([]);
  React.useEffect(() => {
    fetch("/api/analises")
      .then((r) => (r.ok ? r.json() : { analises: [] }))
      .then((d) => setServerAnalises(Array.isArray(d.analises) ? d.analises : []))
      .catch(() => {});
  }, []);

  // Conjunto completo: localStorage + servidor, sem duplicatas (mesmo id).
  const allAnalises = React.useMemo(() => {
    const localIds = new Set(analises.map((a) => a.id));
    return [...analises, ...serverAnalises.filter((a) => !localIds.has(a.id))];
  }, [analises, serverAnalises]);

  // Universo efetivo = snapshot Athena + análises concluídas localmente no Pepito
  // que ainda não estão no snapshot (assim o "Total analisado" cresce conforme
  // a operação decide novos casos, em vez de ficar travado no número do snapshot).
  const items = React.useMemo<PepHistoryItem[]>(() => {
    const snapshotIds = new Set(PEP_HISTORY.items.map((it) => it.draft_membership_id));
    const sintéticos: PepHistoryItem[] = allAnalises
      .filter((a) => a.camadaStatus === "concluido")
      .filter((a) => !a.draftId || !snapshotIds.has(a.draftId))
      .map((a) => ({
        draft_membership_id: a.draftId || `local:${a.id}`,
        status_pepito: pepStatusFromLocal(a.status),
        tipo_pep: a.cliente.tipoPep === "titular" ? "titular" : "relacionado",
        ds_vinculo: a.cliente.tipoPep === "relacionado" ? (a.cliente.grauParentesco || a.cliente.tipoVinculo || null) : null,
        raw_status: "LOCAL_PEPITO",
        motivo: "PLD_SCORE",
        motivo_label: "Análise local Pepito",
        decision_at: a.concludedAt || a.createdAt,
        pld_entered_at: a.createdAt,
        competencia_at: a.concludedAt || a.createdAt,
      }));
    return [...PEP_HISTORY.items, ...sintéticos];
  }, [allAnalises]);

  const [filtro, setFiltro] = React.useState<"todos" | "aprovado" | "reprovado" | "em_andamento">("todos");
  const [tipoPepFiltro, setTipoPepFiltro] = React.useState<"todos" | "titular" | "relacionado">("todos");
  const [vinculoFiltro, setVinculoFiltro] = React.useState<string>("todos");
  const [dataDe, setDataDe] = React.useState<string>("");
  const [dataAte, setDataAte] = React.useState<string>("");

  // Mapa de overrides: draft_membership_id → { status, concludedAt }.
  // Casos concluídos no Pepito (localStorage + servidor) sobrepõem o snapshot Athena.
  // concludedAt é usado como data de referência para filtros mensais — garante que o
  // caso seja contado no mês em que foi ANALISADO, não quando entrou na fila PLD.
  const localOverrides = React.useMemo(() => {
    const map = new Map<string, { status: "aprovado" | "reprovado"; concludedAt: string }>();
    for (const a of allAnalises) {
      if (a.camadaStatus === "concluido" && a.draftId) {
        map.set(a.draftId, {
          status: pepStatusFromLocal(a.status),
          concludedAt: a.concludedAt || a.createdAt,
        });
      }
    }
    return map;
  }, [allAnalises]);

  /** Resolve o status efetivo de um item: local tem prioridade sobre Athena. */
  const statusEfetivo = React.useCallback(
    (it: PepHistoryItem): string => localOverrides.get(it.draft_membership_id)?.status ?? it.status_pepito,
    [localOverrides],
  );

  // Universo filtrado para KPIs, tabela e pizza
  const universo = React.useMemo(() => {
    const deTs = dataDe ? new Date(dataDe + "T00:00:00").getTime() : null;
    const ateTs = dataAte ? new Date(dataAte + "T23:59:59").getTime() : null;
    return items.filter((it) => {
      if (it.status_pepito === "aguardando_cliente") return false;
      if (tipoPepFiltro !== "todos" && it.tipo_pep !== tipoPepFiltro) return false;
      if (vinculoFiltro !== "todos" && (it.ds_vinculo || "—") !== vinculoFiltro) return false;
      if (deTs !== null || ateTs !== null) {
        // Prioridade de data: 1) concludedAt do Pepito (quando foi ANALISADO)
        // 2) competencia_at da planilha de controle 3) decision_at 4) pld_entered_at
        // Isso garante que um caso analisado em Maio seja contado em Maio,
        // mesmo que tenha entrado na fila em Abril.
        const override = localOverrides.get(it.draft_membership_id);
        const dateRef = override?.concludedAt || it.competencia_at || it.decision_at || it.pld_entered_at;
        if (!dateRef) return false;
        const ts = new Date(dateRef).getTime();
        if (Number.isNaN(ts)) return false;
        if (deTs !== null && ts < deTs) return false;
        if (ateTs !== null && ts > ateTs) return false;
      }
      return true;
    });
  }, [items, tipoPepFiltro, vinculoFiltro, dataDe, dataAte]);

  const byStatusFiltered = React.useMemo(() => {
    const acc: Record<string, number> = {};
    for (const it of universo) {
      const s = statusEfetivo(it);
      acc[s] = (acc[s] || 0) + 1;
    }
    return acc;
  }, [universo, statusEfetivo]);

  // Top 3 varre TODA a base histórica (sem filtros de data/tipo/vínculo),
  // aplicando os overrides locais para refletir decisões concluídas no Pepito.
  const top3Vinculos = React.useMemo(() => {
    const aprov: Record<string, number> = {};
    const repr: Record<string, number> = {};
    for (const it of items) {
      if (it.status_pepito === "aguardando_cliente") continue;
      if (!it.ds_vinculo) continue;
      const s = statusEfetivo(it);
      if (s === "aprovado") aprov[it.ds_vinculo] = (aprov[it.ds_vinculo] || 0) + 1;
      else if (s === "reprovado") repr[it.ds_vinculo] = (repr[it.ds_vinculo] || 0) + 1;
    }
    const top3 = (counts: Record<string, number>) =>
      Object.entries(counts)
        .map(([vinculo, n]) => ({ vinculo, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 3);
    const aprovTop = top3(aprov);
    const reprTop = top3(repr);
    const vinculosUnion = Array.from(new Set([...aprovTop.map((x) => x.vinculo), ...reprTop.map((x) => x.vinculo)]));
    return vinculosUnion
      .map((v) => ({ vinculo: v, aprovado: aprov[v] || 0, reprovado: repr[v] || 0 }))
      .sort((a, b) => b.aprovado + b.reprovado - (a.aprovado + a.reprovado));
  }, [items, statusEfetivo]);

  const totalUniverso = universo.length;
  const aprovados = byStatusFiltered.aprovado || 0;
  const reprovados = byStatusFiltered.reprovado || 0;
  const emAndamento = byStatusFiltered.em_andamento || 0;
  const falsoPositivos = byStatusFiltered.falso_positivo || 0;
  const totalDecidido = aprovados + reprovados + falsoPositivos;
  const taxaReprovacao = totalDecidido > 0 ? Math.round((reprovados / totalDecidido) * 1000) / 10 : 0;

  const dadosPizza = [
    { name: "Aprovado", key: "aprovado", value: aprovados },
    { name: "Reprovado", key: "reprovado", value: reprovados },
    { name: "Falso Positivo", key: "falso_positivo", value: falsoPositivos },
    { name: "Em andamento", key: "em_andamento", value: emAndamento },
  ];
  const PIE_COLORS: Record<string, string> = {
    aprovado: "#16a34a",
    reprovado: "#dc2626",
    falso_positivo: "#3b82f6",
    em_andamento: "#94a3b8",
  };

  // Lista única de vínculos para o filtro (apenas registros com tipo=relacionado)
  const vinculosUnicos = React.useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.status_pepito === "aguardando_cliente") continue;
      if (it.tipo_pep === "relacionado" && it.ds_vinculo) set.add(it.ds_vinculo);
    }
    return Array.from(set).sort();
  }, [items]);

  const filtrados = React.useMemo(() => {
    const arr = filtro === "todos" ? universo : universo.filter((i) => statusEfetivo(i) === filtro);
    return arr.slice(0, 200); // amostra recente
  }, [filtro, universo, statusEfetivo]);

  const fetchedAtFmt = meta.fetched_at
    ? new Date(meta.fetched_at).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" /> Histórico de Análises PEP (base histórica)
        </CardTitle>
        <CardDescription>
          Universo: cadastros que passaram pela Fila PLD (sub_status=PLD_SCORE) — Athena{" "}
          <code className="bg-muted px-1 rounded">dumps.registration_draft_membership_registration_status</code>{" "}
          + <code className="bg-muted px-1 rounded">squad_core.registration_notebook_output</code> (pep_pf).{" "}
          Casos com status final <code>WAITING_EMAIL_RESPONSE</code> ficam fora (não estão na fila PLD).{" "}
          Snapshot Athena atualizado 1×/dia (último: {fetchedAtFmt}) e somado às análises concluídas localmente no Pepito que ainda não constam no snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Filtros globais (afetam KPIs, gráficos e tabela) */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Tipo de PEP</label>
            <Select
              value={tipoPepFiltro}
              onChange={(e) => {
                setTipoPepFiltro(e.target.value as typeof tipoPepFiltro);
                if (e.target.value !== "relacionado") setVinculoFiltro("todos");
              }}
              className="w-auto min-w-[180px]"
            >
              <option value="todos">Todos</option>
              <option value="titular">Titular</option>
              <option value="relacionado">Relacionado</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Tipo de vínculo {tipoPepFiltro === "titular" ? "(N/A para titular)" : ""}
            </label>
            <Select
              value={vinculoFiltro}
              onChange={(e) => setVinculoFiltro(e.target.value)}
              disabled={tipoPepFiltro === "titular"}
              className="w-auto min-w-[200px]"
            >
              <option value="todos">Todos</option>
              {vinculosUnicos.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Data de</label>
            <input
              type="date"
              value={dataDe}
              onChange={(e) => setDataDe(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Data até</label>
            <input
              type="date"
              value={dataAte}
              onChange={(e) => setDataAte(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          {(tipoPepFiltro !== "todos" || vinculoFiltro !== "todos" || dataDe || dataAte) && (
            <button
              type="button"
              onClick={() => {
                setTipoPepFiltro("todos");
                setVinculoFiltro("todos");
                setDataDe("");
                setDataAte("");
              }}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              limpar filtros
            </button>
          )}
        </div>

        {/* KPIs (refletem filtros acima) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPI label="Total analisado" value={totalUniverso} />
          <KPI label="Aprovado" value={aprovados} pct={totalUniverso > 0 ? Math.round((aprovados / totalUniverso) * 100) : 0} variant="success" />
          <KPI label="Reprovado" value={reprovados} pct={totalUniverso > 0 ? Math.round((reprovados / totalUniverso) * 100) : 0} variant="danger" />
          <KPI label="Falso Positivo" value={falsoPositivos} pct={totalUniverso > 0 ? Math.round((falsoPositivos / totalUniverso) * 100) : 0} variant="default" />
          <KPI label="Em andamento" value={emAndamento} pct={totalUniverso > 0 ? Math.round((emAndamento / totalUniverso) * 100) : 0} variant="muted" />
        </div>
        <div className="text-xs text-muted-foreground">
          Taxa de reprovação (sobre decididos): <span className="font-semibold">{taxaReprovacao}%</span>
          {" · "}
          {totalDecidido} decisões finais ({aprovados} aprovadas + {reprovados} reprovadas + {falsoPositivos} falsos positivos)
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Distribuição por status</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={dadosPizza} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {dadosPizza.map((d) => (
                      <Cell key={d.key} fill={PIE_COLORS[d.key]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Top 3 vínculos — aprovados vs reprovados</CardTitle>
              <CardDescription className="text-[11px]">
                União dos 3 vínculos com mais aprovações e dos 3 com mais reprovações (apenas tipo PEP relacionado).
              </CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {top3Vinculos.length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer>
                  <BarChart data={top3Vinculos} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="vinculo" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="aprovado" name="Aprovados" fill="#16a34a" />
                    <Bar dataKey="reprovado" name="Reprovados" fill="#dc2626" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabela amostral */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              Decisões recentes (amostra)
              <Badge variant="outline" className="text-[10px]">
                exibindo {filtrados.length} de {totalUniverso}
              </Badge>
            </h3>
            <Select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as typeof filtro)}
              className="w-auto min-w-[180px]"
            >
              <option value="todos">Todos</option>
              <option value="aprovado">Aprovado</option>
              <option value="reprovado">Reprovado</option>
              <option value="falso_positivo">Falso Positivo</option>
              <option value="em_andamento">Em andamento</option>
            </Select>
          </div>
          <div className="rounded-md border max-h-[420px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground sticky top-0">
                <tr>
                  <Th>Data decisão</Th>
                  <Th>Status</Th>
                  <Th>Tipo PEP</Th>
                  <Th>Vínculo</Th>
                  <Th>Motivo (se reprovado)</Th>
                  <Th>draft_membership_id</Th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((it) => (
                  <tr key={it.draft_membership_id} className="border-t hover:bg-muted/20">
                    <Td className="text-xs">
                      {(() => {
                        const override = localOverrides.get(it.draft_membership_id);
                        const d = override?.concludedAt || it.competencia_at || it.decision_at || it.pld_entered_at;
                        return d ? new Date(d).toLocaleDateString("pt-BR") : "—";
                      })()}
                    </Td>
                    <Td>
                      {(() => {
                        const s = statusEfetivo(it);
                        const isLocalDecision = localOverrides.has(it.draft_membership_id);
                        return s === "aprovado" ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Aprovado{isLocalDecision && <span className="text-[10px] text-muted-foreground">(Pepito)</span>}
                          </span>
                        ) : s === "reprovado" ? (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <XCircle className="h-3.5 w-3.5" /> Reprovado{isLocalDecision && <span className="text-[10px] text-muted-foreground">(Pepito)</span>}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" /> Em andamento
                          </span>
                        );
                      })()}
                    </Td>
                    <Td className="text-xs">
                      {it.tipo_pep === "titular" ? "Titular" : it.tipo_pep === "relacionado" ? "Relacionado" : "—"}
                    </Td>
                    <Td className="text-xs">{it.ds_vinculo || "—"}</Td>
                    <Td className="text-xs">
                      {statusEfetivo(it) === "reprovado" ? (it.motivo_label || motivoPt(it.motivo || "")) : "—"}
                    </Td>
                    <Td className="font-mono text-[10px] text-muted-foreground">{it.draft_membership_id}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
