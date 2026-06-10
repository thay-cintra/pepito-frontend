import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  User2,
  Search,
  Save,
  Plus,
  Trash2,
  ScanText,
  Clock,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { ResultadoCard } from "@/components/ResultadoCard";
import { useToast } from "@/components/ui/toast";
import { storage, timer } from "@/lib/storage";
import { getAuthUser } from "@/lib/auth";
import { pesquisarFontesPublicas, reanalisarResultado, consultarCredilink, type CredilinkResultado } from "@/lib/mock-ai";
import { clienteVazio } from "@/lib/cliente-default";
import { getRegistrationCase, markTaken, QUEUE_UPDATED_EVENT } from "@/lib/registration-queue";
import { inferCargoOrgao, inferTipoPep, getSugestaoParecer } from "@/data/registration-enrich";
import { formatCNPJ, formatCPF, formatDuration, uid } from "@/lib/utils";
import type { Analise, ClienteData, ResultadoPesquisa, Socio, StatusAnalise } from "@/types/kyc";
import { STATUS_LABELS, StatusBadge } from "@/components/RiscoBadge";
import { statusLabel } from "@/lib/parecer";

const STATUS_OPTIONS: StatusAnalise[] = ["aprovado", "monitoramento", "reprovado", "falso_positivo"];

export function AnalisePrimeiraCamada() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get("id");
  const prefillDraftId = params.get("prefill");
  const { toast } = useToast();
  const [draftIdOrigem, setDraftIdOrigem] = useState<string | null>(null);

  const [cliente, setCliente] = useState<ClienteData>(clienteVazio());
  const [parecerPrimeiraCamada, setParecerPrimeiraCamada] = useState("");
  const [resultados, setResultados] = useState<ResultadoPesquisa[]>([]);
  const [analiseGeral, setAnaliseGeral] = useState("");
  const [statusSugerido, setStatusSugerido] = useState<StatusAnalise>("aprovado");
  const [observacoesPesquisa, setObservacoesPesquisa] = useState("");
  const [pesquisando, setPesquisando] = useState(false);
  const [credilinkConsultando, setCredilinkConsultando] = useState(false);
  const [credilinkResultado, setCredilinkResultado] = useState<CredilinkResultado | null>(null);
  const [showOcr, setShowOcr] = useState(false);
  const [analistaEmail, setAnalistaEmail] = useState<string>("");

  useEffect(() => {
    getAuthUser().then((u) => { if (u?.email) setAnalistaEmail(u.email); });
  }, []);

  // Timer Check Analista — persistente em localStorage por draftId (ou editId).
  // Inicia no primeiro acesso (click em "Revisar e enviar" → navega prá cá) e
  // sobrevive a reload, navegação, fechar/abrir aba. Limpo quando o analista
  // clica "Enviar à Mesa".
  const timerKey = editId
    ? `analista:edit:${editId}`
    : prefillDraftId
      ? `analista:${prefillDraftId}`
      : null;
  const [tInicio, setTInicio] = useState<number>(() =>
    timerKey ? timer.startOrGet(timerKey) : Date.now(),
  );
  const [agora, setAgora] = useState<number>(Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Quando o draftId for resolvido depois do mount (ex.: edit existing), garante
  // que o cronômetro reflita a chave correta.
  useEffect(() => {
    if (timerKey) setTInicio(timer.startOrGet(timerKey));
  }, [timerKey]);

  // Carrega dados do caso quando a fila estiver disponível. Roda na montagem
  // e novamente quando a fila for atualizada (QUEUE_UPDATED_EVENT) — cobre o
  // cenário de hard refresh onde REGISTRATION_QUEUE ainda está vazia no mount.
  const carregarCaso = useCallback(() => {
    if (editId) {
      const a = storage.getAnalise(editId);
      if (a) {
        setCliente(a.cliente);
        setParecerPrimeiraCamada(a.parecerPrimeiraCamada);
        setResultados(a.resultadosPesquisa);
        setAnaliseGeral(a.analiseGeral || "");
        setStatusSugerido(a.status);
      }
      return;
    }
    if (!prefillDraftId) return;
    const caso = getRegistrationCase(prefillDraftId);
    if (!caso || draftIdOrigem === caso.draft_id) return; // já carregado
    if (caso) {
        const cargoOrgao = inferCargoOrgao(caso);
        const tipoPep = inferTipoPep(caso);
        setDraftIdOrigem(caso.draft_id);
        setCliente((c) => ({
          ...c,
          cnpj: caso.cnpj,
          razaoSocial: caso.rf_nome_oficial,
          nomeResponsavel: caso.full_name_pf,
          nomePessoaVinculada: cargoOrgao.nomePEP,
          cpfPepTitular: tipoPep === "relacionado" ? (cargoOrgao.cpfTitular || caso.pep_pf?.[0]?.cpf_titular || "") : "",
          credilinkNumeroToken: caso.token_pf_cred || "",
          credilinkLinkDossie: caso.token_pf_cred
            ? `https://dashboard.tesserati.com.br/Compliance/VisualizarDossie?token=${caso.token_pf_cred}`
            : "",
          cpfResponsavel: caso.cpf,
          tipoPep,
          tipoVinculo: tipoPep === "relacionado" ? "Owner é vínculo do PEP titular" : "",
          cargoPep: cargoOrgao.cargo,
          orgaoPublico: cargoOrgao.orgao,
          cnae: caso.cnae,
          enderecoComercial: caso.endereco_comercial,
          dataConstituicao: caso.data_constituicao,
          capitalSocial: caso.porte || "",
          faturamentoMensal: (caso.faturamento_presumido || "").replace(/^"|"$/g, ""),
          origemRecursos: "",
          motivoRelacionamento: `Conta puxada da Fila PLD do Retool (${caso.bucket}). draft_id: ${caso.draft_id}. Score PLD ${caso.score_pld}.`,
        }));
        // Investigação completa já carregada — analista só precisa revisar e decidir
        setResultados(caso.resultados_pesquisa);
        setAnaliseGeral(caso.analise_geral);
        // Prioriza sugestão LLM concisa (estilo Josinalva) sobre o template heurístico
        const sugestaoLlm = getSugestaoParecer(caso.draft_id, caso);
        setParecerPrimeiraCamada(sugestaoLlm ?? caso.parecer_sugerido);
        setStatusSugerido(caso.recomendacao_sugerida);
        toast({
          variant: "success",
          title: "Caso da Fila PLD carregado",
          description: sugestaoLlm
            ? `${caso.rf_nome_oficial} — sugestão de parecer pré-preenchida. Edite à vontade.`
            : `${caso.rf_nome_oficial} — ${caso.resultados_pesquisa.length} fontes mapeadas.`,
        });
      }
  }, [editId, prefillDraftId, draftIdOrigem]);

  useEffect(() => {
    carregarCaso();
    window.addEventListener(QUEUE_UPDATED_EVENT, carregarCaso);
    return () => window.removeEventListener(QUEUE_UPDATED_EVENT, carregarCaso);
  }, [carregarCaso]);

  const decorrido = Math.floor((agora - tInicio) / 1000);

  const update = (patch: Partial<ClienteData>) => setCliente((c) => ({ ...c, ...patch }));

  // Credilink: se o caso já tem token real (Athena), exibe diretamente; caso contrário não chama mock
  useEffect(() => {
    if (cliente.tipoPep !== "relacionado" || !cliente.cpfPepTitular) return;
    // Token real disponível — exibe sem chamar API mock
    if (cliente.credilinkNumeroToken) {
      setCredilinkResultado({
        numeroToken: cliente.credilinkNumeroToken,
        linkDossie: cliente.credilinkLinkDossie || "",
        consultadoEm: new Date().toISOString(),
        nomeConsultado: cliente.nomePessoaVinculada,
      });
      return;
    }
    // Sem token real — informa que a consulta deve ser feita manualmente
    setCredilinkResultado(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.cpfPepTitular, cliente.credilinkNumeroToken]);

  const addSocio = () =>
    update({ socios: [...cliente.socios, { nome: "", cpf: "", participacao: "" }] });
  const updateSocio = (i: number, patch: Partial<Socio>) =>
    update({ socios: cliente.socios.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const removeSocio = (i: number) => update({ socios: cliente.socios.filter((_, idx) => idx !== i) });

  const podeFinalizarPrimeira = useMemo(
    () => cliente.cnpj && cliente.razaoSocial && parecerPrimeiraCamada.trim().length > 10,
    [cliente, parecerPrimeiraCamada],
  );

  const handlePesquisar = async () => {
    if (!cliente.cnpj || !cliente.razaoSocial) {
      toast({
        variant: "destructive",
        title: "Cadastro incompleto",
        description: "Preencha pelo menos CNPJ e Razão Social antes de pesquisar.",
      });
      return;
    }
    setPesquisando(true);
    try {
      const out = await pesquisarFontesPublicas({ cliente, observacoesAnalista: observacoesPesquisa });
      setResultados(out.resultados);
      setAnaliseGeral(out.analiseGeral);
      setStatusSugerido(out.recomendacao);
      if (out.qsa.length && cliente.socios.length === 0) update({ socios: out.qsa });
      toast({
        variant: "success",
        title: "Pesquisa concluída",
        description: `${out.resultados.length} apontamentos coletados em ~1.4s.`,
      });
    } finally {
      setPesquisando(false);
    }
  };

  const handleReanalisar = async (id: string, observacao: string) => {
    const target = resultados.find((r) => r.id === id);
    if (!target) return;
    const novo = await reanalisarResultado({ resultado: target, observacao, cliente });
    setResultados((rs) => rs.map((r) => (r.id === id ? novo : r)));
    toast({ variant: "success", title: "Resultado reanalisado" });
  };

  const handleDescartar = (id: string) => {
    setResultados((rs) =>
      rs.map((r) => (r.id === id ? { ...r, descartado: true, motivoDescarte: "Descartado pelo analista." } : r)),
    );
  };

  const handleRestaurar = (id: string) => {
    setResultados((rs) =>
      rs.map((r) => (r.id === id ? { ...r, descartado: false, motivoDescarte: undefined } : r)),
    );
  };

  const handleSalvarRascunho = () => {
    const a = montarAnalise("rascunho");
    storage.saveAnalise(a);
    if (draftIdOrigem) markTaken(draftIdOrigem, a.id);
    toast({ variant: "success", title: "Rascunho salvo" });
  };

  const handleEnviarMesa = () => {
    if (!podeFinalizarPrimeira) {
      toast({
        variant: "destructive",
        title: "Falta o parecer",
        description: "Preencha o parecer técnico (mín. 10 caracteres) antes de enviar à Mesa.",
      });
      return;
    }
    const a = montarAnalise("aguardando_segunda");
    storage.saveAnalise(a);
    if (draftIdOrigem) markTaken(draftIdOrigem, a.id);
    // Para o cronômetro do Check Analista — duração já gravada na Analise.
    if (timerKey) timer.clear(timerKey);
    toast({
      variant: "success",
      title: "Enviado à Mesa de Decisão",
      description: "O cadastro está agora na Fila de Revisão.",
    });
    navigate("/fila-revisao");
  };

  function montarAnalise(camadaStatus: "rascunho" | "aguardando_segunda"): Analise {
    const id = editId ?? uid();
    const existente = editId ? storage.getAnalise(editId) : undefined;
    return {
      id,
      data: existente?.data ?? new Date().toISOString(),
      // Preserva o vínculo com o caso original da fila PLD — sem isso a Liderança
      // não consegue ligar a Analise ao draft_id no Retool e o caso "some" da
      // Fila de Revisão depois do envio.
      draftId: existente?.draftId ?? draftIdOrigem ?? undefined,
      cliente,
      parecerPrimeiraCamada,
      resultadosPesquisa: resultados,
      analiseGeral,
      analiseConsolidadaLideranca: existente?.analiseConsolidadaLideranca,
      status: statusSugerido,
      recomendacao: existente?.recomendacao ?? statusLabel(statusSugerido),
      parecerCompleto: existente?.parecerCompleto ?? "",
      camadaStatus,
      duracaoPrimeiraCamada: decorrido,
      duracaoSegundos: existente?.duracaoSegundos,
      analistaEmail: existente?.analistaEmail ?? (analistaEmail || undefined),
      createdAt: existente?.createdAt ?? new Date().toISOString(),
    };
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">1ª Camada — Análise do Pré-Cliente</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastre os dados, rode a pesquisa em fontes públicas e produza o parecer técnico para a Mesa de Decisão.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-xs text-muted-foreground">Decorrido</span>
          <span className="font-mono font-semibold text-sm">{formatDuration(decorrido)}</span>
        </div>
      </div>

      {draftIdOrigem && (
        <div className="rounded-md border border-primary/30 bg-secondary/40 p-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">Caso da fila PLD do Retool</span>
          <span className="text-muted-foreground">draft_id:</span>
          <code className="font-mono text-xs bg-background px-2 py-0.5 rounded border">
            {draftIdOrigem}
          </code>
          <span className="text-xs text-muted-foreground">
            Salvar/enviar fará o caso sair automaticamente da fila.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* Coluna esquerda — Formulário */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" /> Cadastro PJ
                  </CardTitle>
                  <CardDescription>Dados da Pessoa Jurídica e do PEP relacionado.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowOcr(true)}>
                  <ScanText className="h-4 w-4" /> OCR
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="cnpj">CNPJ *</Label>
                  <Input
                    id="cnpj"
                    value={cliente.cnpj}
                    onChange={(e) => update({ cnpj: formatCNPJ(e.target.value) })}
                    placeholder="00.000.000/0000-00"
                  />
                </div>
                <div>
                  <Label htmlFor="razao">Razão Social *</Label>
                  <Input
                    id="razao"
                    value={cliente.razaoSocial}
                    onChange={(e) => update({ razaoSocial: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="cnae">CNAE</Label>
                  <Input id="cnae" value={cliente.cnae} onChange={(e) => update({ cnae: e.target.value })} placeholder="0000-0/00" />
                </div>
                <div>
                  <Label htmlFor="ativ">Atividade econômica</Label>
                  <Input
                    id="ativ"
                    value={cliente.atividadeEconomica}
                    onChange={(e) => update({ atividadeEconomica: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="data">Data de constituição (RF)</Label>
                  <Input
                    id="data"
                    type="date"
                    value={cliente.dataConstituicao}
                    onChange={(e) => update({ dataConstituicao: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="capital">Capital social</Label>
                  <Input
                    id="capital"
                    value={cliente.capitalSocial}
                    onChange={(e) => update({ capitalSocial: e.target.value })}
                    placeholder="R$ 100.000,00"
                  />
                </div>
                <div>
                  <Label htmlFor="fat">Faturamento mensal</Label>
                  <Input
                    id="fat"
                    value={cliente.faturamentoMensal}
                    onChange={(e) => update({ faturamentoMensal: e.target.value })}
                    placeholder="R$ 30.000,00"
                  />
                </div>
                <div>
                  <Label htmlFor="patrim">Patrimônio estimado</Label>
                  <Input
                    id="patrim"
                    value={cliente.patrimonioEstimado}
                    onChange={(e) => update({ patrimonioEstimado: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="end">Endereço comercial (RF)</Label>
                  <Input
                    id="end"
                    value={cliente.enderecoComercial}
                    onChange={(e) => update({ enderecoComercial: e.target.value })}
                    placeholder="Rua, nº, bairro, cidade/UF"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="motivo">Motivo do relacionamento (racionalidade econômica)</Label>
                  <Textarea
                    id="motivo"
                    value={cliente.motivoRelacionamento}
                    onChange={(e) => update({ motivoRelacionamento: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="origem">Origem dos recursos</Label>
                  <Input
                    id="origem"
                    value={cliente.origemRecursos}
                    onChange={(e) => update({ origemRecursos: e.target.value })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User2 className="h-5 w-5 text-primary" /> PEP & Vínculo
              </CardTitle>
              <CardDescription>
                Identificação da Pessoa Politicamente Exposta e do vínculo com a PJ.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="tipoPep">Classificação PEP</Label>
                  <Select
                    id="tipoPep"
                    value={cliente.tipoPep}
                    onChange={(e) => update({ tipoPep: e.target.value as ClienteData["tipoPep"] })}
                  >
                    <option value="titular">Titular (PEP é o responsável)</option>
                    <option value="relacionado">Relacionado (PEP é vínculo)</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tipoVinculo">Tipo de vínculo</Label>
                  <Input
                    id="tipoVinculo"
                    value={cliente.tipoVinculo}
                    onChange={(e) => update({ tipoVinculo: e.target.value })}
                    placeholder="Cônjuge / sócio / familiar..."
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="nomePep">Nome do PEP</Label>
                  <Input
                    id="nomePep"
                    value={cliente.nomePessoaVinculada}
                    onChange={(e) => update({ nomePessoaVinculada: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="cargo">Cargo / Função pública</Label>
                  <Input id="cargo" value={cliente.cargoPep} onChange={(e) => update({ cargoPep: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="orgao">Órgão / Esfera</Label>
                  <Input
                    id="orgao"
                    value={cliente.orgaoPublico}
                    onChange={(e) => update({ orgaoPublico: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="resp">Responsável (sócio admin)</Label>
                  <Input
                    id="resp"
                    value={cliente.nomeResponsavel}
                    onChange={(e) => update({ nomeResponsavel: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="cpf">CPF do responsável</Label>
                  <Input
                    id="cpf"
                    value={cliente.cpfResponsavel}
                    onChange={(e) => update({ cpfResponsavel: formatCPF(e.target.value) })}
                  />
                </div>
                {cliente.tipoPep === "relacionado" && (
                  <div>
                    <Label htmlFor="cpfPepTitular">CPF do PEP titular</Label>
                    <Input
                      id="cpfPepTitular"
                      value={cliente.cpfPepTitular || ""}
                      onChange={(e) => update({ cpfPepTitular: formatCPF(e.target.value) })}
                      placeholder="000.000.000-00"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {cliente.tipoPep === "relacionado" && (
            <Card className="border-indigo-300 bg-indigo-50/30 dark:bg-indigo-950/20 dark:border-indigo-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
                  <ShieldCheck className="h-5 w-5" /> Consulta Credilink (Tessera)
                </CardTitle>
                <CardDescription>
                  Consulta disparada automaticamente via API para o CPF do PEP titular.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {credilinkConsultando && (
                  <div className="flex items-center gap-3 text-sm text-indigo-700 dark:text-indigo-300 py-2">
                    <ShieldCheck className="h-4 w-4 animate-pulse" />
                    <span>Consultando Tessera/Credilink para CPF <span className="font-mono font-semibold">{cliente.cpfPepTitular}</span>…</span>
                  </div>
                )}
                {!credilinkConsultando && !credilinkResultado && cliente.cpfPepTitular && (
                  <p className="text-xs text-muted-foreground italic">Aguardando retorno da API Credilink…</p>
                )}
                {!credilinkConsultando && credilinkResultado && (
                  <div className="space-y-3">
                    <div className="rounded-md bg-indigo-100/60 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 p-3 text-xs space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-indigo-800 dark:text-indigo-200 min-w-[120px]">CPF consultado:</span>
                        <span className="font-mono">{cliente.cpfPepTitular}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-indigo-800 dark:text-indigo-200 min-w-[120px]">Nome PEP:</span>
                        <span>{credilinkResultado.nomeConsultado}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-indigo-800 dark:text-indigo-200 min-w-[120px]">Nº do token:</span>
                        <span className="font-mono font-semibold">{credilinkResultado.numeroToken}</span>
                      </div>
                      {credilinkResultado.linkDossie ? (
                        <div className="flex items-start gap-2">
                          <span className="font-semibold text-indigo-800 dark:text-indigo-200 min-w-[120px]">Dossiê:</span>
                          <a href={credilinkResultado.linkDossie} target="_blank" rel="noopener noreferrer"
                            className="underline text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 break-all">
                            {credilinkResultado.linkDossie}
                          </a>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <span className="font-semibold text-indigo-800 dark:text-indigo-200 min-w-[120px]">Dossiê:</span>
                          <span className="text-muted-foreground italic text-[11px]">Acesse manualmente em Tessera/Credilink com o token acima.</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="min-w-[120px]">Consultado em:</span>
                        <span>{new Date(credilinkResultado.consultadoEm).toLocaleString("pt-BR")}</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Dados preenchidos automaticamente via API Tessera/Credilink. Token e dossiê salvos na análise.
                    </p>
                  </div>
                )}
                {!credilinkConsultando && !credilinkResultado && !cliente.cpfPepTitular && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    ⚠️ CPF do PEP titular não identificado. Preencha o campo acima para disparar a consulta Credilink.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Quadro Societário</CardTitle>
                  <CardDescription>Adicione os sócios. Será cruzado com QSA da Receita.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={addSocio}>
                  <Plus className="h-4 w-4" /> Sócio
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {cliente.socios.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Nenhum sócio cadastrado. A pesquisa preencherá automaticamente via BrasilAPI (mock).
                </p>
              ) : (
                cliente.socios.map((s, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_200px_120px_auto] gap-2">
                    <Input
                      placeholder="Nome"
                      value={s.nome}
                      onChange={(e) => updateSocio(i, { nome: e.target.value })}
                    />
                    <Input
                      placeholder="CPF"
                      value={s.cpf}
                      onChange={(e) => updateSocio(i, { cpf: formatCPF(e.target.value) })}
                    />
                    <Input
                      placeholder="%"
                      value={s.participacao}
                      onChange={(e) => updateSocio(i, { participacao: e.target.value })}
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeSocio(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parecer Técnico (1ª Camada)</CardTitle>
              <CardDescription>
                Máx. 5 linhas. Justifique o status sugerido com base nas evidências da pesquisa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {draftIdOrigem && getSugestaoParecer(draftIdOrigem) && (
                <div className="rounded-md bg-secondary/30 border border-secondary p-3 text-xs leading-relaxed">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-semibold flex items-center gap-1.5">
                      💡 Sugestão de parecer (rascunho IA)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const s = getSugestaoParecer(draftIdOrigem);
                        if (s) setParecerPrimeiraCamada(s);
                      }}
                      className="text-[10px] text-primary hover:underline"
                    >
                      Restaurar sugestão
                    </button>
                  </div>
                  <p className="text-muted-foreground italic">
                    O texto abaixo já está pré-preenchido com a sugestão. Edite livremente
                    com base na sua análise.
                  </p>
                </div>
              )}
              <Textarea
                value={parecerPrimeiraCamada}
                onChange={(e) => setParecerPrimeiraCamada(e.target.value)}
                rows={8}
                placeholder="Ex.: PEP confirmado em mandato ativo (Vereador/RJ). CNAE compatível com atividade declarada. Sem mídia adversa material. Recomendado APROVAÇÃO COM MONITORAMENTO REFORÇADO."
              />
              <div>
                <Label htmlFor="status">Status sugerido para a Mesa</Label>
                <Select
                  id="status"
                  value={statusSugerido}
                  onChange={(e) => setStatusSugerido(e.target.value as StatusAnalise)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coluna direita — Pesquisa & Resultados */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" /> Pesquisa em Fontes Públicas
              </CardTitle>
              <CardDescription>
                Aciona o gateway de IA + n8n para varrer mídia, processos, sanções e QSA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={observacoesPesquisa}
                onChange={(e) => setObservacoesPesquisa(e.target.value)}
                placeholder='Direcionamentos opcionais para a IA — ex.: "verificar processo TJ-SP n. 0012345-67"'
                rows={2}
              />
              <Button onClick={handlePesquisar} disabled={pesquisando} className="w-full">
                {pesquisando ? (
                  <>
                    <Search className="h-4 w-4 animate-pulse" /> Pesquisando...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" /> Pesquisar Fontes Públicas
                  </>
                )}
              </Button>
              {analiseGeral && (
                <div className="rounded-md bg-secondary/40 border border-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
                  <p className="font-semibold mb-1">Análise consolidada da IA</p>
                  <p>{analiseGeral}</p>
                  <p className="mt-2 font-semibold">
                    Recomendação: <StatusBadge status={statusSugerido} />
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resultados ({resultados.filter((r) => !r.descartado).length})</CardTitle>
              <CardDescription>Clique em "Reanalisar" para sobrescrever com input do analista.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-thin pr-1">
              {resultados.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Nenhum resultado ainda — execute a pesquisa.
                </p>
              ) : (
                resultados.map((r) => (
                  <ResultadoCard
                    key={r.id}
                    resultado={r}
                    onReanalisar={(obs) => handleReanalisar(r.id, obs)}
                    onDescartar={() => handleDescartar(r.id)}
                    onRestaurar={() => handleRestaurar(r.id)}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2 sticky bottom-0">
            <Button variant="outline" onClick={handleSalvarRascunho}>
              <Save className="h-4 w-4" /> Salvar rascunho
            </Button>
            <Button onClick={handleEnviarMesa} disabled={!podeFinalizarPrimeira}>
              Enviar à Mesa de Decisão <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Status sugerido: <span className="font-semibold">{STATUS_LABELS[statusSugerido]}</span>
            </p>
          </div>
        </div>
      </div>

      <Dialog
        open={showOcr}
        onOpenChange={setShowOcr}
        title="OCR (Gemini Vision) indisponível em modo demo"
        description="O protótipo local não está conectado ao Lovable AI Gateway. Em produção, esse botão extrairia automaticamente CNPJ, razão social, CNAE, endereço, dados PEP, etc., a partir de uma captura da ficha cadastral."
      >
        <p className="text-sm">
          Para essa demo, preencha os campos manualmente. O sistema completo aceita imagem JPG/PNG e devolve o JSON estruturado pronto para preenchimento.
        </p>
        <div className="flex justify-end mt-4">
          <Button onClick={() => setShowOcr(false)}>Entendi</Button>
        </div>
      </Dialog>
    </div>
  );
}
