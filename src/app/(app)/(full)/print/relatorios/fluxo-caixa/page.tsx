import type { Metadata } from "next";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Fluxo de caixa — impressão" };

type Params = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Params> };

const OFFSET = "-03:00";
// A4 retrato: a primeira folha perde altura para o cabeçalho e os KPIs.
const FIRST_PAGE_ROWS = 27;
const NEXT_PAGE_ROWS = 32;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function integer(value: string | undefined) {
  if (!value) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Fortaleza",
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}
/** Dia e hora separados: em retrato os dois não cabem na mesma linha. */
function dateParts(value: unknown) {
  if (!value) return { day: "—", time: "" };
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return { day: "—", time: "" };

  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", ...options }).format(date);

  return { day: format({ dateStyle: "short" }), time: format({ timeStyle: "short" }) };
}
function dayStart(value: string) {
  return new Date(`${value}T00:00:00${OFFSET}`).toISOString();
}
function nextDay(value: string) {
  return new Date(new Date(`${value}T00:00:00${OFFSET}`).getTime() + 86_400_000).toISOString();
}
function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result.length ? result : [[]];
}
function reportPages<T>(items: T[]) {
  if (!items.length) return [[]] as T[][];
  const pages: T[][] = [items.slice(0, FIRST_PAGE_ROWS)];
  const remaining = items.slice(FIRST_PAGE_ROWS);
  pages.push(...chunks(remaining, NEXT_PAGE_ROWS).filter((page) => page.length));
  return pages;
}
function origin(row: any) {
  if (row.evento_financeiro_id) return `Evento #${row.evento_financeiro_id}`;
  if (row.ordemservicoid) return `OS #${row.ordemservicoid}`;
  if (row.vendaid) return `Venda #${row.vendaid}`;
  return "Avulso";
}
function joinParts(...parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim()).filter(Boolean).join(" · ");
}
function safeSearch(value: string | undefined) {
  return (value ?? "").trim().slice(0, 200).replace(/[%_]/g, "");
}

export default async function FluxoCaixaPrintPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, one(value)]));
  const buildQuery = () => {
    let query = supabaseAdmin
      .from("transacao")
      .select('id, descricao, valor, "valorLiquido", nomepagador, cpfcnpjpagador, pendente, data, ordemservicoid, vendaid, evento_financeiro_id, metodopagamento, categoria, plano_de_conta, centro_custo, tipo, cliente_id, banco_id, banco:bancoconta!transacao_banco_id_fkey(titulo)')
      .eq("is_deleted", false)
      .order("data", { ascending: true })
      .order("id", { ascending: true });

    const search = safeSearch(params.search);
    const nomePagador = safeSearch(params.nomePagador);
    const documento = (params.documentoPagador ?? "").replace(/\D/g, "").slice(0, 20);
    if (search) query = query.ilike("descricao", `%${search}%`);
    if (params.tipo) query = query.eq("tipo", params.tipo);
    if (params.metodopagamento) query = query.eq("metodopagamento", params.metodopagamento);
    if (params.pendente === "true" || params.pendente === "false") query = query.eq("pendente", params.pendente === "true");
    if (nomePagador) query = query.ilike("nomepagador", `%${nomePagador}%`);
    if (documento) query = query.ilike("cpfcnpjpagador", `%${documento}%`);

    const equals = [
      ["ordemservicoid", integer(params.ordemservicoid)],
      ["vendaid", integer(params.vendaid)],
      ["cliente_id", integer(params.clienteId)],
      ["categoria_id", integer(params.categoriaId)],
      ["banco_id", integer(params.bancoId)],
      ["plano_de_conta_id", integer(params.planoContaId)],
      ["centro_custo_id", integer(params.centroCustoId)],
    ] as const;
    equals.forEach(([column, value]) => {
      if (value !== null) query = query.eq(column, value);
    });
    const minimum = Number(params.valorMin);
    const maximum = Number(params.valorMax);
    if (params.valorMin && Number.isFinite(minimum)) query = query.gte("valor", minimum);
    if (params.valorMax && Number.isFinite(maximum)) query = query.lte("valor", maximum);
    if (params.dateFrom) query = query.gte("data", dayStart(params.dateFrom));
    if (params.dateTo) query = query.lt("data", nextDay(params.dateTo));
    if (params.vinculo === "OS") query = query.not("ordemservicoid", "is", null);
    if (params.vinculo === "VENDA") query = query.not("vendaid", "is", null);
    if (params.vinculo === "EVENTO") query = query.not("evento_financeiro_id", "is", null);
    if (params.vinculo === "AVULSO") query = query.is("ordemservicoid", null).is("vendaid", null).is("evento_financeiro_id", null);
    return query;
  };

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw new Error(`Não foi possível gerar o relatório: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const isIncome = (row: any) => row.tipo === "RECEITA" || row.tipo === "DEPOSITO";
  const totalIncome = rows.filter(isIncome).reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
  const totalExpense = rows.filter((row) => !isIncome(row)).reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
  const balance = totalIncome - totalExpense;
  const pages = reportPages(rows);
  const filters = [
    params.dateFrom || params.dateTo ? `Período: ${params.dateFrom || "início"} a ${params.dateTo || "hoje"}` : "",
    params.tipo ? `Tipo: ${params.tipo}` : "",
    params.pendente ? `Situação: ${params.pendente === "true" ? "Pendente" : "Realizada"}` : "",
    params.vinculo ? `Origem: ${params.vinculo}` : "",
    params.metodopagamento ? `Pagamento: ${params.metodopagamento}` : "",
  ].filter(Boolean);

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body {
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .report-shell {
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .report-sheet {
            box-sizing: border-box !important;
            width: 208mm !important;
            height: 295mm !important;
            min-height: 295mm !important;
            max-height: 295mm !important;
            margin: 0 !important;
            padding: 8mm !important;
            overflow: hidden !important;
            border: 0 !important;
            box-shadow: none !important;
            break-inside: avoid-page !important;
            page-break-inside: avoid !important;
            break-after: page !important;
            page-break-after: always !important;
          }
          .report-sheet:last-child {
            break-after: auto !important;
            page-break-after: auto !important;
          }
          /* Sem isto o navegador descarta os fundos e as faixas somem no papel. */
          .report-sheet, .report-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      <main className="report-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[210mm] justify-end">
          <A4PdfActions filename="relatorio-fluxo-caixa.pdf" backHref="/relatorios" />
        </div>
        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {pages.map((pageRows, pageIndex) => {
            const ultimaFolha = pageIndex === pages.length - 1;

            return (
              <section key={pageIndex} className="report-sheet h-[297mm] w-[210mm] overflow-hidden border border-neutral-300 bg-white p-[10mm] shadow-xl print:break-after-page">
                {pageIndex === 0 ? (
                  <header className="mb-3 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                    <div className="min-w-0">
                      <h1 className="text-lg font-bold uppercase">Relatório de fluxo de caixa</h1>
                      <p className="text-[9px] text-neutral-500">{filters.length ? filters.join(" · ") : "Todos os lançamentos"}</p>
                    </div>
                    <div className="shrink-0 text-right text-[9px] text-neutral-500">
                      <p>Gerado em {dateTime(new Date().toISOString())}</p>
                      <p>Página 1 de {pages.length}</p>
                    </div>
                  </header>
                ) : (
                  // Sem cabeçalho, mas com a numeração: folha solta de relatório
                  // financeiro sem página vira problema na hora de conferir.
                  <p className="mb-2 text-right text-[8px] text-neutral-500">
                    Página {pageIndex + 1} de {pages.length}
                  </p>
                )}

                {pageIndex === 0 && (
                  <div className="mb-3 grid grid-cols-3 gap-3 rounded border border-neutral-300 bg-neutral-100 px-3 py-2 text-[8px]">
                    <Kpi label="Entradas" value={money(totalIncome)} tone="text-emerald-700" />
                    <Kpi label="Saídas" value={money(totalExpense)} tone="text-red-700" />
                    <Kpi label="Saldo" value={money(balance)} tone={balance >= 0 ? "text-blue-700" : "text-red-700"} />
                  </div>
                )}

                <table className="w-full table-fixed border-collapse text-[7px]">
                  {/* O colgroup é quem fixa a largura sob table-fixed; classe no
                      <th> perde para o conteúdo quando o rótulo é maior. */}
                  <colgroup>
                    <col style={{ width: "20mm" }} />
                    <col />
                    <col style={{ width: "28mm" }} />
                    <col style={{ width: "24mm" }} />
                    <col style={{ width: "22mm" }} />
                    <col style={{ width: "28mm" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-neutral-100 text-left uppercase">
                      <Th>Data</Th>
                      <Th>Descrição</Th>
                      <Th>Categoria</Th>
                      <Th>Origem</Th>
                      <Th>Situação</Th>
                      <Th className="text-right">Valor</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length ? pageRows.map((row) => {
                      const entrada = isIncome(row);
                      const { day, time } = dateParts(row.data);

                      return (
                        // Escala de cinza: entrada em branco, saída em cinza claro.
                        <tr key={row.id} className={`h-[7mm] break-inside-avoid border-t border-neutral-300 ${entrada ? "bg-white" : "bg-neutral-50"}`}>
                          <Td className="tabular-nums">
                            <div>{day}</div>
                            {time && <Sub>{time}</Sub>}
                          </Td>
                          <Td>
                            <div className="truncate" title={row.descricao || undefined}>
                              <strong>#{row.id}</strong> {row.descricao || "—"}
                            </div>
                            {row.nomepagador && <Sub>{row.nomepagador}</Sub>}
                          </Td>
                          <Td>
                            <div className="truncate">{row.categoria || "—"}</div>
                            {joinParts(row.plano_de_conta, row.centro_custo) && (
                              <Sub>{joinParts(row.plano_de_conta, row.centro_custo)}</Sub>
                            )}
                          </Td>
                          <Td>
                            <div className="truncate">{origin(row)}</div>
                            {joinParts(row.metodopagamento, row.banco?.titulo) && (
                              <Sub>{joinParts(row.metodopagamento, row.banco?.titulo)}</Sub>
                            )}
                          </Td>
                          <Td>
                            <div className="truncate">{row.pendente ? "Pendente" : "Realizada"}</div>
                            {row.tipo && <Sub>{row.tipo}</Sub>}
                          </Td>
                          <Td className={`text-right font-semibold tabular-nums ${entrada ? "text-emerald-700" : "text-red-700"}`}>
                            {entrada ? "+ " : "- "}
                            {money(row.valor)}
                          </Td>
                        </tr>
                      );
                    }) : (
                      <tr className="h-[7mm] border-t border-neutral-300">
                        <Td className="py-12 text-center text-neutral-500" colSpan={6}>
                          Nenhum lançamento encontrado para os filtros informados.
                        </Td>
                      </tr>
                    )}
                  </tbody>

                  {ultimaFolha && pageRows.length > 0 && (
                    <tfoot>
                      <tr className="h-[7mm] border-t-2 border-neutral-400 bg-neutral-100">
                        <Td colSpan={6}>
                          <div className="flex items-center justify-end gap-6 pr-1">
                            <Total label="Saídas" value={money(totalExpense)} tone="text-red-700" />
                            <Total label="Entradas" value={money(totalIncome)} tone="text-emerald-700" />
                            <Total label="Saldo" value={money(balance)} tone={balance >= 0 ? "text-blue-700" : "text-red-700"} />
                          </div>
                        </Td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className="uppercase text-neutral-500">{label}</p>
      <p className={`text-[11px] font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
function Total({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="uppercase tracking-wide text-neutral-500">{label}</span>
      <strong className={`tabular-nums ${tone}`}>{value}</strong>
    </span>
  );
}
function Sub({ children }: React.PropsWithChildren) {
  return <div className="truncate text-[6px] text-neutral-500">{children}</div>;
}
function Th({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <th className={`truncate border-x border-neutral-200 px-2 py-1 ${className}`}>{children}</th>;
}
function Td({ children, className = "", colSpan }: React.PropsWithChildren<{ className?: string; colSpan?: number }>) {
  return <td colSpan={colSpan} className={`border-x border-neutral-200 px-2 py-1 align-middle ${className}`}>{children}</td>;
}
