"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { toast } from "@/lib/toast";

/**
 * Relação de ordens de serviço em A4 retrato.
 *
 * Antes esta relação saía pela grade genérica de planilha: treze colunas
 * espremidas numa folha deitada, em corpo 6, com a descrição cortada no meio.
 * Aqui cada OS ocupa um bloco de três linhas — identificação, contexto e
 * descrição —, que é como a folha é lida na prática: procura-se a ordem pelo
 * número ou pelo cliente, e o resto se lê depois de achar.
 *
 * Os dados vêm da mesma exportação em xlsx que alimenta o Excel, lidos por nome
 * de coluna. É a convenção das outras folhas de impressão: uma fonte só para o
 * arquivo e para o papel, sem uma segunda rota que possa divergir.
 */

type Cell = string | number | boolean | null;

type OrderRow = {
  id: string;
  status: string;
  priority: string;
  customer: string;
  document: string;
  target: string;
  sector: string;
  owner: string;
  description: string;
  openedAt: string;
  closedAt: string;
  budget: number;
};

/**
 * Orçamento de altura da folha.
 *
 * A4 retrato tem 297mm e 20mm vão nas margens, sobram 277mm. O bloco de cada OS
 * tem altura fixa (`ALTURA_LINHA`) justamente para esta conta fechar: com linha
 * de altura variável a folha ora sobra, ora estoura — e o que estoura é cortado
 * sem aviso, porque a folha esconde o excedente.
 *
 * Primeira folha: cabeçalho (~12mm) + faixa de filtros (~10mm) + painel de
 * totais (~10mm) + distribuição (~11mm) + cabeçalho da tabela (~5mm) = ~48mm.
 * Demais folhas: número da página + cabeçalho da tabela = ~10mm. De cada uma
 * ainda se desconta uma folga para o rodapé de total, que cai na última — e
 * qual será a última só se sabe depois de paginar.
 */
const ALTURA_LINHA = 10.5;
const LINHAS_PRIMEIRA_FOLHA = Math.floor((277 - 48 - 8) / ALTURA_LINHA);
const LINHAS_DEMAIS_FOLHAS = Math.floor((277 - 10 - 8) / ALTURA_LINHA);

const STATUS_LABEL: Record<string, string> = {
  AGUARDANDO_CHECKLIST: "Aguardando checklist",
  ORCAMENTO: "Em orçamento",
  APROVACAO_ORCAMENTO: "Aguardando aprovação",
  ORCAMENTO_APROVADO: "Orçamento aprovado",
  ORCAMENTO_RECUSADO: "Orçamento recusado",
  EM_ANDAMENTO: "Em andamento",
  PAGAMENTO: "Pagamento",
  SEM_COBRANCA: "Sem cobrança",
  CONCLUIDO: "Concluída",
  CANCELADO: "Cancelada",
};

/**
 * Tom de cada status. Impresso em preto e branco vira escala de cinza, então a
 * cor acompanha o rótulo — nunca o substitui.
 */
const STATUS_TOM: Record<string, { faixa: string; selo: string }> = {
  AGUARDANDO_CHECKLIST: { faixa: "bg-neutral-400", selo: "bg-neutral-100 text-neutral-700" },
  ORCAMENTO: { faixa: "bg-amber-400", selo: "bg-amber-50 text-amber-800" },
  APROVACAO_ORCAMENTO: { faixa: "bg-amber-500", selo: "bg-amber-50 text-amber-800" },
  ORCAMENTO_APROVADO: { faixa: "bg-sky-500", selo: "bg-sky-50 text-sky-800" },
  ORCAMENTO_RECUSADO: { faixa: "bg-red-400", selo: "bg-red-50 text-red-800" },
  EM_ANDAMENTO: { faixa: "bg-blue-500", selo: "bg-blue-50 text-blue-800" },
  PAGAMENTO: { faixa: "bg-violet-500", selo: "bg-violet-50 text-violet-800" },
  SEM_COBRANCA: { faixa: "bg-neutral-500", selo: "bg-neutral-100 text-neutral-700" },
  CONCLUIDO: { faixa: "bg-emerald-500", selo: "bg-emerald-50 text-emerald-800" },
  CANCELADO: { faixa: "bg-red-500", selo: "bg-red-50 text-red-800" },
};

const SEM_TOM = { faixa: "bg-neutral-300", selo: "bg-neutral-100 text-neutral-700" };

const PRIORIDADE_LABEL: Record<string, string> = {
  ALTA: "Alta",
  NORMAL: "Normal",
  BAIXA: "Baixa",
};

const ALVO_LABEL: Record<string, string> = {
  VEICULO: "Veículo",
  PECA: "Peça",
  EQUIPAMENTO: "Máquina/Equipamento",
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function text(value: Cell) {
  const limpo = String(value ?? "").trim();
  return limpo || "—";
}

function number(value: Cell) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "12/03/2026, 14:20" -> "12/03/2026": a hora não cabe e não decide nada aqui. */
function dayOf(value: Cell) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.split(",")[0].trim() || "—";
}

function statusLabel(codigo: string) {
  return STATUS_LABEL[codigo] ?? (codigo ? codigo.replaceAll("_", " ") : "—");
}

function pagesOf(rows: OrderRow[]) {
  if (!rows.length) return [[]] as OrderRow[][];
  const pages: OrderRow[][] = [];
  let cursor = 0;
  while (cursor < rows.length) {
    const capacidade = pages.length === 0 ? LINHAS_PRIMEIRA_FOLHA : LINHAS_DEMAIS_FOLHAS;
    pages.push(rows.slice(cursor, cursor + capacidade));
    cursor += capacidade;
  }
  return pages;
}

/** Período do relatório, lido dos próprios filtros da chamada. */
function periodLabel(endpoint: string) {
  const params = new URLSearchParams(endpoint.split("?")[1] ?? "");
  const br = (value: string) => value.split("-").reverse().join("/");
  const from = params.get("dateFrom");
  const to = params.get("dateTo");

  if (from && to) return `${br(from)} a ${br(to)}`;
  if (from) return `A partir de ${br(from)}`;
  if (to) return `Até ${br(to)}`;
  return "Todo o período";
}

function periodAxisLabel(endpoint: string) {
  const params = new URLSearchParams(endpoint.split("?")[1] ?? "");
  return params.get("campoData") === "conclusao" ? "Conclusão da OS" : "Entrada da OS";
}

/**
 * Faixa de filtros aplicados.
 *
 * Setor, cliente e responsável chegam como id no endereço, que não diz nada a
 * quem lê a folha. Como o filtro deixa um único valor no resultado, o nome sai
 * das próprias linhas — e some quando não há linha nenhuma para consultar.
 */
function filtrosAplicados(endpoint: string, rows: OrderRow[]) {
  const params = new URLSearchParams(endpoint.split("?")[1] ?? "");
  const chips: string[] = [];

  // Acima de três status a lista inteira quebraria a faixa em várias linhas e
  // comeria a altura reservada para as ordens; o número basta para conferir.
  const status = (params.get("status") ?? "").split(",").filter(Boolean);
  if (status.length && status.length <= 3) chips.push(`Status: ${status.map(statusLabel).join(", ")}`);
  else if (status.length) chips.push(`Status: ${status.length} selecionados`);

  const prioridade = params.get("prioridade");
  if (prioridade) chips.push(`Prioridade: ${PRIORIDADE_LABEL[prioridade] ?? prioridade}`);

  const alvo = params.get("alvoTipo");
  if (alvo) chips.push(`Alvo: ${ALVO_LABEL[alvo] ?? alvo}`);

  const primeira = rows[0];
  if (params.get("setorId") && primeira) chips.push(`Setor: ${primeira.sector}`);
  if (params.get("clienteId") && primeira) chips.push(`Cliente: ${primeira.customer}`);
  if (params.get("responsavelId") && primeira) chips.push(`Responsável: ${primeira.owner}`);
  if (params.get("ordemId")) chips.push(`OS #${params.get("ordemId")}`);

  return chips;
}

export function OrdemListReportView({ endpoint }: { endpoint: string }) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || "Não foi possível gerar o relatório.");
        }
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
        const headers = (matrix[0] ?? []).map(normalize);
        const column = (label: string) => headers.indexOf(normalize(label));

        const indices = {
          id: column("OS"),
          entrada: column("Entrada"),
          conclusao: column("Conclusão"),
          status: column("Status"),
          prioridade: column("Prioridade"),
          cliente: column("Cliente"),
          documento: column("CPF/CNPJ"),
          alvo: column("Alvo atendido"),
          setor: column("Setor"),
          responsavel: column("Responsável"),
          descricao: column("Descrição"),
          orcamento: column("Orçamento (R$)"),
        };

        const parsed = matrix.slice(1).map((row) => ({
          id: text(row[indices.id]),
          status: String(row[indices.status] ?? "").trim(),
          priority: String(row[indices.prioridade] ?? "").trim(),
          customer: text(row[indices.cliente]),
          document: text(row[indices.documento]),
          target: text(row[indices.alvo]),
          sector: text(row[indices.setor]),
          owner: text(row[indices.responsavel]),
          description: text(row[indices.descricao]),
          openedAt: dayOf(row[indices.entrada]),
          closedAt: dayOf(row[indices.conclusao]),
          budget: number(row[indices.orcamento]),
        }));

        if (active) setRows(parsed);
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "Não foi possível gerar o relatório.";
        if (active) {
          setError(message);
          toast.error(message);
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [endpoint]);

  const pages = useMemo(() => pagesOf(rows), [rows]);
  const periodo = useMemo(() => periodLabel(endpoint), [endpoint]);
  const eixo = useMemo(() => periodAxisLabel(endpoint), [endpoint]);
  const chips = useMemo(() => filtrosAplicados(endpoint, rows), [endpoint, rows]);

  const total = useMemo(() => rows.reduce((soma, row) => soma + row.budget, 0), [rows]);
  const ticket = rows.length ? total / rows.length : 0;

  /** Distribuição por status, do mais frequente ao menos — só o que couber. */
  const distribuicao = useMemo(() => {
    const contagem = new Map<string, number>();
    rows.forEach((row) => contagem.set(row.status, (contagem.get(row.status) ?? 0) + 1));
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Montando a relação de ordens...
      </div>
    );
  }
  if (error) return <div className="flex min-h-screen items-center justify-center p-8 text-destructive">{error}</div>;

  return (
    <>
      <style>{`
        @page{size:A4 portrait;margin:0}
        @media print{
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          .os-list-shell{padding:0!important;background:#fff!important}
          .os-list-sheet{box-sizing:border-box!important;width:208mm!important;height:295mm!important;margin:0!important;padding:8mm!important;border:0!important;box-shadow:none!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}
          .os-list-sheet:last-child{break-after:auto!important;page-break-after:auto!important}
          /* Sem isto o navegador descarta os fundos e as listras somem no papel. */
          .os-list-sheet,.os-list-sheet *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        }
      `}</style>
      <main className="os-list-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[210mm] justify-end">
          <A4PdfActions filename="relacao-de-ordens-de-servico.pdf" backHref="/relatorios" selector=".os-list-sheet" />
        </div>

        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {pages.map((pageRows, pageIndex) => (
            <section
              key={pageIndex}
              className="os-list-sheet flex h-[297mm] w-[210mm] flex-col overflow-hidden border bg-white p-[10mm] shadow-xl"
            >
              {pageIndex === 0 ? (
                <>
                  <header className="flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                    <div className="min-w-0">
                      <h1 className="text-lg font-bold uppercase">Relação de ordens de serviço</h1>
                      <p className="text-[9px] text-neutral-500">Situação operacional das ordens no recorte selecionado</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[9px] uppercase text-neutral-500">{eixo}</p>
                      <p className="text-[10px] font-bold tabular-nums">{periodo}</p>
                      <p className="text-[9px] text-neutral-500">Página 1 de {pages.length}</p>
                    </div>
                  </header>

                  {chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {chips.map((chip) => (
                        <span key={chip} className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[7px] uppercase text-neutral-600">
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Kpi label="Ordens no recorte" value={String(rows.length)} />
                    <Kpi label="Orçamento somado" value={money(total)} />
                    <Kpi label="Média por ordem" value={money(ticket)} />
                  </div>

                  {distribuicao.length > 1 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-neutral-200 py-1.5 text-[8px]">
                      <span className="uppercase text-neutral-500">Distribuição</span>
                      {distribuicao.map(([status, quantidade]) => (
                        <span key={status} className="flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${(STATUS_TOM[status] ?? SEM_TOM).faixa}`} />
                          <span>{statusLabel(status)}</span>
                          <strong className="tabular-nums">{quantidade}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-right text-[8px] text-neutral-500">Página {pageIndex + 1} de {pages.length}</p>
              )}

              <div className="mt-2 flex items-center gap-2 border-b border-neutral-300 pb-1 text-[7px] uppercase text-neutral-500">
                <span className="w-[14mm]">Ordem</span>
                <span className="flex-1">Cliente e alvo atendido</span>
                <span className="w-[26mm] text-right">Orçamento</span>
              </div>

              <div className="min-h-0 flex-1">
                {pageRows.length ? (
                  pageRows.map((row, index) => <OrderLine key={row.id} row={row} listrada={index % 2 === 1} />)
                ) : (
                  <div className="py-20 text-center text-sm text-neutral-500">Nenhuma ordem encontrada no recorte.</div>
                )}
              </div>

              {pageIndex === pages.length - 1 && rows.length > 0 && (
                <div className="mt-1 flex items-center justify-between border-t-2 border-black pt-1.5 text-[9px]">
                  <span className="uppercase text-neutral-500">
                    Total · {rows.length} {rows.length === 1 ? "ordem" : "ordens"}
                  </span>
                  <strong className="tabular-nums">{money(total)}</strong>
                </div>
              )}
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-300 bg-neutral-50 px-2 py-1.5">
      <p className="text-[7px] uppercase text-neutral-500">{label}</p>
      <p className="text-[11px] font-bold tabular-nums">{value}</p>
    </div>
  );
}

function OrderLine({ row, listrada }: { row: OrderRow; listrada: boolean }) {
  const tom = STATUS_TOM[row.status] ?? SEM_TOM;

  return (
    <article
      className={`flex gap-2 overflow-hidden border-b border-neutral-200 py-1.5 ${listrada ? "bg-neutral-50" : ""}`}
      style={{ height: `${ALTURA_LINHA}mm` }}
    >
      <span className={`w-[1mm] shrink-0 rounded-sm ${tom.faixa}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="w-[12mm] shrink-0 text-[10px] font-bold tabular-nums">#{row.id}</span>
          <span className={`shrink-0 rounded px-1 py-[1px] text-[7px] font-semibold uppercase ${tom.selo}`}>
            {statusLabel(row.status)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[9px] font-semibold">{row.customer}</span>
          <span className="shrink-0 text-[10px] font-bold tabular-nums">{money(row.budget)}</span>
        </div>
        <p className="mt-[1px] truncate pl-[12mm] text-[8px] text-neutral-600">
          {row.target}
          {" · "}
          <span className="text-neutral-500">Setor</span> {row.sector}
          {" · "}
          <span className="text-neutral-500">Resp.</span> {row.owner}
          {row.priority ? ` · ${PRIORIDADE_LABEL[row.priority] ?? row.priority}` : ""}
        </p>
        <p className="mt-[1px] truncate pl-[12mm] text-[8px] text-neutral-500">
          <span className="tabular-nums">{row.openedAt}</span>
          {" → "}
          <span className="tabular-nums">{row.closedAt}</span>
          {" · "}
          {row.description}
        </p>
      </div>
    </article>
  );
}
