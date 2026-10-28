import type { Metadata } from "next";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { PrintA4Paginator } from "@/app/(app)/(full)/components/PrintA4Paginator";
import { PrintFontSizeControl } from "@/app/(app)/(full)/components/PrintFontSizeControl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { FluxoAgrupamentoMenu } from "./agrupamento-menu";
import {
  agruparPorBanco,
  ehEntrada,
  filtroDeSituacao,
  itensDaFolhaAgrupada,
  saldosDoBanco,
  totalizarFluxo,
  valorDaLinha,
  type ContaDoGrupo,
  type ItemDaFolhaAgrupada,
  type MovimentoDoBanco,
} from "./report-model";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Fluxo de caixa — impressão" };

type Params = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Params> };

const OFFSET = "-03:00";

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

type Cartao = { label: string; value: number; tone: string };

/**
 * Os movimentos liquidados de cada conta, na ordem do extrato — dia, registro,
 * id —, que é a ordem em que o saldo acumula. Sem nenhum filtro da folha.
 */
async function lerHistoricoDasContas(ids: number[]) {
  const porBanco = new Map<number, MovimentoDoBanco[]>();

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("transacao")
      .select('id, banco_id, tipo, valor, "valorLiquido", valor_descontos')
      .in("banco_id", ids)
      .eq("is_deleted", false)
      // Título em aberto ainda não mexeu no dinheiro.
      .not("pendente", "is", true)
      .order("banco_id", { ascending: true })
      .order("data_dia", { ascending: true })
      .order("movimento_registrado_em", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Não foi possível calcular o saldo dos bancos: ${error.message}`);

    for (const row of data ?? []) {
      const bancoId = Number(row.banco_id);
      const lista = porBanco.get(bancoId) ?? [];
      lista.push(row as MovimentoDoBanco);
      porBanco.set(bancoId, lista);
    }
    if (!data || data.length < 1000) break;
  }

  return porBanco;
}

/**
 * As linhas da folha por conta, com o saldo de cada conta depois de cada
 * lançamento. O saldo é o real da conta — a história inteira, como na tela de
 * bancos —, então não muda com os filtros desta folha.
 */
async function montarGruposPorBanco(rows: any[]) {
  const ids = [...new Set(rows.filter((row) => row.banco_id != null).map((row) => Number(row.banco_id)))];
  if (!ids.length) return agruparPorBanco(rows, new Map(), new Map());

  const [{ data: bancos, error }, historico] = await Promise.all([
    supabaseAdmin.from("bancoconta").select("id, titulo, agencia, contanumero, valorinicial").in("id", ids),
    lerHistoricoDasContas(ids),
  ]);
  if (error) throw new Error(`Não foi possível carregar os bancos: ${error.message}`);

  const contas = new Map<number, ContaDoGrupo>();
  const saldos = new Map<number, Map<number, number>>();
  for (const banco of bancos ?? []) {
    const id = Number(banco.id);
    const inicial = Number(banco.valorinicial ?? 0);
    contas.set(id, { titulo: banco.titulo, detalhe: joinParts(banco.agencia, banco.contanumero) });
    saldos.set(id, saldosDoBanco(Number.isFinite(inicial) ? inicial : 0, historico.get(id) ?? []));
  }

  return agruparPorBanco(rows, contas, saldos);
}

export default async function FluxoCaixaPrintPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, one(value)]));
  const agrupar = params.agrupar === "banco";
  const buildQuery = () => {
    let query = supabaseAdmin
      .from("transacao")
      .select('id, descricao, valor, "valorLiquido", valor_descontos, valor_baixado, baixa_de_transacao_id, adiantamento_id, nomepagador, cpfcnpjpagador, pendente, data, ordemservicoid, vendaid, evento_financeiro_id, metodopagamento, categoria, plano_de_conta, centro_custo, tipo, cliente_id, banco_id, banco:bancoconta!transacao_banco_id_fkey(titulo)')
      .eq("is_deleted", false);
    // Agrupado por banco, a ordem é a do extrato — dia, registro, id —, a mesma em
    // que o saldo acumula: pelo instante cru, o saldo andaria para trás dentro do
    // dia. Sem agrupar, segue o livro cronológico de sempre.
    query = agrupar
      ? query
          .order("data_dia", { ascending: true })
          .order("movimento_registrado_em", { ascending: true })
          .order("id", { ascending: true })
      : query.order("data", { ascending: true }).order("id", { ascending: true });

    const search = safeSearch(params.search);
    const nomePagador = safeSearch(params.nomePagador);
    const documento = (params.documentoPagador ?? "").replace(/\D/g, "").slice(0, 20);
    if (search) query = query.ilike("descricao", `%${search}%`);
    if (params.tipo) query = query.eq("tipo", params.tipo);
    if (params.metodopagamento) query = query.eq("metodopagamento", params.metodopagamento);
    query = query.or(filtroDeSituacao(params.pendente));
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

  const totais = totalizarFluxo(rows);
  const cartoes: Cartao[] = [
    ...(params.pendente !== "true"
      ? [
          { label: "Entradas", value: totais.entradas, tone: "text-emerald-700" },
          { label: "Saídas", value: totais.saidas, tone: "text-red-700" },
          { label: "Saldo", value: totais.saldo, tone: totais.saldo >= 0 ? "text-blue-700" : "text-red-700" },
        ]
      : []),
    ...(params.pendente !== "false"
      ? [
          { label: "A receber em aberto", value: totais.aReceber, tone: "text-emerald-700" },
          { label: "A pagar em aberto", value: totais.aPagar, tone: "text-red-700" },
        ]
      : []),
  ];
  const itensAgrupados = agrupar ? itensDaFolhaAgrupada(await montarGruposPorBanco(rows)) : null;
  const consulta = new URLSearchParams(params).toString();
  const geradoEm = dateTime(new Date().toISOString());
  const filters = [
    params.dateFrom || params.dateTo ? `Período: ${params.dateFrom || "início"} a ${params.dateTo || "hoje"}` : "",
    params.tipo ? `Tipo: ${params.tipo}` : "",
    params.pendente ? `Situação: ${params.pendente === "true" ? "Pendente" : "Realizada"}` : "",
    params.vinculo ? `Origem: ${params.vinculo}` : "",
    params.metodopagamento ? `Pagamento: ${params.metodopagamento}` : "",
    agrupar ? "Agrupado por banco" : "",
  ].filter(Boolean);

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        .report-shell { --a4w: 210mm; --a4h: 297mm; }
        /* Nenhum bloco encolhe para caber: o excesso tem de aparecer como
           transbordo, que é o que o paginador mede para virar a folha. */
        .report-sheet .conteudo > * { flex-shrink: 0; }
        /* Os totais seguem a última linha, e não o pé da folha. */
        .report-sheet [data-print-final-block] { margin-top: 0; }
        /* No topo da folha não há conta anterior de que se separar. */
        .report-sheet tbody > tr.report-espaco:first-child { display: none; }
        .report-sheet .print-generated-page-number,
        .report-sheet .print-generated-page-footer { font-size: calc(9px * var(--print-font-scale, 1)); color: #737373; }
        .report-sheet .print-generated-page-number { right: 10mm; }
        .report-sheet .print-generated-page-footer { left: 10mm; }
        .report-sheet .report-title { font-size: calc(18px * var(--print-font-scale, 1)); }
        .report-sheet .report-meta { font-size: calc(10px * var(--print-font-scale, 1)); }
        .report-sheet .report-kpis { font-size: calc(9px * var(--print-font-scale, 1)); }
        .report-sheet .report-kpi-value { font-size: calc(12px * var(--print-font-scale, 1)); }
        .report-sheet .report-table,
        .report-sheet .report-totais { font-size: calc(8px * var(--print-font-scale, 1)); }
        .report-sheet .report-subtext { font-size: calc(7px * var(--print-font-scale, 1)); }
        .report-sheet .report-bank-title { font-size: calc(9px * var(--print-font-scale, 1)); }
        @media print {
          html, body {
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .report-shell {
            width: 210mm !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          .report-sheet {
            border: 0 !important;
            box-shadow: none !important;
          }
          /* Sem isto o navegador descarta os fundos e as faixas somem no papel. */
          .report-sheet, .report-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      <main className="report-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between gap-2 print:hidden">
          <FluxoAgrupamentoMenu consulta={consulta} agrupamento={agrupar ? "BANCO" : "NENHUM"} />
          <PrintFontSizeControl />
          <A4PdfActions
            filename="relatorio-fluxo-caixa.pdf"
            backHref="/relatorios"
            selector=".print-generated-page.report-sheet"
          />
        </div>
        {/* A folha sai inteira do servidor e o paginador a divide medindo cada
            linha no navegador, na fonte escolhida. Estimar a altura pela
            contagem de caracteres virava a folha com um terço dela em branco:
            nome e descrição em maiúsculas têm largura que a conta não acerta.
            A chave refaz a paginação quando o agrupamento troca o endereço. */}
        <div
          key={consulta}
          data-print-pagination-root
          data-print-pagination-number-pages
          data-print-pagination-footer={`Relatório de fluxo de caixa · Gerado em ${geradoEm}`}
        >
          <PrintA4Paginator />
          <div data-print-pagination-source-holder>
            <section
              className="report-sheet relative flex h-[297mm] w-[210mm] flex-col overflow-hidden border border-neutral-300 bg-white shadow-xl"
              data-print-pagination-source
            >
              {/* O pé fica livre para o rodapé e a numeração que o paginador põe a 6mm da borda. */}
              <div className="conteudo flex min-h-0 flex-1 flex-col overflow-hidden px-[10mm] pb-[12mm] pt-[10mm]">
                <header className="mb-3 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                  <div className="min-w-0">
                    <h1 className="report-title font-bold uppercase">Relatório de fluxo de caixa</h1>
                    <p className="report-meta text-neutral-500">{filters.length ? filters.join(" · ") : "Todos os lançamentos"}</p>
                  </div>
                  <p className="report-meta shrink-0 text-right text-neutral-500">Gerado em {geradoEm}</p>
                </header>

                <div
                  className="report-kpis mb-3 grid gap-3 rounded border border-neutral-300 bg-neutral-100 px-3 py-2"
                  style={{ gridTemplateColumns: `repeat(${cartoes.length}, minmax(0, 1fr))` }}
                >
                  {cartoes.map((cartao) => (
                    <Kpi key={cartao.label} label={cartao.label} value={money(cartao.value)} tone={cartao.tone} />
                  ))}
                </div>

                {itensAgrupados ? (
                  <TabelaPorBanco itens={itensAgrupados} pendente={params.pendente} />
                ) : (
                  <table className="report-table w-full table-fixed border-collapse" data-print-items-table>
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
                      {rows.length ? rows.map((row) => (
                        // Escala de cinza: entrada em branco, saída em cinza claro.
                        <tr key={row.id} className={`h-[8mm] break-inside-avoid border-t border-neutral-300 ${ehEntrada(row.tipo) ? "bg-white" : "bg-neutral-50"}`}>
                          <CelulasDoLancamento row={row} />
                        </tr>
                      )) : (
                        <tr className="h-[8mm] border-t border-neutral-300">
                          <Td className="py-12 text-center text-neutral-500" colSpan={6}>
                            Nenhum lançamento encontrado para os filtros informados.
                          </Td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                <div data-print-final-block>{rows.length > 0 && <TotaisDaFolha cartoes={cartoes} />}</div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className="uppercase text-neutral-500">{label}</p>
      <p className={`report-kpi-value font-bold tabular-nums ${tone}`}>{value}</p>
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
  return <div className="report-subtext truncate text-neutral-500">{children}</div>;
}
function Th({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <th className={`truncate border-x border-neutral-200 px-2 py-0.5 ${className}`}>{children}</th>;
}
function Td({ children, className = "", colSpan }: React.PropsWithChildren<{ className?: string; colSpan?: number }>) {
  return <td colSpan={colSpan} className={`border-x border-neutral-200 px-2 py-0.5 align-middle ${className}`}>{children}</td>;
}

/** O fecho do relatório, logo abaixo da última linha da última folha. */
function TotaisDaFolha({ cartoes }: { cartoes: Cartao[] }) {
  return (
    <div className="report-totais flex h-[8mm] items-center justify-end gap-6 border-x border-t-2 border-neutral-200 border-t-neutral-400 bg-neutral-100 px-2 pr-3">
      {cartoes.map((cartao) => (
        <Total key={cartao.label} label={cartao.label} value={money(cartao.value)} tone={cartao.tone} />
      ))}
    </div>
  );
}

/** As seis colunas de um lançamento — as mesmas nas duas formas da folha. */
function CelulasDoLancamento({ row, mostrarBanco = true }: { row: any; mostrarBanco?: boolean }) {
  const entrada = ehEntrada(row.tipo);
  const { day, time } = dateParts(row.data);
  // Agrupado, o banco já está no cabeçalho da conta; repeti-lo só gastaria a linha.
  const pagamento = joinParts(row.metodopagamento, mostrarBanco ? row.banco?.titulo : null);

  return (
    <>
      <Td className="tabular-nums">
        <div>{day}</div>
        {time && <Sub>{time}</Sub>}
      </Td>
      <Td>
        {row.nomepagador && (
          <div className="whitespace-pre-wrap break-words font-bold [overflow-wrap:anywhere]">
            {row.nomepagador}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          <strong>#{row.id}</strong> {row.descricao || "—"}
        </div>
      </Td>
      <Td>
        <div className="truncate">{row.categoria || "—"}</div>
        {joinParts(row.plano_de_conta, row.centro_custo) && (
          <Sub>{joinParts(row.plano_de_conta, row.centro_custo)}</Sub>
        )}
      </Td>
      <Td>
        <div className="truncate">{origin(row)}</div>
        {pagamento && <Sub>{pagamento}</Sub>}
      </Td>
      <Td>
        <div className="truncate">{row.pendente ? "Pendente" : "Realizada"}</div>
        {row.tipo && <Sub>{row.tipo}</Sub>}
      </Td>
      <Td className={`text-right font-semibold tabular-nums ${entrada ? "text-emerald-700" : "text-red-700"}`}>
        {entrada ? "+ " : "- "}
        {money(valorDaLinha(row))}
      </Td>
    </>
  );
}

/**
 * A folha agrupada por banco.
 *
 * Cada conta abre com o saldo anterior, cada lançamento traz o saldo da conta
 * logo depois dele, e a conta fecha com os totais e o saldo final. Título em
 * aberto não mexeu no dinheiro e fica sem saldo. Respiro e cabeçalho vão
 * presos à primeira linha da conta, para ela nunca abrir no pé da folha.
 */
function TabelaPorBanco({
  itens,
  pendente,
}: {
  itens: ItemDaFolhaAgrupada<any>[];
  /** O filtro de situação: decide quais totais cada conta mostra, como nos cartões. */
  pendente?: string;
}) {
  return (
    <table className="report-table w-full table-fixed border-collapse" data-print-items-table>
      <colgroup>
        <col style={{ width: "18mm" }} />
        <col />
        <col style={{ width: "26mm" }} />
        <col style={{ width: "22mm" }} />
        <col style={{ width: "18mm" }} />
        <col style={{ width: "25mm" }} />
        <col style={{ width: "25mm" }} />
      </colgroup>
      <thead>
        <tr className="bg-neutral-100 text-left uppercase">
          <Th>Data</Th>
          <Th>Descrição</Th>
          <Th>Categoria</Th>
          <Th>Origem</Th>
          <Th>Situação</Th>
          <Th className="text-right">Valor</Th>
          <Th className="text-right">Saldo</Th>
        </tr>
      </thead>
      <tbody>
        {itens.length ? (
          itens.map((item) => {
            if (item.tipo === "espaco") {
              // Sem borda nem fundo: é o vão que separa uma conta da seguinte.
              return (
                <tr
                  key={`espaco-${item.grupo.bancoId}`}
                  aria-hidden
                  className="report-espaco h-[4mm]"
                  data-print-row-keep-with-next=""
                >
                  <td colSpan={7} className="border-0 p-0" />
                </tr>
              );
            }

            if (item.tipo === "banco") {
              return (
                <tr
                  key={`banco-${item.grupo.bancoId}`}
                  className="h-[8mm] border-t-2 border-neutral-500 bg-neutral-200"
                  data-print-row-keep-with-next=""
                >
                  <Td colSpan={6}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="report-bank-title truncate font-bold uppercase">{item.grupo.titulo}</div>
                        {item.grupo.detalhe && <Sub>{item.grupo.detalhe}</Sub>}
                      </div>
                      <span className="shrink-0 uppercase text-neutral-600">Saldo anterior</span>
                    </div>
                  </Td>
                  <Saldo valor={item.grupo.saldoAnterior} />
                </tr>
              );
            }

            if (item.tipo === "subtotal") {
              const { totais } = item.grupo;
              return (
                <tr key={`subtotal-${item.grupo.bancoId}`} className="h-[8mm] border-t border-neutral-400 bg-neutral-100">
                  <Td colSpan={6}>
                    <div className="flex items-center justify-end gap-4">
                      {pendente !== "true" && (
                        <>
                          <Total label="Entradas" value={money(totais.entradas)} tone="text-emerald-700" />
                          <Total label="Saídas" value={money(totais.saidas)} tone="text-red-700" />
                        </>
                      )}
                      {pendente !== "false" && (
                        <>
                          <Total label="A receber" value={money(totais.aReceber)} tone="text-emerald-700" />
                          <Total label="A pagar" value={money(totais.aPagar)} tone="text-red-700" />
                        </>
                      )}
                      <span className="uppercase text-neutral-600">Saldo final</span>
                    </div>
                  </Td>
                  <Saldo valor={item.grupo.saldoFinal} />
                </tr>
              );
            }

            return (
              <tr
                key={item.linha.id}
                className={`h-[8mm] break-inside-avoid border-t border-neutral-300 ${ehEntrada(item.linha.tipo) ? "bg-white" : "bg-neutral-50"}`}
              >
                <CelulasDoLancamento row={item.linha} mostrarBanco={false} />
                <Saldo valor={item.saldoApos} />
              </tr>
            );
          })
        ) : (
          <tr className="h-[8mm] border-t border-neutral-300">
            <Td className="py-12 text-center text-neutral-500" colSpan={7}>
              Nenhum lançamento encontrado para os filtros informados.
            </Td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Saldo da conta: vermelho quando negativo, travessão quando a linha não mexeu nela. */
function Saldo({ valor }: { valor: number | null }) {
  return (
    <Td className={`text-right font-semibold tabular-nums ${valor != null && valor < 0 ? "text-red-700" : ""}`}>
      {valor == null ? "—" : money(valor)}
    </Td>
  );
}
