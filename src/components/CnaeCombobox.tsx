import { useMemo, useState } from "react";
import { Search, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Lista curada de CNAEs frequentes (PEPs/contas PJ). Em produção, consultar a
 * API de CNAEs do IBGE (cnaes_subclasses) para autocomplete completo. */
const CNAES_FREQUENTES: Array<{ codigo: string; descricao: string; sensivel?: boolean }> = [
  { codigo: "4120-4/00", descricao: "Construção de edifícios", sensivel: true },
  { codigo: "4213-8/00", descricao: "Obras de engenharia civil", sensivel: true },
  { codigo: "7112-0/00", descricao: "Serviços de engenharia", sensivel: true },
  { codigo: "7020-4/00", descricao: "Atividades de consultoria em gestão empresarial", sensivel: true },
  { codigo: "6911-7/01", descricao: "Serviços advocatícios" },
  { codigo: "8550-3/02", descricao: "Atividades de apoio à educação", sensivel: true },
  { codigo: "9499-5/00", descricao: "Atividades associativas (ONGs)", sensivel: true },
  { codigo: "6810-2/01", descricao: "Compra e venda de imóveis próprios", sensivel: true },
  { codigo: "4623-1/06", descricao: "Comércio atacadista de animais vivos" },
  { codigo: "3700-1/01", descricao: "Gestão de redes de esgoto", sensivel: true },
  { codigo: "6462-0/00", descricao: "Holdings de instituições não-financeiras" },
  { codigo: "5811-5/00", descricao: "Edição de livros" },
  { codigo: "4930-2/02", descricao: "Transporte rodoviário de carga" },
  { codigo: "4731-8/00", descricao: "Comércio varejista de combustíveis" },
  { codigo: "5611-2/01", descricao: "Restaurantes e similares" },
  { codigo: "4783-1/01", descricao: "Comércio varejista de joias" },
  { codigo: "4783-1/02", descricao: "Comércio varejista de bijuterias" },
  { codigo: "4511-1/02", descricao: "Comércio varejista de veículos seminovos" },
  { codigo: "4651-6/01", descricao: "Atacado de eletrônicos" },
  { codigo: "4711-3/02", descricao: "Comércio varejista de mercadorias em geral" },
  { codigo: "4721-1/02", descricao: "Padaria e confeitaria com predominância de revenda" },
  { codigo: "4789-0/02", descricao: "Comércio varejista de plantas e flores naturais" },
  { codigo: "4789-0/05", descricao: "Comércio varejista de produtos para animais" },
  { codigo: "4774-1/00", descricao: "Comércio varejista de óculos e lentes" },
  { codigo: "4520-0/05", descricao: "Serviços de lavagem de veículos" },
  { codigo: "4530-7/03", descricao: "Comércio varejista de peças e acessórios para veículos" },
  { codigo: "4530-7/04", descricao: "Comércio varejista de pneumáticos e câmaras-de-ar" },
  { codigo: "4635-4/02", descricao: "Comércio atacadista de cerveja, chope e refrigerante" },
  { codigo: "6202-3/00", descricao: "Desenvolvimento e licenciamento de programas de computador" },
  { codigo: "6619-3/02", descricao: "Correspondentes de instituições financeiras / câmbio" },
  { codigo: "9602-5/01", descricao: "Cabeleireiros, manicure e pedicure" },
  { codigo: "9313-1/00", descricao: "Atividades de condicionamento físico" },
  { codigo: "8650-0/03", descricao: "Atividades de psicologia e psicanálise" },
  { codigo: "7319-0/02", descricao: "Promoção de vendas" },
  { codigo: "4321-5/00", descricao: "Instalação e manutenção elétrica" },
  { codigo: "8511-2/00", descricao: "Educação infantil — creche" },
  { codigo: "7911-2/00", descricao: "Agências de viagens" },
  { codigo: "4742-3/00", descricao: "Comércio varejista de material elétrico" },
];

interface Props {
  value: string;
  onChange: (codigo: string, descricao?: string) => void;
}

export function CnaeCombobox({ value, onChange }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CNAES_FREQUENTES.slice(0, 12);
    return CNAES_FREQUENTES.filter(
      (c) => c.codigo.includes(q) || c.descricao.toLowerCase().includes(q),
    ).slice(0, 12);
  }, [query]);

  const handleSelect = (codigo: string, descricao: string) => {
    setQuery(`${codigo} — ${descricao}`);
    onChange(codigo, descricao);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className="pl-9"
          placeholder="Buscar CNAE ou atividade..."
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-lg max-h-64 overflow-y-auto scrollbar-thin">
          {matches.map((m) => (
            <button
              key={m.codigo}
              type="button"
              onMouseDown={() => handleSelect(m.codigo, m.descricao)}
              className={cn(
                "flex items-center justify-between w-full text-left px-3 py-2 text-sm hover:bg-muted",
                value.startsWith(m.codigo) && "bg-secondary/40",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-primary">
                  {m.codigo}
                  {m.sensivel && (
                    <span className="ml-2 inline-block px-1 rounded bg-warning/15 text-warning text-[10px]">
                      sensível
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{m.descricao}</div>
              </div>
              {value.startsWith(m.codigo) && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
