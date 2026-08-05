"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { toast } from "@/lib/toast";

type Cell = string | number | boolean | null;
type Section = "PRODUTO" | "SERVICO" | "PAGAMENTO";

const SECTIONS: Section[] = ["PRODUTO", "SERVICO", "PAGAMENTO"];

type EventRow = {
  id: string;
  /** Tabela em que a linha entra: produtos ou serviços/despesas. */
  section: Section;
  /** (origem, chave) do item — mantém despesa e receita do mesmo item juntas. */
  pairKey: string;
  code: string;
  title: string;
  marker: string;
  note: string;
  /** Quantidade nos itens; data do pagamento na seção de transações. */
  quantity: string;
  nature: string;
  value: number;
  /** Bruto do pagamento, só quando difere do líquido (taxa de maquininha). */
  gross?: number | null;
  /** Linha de "nada aqui": ocupa a tabela vazia sem virar um dado falso. */
  placeholder?: boolean;
};

type OrderGroup = {
  orderId: string;
  orderStatus: string;
  customer: string;
  target: string;
  openedAt: string;
  closedAt: string;
  createdBy: string;
  income: number;
  expense: number;
  result: number;
  events: EventRow[];
};
type Segment = { group: OrderGroup; events: EventRow[]; continuation: boolean };

/**
 * Orçamento de altura da folha, em unidades de uma linha (6mm).
 *
 * A4 retrato = 297mm; tirando 20mm de margem e ~17mm do cabeçalho do documento
 * sobram ~260mm, ou seja ~43 linhas. O bloco de uma OS (título, cliente, datas
 * e a faixa de KPIs) mede ~26mm e o cabeçalho de cada tabela ~10mm — daí as 5 e
 * as 2 unidades cobradas abaixo. As contas arredondam sempre para cima: sobrar
 * um dedo de papel é melhor que estourar, porque a folha corta o excedente.
 */
const PAGE_UNITS = 43;
/** Da segunda folha em diante o cabeçalho sai e sobram ~14mm para conteúdo. */
const PAGE_UNITS_CONT = 45;
const GROUP_UNITS = 5;
/** Cabeçalho (~10mm) + rodapé de totais (~7mm) de cada tabela. */
const SECTION_UNITS = 4;

const SECTION_LABEL: Record<Section, string> = {
  PRODUTO: "Produtos",
  SERVICO: "Serviços e despesas",
  PAGAMENTO: "Pagamentos",
};

/** Terceira coluna: quantidade nos itens, data no extrato de pagamentos. */
const SECTION_THIRD_COLUMN: Record<Section, string> = {
  PRODUTO: "Quantidade",
  SERVICO: "Quantidade",
  PAGAMENTO: "Data",
};

/**
 * O banco grava "Custo - Filtro de óleo"; a coluna mostra "Filtro de óleo
 * (Compra)". O título vem primeiro porque é por ele que se procura na folha.
 */
const MARCADORES: Array<[RegExp, string]> = [
  [/^venda\s*-\s*/i, "Venda"],
  [/^custo\s*-\s*/i, "Compra"],
  [/^servi[çc]o\s*-\s*/i, "Serviço"],
  [/^comiss[ãa]o\s*-\s*/i, "Comissão"],
];

function tituloEMarcador(descricao: string): { title: string; marker: string } {
  for (const [regex, marker] of MARCADORES) {
    if (regex.test(descricao)) {
      return { title: descricao.replace(regex, "").trim() || "—", marker };
    }
  }
  return { title: descricao || "—", marker: "" };
}

function totaisDe(events: EventRow[]) {
  const reais = events.filter((event) => !event.placeholder);
  const despesa = reais
    .filter((event) => event.nature === "DESPESA")
    .reduce((soma, event) => soma + event.value, 0);
  const receita = reais
    .filter((event) => event.nature !== "DESPESA")
    .reduce((soma, event) => soma + event.value, 0);

  return { despesa, receita, lucro: receita - despesa };
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function text(value: Cell) {
  return value == null || value === "" ? "—" : String(value);
}
function number(value: Cell) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Período do relatório, lido dos filtros da própria chamada.
 * O recorte é pela data de entrada da OS — o mesmo campo que o export filtra.
 */
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

function quantityOf(value: Cell) {
  if (value == null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return parsed.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** "12/03/2026, 14:20" -> "12/03/2026". A hora não acrescenta nada no cabeçalho. */
function dayOf(value: Cell) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw.split(",")[0].trim() || "—";
}

/** Comissão usa "servicoid:usuarioid"; na coluna vale o id do serviço. */
function codeOf(chave: string) {
  const limpo = chave.trim();
  if (!limpo) return "—";
  return limpo.split(":")[0];
}

/**
 * Ordena os eventos de uma OS: produtos primeiro, depois serviços/despesas.
 * Dentro de cada tabela os itens saem na ordem de entrada, com a despesa
 * colada na receita do mesmo item.
 */
function arrange(events: EventRow[]): EventRow[] {
  const ordered: EventRow[] = [];

  SECTIONS.forEach((section) => {
    const daSecao = events.filter((event) => event.section === section);
    const pares = new Map<string, EventRow[]>();

    daSecao.forEach((event) => {
      const atual = pares.get(event.pairKey) ?? [];
      atual.push(event);
      pares.set(event.pairKey, atual);
    });

    pares.forEach((doItem) => {
      const despesas = doItem.filter((event) => event.nature === "DESPESA");
      const receitas = doItem.filter((event) => event.nature !== "DESPESA");
      ordered.push(...despesas, ...receitas);
    });
  });

  return ordered;
}

function paginate(groups: OrderGroup[], umaPorPagina: boolean) {
  const pages: Segment[][] = [];
  let page: Segment[] = [];
  let used = 0;

  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
    used = 0;
  };

  // Só a primeira folha carrega o cabeçalho do documento.
  const budget = () => (pages.length === 0 ? PAGE_UNITS : PAGE_UNITS_CONT);

  groups.forEach((group) => {
    // No modo "uma OS por página" cada ordem abre folha nova; uma OS grande
    // ainda pode ocupar mais de uma, mas nunca divide folha com outra.
    if (umaPorPagina) flush();

    if (!group.events.length) {
      if (used + GROUP_UNITS > budget()) flush();
      page.push({ group, events: [], continuation: false });
      used += GROUP_UNITS;
      return;
    }

    let offset = 0;
    let continuation = false;

    while (offset < group.events.length) {
      let capacity = budget() - used - GROUP_UNITS;
      if (capacity <= 0) {
        flush();
        capacity = budget() - GROUP_UNITS;
      }

      const slice: EventRow[] = [];
      const sections = new Set<Section>();
      let cost = 0;

      for (let index = offset; index < group.events.length; index += 1) {
        const event = group.events[index];
        // Abrir uma tabela custa o cabeçalho dela; linha com nota (comissão)
        // ocupa duas alturas por causa do nome do realizador embaixo.
        const extra =
          (sections.has(event.section) ? 0 : SECTION_UNITS) + (event.note ? 2 : 1);
        if (cost + extra > capacity && slice.length) break;
        slice.push(event);
        sections.add(event.section);
        cost += extra;
      }

      if (!slice.length) {
        flush();
        continue;
      }

      page.push({ group, events: slice, continuation });
      used += GROUP_UNITS + cost;
      offset += slice.length;
      continuation = true;
      if (offset < group.events.length) flush();
    }
  });

  flush();
  return pages.length ? pages : [[]];
}

export function OrdemFinancialReportView({
  endpoint,
  umaPorPagina = false,
}: {
  endpoint: string;
  umaPorPagina?: boolean;
}) {
  const [groups, setGroups] = useState<OrderGroup[]>([]);
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

        /** Cada aba vira uma matriz com um leitor por nome de coluna. */
        const sheetReader = (name: string) => {
          const sheet = workbook.Sheets[name];
          if (!sheet) return null;

          const matrix = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
          const headers = (matrix[0] ?? []).map(normalize);
          const column = (label: string) => headers.indexOf(normalize(label));

          return {
            rows: matrix.slice(1),
            read: (row: Cell[], label: string) => row[column(label)] ?? null,
          };
        };

        const principal = sheetReader(workbook.SheetNames[0]);
        if (!principal) throw new Error("Planilha do relatório veio vazia.");
        const { rows: matrix, read } = principal;

        const map = new Map<string, OrderGroup>();

        matrix.forEach((row) => {
          const orderId = text(read(row, "OS"));
          const current = map.get(orderId) ?? {
            orderId,
            orderStatus: text(read(row, "Status da OS")),
            customer: text(read(row, "Cliente")),
            target: text(read(row, "Alvo atendido")),
            openedAt: dayOf(read(row, "Entrada da OS")),
            closedAt: dayOf(read(row, "Conclusão da OS")),
            createdBy: text(read(row, "Criador da OS")),
            income: number(read(row, "Receitas da OS")),
            expense: number(read(row, "Despesas da OS")),
            result: number(read(row, "Resultado da OS")),
            events: [],
          };

          const origem = String(read(row, "Origem") ?? "").toUpperCase();
          const chave = String(read(row, "Chave origem") ?? "");
          const descricao = String(read(row, "Descrição") ?? "").trim();
          const detalhe = String(read(row, "Detalhe") ?? "").trim();

          current.events.push({
            id: text(read(row, "Evento")),
            section: origem === "PRODUTO" ? "PRODUTO" : "SERVICO",
            pairKey: `${origem}|${chave || descricao}`,
            code: codeOf(chave),
            ...tituloEMarcador(descricao),
            // A comissão só se identifica pelo realizador; o resto dispensa nota.
            note: origem === "COMISSAO" ? detalhe : "",
            quantity: quantityOf(read(row, "Quantidade snapshot")),
            nature: text(read(row, "Natureza")),
            value: number(read(row, "Valor (R$)")),
          });

          map.set(orderId, current);
        });

        // Aba de transações: a lista de pagamentos de cada OS.
        const extrato = sheetReader("Transações");
        extrato?.rows.forEach((row) => {
          const orderId = text(extrato.read(row, "OS"));
          const grupo = map.get(orderId);
          if (!grupo) return;

          const id = text(extrato.read(row, "Transação"));
          const tipo = String(extrato.read(row, "Tipo") ?? "").toUpperCase();
          const metodo = String(extrato.read(row, "Método") ?? "").trim();
          const situacao = String(extrato.read(row, "Situação") ?? "").trim();
          const complemento = String(extrato.read(row, "Descrição do pagamento") ?? "").trim();

          const liquido = number(extrato.read(row, "Valor (R$)"));
          const bruto = number(extrato.read(row, "Valor bruto (R$)"));
          // Comparação em centavos: 0.1 + 0.2 não fecha com 0.3 em ponto flutuante.
          // Bruto zerado significa coluna ausente, não pagamento de graça.
          const temTaxa = bruto > 0 && Math.round(bruto * 100) !== Math.round(liquido * 100);

          grupo.events.push({
            id: `T${id}`,
            section: "PAGAMENTO",
            // Pagamento não tem par: cada linha é um item.
            pairKey: `TRANSACAO|${id}`,
            code: id,
            title: String(extrato.read(row, "Descrição") ?? "").trim() || "—",
            marker: "",
            note: [complemento, metodo || "Método não definido", situacao].filter(Boolean).join(" · "),
            quantity: dayOf(extrato.read(row, "Data")),
            nature: tipo === "DESPESA" || tipo === "SAQUE" ? "DESPESA" : "RECEITA",
            value: liquido,
            gross: temTaxa ? bruto : null,
          });
        });

        const parsed = Array.from(map.values()).map((group) => {
          const semPagamento = !group.events.some((event) => event.section === "PAGAMENTO");

          // A tabela de pagamentos aparece sempre; sem transação ela carrega
          // esta linha, que também reserva o espaço dela na paginação.
          if (semPagamento) {
            group.events.push({
              id: `T-vazio-${group.orderId}`,
              section: "PAGAMENTO",
              pairKey: `TRANSACAO|vazio`,
              code: "",
              title: "Nenhuma transação foi registrada para esta OS.",
              marker: "",
              note: "",
              quantity: "",
              nature: "RECEITA",
              value: 0,
              placeholder: true,
            });
          }

          return { ...group, events: arrange(group.events) };
        });

        if (active) setGroups(parsed);
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

  const pages = useMemo(() => paginate(groups, umaPorPagina), [groups, umaPorPagina]);
  const periodo = useMemo(() => periodLabel(endpoint), [endpoint]);

  if (loading) return <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Organizando eventos por OS...</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center p-8 text-destructive">{error}</div>;

  return (
    <>
      <style>{`
        @page{size:A4 portrait;margin:0}
        @media print{
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          .os-report-shell{padding:0!important;background:#fff!important}
          .os-report-sheet{box-sizing:border-box!important;width:208mm!important;height:295mm!important;margin:0!important;padding:8mm!important;border:0!important;box-shadow:none!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}
          .os-report-sheet:last-child{break-after:auto!important;page-break-after:auto!important}
          /* Sem isto o navegador descarta os fundos e as listras somem no papel. */
          .os-report-sheet,.os-report-sheet *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        }
      `}</style>
      <main className="os-report-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[210mm] justify-end">
          <A4PdfActions filename="eventos-financeiros-por-os.pdf" backHref="/relatorios" selector=".os-report-sheet" />
        </div>
        <div className="mx-auto flex w-[210mm] flex-col gap-4 print:gap-0">
          {pages.map((segments, pageIndex) => (
            <section key={pageIndex} className="os-report-sheet h-[297mm] w-[210mm] overflow-hidden border bg-white p-[10mm] shadow-xl">
              {pageIndex === 0 ? (
                <header className="mb-3 flex items-end justify-between gap-4 border-b-2 border-black pb-2">
                  <div className="min-w-0">
                    <h1 className="text-lg font-bold uppercase">Eventos financeiros por OS</h1>
                    <p className="text-[9px] text-neutral-500">Snapshots econômicos vinculados às ordens de serviço</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[9px] uppercase text-neutral-500">Entrada da OS</p>
                    <p className="text-[10px] font-bold tabular-nums">{periodo}</p>
                    <p className="text-[9px] text-neutral-500">Página 1 de {pages.length}</p>
                  </div>
                </header>
              ) : (
                // Sem cabeçalho, mas com a numeração: folha solta de relatório
                // financeiro sem página vira problema na hora de conferir.
                <p className="mb-2 text-right text-[8px] text-neutral-500">
                  Página {pageIndex + 1} de {pages.length}
                </p>
              )}
              <div className="space-y-3">
                {segments.length ? segments.map((segment, index) => <OrderBlock key={`${segment.group.orderId}-${index}`} segment={segment} />) : <div className="py-20 text-center text-sm text-neutral-500">Nenhum evento financeiro encontrado.</div>}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

function OrderBlock({ segment }: { segment: Segment }) {
  const { group } = segment;

  const secoes = SECTIONS.map((section) => {
    const daOS = group.events.filter((event) => event.section === section);
    const naFolha = segment.events.filter((event) => event.section === section);
    const ultimo = daOS[daOS.length - 1];
    const vazia = daOS.every((event) => event.placeholder);

    return {
      section,
      events: naFolha,
      // Os totais somam a OS inteira, não a fatia; por isso só saem na folha
      // que fecha a seção — senão virariam subtotais disfarçados de total.
      totals: totaisDe(daOS),
      showTotals: !vazia && Boolean(ultimo) && naFolha.includes(ultimo),
    };
  }).filter((bloco) => bloco.events.length > 0);

  return (
    <article className="break-inside-avoid overflow-hidden rounded border border-neutral-400">
      <div className="bg-neutral-100 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold">OS #{group.orderId}</h2>
          {segment.continuation && <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[7px] uppercase">continuação</span>}
          <span className="text-[8px] uppercase text-neutral-500">{group.orderStatus}</span>
        </div>
        <p className="truncate text-[8px]"><strong>{group.customer}</strong> · {group.target}</p>
        <p className="truncate text-[8px] text-neutral-600">
          Entrada <strong className="tabular-nums">{group.openedAt}</strong>
          {" · "}
          Conclusão <strong className="tabular-nums">{group.closedAt}</strong>
          {" · "}
          Criada por <strong>{group.createdBy}</strong>
        </p>

        <div className="mt-1.5 grid grid-cols-3 gap-3 border-t border-neutral-300 pt-1.5 text-[8px]">
          <Kpi label="Receitas" value={money(group.income)} tone="text-emerald-700" />
          <Kpi label="Despesas" value={money(group.expense)} tone="text-red-700" />
          <Kpi label="Resultado" value={money(group.result)} tone={group.result >= 0 ? "text-blue-700" : "text-red-700"} />
        </div>
      </div>

      {secoes.length ? (
        secoes.map((bloco) => (
          <EventTable
            key={bloco.section}
            section={bloco.section}
            events={bloco.events}
            totals={bloco.totals}
            showTotals={bloco.showTotals}
          />
        ))
      ) : (
        <p className="py-3 text-center text-[7px] text-neutral-500">Nenhum evento encontrado para esta OS.</p>
      )}
    </article>
  );
}

function EventTable({
  section,
  events,
  totals,
  showTotals,
}: {
  section: Section;
  events: EventRow[];
  totals: { despesa: number; receita: number; lucro: number };
  showTotals: boolean;
}) {
  // Produto se compra e se vende; serviço tem custo (comissão) e receita;
  // pagamento é dinheiro que entrou ou saiu do caixa.
  const rotulos =
    section === "PRODUTO"
      ? { saida: "Compras", entrada: "Vendas", saldo: "Lucro" }
      : section === "PAGAMENTO"
        ? { saida: "Saídas", entrada: "Entradas", saldo: "Saldo" }
        : { saida: "Despesas", entrada: "Receitas", saldo: "Lucro" };

  return (
    <table className="w-full table-fixed border-collapse border-t border-neutral-300 text-[7px]">
      {/* Escala de cinza em quatro degraus: faixa da seção > cabeçalho >
          linha de despesa > linha de receita (branco). */}
      <caption className="bg-neutral-200 px-3 py-1 text-left text-[7px] font-bold uppercase tracking-wide text-neutral-700">
        {SECTION_LABEL[section]}
      </caption>
      <thead>
        <tr className="bg-neutral-100 text-left uppercase">
          <Th className="w-[18mm]">Código</Th>
          <Th>Descrição</Th>
          <Th className="w-[20mm] text-right">{SECTION_THIRD_COLUMN[section]}</Th>
          <Th className="w-[30mm] text-right">Valor</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((event, index) => {
          if (event.placeholder) {
            return (
              <tr key={event.id} className="h-[7mm] border-t border-neutral-300 bg-white">
                <Td colSpan={4} className="text-center text-neutral-500">
                  {event.title}
                </Td>
              </tr>
            );
          }

          const despesa = event.nature === "DESPESA";
          // Despesa e receita do mesmo item ficam sem divisória entre si:
          // a linha só aparece quando começa um item novo.
          const novoItem = index === 0 || events[index - 1].pairKey !== event.pairKey;

          return (
            <tr
              key={event.id}
              className={`h-[6mm] ${despesa ? "bg-neutral-50" : "bg-white"} ${novoItem ? "border-t border-neutral-300" : ""}`}
            >
              <Td className="tabular-nums">{event.code}</Td>
              <Td>
                <div className="truncate">
                  {event.title}
                  {event.marker && <span className="text-neutral-500"> ({event.marker})</span>}
                </div>
                {event.note && <div className="truncate text-[6px] text-neutral-500">{event.note}</div>}
              </Td>
              <Td className="text-right tabular-nums">{event.quantity}</Td>
              <Td className="text-right">
                <div className={`font-semibold tabular-nums ${despesa ? "text-red-700" : "text-emerald-700"}`}>
                  {despesa ? "- " : "+ "}
                  {money(event.value)}
                </div>
                {event.gross != null && (
                  <div className="text-[6px] tabular-nums text-neutral-500">
                    Bruto {money(event.gross)} · taxa {money(Math.abs(event.gross - event.value))}
                  </div>
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>

      {showTotals && (
        <tfoot>
          <tr className="h-[7mm] border-t-2 border-neutral-400 bg-neutral-100">
            <Td colSpan={4}>
              <div className="flex items-center justify-end gap-6 pr-1">
                <Total label={rotulos.saida} value={money(totals.despesa)} tone="text-red-700" />
                <Total label={rotulos.entrada} value={money(totals.receita)} tone="text-emerald-700" />
                <Total
                  label={rotulos.saldo}
                  value={money(totals.lucro)}
                  tone={totals.lucro >= 0 ? "text-blue-700" : "text-red-700"}
                />
              </div>
            </Td>
          </tr>
        </tfoot>
      )}
    </table>
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

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div><div className="uppercase text-neutral-500">{label}</div><div className={`font-bold ${tone}`}>{value}</div></div>;
}
function Th({ children, className = "" }: React.PropsWithChildren<{ className?: string }>) {
  return <th className={`border-x border-neutral-200 px-2 py-1 ${className}`}>{children}</th>;
}
function Td({ children, className = "", colSpan }: React.PropsWithChildren<{ className?: string; colSpan?: number }>) {
  return <td colSpan={colSpan} className={`border-x border-neutral-200 px-2 py-1 align-middle ${className}`}>{children}</td>;
}
