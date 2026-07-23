"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { toast } from "@/lib/toast";

type Cell = string | number | boolean | null;
type EventRow = {
  id: string;
  date: string;
  origin: string;
  nature: string;
  description: string;
  detail: string;
  value: number;
  status: string;
  transaction: string;
};
type OrderGroup = {
  orderId: string;
  orderStatus: string;
  customer: string;
  target: string;
  income: number;
  expense: number;
  result: number;
  events: EventRow[];
};
type Segment = { group: OrderGroup; events: EventRow[]; continuation: boolean };

const PAGE_UNITS = 15;
const GROUP_UNITS = 4;

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
function paginate(groups: OrderGroup[]) {
  const pages: Segment[][] = [];
  let page: Segment[] = [];
  let used = 0;

  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
    used = 0;
  };

  groups.forEach((group) => {
    let offset = 0;
    let continuation = false;
    if (!group.events.length) {
      if (used + GROUP_UNITS > PAGE_UNITS) flush();
      page.push({ group, events: [], continuation: false });
      used += GROUP_UNITS;
      return;
    }
    while (offset < group.events.length) {
      let capacity = PAGE_UNITS - used - GROUP_UNITS;
      if (capacity <= 0) {
        flush();
        capacity = PAGE_UNITS - GROUP_UNITS;
      }
      const events = group.events.slice(offset, offset + capacity);
      page.push({ group, events, continuation });
      used += GROUP_UNITS + events.length;
      offset += events.length;
      continuation = true;
      if (offset < group.events.length) flush();
    }
  });
  flush();
  return pages.length ? pages : [[]];
}

export function OrdemFinancialReportView({ endpoint }: { endpoint: string }) {
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
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null });
        const headers = (matrix[0] ?? []).map(normalize);
        const column = (name: string) => headers.indexOf(normalize(name));
        const read = (row: Cell[], name: string) => row[column(name)] ?? null;
        const map = new Map<string, OrderGroup>();
        matrix.slice(1).forEach((row) => {
          const orderId = text(read(row, "OS"));
          const current = map.get(orderId) ?? {
            orderId,
            orderStatus: text(read(row, "Status da OS")),
            customer: text(read(row, "Cliente")),
            target: text(read(row, "Veículo / Peça")),
            income: number(read(row, "Receitas da OS")),
            expense: number(read(row, "Despesas da OS")),
            result: number(read(row, "Resultado da OS")),
            events: [],
          };
          current.events.push({
            id: text(read(row, "Evento")),
            date: text(read(row, "Data do evento")),
            origin: text(read(row, "Origem")),
            nature: text(read(row, "Natureza")),
            description: text(read(row, "Descrição")),
            detail: text(read(row, "Detalhe")),
            value: number(read(row, "Valor (R$)")),
            status: text(read(row, "Status do evento")),
            transaction: text(read(row, "Transação")),
          });
          map.set(orderId, current);
        });
        if (active) setGroups(Array.from(map.values()));
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

  const pages = useMemo(() => paginate(groups), [groups]);

  if (loading) return <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Organizando eventos por OS...</div>;
  if (error) return <div className="flex min-h-screen items-center justify-center p-8 text-destructive">{error}</div>;

  return (
    <>
      <style>{`
        @page{size:A4 landscape;margin:0}
        @media print{
          html,body{margin:0!important;padding:0!important;background:#fff!important}
          .os-report-shell{padding:0!important;background:#fff!important}
          .os-report-sheet{box-sizing:border-box!important;width:296mm!important;height:208mm!important;margin:0!important;padding:8mm!important;border:0!important;box-shadow:none!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}
          .os-report-sheet:last-child{break-after:auto!important;page-break-after:auto!important}
        }
      `}</style>
      <main className="os-report-shell min-h-screen bg-neutral-200 px-4 py-6 text-black">
        <div className="mx-auto mb-4 flex w-[297mm] justify-end">
          <A4PdfActions filename="eventos-financeiros-por-os.pdf" backHref="/relatorios" landscape selector=".os-report-sheet" />
        </div>
        <div className="mx-auto flex w-[297mm] flex-col gap-4 print:gap-0">
          {pages.map((segments, pageIndex) => (
            <section key={pageIndex} className="os-report-sheet h-[210mm] w-[297mm] overflow-hidden border bg-white p-[10mm] shadow-xl">
              <header className="mb-3 flex items-end justify-between border-b-2 border-black pb-2">
                <div><h1 className="text-xl font-bold uppercase">Eventos financeiros por OS</h1><p className="text-[9px] text-neutral-500">Snapshots econômicos vinculados às ordens de serviço</p></div>
                <p className="text-[9px] text-neutral-500">Página {pageIndex + 1} de {pages.length}</p>
              </header>
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
  return (
    <article className="break-inside-avoid overflow-hidden rounded border border-neutral-400">
      <div className="flex items-start justify-between gap-4 bg-neutral-100 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h2 className="text-sm font-bold">OS #{group.orderId}</h2>{segment.continuation && <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[7px] uppercase">continuação</span>}<span className="text-[8px] uppercase text-neutral-500">{group.orderStatus}</span></div>
          <p className="truncate text-[8px]"><strong>{group.customer}</strong> · {group.target}</p>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-4 text-right text-[8px]">
          <Kpi label="Receitas" value={money(group.income)} tone="text-emerald-700" />
          <Kpi label="Despesas" value={money(group.expense)} tone="text-red-700" />
          <Kpi label="Resultado" value={money(group.result)} tone={group.result >= 0 ? "text-blue-700" : "text-red-700"} />
        </div>
      </div>
      <table className="w-full table-fixed border-collapse text-[7px]">
        <thead><tr className="bg-neutral-50 text-left uppercase"><Th className="w-[25mm]">Data</Th><Th className="w-[22mm]">Origem</Th><Th className="w-[20mm]">Natureza</Th><Th>Descrição / detalhe</Th><Th className="w-[22mm]">Estado</Th><Th className="w-[20mm]">Transação</Th><Th className="w-[25mm] text-right">Valor</Th></tr></thead>
        <tbody>
          {segment.events.length ? segment.events.map((event) => (
            <tr key={event.id} className="h-[7mm] border-t border-neutral-200">
              <Td>{event.date}</Td><Td>{event.origin}</Td><Td>{event.nature}</Td>
              <Td><div className="truncate font-medium">{event.description}</div>{event.detail !== "—" && <div className="truncate text-[6px] text-neutral-500">{event.detail}</div>}</Td>
              <Td>{event.status}</Td><Td>{event.transaction}</Td><Td className={`text-right font-semibold ${event.nature === "RECEITA" ? "text-emerald-700" : "text-red-700"}`}>{money(event.value)}</Td>
            </tr>
          )) : <tr><Td colSpan={7} className="py-3 text-center text-neutral-500">Nenhum evento encontrado para esta OS.</Td></tr>}
        </tbody>
      </table>
    </article>
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
