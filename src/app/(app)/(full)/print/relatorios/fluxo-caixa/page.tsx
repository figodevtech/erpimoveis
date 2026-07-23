import type { Metadata } from "next";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Fluxo de caixa — impressão" };

type Params = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Params> };

const OFFSET = "-03:00";
const FIRST_PAGE_ROWS = 14;
const NEXT_PAGE_ROWS = 18;

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
        @page { size: A4 landscape; margin: 0; }
        @media print {
          html, body {
            width: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .report-shell {
            width: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .report-sheet {
            box-sizing: border-box !important;
            width: 296mm !important;
            height: 208mm !important;
            min-height: 208mm !important;
            max-height: 208mm !important;
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
        }
      `}</style>
      <main className="report-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[297mm] justify-end">
          <A4PdfActions filename="relatorio-fluxo-caixa.pdf" backHref="/relatorios" landscape />
        </div>
        <div className="mx-auto flex w-[297mm] flex-col gap-4 print:gap-0">
          {pages.map((pageRows, pageIndex) => (
            <section key={pageIndex} className="report-sheet h-[210mm] w-[297mm] overflow-hidden border border-neutral-300 bg-white p-[10mm] shadow-xl print:break-after-page">
              <header className="mb-4 flex items-start justify-between border-b-2 border-black pb-3">
                <div>
                  <h1 className="text-xl font-bold uppercase">Relatório de fluxo de caixa</h1>
                  <p className="mt-1 text-[10px] text-neutral-600">{filters.length ? filters.join(" · ") : "Todos os lançamentos"}</p>
                </div>
                <div className="text-right text-[10px] text-neutral-600">
                  <p>Gerado em {dateTime(new Date().toISOString())}</p>
                  <p>Página {pageIndex + 1} de {pages.length}</p>
                </div>
              </header>

              {pageIndex === 0 && (
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <Kpi label="Entradas" value={money(totalIncome)} tone="text-emerald-700" />
                  <Kpi label="Saídas" value={money(totalExpense)} tone="text-red-700" />
                  <Kpi label="Saldo" value={money(totalIncome - totalExpense)} tone={totalIncome - totalExpense >= 0 ? "text-blue-700" : "text-red-700"} />
                </div>
              )}

              <table className="w-full table-fixed border-collapse text-[8px]">
                <thead>
                  <tr className="bg-neutral-100 text-left uppercase">
                    <Th className="w-[24mm]">Data</Th><Th>Descrição</Th><Th className="w-[21mm]">Tipo</Th>
                    <Th className="w-[30mm]">Categoria</Th><Th className="w-[31mm]">Plano / centro</Th>
                    <Th className="w-[25mm]">Origem</Th><Th className="w-[31mm]">Pagamento / conta</Th>
                    <Th className="w-[20mm]">Situação</Th><Th className="w-[25mm] text-right">Valor</Th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length ? pageRows.map((row) => (
                    <tr key={row.id} className="break-inside-avoid border-b border-neutral-200">
                      <Td>{dateTime(row.data)}</Td>
                      <Td><div className="truncate" title={row.descricao || undefined}><strong>#{row.id}</strong> {row.descricao || "—"}</div>{row.nomepagador ? <small className="block truncate text-[7px] text-neutral-500">{row.nomepagador}</small> : null}</Td>
                      <Td>{row.tipo || "—"}</Td>
                      <Td><div className="truncate">{row.categoria || "—"}</div></Td>
                      <Td><div className="truncate">{row.plano_de_conta || "—"}</div>{row.centro_custo ? <small className="block truncate text-[7px] text-neutral-500">{row.centro_custo}</small> : null}</Td>
                      <Td>{origin(row)}</Td>
                      <Td><div className="truncate">{row.metodopagamento || "—"}</div>{row.banco?.titulo ? <small className="block truncate text-[7px] text-neutral-500">{row.banco.titulo}</small> : null}</Td>
                      <Td>{row.pendente ? "Pendente" : "Realizada"}</Td>
                      <Td className={`text-right font-semibold ${isIncome(row) ? "text-emerald-700" : "text-red-700"}`}>{money(row.valor)}</Td>
                    </tr>
                  )) : <tr><Td className="py-12 text-center text-neutral-500" colSpan={9}>Nenhum lançamento encontrado para os filtros informados.</Td></tr>}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="rounded border border-neutral-300 p-3"><p className="text-[9px] uppercase text-neutral-500">{label}</p><p className={`text-lg font-bold ${tone}`}>{value}</p></div>;
}
function Th({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <th className={`border border-neutral-300 px-2 py-1.5 ${className}`}>{children}</th>;
}
function Td({ children, className = "", colSpan }: React.PropsWithChildren<{ className?: string; colSpan?: number }>) {
  return <td colSpan={colSpan} className={`border-x border-neutral-200 px-2 py-1.5 align-top ${className}`}>{children}</td>;
}
