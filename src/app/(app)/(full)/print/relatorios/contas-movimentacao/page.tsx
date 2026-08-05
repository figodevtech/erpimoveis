import type { Metadata } from "next";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Movimentação por conta — impressão" };

type Params = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Params> };

type Movimento = { entradas: number; saidas: number; anterior: number };

const OFFSET = "-03:00";
const FIRST_PAGE_ROWS = 22;
const NEXT_PAGE_ROWS = 28;
/** Chave da linha que junta o que não tem conta bancária vinculada. */
const SEM_CONTA = "sem-conta";

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
function joinParts(...parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? "").trim()).filter(Boolean).join(" · ");
}

/** Entrada é o que credita a conta; o resto debita. */
function isEntrada(row: any) {
  return row.tipo === "RECEITA" || row.tipo === "DEPOSITO";
}
/** O que de fato encosta na conta é o líquido; a taxa nunca entrou. */
function valorEfetivo(row: any) {
  return Number(row.valorLiquido ?? row.valor ?? 0);
}

export default async function ContasMovimentacaoPrintPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, one(value)]));

  const dateFrom = params.dateFrom ?? "";
  const dateTo = params.dateTo ?? "";
  // Saldo é caixa: por padrão só entra o que já foi realizado.
  const incluiPendentes = params.pendentes === "true";

  const contasRes = await supabaseAdmin
    .from("bancoconta")
    .select("id, titulo, tipo, agencia, contanumero, valorinicial, ativo")
    .order("titulo", { ascending: true });
  if (contasRes.error) throw new Error(`Não foi possível carregar as contas: ${contasRes.error.message}`);
  const contas = contasRes.data ?? [];

  const carregar = async (aplicar: (query: any) => any) => {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      let query = supabaseAdmin
        .from("transacao")
        .select('id, banco_id, tipo, valor, "valorLiquido", data, pendente')
        .eq("is_deleted", false)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (!incluiPendentes) query = query.eq("pendente", false);
      query = aplicar(query);

      const { data, error } = await query;
      if (error) throw new Error(`Não foi possível gerar o relatório: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  };

  // Duas leituras: o que veio antes do período forma o saldo de abertura.
  const anteriores = dateFrom ? await carregar((query) => query.lt("data", dayStart(dateFrom))) : [];
  const doPeriodo = await carregar((query) => {
    let scoped = query;
    if (dateFrom) scoped = scoped.gte("data", dayStart(dateFrom));
    if (dateTo) scoped = scoped.lt("data", nextDay(dateTo));
    return scoped;
  });

  const movimentos = new Map<string, Movimento>();
  const movimentoDe = (key: string) => {
    const atual = movimentos.get(key) ?? { entradas: 0, saidas: 0, anterior: 0 };
    movimentos.set(key, atual);
    return atual;
  };

  contas.forEach((conta) => {
    // O valor inicial da conta é o ponto de partida do saldo de abertura.
    movimentoDe(String(conta.id)).anterior = Number(conta.valorinicial ?? 0);
  });

  anteriores.forEach((row) => {
    const alvo = movimentoDe(row.banco_id == null ? SEM_CONTA : String(row.banco_id));
    alvo.anterior += isEntrada(row) ? valorEfetivo(row) : -valorEfetivo(row);
  });

  doPeriodo.forEach((row) => {
    const alvo = movimentoDe(row.banco_id == null ? SEM_CONTA : String(row.banco_id));
    if (isEntrada(row)) alvo.entradas += valorEfetivo(row);
    else alvo.saidas += valorEfetivo(row);
  });

  const semConta = movimentos.get(SEM_CONTA);
  const linhas = [
    ...contas.map((conta) => {
      const movimento = movimentoDe(String(conta.id));
      return {
        key: String(conta.id),
        titulo: conta.titulo as string,
        detalhe: joinParts(conta.tipo, joinParts(conta.agencia, conta.contanumero)),
        inativa: conta.ativo === false,
        ...movimento,
      };
    }),
    // Sem esta linha os totais impressos não fecham com o fluxo de caixa.
    ...(semConta && (semConta.entradas || semConta.saidas || semConta.anterior)
      ? [{
          key: SEM_CONTA,
          titulo: "Sem conta vinculada",
          detalhe: "Lançamentos sem banco informado",
          inativa: false,
          ...semConta,
        }]
      : []),
  ].map((linha) => ({ ...linha, final: linha.anterior + linha.entradas - linha.saidas }));

  const totais = linhas.reduce(
    (acumulado, linha) => ({
      anterior: acumulado.anterior + linha.anterior,
      entradas: acumulado.entradas + linha.entradas,
      saidas: acumulado.saidas + linha.saidas,
      final: acumulado.final + linha.final,
    }),
    { anterior: 0, entradas: 0, saidas: 0, final: 0 },
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
          <A4PdfActions filename="movimentacao-por-conta.pdf" backHref="/relatorios" />
        </div>
        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {pages.map((pageRows, pageIndex) => {
            const ultimaFolha = pageIndex === pages.length - 1;

            return (
              <section key={pageIndex} className="report-sheet h-[297mm] w-[210mm] overflow-hidden border border-neutral-300 bg-white p-[10mm] shadow-xl">
                {pageIndex === 0 ? (
                  <header className="mb-3 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                    <div className="min-w-0">
                      <h1 className="text-lg font-bold uppercase">Movimentação por conta bancária</h1>
                      <p className="text-[9px] text-neutral-500">
                        {incluiPendentes
                          ? "Inclui lançamentos pendentes"
                          : "Somente lançamentos realizados"}
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
                  <thead>
                    <tr className="bg-neutral-100 text-left uppercase">
                      <Th>Conta</Th>
                      <Th className="w-[30mm] text-right">Saldo anterior</Th>
                      <Th className="w-[28mm] text-right">Entradas</Th>
                      <Th className="w-[28mm] text-right">Saídas</Th>
                      <Th className="w-[30mm] text-right">Saldo da conta</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length ? pageRows.map((linha, index) => (
                      // Escala de cinza alternada: separa uma conta da seguinte.
                      <tr key={linha.key} className={`h-[8mm] border-t border-neutral-300 ${index % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                        <Td>
                          <div className="truncate font-medium">
                            {linha.titulo}
                            {linha.inativa && <span className="text-neutral-500"> (inativa)</span>}
                          </div>
                          {linha.detalhe && <div className="truncate text-[6px] text-neutral-500">{linha.detalhe}</div>}
                        </Td>
                        <Td className="text-right tabular-nums">{money(linha.anterior)}</Td>
                        <Td className="text-right font-semibold tabular-nums text-emerald-700">+ {money(linha.entradas)}</Td>
                        <Td className="text-right font-semibold tabular-nums text-red-700">- {money(linha.saidas)}</Td>
                        <Td className={`text-right font-bold tabular-nums ${linha.final >= 0 ? "text-blue-700" : "text-red-700"}`}>
                          {money(linha.final)}
                        </Td>
                      </tr>
                    )) : (
                      <tr className="h-[8mm] border-t border-neutral-300">
                        <Td className="py-12 text-center text-neutral-500" colSpan={5}>
                          Nenhuma conta bancária cadastrada.
                        </Td>
                      </tr>
                    )}
                  </tbody>

                  {ultimaFolha && linhas.length > 0 && (
                    <tfoot>
                      <tr className="h-[8mm] border-t-2 border-neutral-400 bg-neutral-100">
                        <Td className="font-bold uppercase">Total</Td>
                        <Td className="text-right tabular-nums">{money(totais.anterior)}</Td>
                        <Td className="text-right font-semibold tabular-nums text-emerald-700">+ {money(totais.entradas)}</Td>
                        <Td className="text-right font-semibold tabular-nums text-red-700">- {money(totais.saidas)}</Td>
                        <Td className={`text-right font-bold tabular-nums ${totais.final >= 0 ? "text-blue-700" : "text-red-700"}`}>
                          {money(totais.final)}
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
  return <th className={`border-x border-neutral-200 px-2 py-1 ${className}`}>{children}</th>;
}
function Td({ children, className = "", colSpan }: React.PropsWithChildren<{ className?: string; colSpan?: number }>) {
  return <td colSpan={colSpan} className={`border-x border-neutral-200 px-2 py-1 align-middle ${className}`}>{children}</td>;
}
