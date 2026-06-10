import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Gavel,
  Search,
  Save,
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  Building2,
  PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ResultadoCard } from "@/components/ResultadoCard";
import { HistoricoComentarios } from "@/components/HistoricoComentarios";
import { useToast } from "@/components/ui/toast";
import { storage, timer } from "@/lib/storage";
import {
  pesquisarFontesPublicas,
  reanalisarResultado,
} from "@/lib/mock-ai";
import { gerarParecerLideranca, statusLabel } from "@/lib/parecer";
import { getSugestaoLideranca, getPldRiskScore, getComentariosReais } from "@/data/registration-enrich";
import type { PldRiskScore } from "@/data/registration-enrich";
import { formatDuration } from "@/lib/utils";
import type { Analise, ComentarioAnalise, ResultadoPesquisa, StatusAnalise } from "@/types/kyc";
import { STATUS_LABELS, StatusBadge } from "@/components/RiscoBadge";

const STATUS_OPTIONS: StatusAnalise[] = ["aprovado", "monitoramento", "reprovado", "falso_positivo"];

export function NovaAnalise() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get("id");
  const { toast } = useToast();

  const [analise, setAnalise] = useState<Analise | undefined>();
  const [resultados, setResultados] = useState<ResultadoPesquisa[]>([]);
  const [analiseGeral, setAnaliseGeral] = useState("");
  const [parecerCompleto, setParecerCompleto] = useState("");
  const [decisao, setDecisao] = useState<StatusAnalise>("aprovado");
  const [observacoesPesquisa, setObservacoesPesquisa] = useState("");
  const [pesquisando, setPesquisando] = useState(false);
  // Timer Check Liderança — persistente por analiseId. Inicia no primeiro
  // acesso ("Decidir na Mesa") e limpa quando a decisão final é gravada.
  const timerKey = id ? `lideranca:${id}` : null;
  const [tInicio, setTInicio] = useState<number>(() =>
    timerKey ? timer.startOrGet(timerKey) : Date.now(),
  );
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    if (timerKey) setTInicio(timer.startOrGet(timerKey));
  }, [timerKey]);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!id) return;
    const a = storage.getAnalise(id);
    if (a) {
      setAnalise(a);
      setResultados(a.resultadosPesquisa);
      setAnaliseGeral(a.analiseGeral || "");
      setDecisao(a.status);

      // Auto-preenche o parecer final se ainda não foi redigido.
      // Prioridade: sugestão IA da Mesa → template gerado pelo motor local.
      if (a.parecerCompleto && a.parecerCompleto.trim().length > 0) {
        setParecerCompleto(a.parecerCompleto);
      } else {
        const sugLid = a.draftId ? getSugestaoLideranca(a.draftId) : null;
        const parecerGerado = sugLid?.text ?? gerarParecerLideranca({
          cliente: a.cliente,
          status: a.status,
          resultados: a.resultadosPesquisa,
          analiseConsolidada: a.analiseConsolidadaLideranca || "",
          parecerPrimeiraCamada: a.parecerPrimeiraCamada,
        });
        setParecerCompleto(parecerGerado);
        // Persiste para que aberturas subsequentes não regenerem
        storage.saveAnalise({ ...a, parecerCompleto: parecerGerado });
      }
    }
  }, [id]);

  const decorrido = Math.floor((agora - tInicio) / 1000);

  const altos = useMemo(
    () => resultados.filter((r) => !r.descartado && r.risco === "alto").length,
    [resultados],
  );
  const medios = useMemo(
    () => resultados.filter((r) => !r.descartado && r.risco === "medio").length,
    [resultados],
  );

  if (!analise) {
    // Sem caso carregado: 2ª Camada vai direto para input manual (per PDF design)
    if (!id) {
      return <Navigate to="/novo-caso-manual" replace />;
    }
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gavel className="h-5 w-5 text-primary" /> Caso não encontrado
            </CardTitle>
            <CardDescription>O id "{id}" não corresponde a nenhuma análise salva.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/fila-revisao")}>
              <Eye className="h-4 w-4" /> Abrir Fila de Revisão
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleRepescaisar = async () => {
    setPesquisando(true);
    try {
      const out = await pesquisarFontesPublicas({
        cliente: analise.cliente,
        observacoesAnalista: observacoesPesquisa,
      });
      setResultados(out.resultados);
      setAnaliseGeral(out.analiseGeral);
      toast({
        variant: "success",
        title: "Pesquisa atualizada",
        description: `${out.resultados.length} apontamentos.`,
      });
    } finally {
      setPesquisando(false);
    }
  };

  const handleReanalisar = async (rid: string, observacao: string) => {
    const target = resultados.find((r) => r.id === rid);
    if (!target) return;
    const novo = await reanalisarResultado({ resultado: target, observacao, cliente: analise.cliente });
    setResultados((rs) => rs.map((r) => (r.id === rid ? novo : r)));
    toast({ variant: "success", title: "Resultado reanalisado" });
  };

  const handleGerarParecer = () => {
    const texto = gerarParecerLideranca({
      cliente: analise.cliente,
      status: decisao,
      resultados,
      analiseConsolidada: "",
      parecerPrimeiraCamada: analise.parecerPrimeiraCamada,
    });
    setParecerCompleto(texto);
    toast({ variant: "success", title: "Template do parecer preenchido" });
  };

  const handleConcluir = () => {
    if (parecerCompleto.trim().length < 30) {
      toast({
        variant: "destructive",
        title: "Parecer incompleto",
        description: "Gere ou redija o parecer final antes de concluir.",
      });
      return;
    }
    const final: Analise = {
      ...analise,
      resultadosPesquisa: resultados,
      analiseGeral,
      status: decisao,
      recomendacao: statusLabel(decisao),
      parecerCompleto,
      camadaStatus: "concluido",
      duracaoSegundos: decorrido,
      concludedAt: new Date().toISOString(),
    };
    storage.saveAnalise(final);
    // Para o cronômetro do Check Liderança — duração consolidada na Analise.
    if (timerKey) timer.clear(timerKey);
    toast({
      variant: "success",
      title: "Decisão registrada",
      description: STATUS_LABELS[decisao],
    });
    navigate("/dashboard");
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gavel className="h-6 w-6 text-primary" /> Mesa de Decisão (2ª Camada)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Liderança revisa os achados, consolida a análise e registra a decisão final.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-xs text-muted-foreground">2ª camada</span>
          <span className="font-mono font-semibold text-sm">{formatDuration(decorrido)}</span>
        </div>
      </div>

      {/* Resumo do cadastro */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" /> {analise.cliente.razaoSocial}
              </CardTitle>
              <CardDescription>
                CNPJ {analise.cliente.cnpj} · CNAE {analise.cliente.cnae || "—"} · {analise.cliente.enderecoComercial || "—"}
              </CardDescription>
            </div>
            {/* Indicador de risco LD */}
            {analise.draftId && <PldRiskBadgeInline draftId={analise.draftId} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Info label="PEP" value={analise.cliente.nomePessoaVinculada || analise.cliente.nomeResponsavel} />
            <Info label="Cargo" value={analise.cliente.cargoPep || "—"} />
            <Info label="Órgão" value={analise.cliente.orgaoPublico || "—"} />
            <Info label="Tipo" value={analise.cliente.tipoPep === "titular" ? "Titular" : "Relacionado"} />
            {analise.cliente.tipoPep === "relacionado" && analise.cliente.cpfPepTitular && (
              <Info label="CPF PEP titular" value={analise.cliente.cpfPepTitular} />
            )}
            {analise.cliente.tipoPep === "relacionado" && analise.cliente.credilinkNumeroToken && (
              <Info label="Token Credilink" value={analise.cliente.credilinkNumeroToken} />
            )}
            {analise.cliente.tipoPep === "relacionado" && analise.cliente.credilinkLinkDossie && (
              <Info label="Dossiê Credilink" value="↗ ver link abaixo" />
            )}
            <Info label="Capital" value={analise.cliente.capitalSocial || "—"} />
            <Info label="Faturamento" value={analise.cliente.faturamentoMensal || "—"} />
            <Info label="Constituição" value={analise.cliente.dataConstituicao || "—"} />
            <Info
              label="1ª Camada"
              value={`${formatDuration(analise.duracaoPrimeiraCamada)} · ${STATUS_LABELS[analise.status]}`}
            />
          </div>
          {analise.cliente.tipoPep === "relacionado" && analise.cliente.credilinkLinkDossie && (
            <div className="rounded-md border border-indigo-200 dark:border-indigo-700 bg-indigo-50/30 dark:bg-indigo-950/20 px-3 py-2 text-xs flex items-center gap-2">
              <span className="font-semibold text-indigo-700 dark:text-indigo-300">Dossiê Credilink:</span>
              <a
                href={analise.cliente.credilinkLinkDossie}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 truncate"
              >
                {analise.cliente.credilinkLinkDossie}
              </a>
            </div>
          )}
          {/* Síntese da análise (analise_geral + achados) */}
          {analise.analiseGeral && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Síntese da Análise (1ª Camada)
              </p>
              <p className="text-xs leading-relaxed">{analise.analiseGeral}</p>
              <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
                <span>
                  🔍 <span className="font-medium">{resultados.filter((r) => !r.descartado).length}</span> fontes mapeadas
                  {resultados.filter((r) => !r.descartado && r.risco === "alto").length > 0 && (
                    <span className="text-destructive ml-1">
                      · {resultados.filter((r) => !r.descartado && r.risco === "alto").length} alto risco
                    </span>
                  )}
                </span>
                <span>
                  📋 Sugestão 1ª camada: <span className="font-medium">{STATUS_LABELS[analise.status]}</span>
                </span>
              </div>
            </div>
          )}
          {/* Painel de fatores de risco LD */}
          {analise.draftId && <PldRiskPanel draftId={analise.draftId} />}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-6">
        {/* Esquerda */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Parecer da 1ª Camada</CardTitle>
              <CardDescription>Subsídio do analista que iniciou o caso.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                {analise.parecerPrimeiraCamada || "(sem parecer)"}
              </div>
            </CardContent>
          </Card>

          {/* Histórico e inclusão de comentários (timeline + input) */}
          <Card>
            <CardHeader>
              <CardTitle>Histórico do caso</CardTitle>
              <CardDescription>
                Pareceres e ações registradas no Retool/Pepito. Liderança pode acrescentar observações.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HistoricoComentarios
                comentarios={analise.historicoComentarios ?? []}
                onAdicionar={(novo) => {
                  const atualizada: Analise = {
                    ...analise,
                    historicoComentarios: [
                      ...(analise.historicoComentarios ?? []),
                      novo as ComentarioAnalise,
                    ],
                  };
                  setAnalise(atualizada);
                  storage.saveAnalise(atualizada);
                  toast({ variant: "success", title: "Comentário adicionado ao histórico" });
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Resultados da Pesquisa ({resultados.filter((r) => !r.descartado).length})</CardTitle>
                  <CardDescription>
                    {altos} de risco alto, {medios} de risco médio.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleRepescaisar} disabled={pesquisando}>
                  <Search className={pesquisando ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                  {pesquisando ? "Repesquisando..." : "Repesquisar"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[600px] overflow-y-auto scrollbar-thin">
              <Textarea
                value={observacoesPesquisa}
                onChange={(e) => setObservacoesPesquisa(e.target.value)}
                placeholder="Pontos novos para direcionar a IA antes de repesquisar (opcional)"
                rows={2}
              />
              {resultados.map((r) => (
                <ResultadoCard
                  key={r.id}
                  resultado={r}
                  onReanalisar={(obs) => handleReanalisar(r.id, obs)}
                  onDescartar={() =>
                    setResultados((rs) =>
                      rs.map((x) =>
                        x.id === r.id ? { ...x, descartado: true, motivoDescarte: "Descartado pela Mesa." } : x,
                      ),
                    )
                  }
                  onRestaurar={() =>
                    setResultados((rs) =>
                      rs.map((x) => (x.id === r.id ? { ...x, descartado: false, motivoDescarte: undefined } : x)),
                    )
                  }
                />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Direita — Decisão Final (campo único) */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gavel className="h-5 w-5 text-primary" /> Decisão Final
              </CardTitle>
              <CardDescription>
                Escolha uma das 4 categorias obrigatórias e redija o parecer final.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SugestaoDecisaoIA
                draftId={analise.draftId ?? ""}
                analise={analise}
                onUsarTexto={(texto, d) => {
                  setParecerCompleto(texto);
                  if (d) setDecisao(d);
                }}
              />
              <div>
                <Label htmlFor="dec">Categoria</Label>
                <Select id="dec" value={decisao} onChange={(e) => setDecisao(e.target.value as StatusAnalise)}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Visualização:</span> <StatusBadge status={decisao} />
              </div>
              <Button onClick={handleGerarParecer} variant="secondary" className="w-full">
                <Sparkles className="h-4 w-4" /> Gerar template de parecer
              </Button>
              <Textarea
                rows={14}
                value={parecerCompleto}
                onChange={(e) => setParecerCompleto(e.target.value)}
                placeholder="Redija aqui o parecer final (Markdown). Você pode usar a sugestão IA como base ou gerar template."
              />
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2 sticky bottom-0">
            <Button
              variant="outline"
              onClick={() => {
                storage.saveAnalise({
                  ...analise,
                  resultadosPesquisa: resultados,
                  analiseGeral,
                  parecerCompleto,
                  status: decisao,
                  recomendacao: statusLabel(decisao),
                  camadaStatus: "aguardando_segunda",
                });
                toast({ variant: "success", title: "Progresso salvo" });
              }}
            >
              <Save className="h-4 w-4" /> Salvar e voltar à fila
            </Button>
            <Button onClick={handleConcluir}>
              {decisao === "reprovado" ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              Registrar decisão final
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sugestão de Decisão IA ───────────────────────────────────────────────────

const DECISAO_CONFIG: Record<StatusAnalise, { label: string; color: string; bg: string; border: string }> = {
  aprovado:      { label: "APROVAR",                        color: "text-success",     bg: "bg-success/10",     border: "border-success/30" },
  monitoramento: { label: "APROVAR com Diligência Reforçada", color: "text-yellow-600", bg: "bg-yellow-50",      border: "border-yellow-200" },
  reprovado:     { label: "REPROVAR",                        color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30" },
  falso_positivo:{ label: "FALSO POSITIVO",                  color: "text-primary",     bg: "bg-primary/10",     border: "border-primary/30" },
};

function SugestaoDecisaoIA({
  draftId,
  analise,
  onUsarTexto,
}: {
  draftId: string;
  analise: Analise;
  onUsarTexto: (texto: string, decisao?: StatusAnalise) => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const sugLid = getSugestaoLideranca(draftId);
  const comentariosAnalista = getComentariosReais(draftId);
  const comentarioAnalista = comentariosAnalista.find(
    (c) => c.acao === "ENVIAR_LIDERANCA_PLD" && c.text
  ) ?? comentariosAnalista[0];

  // Fallback: usa o parecer da 1ª camada como base quando não há template da Mesa
  const parecerBase = analise.parecerPrimeiraCamada;
  if (!sugLid && !comentarioAnalista && !parecerBase) return null;

  const cfg = sugLid ? DECISAO_CONFIG[sugLid.decisao] : DECISAO_CONFIG.monitoramento;

  return (
    <div className="space-y-2.5">
      {/* ── Recomendação da IA ── */}
      {sugLid && (
        <div className={`rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}>
          {/* Badge de decisão */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={`text-xs font-black uppercase tracking-wide ${cfg.color}`}>
              <Sparkles className="inline h-3.5 w-3.5 mr-1" />
              IA sugere: {cfg.label}
            </span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setExpandido((v) => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline"
              >
                {expandido ? "▲ resumir" : "▼ ver parecer completo"}
              </button>
              <button
                type="button"
                onClick={() => onUsarTexto(sugLid.text, sugLid.decisao)}
                className="text-[10px] text-primary hover:underline font-semibold"
              >
                Usar como base →
              </button>
            </div>
          </div>

          {/* Resumo direto (sempre visível) */}
          <p className={`text-xs leading-relaxed ${cfg.color} font-medium`}>
            {sugLid.resumo}
          </p>

          {/* Parecer completo (expandível) */}
          {expandido && (
            <div className="mt-2 pt-2 border-t border-current/10">
              <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {sugLid.text}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Parecer da 1ª camada — fallback quando não há comentário via webhook ── */}
      {!comentarioAnalista && parecerBase && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
            📋 Parecer do analista (1ª camada)
          </p>
          <p className="text-[11px] leading-relaxed text-foreground/80 line-clamp-4">
            {parecerBase}
          </p>
          <button
            type="button"
            className="text-[10px] text-primary hover:underline mt-1"
            onClick={() => onUsarTexto(parecerBase)}
          >
            Usar como base →
          </button>
        </div>
      )}

      {/* ── Parecer do analista (insumo para a decisão) ── */}
      {comentarioAnalista && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
            📋 Parecer do analista ({comentarioAnalista.user_email?.split("@")[0]})
          </p>
          <p className="text-[11px] leading-relaxed text-foreground/80 line-clamp-4">
            {comentarioAnalista.text}
          </p>
          {comentarioAnalista.text && comentarioAnalista.text.length > 300 && (
            <button
              type="button"
              className="text-[10px] text-primary hover:underline mt-1"
              onClick={() => {
                // Scroll para o histórico de comentários
                document.getElementById("historico-caso")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Ver completo no histórico ↓
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium truncate">{value}</p>
    </div>
  );
}

// ─── Componentes de Risco LD ──────────────────────────────────────────────────

const NIVEL_CONFIG = {
  critico: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", bar: "bg-destructive", icon: "🔴", label: "CRÍTICO" },
  alto:    { color: "text-orange-600",  bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/20", bar: "bg-orange-500", icon: "🟠", label: "ALTO" },
  medio:   { color: "text-yellow-600",  bg: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20", bar: "bg-yellow-500", icon: "🟡", label: "MÉDIO" },
  baixo:   { color: "text-success",     bg: "bg-success/10 border-success/20", bar: "bg-success", icon: "🟢", label: "BAIXO" },
} as const;

const FATOR_DOT: Record<string, string> = { alto: "bg-destructive", medio: "bg-yellow-500", baixo: "bg-success" };
const FATOR_COLOR: Record<string, string> = { alto: "text-destructive", medio: "text-yellow-600", baixo: "text-success" };

/** Badge compacto exibido no header do card */
function PldRiskBadgeInline({ draftId }: { draftId: string }) {
  const score = getPldRiskScore(draftId);
  if (!score) return null;
  const cfg = NIVEL_CONFIG[score.nivel as keyof typeof NIVEL_CONFIG];
  const pct = Math.round(score.probabilidade);
  return (
    <div className={`shrink-0 rounded-lg border px-3 py-2 text-center min-w-[84px] ${cfg.bg}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none mb-0.5">Prob. LD</p>
      <p className={`text-xl font-black leading-none ${cfg.color}`}>{pct}%</p>
      <p className={`text-[10px] font-semibold leading-none mt-0.5 ${cfg.color}`}>{cfg.icon} {cfg.label}</p>
      <div className="mt-1.5 h-1 w-full rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Painel expandido com todos os fatores de risco */
function PldRiskPanel({ draftId }: { draftId: string }) {
  const score = getPldRiskScore(draftId);
  if (!score || score.fatores.length === 0) return null;
  const cfg = NIVEL_CONFIG[score.nivel as keyof typeof NIVEL_CONFIG];
  const pct = Math.round(score.probabilidade);

  return (
    <div className={`rounded-lg border p-4 ${cfg.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            Análise de Risco — Probabilidade de Lavagem de Dinheiro
          </p>
          <p className={`text-lg font-black leading-tight mt-0.5 ${cfg.color}`}>
            {pct}% {cfg.icon} {cfg.label}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted-foreground">Score modelo</p>
          <p className="font-mono text-sm font-semibold">{score.score_modelo}/{score.score_max}</p>
        </div>
      </div>

      {/* Barra */}
      <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden mb-4">
        <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${pct}%` }} />
      </div>

      {/* Fatores */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          {score.fatores.length} fator{score.fatores.length !== 1 ? "es" : ""} identificado{score.fatores.length !== 1 ? "s" : ""}
        </p>
        {score.fatores.map((f) => {
          const isRegulado = f.id === "cnae_regulado";
          const isFronteira = f.id === "municipio_fronteira" || f.id === "municipio_risco";
          const isEleitoral = f.id === "eleitoral_2026";
          return (
            <div
              key={f.id}
              className={`flex items-start gap-2.5 rounded-md p-2.5 ${
                isRegulado ? "bg-amber-50 border border-amber-200 dark:bg-amber-950/20" :
                isFronteira ? "bg-blue-50 border border-blue-200 dark:bg-blue-950/20" :
                isEleitoral ? "bg-destructive/5 border border-destructive/15" :
                "bg-background/60 border border-border/40"
              }`}
            >
              <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${FATOR_DOT[f.nivel] ?? "bg-muted"}`} />
              <div className="min-w-0 flex-1">
                {isRegulado && (
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
                    ⚠️ CNAE regulamentado — verificar autorização obrigatória
                  </p>
                )}
                {isFronteira && (
                  <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 mb-0.5">
                    📍 Circular BACEN 4.001 — Município de risco geográfico
                  </p>
                )}
                {isEleitoral && (
                  <p className="text-[11px] font-semibold text-destructive mb-0.5">
                    🗳️ Risco eleitoral 2026 — PEP com mandato ativo
                  </p>
                )}
                <p className={`text-xs leading-relaxed ${FATOR_COLOR[f.nivel] ?? "text-foreground/80"}`}>
                  {f.label}
                </p>
                {isRegulado && "orgao_url" in f && (f as { orgao_url?: string }).orgao_url && (
                  <a
                    href={(f as { orgao_url?: string }).orgao_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary underline font-medium"
                  >
                    Consultar órgão regulador →
                  </a>
                )}
              </div>
              <span className={`text-[9px] uppercase font-semibold shrink-0 ${FATOR_COLOR[f.nivel] ?? ""}`}>
                {f.nivel}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[9px] text-muted-foreground border-t pt-2">
        Modelo baseado em análise de 399 contas PLD-encerradas (risk_business.status='PLD', Cora).
        {score.gerado_em && <> Atualizado: {new Date(score.gerado_em).toLocaleDateString("pt-BR")}.</>}
      </p>
    </div>
  );
}
