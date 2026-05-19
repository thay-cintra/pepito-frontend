import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  Building2,
  AlertTriangle,
  Mail,
  Hash,
  Clock,
  ArrowRight,
  Crown,
  Users,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { storage } from "@/lib/storage";
import { synthesizeAnalise, markTaken } from "@/lib/registration-queue";
import type { RegistrationCase } from "@/types/registration";
import { inferCargoOrgao, inferTipoPep, getSugestaoParecer, getSugestaoLideranca, vinculoLabel, getPldRiskScore } from "@/data/registration-enrich";
import type { PldRiskScore } from "@/data/registration-enrich";
import { StatusBadge } from "@/components/RiscoBadge";
import { HistoricoComentarios } from "@/components/HistoricoComentarios";
import { cn } from "@/lib/utils";

const BUCKET_VARIANT = {
  CHECK_LIDERANCA: "destructive" as const,
  CHECK_ANALISTA: "warning" as const,
};

function scoreVariant(score: number): "success" | "warning" | "destructive" {
  if (score >= 150) return "destructive";
  if (score >= 130) return "warning";
  return "success";
}

interface Props {
  caso: RegistrationCase;
}

export function RegistrationCaseCard({ caso }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const Icon = caso.bucket === "CHECK_LIDERANCA" ? Crown : Users;
  const [showLinks, setShowLinks] = useState(false);
  const cargoOrgao = inferCargoOrgao(caso);
  const tipoPep = inferTipoPep(caso);
  const riskScore = getPldRiskScore(caso.draft_id);

  const handleAbrir = () => {
    if (caso.bucket === "CHECK_LIDERANCA") {
      const analise = synthesizeAnalise(caso);
      storage.saveAnalise(analise);
      markTaken(caso.draft_id, analise.id);
      toast({
        variant: "success",
        title: "Caso carregado na Mesa de Decisão",
        description: `${caso.rf_nome_oficial} · investigação pré-concluída`,
      });
      navigate(`/nova-analise?id=${analise.id}`);
    } else {
      navigate(`/primeira-camada?prefill=${caso.draft_id}`);
    }
  };

  // Agrupa os links por categoria (a partir dos resultados que já têm link)
  const linksAgrupados = caso.resultados_pesquisa
    .filter((r) => !!r.link)
    .reduce<Record<string, typeof caso.resultados_pesquisa>>((acc, r) => {
      const cat = categoriaDe(r.fonte);
      acc[cat] ||= [];
      acc[cat].push(r);
      return acc;
    }, {});

  return (
    <Card
      className={cn(
        "hover:shadow-md transition-shadow",
        "border-primary/60 ring-1 ring-primary/20",
        riskScore?.nivel === "critico" && "border-destructive/70 ring-destructive/30",
        riskScore?.nivel === "alto" && "border-orange-500/60 ring-orange-500/20",
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <Badge variant="default" className="text-[10px]">
                <ShieldCheck className="h-3 w-3 mr-1" />
                Real Athena
              </Badge>
              <Badge variant={BUCKET_VARIANT[caso.bucket]} className="text-[10px]">
                <Icon className="h-3 w-3 mr-1" />
                {caso.bucket === "CHECK_LIDERANCA" ? "Liderança" : "Analista"}
              </Badge>
            </div>
            <CardTitle className="flex items-center gap-2 truncate text-base">
              <Building2 className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{caso.rf_nome_oficial}</span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
              <Hash className="h-3 w-3" />
              <span className="font-mono">CNPJ {caso.cnpj}</span>
              <span>·</span>
              <span>draft {caso.draft_id}</span>
            </div>
          </div>
          {/* Indicador de risco de LD */}
          {riskScore && <PldRiskIndicator score={riskScore} cnae={caso.cnae} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* PEP / PF */}
        <div className="rounded-md bg-muted/40 border p-3 space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Pessoa Politicamente Exposta (PEP)
          </p>
          <p className="font-semibold text-sm">
            {caso.full_name_pf}
            <span className="ml-2 text-[10px] uppercase font-normal text-muted-foreground">
              (PEP {tipoPep}
              {tipoPep === "relacionado" && cargoOrgao.vinculo && (
                <> · {vinculoLabel(cargoOrgao.vinculo)}</>
              )}
              )
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">CPF sócio: {caso.cpf}</span>
            <span>·</span>
            <span>{cargoOrgao.cargo}{cargoOrgao.orgao && cargoOrgao.orgao !== caso.uf ? ` em ${cargoOrgao.orgao}` : ""}</span>
            {tipoPep === "relacionado" && (
              <>
                <span>·</span>
                <span className="italic">
                  {vinculoLabel(cargoOrgao.vinculo) || "vínculo"} de {cargoOrgao.nomePEP}
                </span>
                {cargoOrgao.cpfTitular && (
                  <>
                    <span>·</span>
                    <span className="font-mono">CPF PEP: {cargoOrgao.cpfTitular}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Cadastro PJ */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="CNAE" value={caso.cnae} />
          <Field label="Constituição" value={caso.data_constituicao} />
          <Field label="Porte" value={caso.porte || "—"} />
          <Field label="Faturamento presumido" value={(caso.faturamento_presumido || "").replace(/^"|"$/g, "") || "—"} />
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3 w-3" /> {caso.email}
        </div>

        {/* Status Retool */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[10px]">status: {caso.status}</Badge>
          <Badge variant="outline" className="font-mono text-[10px]">sub_status: {caso.sub_status}</Badge>
          <Badge variant="outline" className="font-mono text-[10px]">person_type: {caso.person_type}</Badge>
        </div>

        {/* Score + reason + investigação */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={scoreVariant(caso.score_pld)}>Score PLD: {caso.score_pld}</Badge>
          <Badge variant="muted">
            <AlertTriangle className="h-3 w-3 mr-1" />HIGH_PLD
          </Badge>
          <Badge variant="info">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {caso.resultados_pesquisa.length} fontes mapeadas
          </Badge>
        </div>

        {/* Sugestão de parecer (só ANALISTA — texto conciso no estilo Josinalva) */}
        {caso.bucket === "CHECK_ANALISTA" && (() => {
          const sugestao = getSugestaoParecer(caso.draft_id) ?? caso.parecer_sugerido;
          if (!sugestao) return null;
          return (
            <div className="rounded-md bg-secondary/30 border border-secondary p-3 text-xs leading-relaxed">
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldCheck className="h-3 w-3 text-primary" />
                <span className="font-semibold">Sugestão de parecer (rascunho IA)</span>
                <Badge variant="outline" className="text-[9px]">opcional</Badge>
              </div>
              <p className="text-muted-foreground italic">{sugestao}</p>
            </div>
          );
        })()}

        {/* Sugestão de Parecer da LIDERANÇA (4 templates) — só CHECK_LIDERANCA */}
        {caso.bucket === "CHECK_LIDERANCA" && (() => {
          const sugLid = getSugestaoLideranca(caso.draft_id);
          if (!sugLid) return null;
          return (
            <div className="rounded-md bg-secondary/30 border border-secondary p-3 text-xs leading-relaxed">
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldCheck className="h-3 w-3 text-primary" />
                <span className="font-semibold">Sugestão de parecer Liderança (rascunho IA)</span>
                <Badge variant="outline" className="text-[9px]">opcional</Badge>
              </div>
              <p className="text-muted-foreground italic whitespace-pre-wrap line-clamp-6">
                {sugLid.text}
              </p>
            </div>
          );
        })()}

        {/* Histórico e comentários (compact) */}
        <HistoricoComentarios comentarios={caso.historico_comentarios} compact />

        {/* Toggle de links de verificação */}
        <button
          type="button"
          onClick={() => setShowLinks((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {showLinks ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {showLinks ? "Ocultar" : "Ver"} links de verificação ({Object.values(linksAgrupados).flat().length})
        </button>

        {showLinks && (
          <div className="space-y-2 rounded-md border bg-background p-3 max-h-72 overflow-y-auto scrollbar-thin">
            {Object.entries(linksAgrupados).map(([cat, links]) => (
              <div key={cat}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                  {cat}
                </p>
                <ul className="space-y-1 mb-2">
                  {links.map((l) => (
                    <li key={l.id} className="text-xs">
                      <a
                        href={l.link!}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{l.fonte}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> {formatDate(caso.created_at)}
          </span>
          <Button size="sm" onClick={handleAbrir}>
            {caso.bucket === "CHECK_LIDERANCA" ? "Decidir na Mesa" : "Revisar e enviar"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium truncate text-xs">{value}</p>
    </div>
  );
}

// ─── Indicador visual de risco de lavagem de dinheiro ────────────────────────

const RISK_CONFIG = {
  critico: {
    label: "CRÍTICO",
    color: "text-destructive",
    bg: "bg-destructive/10 border-destructive/30",
    bar: "bg-destructive",
    icon: "🔴",
  },
  alto: {
    label: "ALTO",
    color: "text-orange-600",
    bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800/30",
    bar: "bg-orange-500",
    icon: "🟠",
  },
  medio: {
    label: "MÉDIO",
    color: "text-yellow-600",
    bg: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800/30",
    bar: "bg-yellow-500",
    icon: "🟡",
  },
  baixo: {
    label: "BAIXO",
    color: "text-success",
    bg: "bg-success/10 border-success/20",
    bar: "bg-success",
    icon: "🟢",
  },
} as const;

// ─── Mapeamento CNAE → risco de LD ───────────────────────────────────────────

interface CnaeLdRisk {
  atividade: string;
  /** Score Cora: 5=baixo (verde) | 20=médio (laranja) | 2415=alto/recusar (vermelho) */
  score_cora: 5 | 10 | 20 | 2415;
  risco: "recusar" | "alto" | "medio" | "baixo";
  como_usa_ld: string;
  tipologia: string;
}

/**
 * Mapeamento CNAE → risco de LD.
 * Fonte primária: Manual KYC Cora (CNAEs proibidas = rejeição automática).
 * Fonte secundária: tabela Cora table_cnae (score 2415/20/5).
 */
const CNAE_LD_MAP: Record<string, CnaeLdRisk> = {
  // ══════════════════════════════════════════════════════════════════════════
  // CNAEs PROIBIDAS — Manual KYC Cora (cnae_allowed=False → COMPLIANCE_CNAE_ALLOWED)
  // Rejeição automática — não iniciar relacionamento comercial
  // ══════════════════════════════════════════════════════════════════════════
  "0893": { score_cora: 2415, atividade: "Extração de gemas — 0893-2/00", risco: "recusar",
    como_usa_ld: "Garimpo e extração de pedras preciosas são fonte de recursos ilícitos de difícil rastreio. Pedras servem como moeda alternativa para movimentação internacional de valores sem controle bancário.",
    tipologia: "Garimpo ilegal / Mineração não licenciada / PROIBIDA Manual KYC" },
  "3211": { score_cora: 2415, atividade: "Lapidação de gemas / Joalheria / Cunhagem — 3211-6/01,02,03", risco: "recusar",
    como_usa_ld: "Joias e pedras preciosas são instrumentos clássicos de LD: alto valor em pequeno volume, precificação opaca e fácil transporte internacional sem declaração. Cunhagem de moedas facilita criação de ativos paralelos.",
    tipologia: "Trade-based LD / Smurfing via joias / PROIBIDA Manual KYC" },
  "4649": { score_cora: 2415, atividade: "Comércio atacadista de jóias, relógios e pedras preciosas — 4649-4/10", risco: "recusar",
    como_usa_ld: "Atacado de joias permite movimentação de grandes valores com pouca rastreabilidade. Precificação subjetiva facilita super/subfaturamento para lavagem de recursos ilícitos.",
    tipologia: "Trade-based LD / Valoração artificial / PROIBIDA Manual KYC" },
  "4689": { score_cora: 2415, atividade: "Comércio atacadista de produtos da extração mineral, exceto combustíveis — 4689-3/01", risco: "recusar",
    como_usa_ld: "Minerais extraídos ilegalmente são comercializados por este CNAE. Dificulta rastreio de origem, permite integração de recursos de garimpo clandestino.",
    tipologia: "Mineração ilegal / Trade-based LD / PROIBIDA Manual KYC" },
  "8411": { score_cora: 2415, atividade: "Administração pública em geral — 8411-6/00", risco: "recusar",
    como_usa_ld: "Entidades privadas não podem operar com CNAE de administração pública. Presença deste CNAE em empresa privada indica fraude ou erro de registro.",
    tipologia: "Fraude de registro / CNAE inválida para PJ privada / PROIBIDA Manual KYC" },
  "9492": { score_cora: 2415, atividade: "Atividades de organizações políticas — 9492-8/00", risco: "recusar",
    como_usa_ld: "Partidos e organizações políticas não podem ter conta PJ bancária convencional para fins comerciais. Uso desta CNAE para movimentação financeira configura risco de financiamento político irregular.",
    tipologia: "Financiamento político irregular / PROIBIDA Manual KYC" },
  "4789": { score_cora: 2415, atividade: "Comércio varejista de armas e munições — 4789-0/09", risco: "recusar",
    como_usa_ld: "Comércio de armas requer controle rígido do Exército. O setor é frequentemente associado a tráfico de armas e lavagem de recursos de organizações criminosas.",
    tipologia: "Tráfico de armas / Crime organizado / PROIBIDA Manual KYC" },
  "2550": { score_cora: 2415, atividade: "Fabricação de equipamento bélico / Armas de fogo e munições — 2550-1/01,02", risco: "recusar",
    como_usa_ld: "Fabricação de armas exige autorização do Exército. Operação não autorizada configura crime e risco extremo de tráfico de armas.",
    tipologia: "Tráfico de armas / Crime militar / PROIBIDA Manual KYC" },
  "3311": { score_cora: 2415, atividade: "Manutenção de tanques, reservatórios metálicos e caldeiras — 3311-2/00", risco: "recusar",
    como_usa_ld: "CNAE proibida por risco de uso em estruturas críticas (oleodutos, gasodutos) e potencial para crimes ambientais e de infraestrutura.",
    tipologia: "Infraestrutura crítica / PROIBIDA Manual KYC" },
  "0500": { score_cora: 2415, atividade: "Extração de carvão mineral — 0500-3/01", risco: "recusar",
    como_usa_ld: "Extração mineral controlada pelo governo. Operação irregular viabiliza desvio de royalties e lavagem de recursos via subfaturamento da produção.",
    tipologia: "Mineração irregular / Evasão de royalties / PROIBIDA Manual KYC" },
  "0600": { score_cora: 2415, atividade: "Extração de petróleo e gás natural — 0600-0/01", risco: "recusar",
    como_usa_ld: "Histórico de corrupção sistêmica (Lava Jato). Contratos bilionários, royalties e concessões da ANP são alvos de desvio. CNAE proibida para empresas privadas sem concessão regulatória.",
    tipologia: "Corrupção em contratos públicos / Desvio de royalties / PROIBIDA Manual KYC" },
  "0722": { score_cora: 2415, atividade: "Extração de minério de estanho — 0722-7/01", risco: "recusar",
    como_usa_ld: "Extração de estanho está associada a garimpo ilegal no Pará e Rondônia. Recursos de mineração irregular são lavados via comercialização sem nota fiscal.",
    tipologia: "Garimpo ilegal / Mineração não licenciada / PROIBIDA Manual KYC" },
  "0723": { score_cora: 2415, atividade: "Extração de minério de manganês — 0723-5/01", risco: "recusar",
    como_usa_ld: "Mineração de manganês sem licença é prática conhecida no Amapá e Pará. Integração via exportação subfaturada.",
    tipologia: "Mineração ilegal / Evasão fiscal / PROIBIDA Manual KYC" },
  "0724": { score_cora: 2415, atividade: "Extração de minério de metais preciosos — 0724-3/01", risco: "recusar",
    como_usa_ld: "Ouro e prata extraídos ilegalmente são convertidos em recursos financeiros via doleiros e casas de câmbio informais. Tipologia de LD com alto impacto ambiental e social.",
    tipologia: "Garimpo ilegal de ouro / Lavagem via metal precioso / PROIBIDA Manual KYC" },
  "0725": { score_cora: 2415, atividade: "Extração de minerais radioativos — 0725-1/00", risco: "recusar",
    como_usa_ld: "Materiais radioativos são controlados pela CNEN. Extração não autorizada representa risco nuclear, ambiental e de terrorismo.",
    tipologia: "Risco nuclear / Terrorismo / PROIBIDA Manual KYC" },
  "0729": { score_cora: 2415, atividade: "Extração de minérios (nióbio, titânio, tungstênio, níquel, cobre, chumbo, zinco) — 0729-4/xx", risco: "recusar",
    como_usa_ld: "Minérios estratégicos com alto valor internacional. Extração ilegal em áreas indígenas e de preservação é fonte de recursos ilícitos lavados via exportação subfaturada.",
    tipologia: "Mineração ilegal em áreas protegidas / Trade-based LD / PROIBIDA Manual KYC" },
  "4687": { score_cora: 2415, atividade: "Comércio atacadista de resíduos e sucatas (metálicos e não metálicos) — 4687-7/02,03", risco: "recusar",
    como_usa_ld: "Sucata metálica é canal conhecido para lavagem de recursos de mineração ilegal e furto de metais. Precificação arbitrária facilita super/subfaturamento. Fácil integração de ouro e outros metais preciosos.",
    tipologia: "Lavagem via sucata / Mineração ilegal / PROIBIDA Manual KYC" },
  "8299": { score_cora: 2415, atividade: "Leiloeiros independentes — 8299-7/04", risco: "recusar",
    como_usa_ld: "Leilões permitem valoração subjetiva de ativos e pagamentos em espécie. Instrumento histórico de lavagem de dinheiro via superfaturamento de bens em leilão.",
    tipologia: "Lavagem via leilão / Valoração artificial / PROIBIDA Manual KYC" },
  "9200": { score_cora: 2415, atividade: "Exploração de jogos de azar e apostas — 9200-3/99", risco: "recusar",
    como_usa_ld: "Alto volume de dinheiro em espécie com baixo controle de identidade de apostadores. Integração de recursos ilícitos via ganhos fictícios de prêmios. Tipologia amplamente documentada pelo COAF.",
    tipologia: "Cash integration via premiação fictícia / PROIBIDA Manual KYC" },

  // ── SCORE 20 — LARANJA — MÉDIO (157 CNAEs na tabela Cora) ─────────────────
  "7911": { score_cora: 20, atividade: "Agências de viagem", risco: "medio",
    como_usa_ld: "Pacotes de viagem são instrumentos de lavagem: pagamento em espécie por viagens fictícias ou superfaturadas. Facilita transferência de recursos para o exterior via despesas de viagem. Score 20 na tabela Cora.",
    tipologia: "Lavagem via agência de viagem / Transferência disfarçada" },
  "9491": { score_cora: 20, atividade: "Organizações religiosas", risco: "medio",
    como_usa_ld: "Recebimento de dízimos/ofertas em espécie com mínima prestação de contas. Isenção fiscal facilita uso como escudo. Frequentemente associadas a candidatos políticos (PEPs). Score 20 na tabela Cora.",
    tipologia: "Cash integration via dízimos / Isenção fiscal abusiva" },
  "9312": { score_cora: 20, atividade: "Clubes esportivos", risco: "medio",
    como_usa_ld: "Contratos de atletas e patrocínios são instrumentos de lavagem. Receita de bilheteria em espécie dificulta auditoria. Score 20 na tabela Cora.",
    tipologia: "Lavagem via contratos esportivos / Cash integration" },
  "4111": { score_cora: 20, atividade: "Incorporação e construção civil / Construção de edifícios", risco: "medio",
    como_usa_ld: "Construção civil é setor clássico de LD: obras superfaturadas, materiais fictícios, pagamentos em caixa 2. Favorito para PEPs com contratos públicos de obras. Score 20 na tabela Cora.",
    tipologia: "Superfaturamento de obras / Caixa 2 na construção" },
  "4120": { score_cora: 20, atividade: "Construção de edifícios e incorporação imobiliária", risco: "medio",
    como_usa_ld: "Setor imobiliário e construção: valorização artificial de imóveis para justificar pagamentos. Obras fictícias ou superfaturadas são canal clásico de lavagem de recursos públicos.",
    tipologia: "Valorização artificial de imóveis / Obras superfaturadas" },
  "4940": { score_cora: 20, atividade: "Transporte rodoviário de carga (logística)", risco: "medio",
    como_usa_ld: "Fretes fantasmas (NF sem carga real). Inflação de custos logísticos para saída de caixa. Pagamentos em espécie para motoristas autônomos. Score 20 na tabela Cora.",
    tipologia: "Fretes fantasmas / Cash payments" },
  "7490": { score_cora: 20, atividade: "Intermediação, agenciamento de serviços e negócios / Consultorias", risco: "alto",
    como_usa_ld: "CNAEs de consultoria e intermediação são os favoritos de PEPs para receber propina via PJ: NFs de serviços intangíveis sem entregável verificável. Score 20 na tabela Cora, com risco elevado quando titular é PEP.",
    tipologia: "Propina via PJ / NFs frias / Phantom consulting" },
  "7319": { score_cora: 20, atividade: "Promoção de vendas / Publicidade e marketing", risco: "alto",
    como_usa_ld: "Contratos de publicidade sem precificação objetiva. Caixa 2 eleitoral via despesas de 'marketing'. Score 20 na tabela Cora.",
    tipologia: "Caixa 2 eleitoral / Superfaturamento de campanhas" },
  "8111": { score_cora: 20, atividade: "Segurança patrimonial / Serviços de vigilância", risco: "medio",
    como_usa_ld: "Contratos de segurança são frequentemente superfaturados em obras e eventos públicos. Pagamentos em espécie para vigilantes. Score 20 na tabela Cora.",
    tipologia: "Superfaturamento em contratos de segurança" },
  "6912": { score_cora: 20, atividade: "Serviços advocatícios", risco: "medio",
    como_usa_ld: "Escritórios de advocacia recebem honorários sem discriminação de origem. Pagamentos em espécie por 'consultas jurídicas'. Sigilo profissional dificulta rastreio. Score 20 na tabela Cora.",
    tipologia: "Lavagem via honorários advocatícios" },
  "6810": { score_cora: 20, atividade: "Compra e venda de imóveis / Mercado imobiliário", risco: "medio",
    como_usa_ld: "Imóveis são instrumento clássico de LD: valorização artificial, compra com dinheiro sujo, posterior venda 'legaliza' os recursos. Score 20 na tabela Cora.",
    tipologia: "Lavagem imobiliária / Valorização artificial" },
  "6420": { score_cora: 20, atividade: "Atividades de sociedades holding", risco: "alto",
    como_usa_ld: "Holdings criam camadas societárias (layering) que dificultam rastreamento do beneficiário final. Instrumento para ocultar origem de recursos de PEPs. Score 20 na tabela Cora.",
    tipologia: "Layering societário / Ocultação de beneficiário final" },
  "6619": { score_cora: 20, atividade: "Outras atividades auxiliares de serviços financeiros", risco: "alto",
    como_usa_ld: "Inclui câmbio informal (doleiro), intermediação de pagamentos não regulados. Score 20 na tabela Cora.",
    tipologia: "Câmbio informal / Doleiro / Trade-based LD" },

  // ── SCORE 10 — CINZA — ATENÇÃO ────────────────────────────────────────────
  "7112": { score_cora: 10, atividade: "Serviços de engenharia", risco: "medio",
    como_usa_ld: "Laudos e projetos de engenharia podem ser superfaturados ou emitidos sem prestação real, especialmente em obras públicas. Instrumentos de propina via PJ técnica.",
    tipologia: "Superfaturamento técnico / Propina via laudo" },

  // ── SCORE 5 — VERDE — BAIXO ───────────────────────────────────────────────
  "8511": { score_cora: 5, atividade: "Educação infantil — pré-escola", risco: "baixo",
    como_usa_ld: "CNAE de baixo risco intrínseco. Risco residual: convênios com prefeituras controladas por PEP familiar podem ser desviados.",
    tipologia: "Baixo risco — monitorar convênios públicos se PEP for Prefeito/Vereador" },
  "8531": { score_cora: 5, atividade: "Educação superior — graduação", risco: "baixo",
    como_usa_ld: "CNAE de baixo risco. Faculdades privadas podem receber verbas do ProUni/FIES via repasses públicos — verificar se PEP tem influência sobre contratos públicos com o MEC.",
    tipologia: "Baixo risco — verificar repasses públicos MEC/FIES se PEP" },
  "9511": { score_cora: 5, atividade: "Reparação e manutenção de computadores", risco: "baixo",
    como_usa_ld: "CNAE de baixo risco. Score 5 na tabela Cora.",
    tipologia: "Baixo risco" },
  "8211": { score_cora: 5, atividade: "Serviços combinados de escritório e apoio administrativo", risco: "medio",
    como_usa_ld: "A tabela Cora classifica como score 5, mas o histórico PLD da Cora mostra frequência acima da média neste CNAE para contas encerradas por LD. Serviços de apoio sem entregável específico facilitam NFs fictícias.",
    tipologia: "NFs frias / Empresa-laranja intermediária (score 5 na tabela, mas com histórico PLD)" },
};

// Mapeamento por palavras-chave da descrição CNAE para score Cora
// Usado quando não há match por código 4 dígitos
const CNAE_KEYWORD_SCORES: Array<{ keywords: string[]; score_cora: 5 | 10 | 20 | 2415; risco: CnaeLdRisk["risco"]; tipologia: string }> = [
  { keywords: ["jogo", "apostas", "loteria", "sorteio", "bingo", "casino"], score_cora: 2415, risco: "recusar", tipologia: "Jogos de azar — RECUSAR (score 2415)" },
  // "arma" sozinho captura "farmacêuticos" → usar termos compostos específicos
  { keywords: ["arma de fogo", "armas e municoes", "armas e munições", "comercio de armas", "venda de armas", "fabricacao de armas", "fabricação de armas", "municao de guerra", "munições militares", "equipamento belico", "equipamento bélico"], score_cora: 2415, risco: "recusar", tipologia: "Armas/munições — RECUSAR (score 2415)" },
  { keywords: ["joalheria", "joias", "jóias", "ourives", "gemas", "pedras preciosas"], score_cora: 2415, risco: "recusar", tipologia: "Joalheria/pedras — RECUSAR (score 2415)" },
  // "extração de petróleo" especifica o CNAE 0600-0/01 (proibido).
  // NÃO inclui "gás liquefeito de petróleo" (GLP/botijão = 47.84-9-00 = score 5).
  { keywords: ["extracao de petroleo", "extração de petróleo", "extracao de gas natural", "extração de gás natural", "offshore"], score_cora: 2415, risco: "recusar", tipologia: "Extração de petróleo/gás — RECUSAR (score 2415)" },
  { keywords: ["sucata", "residuos metalicos", "resíduos metálicos"], score_cora: 2415, risco: "recusar", tipologia: "Sucata — RECUSAR (score 2415)" },
  // Planilha L3/L4: carvão vegetal/lenha = score 2415
  { keywords: ["carvao vegetal", "carvão vegetal", "carvao mineral", "carvão mineral", "lenha atacad", "lenha vareji"], score_cora: 2415, risco: "recusar", tipologia: "Carvão vegetal/mineral — RECUSAR (score 2415)" },
  { keywords: ["agencia de viagem", "agências de viagem", "turismo"], score_cora: 20, risco: "medio", tipologia: "Agências de viagem (score 20)" },
  { keywords: ["organizacao religiosa", "organizações religiosas", "religios", "igrej", "templo"], score_cora: 20, risco: "medio", tipologia: "Org. religiosas (score 20)" },
  { keywords: ["construcao civil", "incorporadora", "incorporacao", "empreiteira"], score_cora: 20, risco: "medio", tipologia: "Construção civil (score 20)" },
  // GLP (47.84) = score 20 (planilha L1667: "COM VAREJISTA DE GÁS LIQUEFEITO DE PETRÓLEO")
  { keywords: ["combustivel", "combustível", "gas liquefeito", "gás liquefeito", "glp", "posto", "petrobrás", "petrobras", "ipiranga", "shell", "derivados de petroleo", "derivados de petróleo"], score_cora: 20, risco: "medio", tipologia: "Combustíveis / GLP (score 20)" },
  { keywords: ["consultoria", "consulting"], score_cora: 20, risco: "alto", tipologia: "Consultorias (score 20)" },
  { keywords: ["logistica", "logística", "transporte de carga"], score_cora: 20, risco: "medio", tipologia: "Logística (score 20)" },
  { keywords: ["seguranca patrimonial", "vigilancia", "segurança patrimonial"], score_cora: 20, risco: "medio", tipologia: "Segurança patrimonial (score 20)" },
  { keywords: ["holding", "participacoes", "participações"], score_cora: 20, risco: "alto", tipologia: "Holdings/participações (score 20)" },
  { keywords: ["advocaticios", "advocatícios", "advocacia"], score_cora: 20, risco: "medio", tipologia: "Serviços advocatícios (score 20)" },
  { keywords: ["imovel", "imóvel", "imobiliaria", "imobiliária"], score_cora: 20, risco: "medio", tipologia: "Mercado imobiliário (score 20)" },
  { keywords: ["engenharia"], score_cora: 10, risco: "medio", tipologia: "Engenharia (score 10)" },
];

function getCnaeLdRisk(cnae: string | undefined | null): CnaeLdRisk | null {
  if (!cnae) return null;
  const code = cnae.replace(/\D/g, "").slice(0, 7);
  // 1. Tenta match por código (4 dígitos = grupo CNAE)
  for (const key of [code.slice(0, 7), code.slice(0, 6), code.slice(0, 5), code.slice(0, 4)]) {
    if (CNAE_LD_MAP[key]) return CNAE_LD_MAP[key];
  }
  // 2. Tenta match por palavras-chave na descrição do CNAE
  const descNorm = cnae.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  for (const entry of CNAE_KEYWORD_SCORES) {
    if (entry.keywords.some((kw) => descNorm.includes(kw.toLowerCase()))) {
      return {
        score_cora: entry.score_cora,
        atividade: cnae,
        risco: entry.risco,
        como_usa_ld: `CNAE identificado por palavras-chave da descrição. Tipologia Cora: ${entry.tipologia}`,
        tipologia: entry.tipologia,
      };
    }
  }
  return null;
}

const CNAE_RISCO_COLOR: Record<CnaeLdRisk["risco"], string> = {
  recusar: "text-destructive font-black",
  alto: "text-orange-600",
  medio: "text-yellow-600",
  baixo: "text-success",
};

const CNAE_RISCO_BG: Record<CnaeLdRisk["risco"], string> = {
  recusar: "bg-destructive/15 border-destructive/40",
  alto: "bg-orange-50 border-orange-200 dark:bg-orange-950/20",
  medio: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20",
  baixo: "bg-success/10 border-success/20",
};

const CNAE_RISCO_LABEL: Record<CnaeLdRisk["risco"], string> = {
  recusar: "🔴 RECUSAR (score 2415)",
  alto: "🟠 Alto (score 20)",
  medio: "🟡 Médio (score 20)",
  baixo: "🟢 Baixo (score 5)",
};

// ─── Fim mapeamento CNAE ─────────────────────────────────────────────────────

const FATOR_NIVEL_COLOR: Record<string, string> = {
  alto: "text-destructive",
  medio: "text-yellow-600",
  baixo: "text-success",
};

const FATOR_NIVEL_DOT: Record<string, string> = {
  alto: "bg-destructive",
  medio: "bg-yellow-500",
  baixo: "bg-success",
};

function PldRiskIndicator({ score, cnae }: { score: PldRiskScore; cnae?: string | null }) {
  const [open, setOpen] = useState(false);
  const cfg = RISK_CONFIG[score.nivel];
  const pct = Math.round(score.probabilidade);
  const cnaeLd = getCnaeLdRisk(cnae);

  return (
    <div className="relative shrink-0">
      {/* Badge clicável */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={cn(
          "rounded-lg border px-3 py-2 min-w-[88px] text-center cursor-pointer",
          "hover:opacity-90 active:scale-95 transition-all select-none",
          cfg.bg,
        )}
        aria-label={`Ver fatores de risco — Probabilidade LD ${pct}%`}
      >
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none mb-1">
          Risco LD
        </p>
        <p className={cn("text-xl font-black leading-none", cfg.color)}>
          {pct}%
        </p>
        <p className={cn("text-[10px] font-semibold mt-0.5 leading-none", cfg.color)}>
          {cfg.icon} {cfg.label}
        </p>
        {/* Barra de progresso */}
        <div className="mt-1.5 h-1 w-full rounded-full bg-muted/40 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", cfg.bar)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground leading-none">
          {open ? "▲ fechar" : "▼ fatores"}
        </p>
      </button>

      {/* Painel de fatores */}
      {open && (
        <>
          {/* Overlay para fechar ao clicar fora */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl border shadow-xl",
              "bg-card text-card-foreground",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={cn("rounded-t-xl px-4 py-3 border-b", cfg.bg)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Prob. Lavagem de Dinheiro
                  </p>
                  <p className={cn("text-2xl font-black leading-none mt-0.5", cfg.color)}>
                    {pct}% <span className="text-sm font-semibold">{cfg.icon} {cfg.label}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              {/* Barra full */}
              <div className="mt-2 h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={cn("h-full rounded-full", cfg.bar)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Fatores */}
            <div className="px-4 py-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                {score.fatores.length > 0
                  ? `${score.fatores.length} fator${score.fatores.length > 1 ? "es" : ""} identificado${score.fatores.length > 1 ? "s" : ""}`
                  : "Nenhum fator de risco elevado"}
              </p>
              {score.fatores.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  Perfil de baixo risco com base nos indicadores analisados.
                </p>
              )}
              {score.fatores.map((f) => (
                <div key={f.id} className={cn(
                  "flex items-start gap-2.5 rounded-md p-2",
                  f.id === "cnae_regulado" ? "bg-amber-50 border border-amber-200 dark:bg-amber-950/20" :
                  f.id === "municipio_fronteira" ? "bg-blue-50 border border-blue-200 dark:bg-blue-950/20" :
                  f.id === "eleitoral_2026" ? "bg-destructive/5 border border-destructive/20" : "",
                )}>
                  <div className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", FATOR_NIVEL_DOT[f.nivel] ?? "bg-muted")} />
                  <div className="min-w-0 flex-1">
                    {/* Label especial para órgão regulador */}
                    {f.id === "cnae_regulado" ? (
                      <>
                        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 leading-snug mb-1">
                          ⚠️ CNAE regulamentado — verificar autorização obrigatória
                        </p>
                        <p className="text-[10px] leading-relaxed text-foreground/80">{f.label}</p>
                        {"orgao_url" in f && (f as { orgao_url?: string }).orgao_url && (
                          <a
                            href={(f as { orgao_url?: string }).orgao_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary underline font-medium"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Consultar órgão regulador →
                          </a>
                        )}
                      </>
                    ) : f.id === "municipio_fronteira" ? (
                      <>
                        <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 leading-snug mb-1">
                          📍 Circular BACEN 4.001 — Município de risco geográfico
                        </p>
                        <p className="text-[10px] leading-relaxed text-foreground/80">{f.label}</p>
                      </>
                    ) : f.id === "eleitoral_2026" ? (
                      <>
                        <p className="text-[11px] font-semibold text-destructive leading-snug mb-1">
                          🗳️ Risco eleitoral 2026 — PEP com mandato ativo
                        </p>
                        <p className="text-[10px] leading-relaxed text-foreground/80">{f.label}</p>
                      </>
                    ) : (
                      <>
                        <p className={cn("text-xs font-medium leading-snug", FATOR_NIVEL_COLOR[f.nivel] ?? "")}>
                          {f.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground capitalize">
                          severidade {f.nivel}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* CNAE e uso para LD */}
            {cnae && (
              <div className="px-4 pb-3 border-t pt-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  CNAE e tipologia de LD
                </p>
                <p className="text-[10px] font-mono text-muted-foreground mb-1.5 truncate">{cnae}</p>
                {cnaeLd ? (
                  <div className={cn("rounded-lg border p-3 space-y-2", CNAE_RISCO_BG[cnaeLd.risco])}>
                    {/* Alerta de recusa automática */}
                    {cnaeLd.risco === "recusar" && (
                      <div className="flex items-center gap-2 rounded-md bg-destructive/20 border border-destructive/40 px-2.5 py-1.5">
                        <span className="text-base">🚫</span>
                        <p className="text-[11px] font-black text-destructive uppercase tracking-wide">
                          CNAE proibido pela política Cora — reprovar automaticamente
                        </p>
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold leading-snug">{cnaeLd.atividade}</p>
                      <span className={cn("text-[10px] font-bold shrink-0 text-right", CNAE_RISCO_COLOR[cnaeLd.risco])}>
                        {CNAE_RISCO_LABEL[cnaeLd.risco]}
                      </span>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                        Como pode ser usado para LD
                      </p>
                      <p className="text-[11px] leading-relaxed text-foreground/80">
                        {cnaeLd.como_usa_ld}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Tipologia:</span>
                      <span className={cn("text-[10px] font-semibold", CNAE_RISCO_COLOR[cnaeLd.risco])}>
                        {cnaeLd.tipologia}
                      </span>
                    </div>
                    <p className="text-[9px] text-muted-foreground border-t pt-1.5">
                      Fonte: tabela Cora (table_cnae) · score={cnaeLd.score_cora}
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground italic">
                    CNAE não mapeado na base de tipologias de risco Cora. Solicite inclusão na tabela ou avalie manualmente.
                  </p>
                )}
              </div>
            )}

            {/* Rodapé */}
            <div className="rounded-b-xl bg-muted/30 px-4 py-2 border-t">
              <p className="text-[9px] text-muted-foreground leading-snug">
                Modelo baseado em análise de 399 contas PLD-encerradas (risk_business.status='PLD').
                {score.gerado_em && (
                  <> Atualizado: {new Date(score.gerado_em).toLocaleDateString("pt-BR")}.</>
                )}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function categoriaDe(fonte: string): string {
  if (fonte.startsWith("TSE")) return "Eleitoral / PEP";
  if (fonte.includes("Sanções") || fonte.includes("CEIS") || fonte.includes("CGU")) return "Sanções";
  if (fonte.includes("Receita") || fonte.includes("Casa dos Dados") || fonte.includes("BrasilAPI"))
    return "Receita / QSA";
  if (fonte.includes("CNJ") || fonte.includes("JusBrasil") || fonte.includes("Escavador") ||
      fonte.includes("TCU") || fonte.includes("MPF") || fonte.startsWith("TJ-")) return "Justiça";
  if (fonte.includes("DOU") || fonte.includes("Diário")) return "Diário Oficial";
  if (fonte.startsWith("TCE-") || fonte.startsWith("MP-") || fonte.startsWith("Câmara/ALE")) return "Estadual";
  if (fonte.includes("cruzada")) return "Cruzamento";
  return "Mídia";
}
