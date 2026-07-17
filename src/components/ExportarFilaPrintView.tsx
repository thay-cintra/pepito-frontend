import type { RegistrationCase } from "@/types/registration";
import {
  inferCargoOrgao,
  inferTipoPep,
  vinculoLabel,
  getSugestaoParecer,
  getPldRiskScore,
} from "@/data/registration-enrich";
import { formatDate } from "@/lib/utils";

interface ExportarFilaPrintViewProps {
  casos: RegistrationCase[];
  filtros: {
    status: string;
    decisao: string;
    busca: string;
  };
}

const NIVEL_LABEL: Record<string, string> = {
  critico: "CRÍTICO",
  alto: "ALTO",
  medio: "MÉDIO",
  baixo: "BAIXO",
};

export function ExportarFilaPrintView({ casos, filtros }: ExportarFilaPrintViewProps) {
  return (
    <div id="pepito-print-root" className="hidden">
      {/* Página de rosto */}
      <div className="print-page-break p-8">
        <h1 className="text-2xl font-bold mb-4">
          Fila CHECK_ANALISTA — Export PDF (fallback offline)
        </h1>
        <p className="mb-1">Exportado em: {new Date().toLocaleString("pt-BR")}</p>
        <p className="mb-1">Quantidade de casos: {casos.length}</p>
        <p className="mb-1">Filtro de status: {filtros.status}</p>
        <p className="mb-1">Filtro de Sugestão IA: {filtros.decisao}</p>
        <p className="mb-1">Busca aplicada: {filtros.busca || "(nenhuma)"}</p>
        <p className="mt-4 text-sm">
          Este documento é um fallback offline. As Sugestões de parecer IA aqui
          contidas são rascunhos — a decisão final é sempre do analista.
        </p>
      </div>

      {/* Uma seção por caso */}
      {casos.map((caso, idx) => (
        <CasoPrintSection
          key={caso.draft_id}
          caso={caso}
          isLast={idx === casos.length - 1}
        />
      ))}
    </div>
  );
}

function CasoPrintSection({ caso, isLast }: { caso: RegistrationCase; isLast: boolean }) {
  const cargoOrgao = inferCargoOrgao(caso);
  const tipoPep = inferTipoPep(caso);
  const sugestao = getSugestaoParecer(caso.draft_id) ?? caso.parecer_sugerido;
  const riskScore = getPldRiskScore(caso.draft_id);
  const faturamento = (caso.faturamento_presumido || "").replace(/^"|"$/g, "") || "—";

  return (
    <div className={isLast ? "p-8" : "print-page-break p-8"}>
      <h2 className="text-xl font-bold mb-1">{caso.rf_nome_oficial}</h2>
      <p className="text-sm mb-3">
        CNPJ {caso.cnpj} · draft_id {caso.draft_id} · status {caso.status} ·
        sub_status {caso.sub_status} · person_type {caso.person_type}
      </p>

      <h3 className="font-semibold mt-4 mb-1">Pessoa Politicamente Exposta (PEP)</h3>
      <p className="text-sm">
        {caso.full_name_pf} (CPF {caso.cpf}) — PEP {tipoPep}
        {tipoPep === "relacionado" && cargoOrgao.vinculo
          ? ` · ${vinculoLabel(cargoOrgao.vinculo)} de ${cargoOrgao.nomePEP}`
          : ""}
      </p>
      <p className="text-sm">
        {cargoOrgao.cargo}
        {cargoOrgao.orgao ? ` em ${cargoOrgao.orgao}` : ""}
      </p>

      <h3 className="font-semibold mt-4 mb-1">Dados cadastrais (PJ)</h3>
      <p className="text-sm">CNAE: {caso.cnae || "—"}</p>
      <p className="text-sm">Constituição: {caso.data_constituicao || "—"}</p>
      <p className="text-sm">Porte: {caso.porte || "—"}</p>
      <p className="text-sm">Faturamento presumido: {faturamento}</p>
      <p className="text-sm">Endereço comercial: {caso.endereco_comercial || "—"}</p>

      <h3 className="font-semibold mt-4 mb-1">Score PLD</h3>
      <p className="text-sm">
        Score PLD: {caso.score_pld}
        {riskScore ? ` · Risco LD: ${Math.round(riskScore.probabilidade)}% (${NIVEL_LABEL[riskScore.nivel]})` : ""}
      </p>

      <h3 className="font-semibold mt-4 mb-1">Sugestão de parecer IA (rascunho)</h3>
      <p className="text-sm whitespace-pre-wrap">{sugestao || "(sem sugestão gerada)"}</p>

      <h3 className="font-semibold mt-4 mb-1">Histórico de comentários</h3>
      {caso.historico_comentarios.length === 0 ? (
        <p className="text-sm italic">Sem comentários registrados.</p>
      ) : (
        caso.historico_comentarios.map((h, i) => (
          <p key={i} className="text-sm mb-1">
            <span className="font-medium">{formatDate(h.timestamp)}</span> — {h.user_email}: {h.text}
          </p>
        ))
      )}
    </div>
  );
}
