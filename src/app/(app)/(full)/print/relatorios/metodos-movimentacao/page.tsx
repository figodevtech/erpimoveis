import type { Metadata } from "next";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { formatPaymentMethodLabel } from "@/lib/payment-methods";
import { getPaymentMethodValues } from "@/lib/payment-methods-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Movimentação por método — impressão" };

type Params = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Params> };

type Movimento = { entradas: number; saidas: number; lancamentos: number };

const OFFSET = "-03:00";
const FIRST_PAGE_ROWS = 22;
const NEXT_PAGE_ROWS = 28;
/** Chave da linha que junta o que não tem método informado. */
const SEM_METODO = "sem-metodo";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
function br(value: string) {
  return value ? value.split("-").reverse().join("/") : "";
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
  pages.push(...chunks(items.slice(FIRST_PAGE_ROWS), NEXT_PAGE_ROWS).filter((page) => page.length));
  return pages;
}

/** Entrada é o que credita o caixa; o resto debita. */
function isEntrada(row: any) {
  return row.tipo === "RECEITA" || row.tipo === "DEPOSITO";
}
/** O que de fato circulou é o líquido; a taxa nunca chegou. */
function valorEfetivo(row: any) {
  return Number(row.valorLiquido ?? row.valor ?? 0);
}

export default async function MetodosMovimentacaoPrintPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, one(value)]));

  const dateFrom = params.dateFrom ?? "";
  const dateTo = params.dateTo ?? "";
  const incluiPendentes = params.pendentes === "true";

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabaseAdmin
      .from("transacao")
      .select('id, metodopagamento, tipo, valor, "valorLiquido", data, pendente')
      .eq("is_deleted", false)
      .order("id", { ascending: true })
      .range(from, from + 999);

    if (!incluiPendentes) query = query.eq("pendente", false);
    if (dateFrom) query = query.gte("data", dayStart(dateFrom));
    if (dateTo) query = query.lt("data", nextDay(dateTo));

    const { data, error } = await query;
    if (error) throw new Error(`Não foi possível gerar o relatório: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const movimentos = new Map<string, Movimento>();
  const movimentoDe = (key: string) => {
    const atual = movimentos.get(key) ?? { entradas: 0, saidas: 0, lancamentos: 0 };
    movimentos.set(key, atual);
    return atual;
  };

  /*
   * Todos os métodos do sistema entram na lista, mesmo sem movimento no período.
   *
   * A lista vem do banco, não de um enum no código: cada empresa tem os seus, e
   * o do TypeScript é uma cópia parcial que já ficou três métodos atrás do Demir
   * (DEBITO AUTOMATICO, CHEQUE, CREDITO EM CONTA). Com a cópia, esses três só
   * apareciam pela cláusula de dado legado, no fim da tabela e apenas quando
   * tinham movimento — nunca como linha própria zerada, como os demais.
   */
  const metodosDoSistema = await getPaymentMethodValues();
  metodosDoSistema.forEach((metodo) => movimentoDe(metodo));

  rows.forEach((row) => {
    const metodo = String(row.metodopagamento ?? "").trim();
    const alvo = movimentoDe(metodo || SEM_METODO);

    alvo.lancamentos += 1;
    if (isEntrada(row)) alvo.entradas += valorEfetivo(row);
    else alvo.saidas += valorEfetivo(row);
  });

  const semMetodo = movimentos.get(SEM_METODO);
  const linhas = [
    ...metodosDoSistema.map((metodo) => ({
      key: metodo,
      titulo: formatPaymentMethodLabel(metodo),
      ...movimentoDe(metodo),
    })),
    // Método que saiu da lista do sistema mas ainda tem lançamento gravado não
    // pode sumir da soma.
    ...Array.from(movimentos.entries())
      .filter(([key]) => key !== SEM_METODO && !metodosDoSistema.includes(key))
      .map(([key, movimento]) => ({
        key,
        titulo: formatPaymentMethodLabel(key),
        ...movimento,
      })),
    ...(semMetodo && semMetodo.lancamentos > 0
      ? [{ key: SEM_METODO, titulo: "Não informado", ...semMetodo }]
      : []),
  ].map((linha) => ({ ...linha, saldo: linha.entradas - linha.saidas }));

  const totais = linhas.reduce(
    (acumulado, linha) => ({
      entradas: acumulado.entradas + linha.entradas,
      saidas: acumulado.saidas + linha.saidas,
      saldo: acumulado.saldo + linha.saldo,
      lancamentos: acumulado.lancamentos + linha.lancamentos,
    }),
    { entradas: 0, saidas: 0, saldo: 0, lancamentos: 0 },
  );

  const pages = reportPages(linhas);
  const periodo =
    dateFrom && dateTo
      ? `${br(dateFrom)} a ${br(dateTo)}`
      : dateFrom
        ? `A partir de ${br(dateFrom)}`
        : dateTo
          ? `Até ${br(dateTo)}`
          : "Todo o período";

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { width: 210mm !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .report-shell { width: 210mm !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
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
            break-after: page !important;
            page-break-after: always !important;
          }
          .report-sheet:last-child { break-after: auto !important; page-break-after: auto !important; }
          /* Sem isto o navegador descarta os fundos e as faixas somem no papel. */
          .report-sheet, .report-sheet * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <main className="report-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[210mm] justify-end">
          <A4PdfActions filename="movimentacao-por-metodo.pdf" backHref="/relatorios" />
        </div>
        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {pages.map((pageRows, pageIndex) => {
            const ultimaFolha = pageIndex === pages.length - 1;

            return (
              <section key={pageIndex} className="report-sheet h-[297mm] w-[210mm] overflow-hidden border border-neutral-300 bg-white p-[10mm] shadow-xl">
                {pageIndex === 0 ? (
                  <header className="mb-3 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                    <div className="min-w-0">
                      <h1 className="text-lg font-bold uppercase">Movimentação por método de pagamento</h1>
                      <p className="text-[9px] text-neutral-500">
                        {incluiPendentes ? "Inclui lançamentos pendentes" : "Somente lançamentos realizados"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-[9px] text-neutral-500">
                      <p className="uppercase">Período</p>
                      <p className="text-[10px] font-bold tabular-nums text-black">{periodo}</p>
                      <p>Gerado em {dateTime(new Date().toISOString())}</p>
                      <p>Página 1 de {pages.length}</p>
                    </div>
                  </header>
                ) : (
                  <p className="mb-2 text-right text-[8px] text-neutral-500">
                    Página {pageIndex + 1} de {pages.length}
                  </p>
                )}

                <table className="w-full table-fixed border-collapse text-[7px]">
                  {/* O colgroup é quem fixa a largura sob table-fixed; classe no
                      <th> perde para o conteúdo quando o rótulo é maior. */}
                  <colgroup>
                    <col />
                    <col style={{ width: "22mm" }} />
                    <col style={{ width: "30mm" }} />
                    <col style={{ width: "30mm" }} />
                    <col style={{ width: "32mm" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-neutral-100 text-left uppercase">
                      <Th>Método de pagamento</Th>
                      <Th className="text-right">Lançamentos</Th>
                      <Th className="text-right">Entradas</Th>
                      <Th className="text-right">Saídas</Th>
                      <Th className="text-right">Saldo</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length ? pageRows.map((linha, index) => (
                      // Escala de cinza alternada: separa um método do seguinte.
                      <tr key={linha.key} className={`h-[8mm] border-t border-neutral-300 ${index % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                        <Td>
                          <div className="truncate font-medium">{linha.titulo}</div>
                          {linha.lancamentos === 0 && (
                            <div className="truncate text-[6px] text-neutral-500">Sem movimento no período</div>
                          )}
                        </Td>
                        <Td className="text-right tabular-nums">{linha.lancamentos}</Td>
                        <Td className="text-right font-semibold tabular-nums text-emerald-700">+ {money(linha.entradas)}</Td>
                        <Td className="text-right font-semibold tabular-nums text-red-700">- {money(linha.saidas)}</Td>
                        <Td className={`text-right font-bold tabular-nums ${linha.saldo >= 0 ? "text-blue-700" : "text-red-700"}`}>
                          {money(linha.saldo)}
                        </Td>
                      </tr>
                    )) : (
                      <tr className="h-[8mm] border-t border-neutral-300">
                        <Td className="py-12 text-center text-neutral-500" colSpan={5}>
                          Nenhum lançamento encontrado para o período informado.
                        </Td>
                      </tr>
                    )}
                  </tbody>

                  {ultimaFolha && linhas.length > 0 && (
                    <tfoot>
                      <tr className="h-[8mm] border-t-2 border-neutral-400 bg-neutral-100">
                        <Td className="font-bold uppercase">Total</Td>
                        <Td className="text-right tabular-nums">{totais.lancamentos}</Td>
                        <Td className="text-right font-semibold tabular-nums text-emerald-700">+ {money(totais.entradas)}</Td>
                        <Td className="text-right font-semibold tabular-nums text-red-700">- {money(totais.saidas)}</Td>
                        <Td className={`text-right font-bold tabular-nums ${totais.saldo >= 0 ? "text-blue-700" : "text-red-700"}`}>
                          {money(totais.saldo)}
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

function Th({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <th className={`truncate border-x border-neutral-200 px-2 py-1 ${className}`}>{children}</th>;
}
function Td({ children, className = "", colSpan }: React.PropsWithChildren<{ className?: string; colSpan?: number }>) {
  return <td colSpan={colSpan} className={`border-x border-neutral-200 px-2 py-1 align-middle ${className}`}>{children}</td>;
}
