"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, ClipboardList, Download, FileChartColumn, FileText, Loader2, Search, X } from "lucide-react";

import CustomerSelect from "@/app/(app)/components/customerSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import type { Customer } from "../../../clientes/types";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";

type Mode = "simples" | "financeiro";
type Sector = { id: number; nome: string };
type Person = { id: string; nome: string };
/** Como as OS se distribuem nas folhas do PDF. */
type PrintLayout = "VARIAS_OS" | "UMA_OS";
/** Qual data da OS o período filtra. */
type DateField = "entrada" | "conclusao";

/** Status de OS, na ordem em que a ordem caminha pela oficina. */
const STATUS_OPTIONS = [
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

/** Atalhos para as perguntas que se repetem no balcão. */
const STATUS_PRESETS: Array<[string, string[]]> = [
  ["Em aberto", ["AGUARDANDO_CHECKLIST", "ORCAMENTO", "APROVACAO_ORCAMENTO", "ORCAMENTO_APROVADO", "EM_ANDAMENTO", "PAGAMENTO"]],
  ["Encerradas", ["CONCLUIDO", "SEM_COBRANCA"]],
  ["Perdidas", ["ORCAMENTO_RECUSADO", "CANCELADO"]],
];

export function DialogRelatorioOrdens({ mode }: { mode: Mode }) {
  const financial = mode === "financeiro";
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateField, setDateField] = useState<DateField>("conclusao");
  /** Vazio significa "todos os status" — sem filtro de status na consulta. */
  const [statuses, setStatuses] = useState<string[]>([]);
  const [sectorId, setSectorId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [priority, setPriority] = useState("TODAS");
  const [target, setTarget] = useState("TODOS");
  const [personId, setPersonId] = useState("");
  const [nature, setNature] = useState("TODAS");
  const [eventStatus, setEventStatus] = useState("TODOS");
  const [printLayout, setPrintLayout] = useState<PrintLayout>("VARIAS_OS");
  const [customer, setCustomer] = useState<Customer>();
  const [customerOpen, setCustomerOpen] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
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

  // Lista enxuta de usuários, a mesma do vínculo de realizadores. Quem só tem a
  // permissão de Relatórios não a alcança; nesse caso o seletor fica só com
  // "Todos", em vez de derrubar o restante dos filtros.
  useEffect(() => {
    let active = true;
    fetch("/api/ordens/realizadores", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("sem acesso");
        const items = Array.isArray(payload?.realizadores) ? payload.realizadores : [];
        if (active) {
          setPeople(
            items
              .map((item: any) => ({ id: String(item.id ?? ""), nome: String(item.nome ?? "").trim() || "Sem nome" }))
              .filter((item: Person) => item.id),
          );
        }
      })
      .catch(() => active && setPeople([]));
    return () => { active = false; };
  }, []);

  const params = new URLSearchParams({ mode });
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  params.set("campoData", dateField);
  if (statuses.length) params.set("status", statuses.join(","));
  if (sectorId) params.set("setorId", sectorId);
  if (orderId) params.set("ordemId", orderId);
  if (priority !== "TODAS") params.set("prioridade", priority);
  if (target !== "TODOS") params.set("alvoTipo", target);
  if (personId) params.set("responsavelId", personId);
  if (customer?.id) params.set("clienteId", String(customer.id));
  if (financial && nature !== "TODAS") params.set("natureza", nature);
  if (financial && eventStatus !== "TODOS") params.set("eventoStatus", eventStatus);
  const endpoint = `/api/reports/ordens/export?${params.toString()}`;
  const title = financial ? "Eventos financeiros por OS" : "Relação de ordens de serviço";
  const openFinancialPdf = () => {
    const printParams = new URLSearchParams({ endpoint, layout: printLayout });
    window.open(`/print/relatorios/ordens-financeiro?${printParams.toString()}`, "_blank", "noopener,noreferrer");
  };
  /** Relação de OS tem folha própria, em A4 retrato — não é a grade genérica. */
  const openListPdf = () => {
    window.open(
      `/print/relatorios/ordens?${new URLSearchParams({ endpoint }).toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
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
          <Field label="Filtrar período por">
            <Select value={dateField} onValueChange={(value) => setDateField(value as DateField)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="entrada">Data de entrada</SelectItem>
                <SelectItem value="conclusao">Data de conclusão</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {dateField === "conclusao"
                ? "Usa a conclusão da execução, carimbada pelo sistema. Ordens que ainda não foram concluídas ficam de fora."
                : "Usa a data de abertura da OS."}
            </p>
          </Field>
          <Field label="Status da OS">
            <StatusMultiSelect value={statuses} onChange={setStatuses} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prioridade">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as prioridades</SelectItem>
                  <SelectItem value="ALTA">Alta</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="BAIXA">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Alvo atendido">
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os alvos</SelectItem>
                  <SelectItem value="VEICULO">Veículo</SelectItem>
                  <SelectItem value="PECA">Peça</SelectItem>
                  <SelectItem value="EQUIPAMENTO">Máquina/Equipamento</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Responsável">
              <Select
                value={personId || "TODOS"}
                onValueChange={(value) => setPersonId(value === "TODOS" ? "" : value)}
                disabled={people.length === 0}
              >
                <SelectTrigger><SelectValue placeholder="Todos os responsáveis" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os responsáveis</SelectItem>
                  {people.map((person) => <SelectItem key={person.id} value={person.id}>{person.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Quem abriu a ordem.</p>
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
          <Button
            type="button"
            variant="outline"
            onClick={financial ? openFinancialPdf : openListPdf}
            disabled={invalid || exporting}
          >
            <FileText className="mr-2 h-4 w-4" />Gerar PDF
          </Button>
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

/**
 * Status em lista de marcação.
 *
 * Nenhum marcado significa "todos": é o estado inicial e o mais usado, e obriga
 * menos cliques do que exigir que se marque a lista inteira para não filtrar.
 */
function StatusMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selecionados = useMemo(() => new Set(value), [value]);

  const resumo =
    value.length === 0
      ? "Todos os status"
      : value.length === 1
        ? STATUS_OPTIONS.find(([codigo]) => codigo === value[0])?.[1] ?? value[0]
        : `${value.length} status selecionados`;

  function alternar(codigo: string) {
    const proximo = new Set(selecionados);
    if (proximo.has(codigo)) proximo.delete(codigo);
    else proximo.add(codigo);
    // Marcar todos equivale a não filtrar — o estado volta a ser o vazio.
    onChange(proximo.size === STATUS_OPTIONS.length ? [] : [...proximo]);
  }

  function aplicarPreset(codigos: string[]) {
    const iguais =
      codigos.length === value.length && codigos.every((codigo) => selecionados.has(codigo));
    onChange(iguais ? [] : codigos);
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
            <span className="truncate">{resumo}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0"
          align="start"
          style={{ width: "var(--radix-popover-trigger-width)" }}
          onWheel={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Command>
            <CommandInput placeholder="Buscar status..." className="h-9 text-base" />
            <CommandList className="max-h-64">
              <CommandEmpty>Nenhum status encontrado.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="todos" className="hover:cursor-pointer" onSelect={() => onChange([])}>
                  <span className={value.length === 0 ? "font-medium" : ""}>Todos os status</span>
                  <Check className={`ml-auto h-4 w-4 ${value.length === 0 ? "opacity-100" : "opacity-0"}`} />
                </CommandItem>
                {STATUS_OPTIONS.map(([codigo, rotulo]) => (
                  <CommandItem
                    key={codigo}
                    value={rotulo}
                    className="flex items-center gap-2 hover:cursor-pointer"
                    onSelect={() => alternar(codigo)}
                  >
                    <Checkbox checked={selecionados.has(codigo)} onCheckedChange={() => alternar(codigo)} />
                    <span className={selecionados.has(codigo) ? "font-medium" : ""}>{rotulo}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <div className="flex flex-wrap gap-1 border-t p-2">
            {STATUS_PRESETS.map(([rotulo, codigos]) => (
              <Button
                key={rotulo}
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={() => aplicarPreset(codigos)}
              >
                {rotulo}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((codigo) => (
            <Badge key={codigo} variant="secondary" className="gap-1 font-normal">
              {STATUS_OPTIONS.find(([item]) => item === codigo)?.[1] ?? codigo}
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== codigo))}
                aria-label={`Remover ${codigo}`}
                className="hover:cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
