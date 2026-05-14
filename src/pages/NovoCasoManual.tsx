import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Image as ImageIcon,
  Upload,
  ClipboardCopy,
  Globe,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CnaeCombobox } from "@/components/CnaeCombobox";
import { storage } from "@/lib/storage";
import { clienteVazio } from "@/lib/cliente-default";
import { pesquisarFontesPublicas } from "@/lib/mock-ai";
import { formatCNPJ, formatCPF, uid } from "@/lib/utils";
import { statusLabel } from "@/lib/parecer";
import type {
  Analise,
  ClienteData,
  GrauParentesco,
  RelacaoEmpresa,
  Socio,
  TipoVinculoPEP,
} from "@/types/kyc";

const RELACAO_EMPRESA_OPTIONS: RelacaoEmpresa[] = [
  "",
  "Sócio",
  "Sócio Administrador",
  "Diretor",
  "Presidente",
  "Procurador",
  "Administrador",
  "Membro do Conselho de Administração",
  "Conselheiro Fiscal",
  "Sócio Comanditário",
  "Sócio Comanditado",
  "Sócio Cotista",
  "Sócio Ostensivo",
  "Acionista Controlador",
  "Empresário (Individual)",
  "Sócio Pessoa Jurídica Domiciliado no Exterior",
  "Sócio Pessoa Física Residente ou Domiciliado no Exterior",
  "Titular Pessoa Física Residente ou Domiciliado no Exterior",
  "Outros",
];

const TIPO_VINCULO_OPTIONS: TipoVinculoPEP[] = [
  "",
  "Cônjuge/Companheiro",
  "Parente até 2º grau",
  "Sócio/Representante em outra empresa",
  "Procurador",
  "Controlador de Pessoa Jurídica",
  "Outro vínculo",
];

const GRAU_PARENTESCO_OPTIONS: GrauParentesco[] = [
  "",
  "Pai",
  "Mãe",
  "Irmão",
  "Irmã",
  "Tio",
  "Tia",
  "Filho",
  "Filha",
];

interface SocioForm {
  nome: string;
  relacao: RelacaoEmpresa | "";
}

export function NovoCasoManual() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [validando, setValidando] = useState(false);

  // PJ
  const [cnpj, setCnpj] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");

  // Sócios
  const [socio1, setSocio1] = useState<SocioForm>({ nome: "", relacao: "" });
  const [socio2, setSocio2] = useState<SocioForm>({ nome: "", relacao: "" });

  // PEP
  const [tipoPep, setTipoPep] = useState<"titular" | "relacionado">("titular");
  const [nomePep, setNomePep] = useState("");
  const [relacaoPep, setRelacaoPep] = useState<RelacaoEmpresa>("");
  const [cargoPep, setCargoPep] = useState("");
  const [orgaoPep, setOrgaoPep] = useState("");
  const [tipoVinculo, setTipoVinculo] = useState<TipoVinculoPEP>("");
  const [grauParentesco, setGrauParentesco] = useState<GrauParentesco>("");

  // Cadastro PJ extras
  const [cnae, setCnae] = useState("");
  const [endereco, setEndereco] = useState("");
  const [dataAbertura, setDataAbertura] = useState("");
  const [parecerPrimeira, setParecerPrimeira] = useState("");

  // OCR (paste image)
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          handleOcrFromImage(item.getAsFile());
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function handleOcrFromImage(file: File | null) {
    if (!file) return;
    toast({
      title: "OCR não disponível em modo demo",
      description:
        "Em produção, a Edge Function `ocr-extract` (Gemini Vision) preencheria os campos automaticamente. Preencha manualmente por enquanto.",
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleOcrFromImage(f);
  }

  // Validação multi-campo
  const isParente2Grau = tipoVinculo === "Parente até 2º grau";
  const podeIniciar =
    cnpj.replace(/\D/g, "").length === 14 &&
    razaoSocial.trim().length > 0 &&
    socio1.nome.trim().length > 0 &&
    socio1.relacao &&
    nomePep.trim().length > 0 &&
    (tipoPep === "titular"
      ? !!relacaoPep
      : !!tipoVinculo && (!isParente2Grau || !!grauParentesco));

  function montarCliente(): ClienteData {
    const base = clienteVazio();
    return {
      ...base,
      cnpj,
      razaoSocial,
      tipoPep,
      tipoVinculo: tipoPep === "relacionado" ? tipoVinculo : "",
      grauParentesco: tipoPep === "relacionado" ? grauParentesco : "",
      nomePessoaVinculada: nomePep,
      nomeResponsavel: socio1.nome,
      cpfResponsavel: "",
      relacaoComEmpresa: tipoPep === "titular" ? relacaoPep : socio1.relacao || "",
      cargoPep,
      orgaoPublico: orgaoPep,
      cnae,
      enderecoComercial: endereco,
      dataConstituicao: dataAbertura,
      socios: [
        ...(socio1.nome
          ? [{ nome: socio1.nome, cpf: "", participacao: socio1.relacao || "" }]
          : []),
        ...(socio2.nome
          ? [{ nome: socio2.nome, cpf: "", participacao: socio2.relacao || "" }]
          : []),
      ] as Socio[],
    };
  }

  async function handleIniciarValidacao() {
    if (!podeIniciar) {
      toast({
        variant: "destructive",
        title: "Preencha os campos obrigatórios",
        description:
          "CNPJ, Razão Social, Titular/Sócio + Relação, Tipo PEP e Nome do PEP são necessários.",
      });
      return;
    }

    setValidando(true);
    try {
      const cliente = montarCliente();
      const id = uid();
      const now = new Date().toISOString();

      // Dispara pesquisa automatizada (mock-AI: substitui Edge Function)
      const pesquisa = await pesquisarFontesPublicas({
        cliente,
        observacoesAnalista: parecerPrimeira,
      });

      const analise: Analise = {
        id,
        data: now,
        createdAt: now,
        cliente,
        parecerPrimeiraCamada: parecerPrimeira,
        resultadosPesquisa: pesquisa.resultados,
        analiseGeral: pesquisa.analiseGeral,
        status: pesquisa.recomendacao,
        recomendacao: statusLabel(pesquisa.recomendacao),
        parecerCompleto: "",
        camadaStatus: "aguardando_segunda",
      };

      storage.saveAnalise(analise);
      toast({
        variant: "success",
        title: "Validação concluída",
        description: `${pesquisa.resultados.length} apontamentos coletados. Caso aberto na Mesa para decisão.`,
      });
      navigate(`/nova-analise?id=${id}`);
    } finally {
      setValidando(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" /> Mesa de Decisão — 2ª Camada
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Análise manual. Preencha os dados e inicie a pesquisa automatizada.
        </p>
      </div>

      {/* Extração por Imagem (OCR) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-5 w-5 text-primary" /> Extração por Imagem (OCR)
          </CardTitle>
          <CardDescription>
            Envie ou <strong>cole (Ctrl+V)</strong> uma captura de tela do
            sistema interno. Os campos serão preenchidos automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-border rounded-md p-6 flex flex-col items-center gap-3 hover:border-primary/40 transition-colors">
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1 text-sm hover:text-primary"
              >
                <Upload className="h-5 w-5" />
                <span>Enviar arquivo</span>
              </button>
              <div className="h-12 w-px bg-border" />
              <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                <ClipboardCopy className="h-5 w-5" />
                <span>Colar imagem</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Clique para enviar ou pressione{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] font-mono">
                Ctrl+V
              </kbd>{" "}
              para colar
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </CardContent>
      </Card>

      {/* Dados do Cliente */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do Cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* CNPJ */}
          <div>
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input
              id="cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
            />
          </div>

          <div>
            <Label htmlFor="razao">Razão Social</Label>
            <Input
              id="razao"
              value={razaoSocial}
              onChange={(e) => setRazaoSocial(e.target.value)}
            />
          </div>

          {/* Sócio 1 */}
          <div>
            <Label htmlFor="socio1nome">Titular / Sócio da Empresa</Label>
            <Input
              id="socio1nome"
              value={socio1.nome}
              onChange={(e) => setSocio1({ ...socio1, nome: e.target.value })}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <Label htmlFor="socio1rel">Relação com a Empresa</Label>
            <Select
              id="socio1rel"
              value={socio1.relacao}
              onChange={(e) =>
                setSocio1({ ...socio1, relacao: e.target.value as RelacaoEmpresa })
              }
            >
              {RELACAO_EMPRESA_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt || "Selecione"}
                </option>
              ))}
            </Select>
          </div>

          {/* Sócio 2 */}
          <div>
            <Label htmlFor="socio2nome">Titular / Sócio da Empresa (2)</Label>
            <Input
              id="socio2nome"
              value={socio2.nome}
              onChange={(e) => setSocio2({ ...socio2, nome: e.target.value })}
              placeholder="Nome completo (opcional)"
            />
          </div>
          <div>
            <Label htmlFor="socio2rel">Relação com a Empresa (2)</Label>
            <Select
              id="socio2rel"
              value={socio2.relacao}
              onChange={(e) =>
                setSocio2({ ...socio2, relacao: e.target.value as RelacaoEmpresa })
              }
            >
              {RELACAO_EMPRESA_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt || "Selecione"}
                </option>
              ))}
            </Select>
          </div>

          {/* Tipo PEP — radio */}
          <div className="space-y-2 pt-2">
            <Label>Tipo PEP</Label>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="tipoPep"
                  value="titular"
                  checked={tipoPep === "titular"}
                  onChange={() => {
                    setTipoPep("titular");
                    setTipoVinculo("");
                    setGrauParentesco("");
                  }}
                  className="accent-primary"
                />
                <span>Titular</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="tipoPep"
                  value="relacionado"
                  checked={tipoPep === "relacionado"}
                  onChange={() => setTipoPep("relacionado")}
                  className="accent-primary"
                />
                <span>Relacionado</span>
              </label>
            </div>
          </div>

          {/* Conditional block — same shell, different inner fields */}
          <div className="rounded-md border bg-muted/30 p-4 space-y-4">
            {tipoPep === "titular" ? (
              <>
                <div>
                  <Label htmlFor="nomePepTit">Nome do PEP Titular *</Label>
                  <Input
                    id="nomePepTit"
                    value={nomePep}
                    onChange={(e) => setNomePep(e.target.value)}
                    placeholder="Nome completo do PEP"
                  />
                </div>
                <div>
                  <Label htmlFor="relPepTit">Relação com a Empresa *</Label>
                  <Select
                    id="relPepTit"
                    value={relacaoPep}
                    onChange={(e) => setRelacaoPep(e.target.value as RelacaoEmpresa)}
                  >
                    {RELACAO_EMPRESA_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt || "Selecione"}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 p-3 text-xs">
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                  <span>
                    Owner é vínculo (não-titular) do PEP. Preencha os dados do
                    vínculo abaixo.
                  </span>
                </div>
                <div>
                  <Label htmlFor="tipoVinc">Tipo de Vínculo *</Label>
                  <Select
                    id="tipoVinc"
                    value={tipoVinculo}
                    onChange={(e) => {
                      setTipoVinculo(e.target.value as TipoVinculoPEP);
                      if (e.target.value !== "Parente até 2º grau") {
                        setGrauParentesco("");
                      }
                    }}
                  >
                    {TIPO_VINCULO_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt || "Selecione"}
                      </option>
                    ))}
                  </Select>
                </div>
                {isParente2Grau && (
                  <div>
                    <Label htmlFor="grauP">Grau de Parentesco *</Label>
                    <Select
                      id="grauP"
                      value={grauParentesco}
                      onChange={(e) =>
                        setGrauParentesco(e.target.value as GrauParentesco)
                      }
                    >
                      {GRAU_PARENTESCO_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt || "Selecione"}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div>
                  <Label htmlFor="nomePepRel">Nome da Pessoa PEP *</Label>
                  <Input
                    id="nomePepRel"
                    value={nomePep}
                    onChange={(e) => setNomePep(e.target.value)}
                    placeholder="Nome completo do PEP"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="cargoPep">Cargo / Função pública</Label>
                    <Input
                      id="cargoPep"
                      value={cargoPep}
                      onChange={(e) => setCargoPep(e.target.value)}
                      placeholder="Ex.: Vereador, Secretário..."
                    />
                  </div>
                  <div>
                    <Label htmlFor="orgaoPep">Órgão / Esfera</Label>
                    <Input
                      id="orgaoPep"
                      value={orgaoPep}
                      onChange={(e) => setOrgaoPep(e.target.value)}
                      placeholder="Ex.: Prefeitura de X, ALE-Y..."
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* CNAE */}
          <div>
            <Label>Atividade da Empresa (CNAE)</Label>
            <CnaeCombobox value={cnae} onChange={(v) => setCnae(v)} />
          </div>

          {/* Endereço */}
          <div>
            <Label htmlFor="end">
              Endereço da Empresa <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              id="end"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Rua, nº, bairro, cidade/UF"
            />
          </div>

          {/* Data Abertura */}
          <div>
            <Label htmlFor="dataAb">
              Data de Abertura <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              id="dataAb"
              type="date"
              value={dataAbertura}
              onChange={(e) => setDataAbertura(e.target.value)}
            />
          </div>

          {/* Parecer da 1ª Camada */}
          <div>
            <Label htmlFor="parecer">Parecer da 1ª Camada</Label>
            <Textarea
              id="parecer"
              value={parecerPrimeira}
              onChange={(e) => setParecerPrimeira(e.target.value)}
              placeholder="Insira observações ou parecer prévio..."
              rows={4}
            />
          </div>

          {/* Iniciar Validação */}
          <div className="pt-2">
            <Button
              onClick={handleIniciarValidacao}
              disabled={!podeIniciar || validando}
              className="w-full md:w-auto"
            >
              {validando ? (
                <>
                  <Globe className="h-4 w-4 animate-pulse" /> Validando...
                </>
              ) : (
                <>
                  <Globe className="h-4 w-4" /> Iniciar Validação
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
