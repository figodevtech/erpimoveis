"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Download, FileChartColumn, FileText, Loader2, Search, X } from "lucide-react";

import CustomerSelect from "@/app/(app)/components/customerSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import type { Customer } from "../../../clientes/types";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";

type Mode = "simples" | "financeiro";
type Sector = { id: number; nome: string };
/** Como as OS se distribuem nas folhas do PDF. */
type PrintLayout = "VARIAS_OS" | "UMA_OS";

const STATUS_OPTIONS = [
  ["TODAS", "Todos os status"],
  ["AGUARDANDO_CHECKLIST", "Aguardando checklist"],
  ["ORCAMENTO", "Em orçamento"],
  ["APROVACAO_ORCAMENTO", "Aguardando aprovação"],
  ["ORCAMENTO_APROVADO", "Orçamento aprovado"],
  ["ORCAMENTO_RECUSADO", "Orçamento recusado"],
  ["EM_ANDAMENTO", "Em andamento"],
  ["PAGAMENTO", "Pagamento"],
  ["SEM_COBRANCA", "Sem cobrança"],
  ["CONCLUIDO", "Concluída"],
  ["CANCELADO", "Cancelada"],
] as const;

export function DialogRelatorioOrdens({ mode }: { mode: Mode }) {
  const financial = mode === "financeiro";
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("TODAS");
  const [sectorId, setSectorId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [nature, setNature] = useState("TODAS");
  const [eventStatus, setEventStatus] = useState("TODOS");
  const [printLayout, setPrintLayout] = useState<PrintLayout>("VARIAS_OS");
  const [customer, setCustomer] = useState<Customer>();
  const [customerOpen, setCustomerOpen] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loadingSectors, setLoadingSectors] = useState(true);
  const [exporting, setExporting] = useState(false);
  const invalid = isInvalidPeriod(dateFrom, dateTo);

  useEffect(() => {
    let active = true;
    fetch("/api/tipos/setores", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Falha ao carregar setores.");
        const items = Array.isArray(payload) ? payload : payload?.items ?? payload?.setores ?? [];
        if (active) setSectors(items);
      })
      .catch(() => active && setSectors([]))
      .finally(() => active && setLoadingSectors(false));
    return () => { active = false; };
  }, []);

  const params = new URLSearchParams({ mode });
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (status !== "TODAS") params.set("status", status);
  if (sectorId) params.set("setorId", sectorId);
  if (orderId) params.set("ordemId", orderId);
  if (customer?.id) params.set("clienteId", String(customer.id));
  if (financial && nature !== "TODAS") params.set("natureza", nature);
  if (financial && eventStatus !== "TODOS") params.set("eventoStatus", eventStatus);
  const endpoint = `/api/reports/ordens/export?${params.toString()}`;
  const title = financial ? "Eventos financeiros por OS" : "Relação de ordens de serviço";
  const openFinancialPdf = () => {
    const printParams = new URLSearchParams({ endpoint, layout: printLayout });
    window.open(`/print/relatorios/ordens-financeiro?${printParams.toString()}`, "_blank", "noopener,noreferrer");
  };

  async function exportExcel() {
    if (exporting || invalid) return;
    setExporting(true);
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Não foi possível exportar o relatório.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = financial ? "eventos_financeiros_os.xlsx" : "ordens_servico.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível exportar o relatório.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ReportTrigger
          icon={financial ? <FileChartColumn className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
          title={title}
          description={financial ? "Snapshots de receitas, despesas e resultado econômico das ordens" : "Listagem operacional das ordens com cliente, status e orçamento"}
          tone={financial ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"}
        />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {financial
              ? "Os valores representam os eventos econômicos gravados na OS e podem não corresponder a transações já realizadas."
              : "Combine os filtros para gerar uma relação objetiva das ordens de serviço."}
          </DialogDescription>
        </DialogHeader>

        <ReportFiltersPanel>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status da OS">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Setor">
              <Select value={sectorId || "TODOS"} onValueChange={(value) => setSectorId(value === "TODOS" ? "" : value)} disabled={loadingSectors}>
                <SelectTrigger><SelectValue placeholder={loadingSectors ? "Carregando..." : "Todos os setores"} /></SelectTrigger>
                <SelectContent><SelectItem value="TODOS">Todos os setores</SelectItem>{sectors.map((sector) => <SelectItem key={sector.id} value={String(sector.id)}>{sector.nome}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Número da OS">
              <Input inputMode="numeric" value={orderId} onChange={(event) => setOrderId(event.target.value.replace(/\D/g, ""))} placeholder="Todas as ordens" />
            </Field>
            <Field label="Cliente">
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal" onClick={() => setCustomerOpen(true)}>
                  <Search className="mr-2 h-4 w-4" /><span className="truncate">{customer?.nomerazaosocial ?? "Todos os clientes"}</span>
                </Button>
                {customer && <Button type="button" variant="outline" size="icon" onClick={() => setCustomer(undefined)} aria-label="Limpar cliente"><X className="h-4 w-4" /></Button>}
              </div>
              <CustomerSelect open={customerOpen} setOpen={setCustomerOpen} OnSelect={(selected) => { setCustomer(selected); setCustomerOpen(false); }} />
            </Field>
            {financial && (
              <>
                <Field label="Natureza do evento">
                  <Select value={nature} onValueChange={setNature}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODAS">Receitas e despesas</SelectItem><SelectItem value="RECEITA">Somente receitas</SelectItem><SelectItem value="DESPESA">Somente despesas</SelectItem></SelectContent></Select>
                </Field>
                <Field label="Estado do evento">
                  <Select value={eventStatus} onValueChange={setEventStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODOS">Todos os eventos</SelectItem><SelectItem value="ATIVO">Ativos</SelectItem><SelectItem value="CONVERTIDO">Convertidos</SelectItem><SelectItem value="CANCELADO">Cancelados</SelectItem></SelectContent></Select>
                </Field>
                <Field label="Modo de impressão">
                  <Select value={printLayout} onValueChange={(value) => setPrintLayout(value as PrintLayout)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VARIAS_OS">Várias OS por página</SelectItem>
                      <SelectItem value="UMA_OS">Uma OS por página</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Vale só para o PDF. Uma OS por página gasta mais papel, mas cada ordem sai numa folha destacável.
                  </p>
                </Field>
              </>
            )}
          </div>
        </ReportFiltersPanel>

        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          {financial ? (
            <Button type="button" variant="outline" onClick={openFinancialPdf} disabled={invalid || exporting}>
              <FileText className="mr-2 h-4 w-4" />Gerar PDF
            </Button>
          ) : (
            <SpreadsheetPdfButton endpoint={endpoint} title={title} disabled={invalid || exporting} />
          )}
          <Button type="button" onClick={() => void exportExcel()} disabled={invalid || exporting}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {exporting ? "Exportando..." : "Exportar Excel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>;
}
