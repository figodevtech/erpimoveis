"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Download, FileText, Loader2, Search, ShoppingCart, X } from "lucide-react";

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

type Categoria = { id: number; nome: string };
type Person = { id: string; nome: string };
/** Qual marco da venda o período filtra. */
type DateField = "venda" | "pagamento" | "baixa";

/** Status de venda, na ordem em que ela caminha do orçamento à baixa. */
const STATUS_OPTIONS = [
  ["ORCAMENTO", "Em orçamento"],
  ["APROVACAO_ORCAMENTO", "Aguardando aprovação"],
  ["ORCAMENTO_APROVADO", "Orçamento aprovado"],
  ["ORCAMENTO_RECUSADO", "Orçamento recusado"],
  ["ABERTA", "Aberta"],
  ["PAGAMENTO", "Pagamento"],
  ["PENDENTE", "Pendente"],
  ["PAGO", "Pago"],
  ["AUTORIZADO", "Autorizado"],
  ["FINALIZADA", "Finalizada"],
  // `CANCELADA` e `CANCELADO` convivem no enum por compatibilidade. Aparecem
  // como uma opção só, porque para quem lê são a mesma coisa; o preset abaixo
  // manda as duas grafias, senão metade das canceladas fica de fora.
  ["CANCELADA", "Cancelada"],
  ["CANCELADO", "Cancelada (grafia antiga)"],
] as const;

/** Atalhos para as perguntas que se repetem no balcão. */
const STATUS_PRESETS: Array<[string, string[]]> = [
  ["Em aberto", ["ORCAMENTO", "APROVACAO_ORCAMENTO", "ORCAMENTO_APROVADO", "ABERTA", "PAGAMENTO", "PENDENTE"]],
  // O mesmo conjunto que `venda_reconhece_receita` usa no banco: é o que a DRE
  // considera vendido, e o relatório não pode discordar dela.
  ["Realizadas", ["PAGAMENTO", "PAGO", "AUTORIZADO", "FINALIZADA"]],
  ["Perdidas", ["ORCAMENTO_RECUSADO", "CANCELADA", "CANCELADO"]],
];

const CANAL_OPTIONS = [
  ["PDV", "Balcão (PDV)"],
  ["ONLINE", "Loja online"],
  ["MERCADO_LIVRE", "Mercado Livre"],
  ["SHOPEE", "Shopee"],
] as const;

const AJUDA_DO_EIXO: Record<DateField, string> = {
  venda: "Usa a data do registro da venda. É o mesmo eixo do histórico de vendas e da competência da DRE.",
  pagamento: "Usa o momento em que a venda entrou em pagamento, carimbado pelo sistema. Vendas que não chegaram lá ficam de fora.",
  baixa: "Usa a quitação da venda, carimbada pelo sistema. Vendas ainda não baixadas ficam de fora.",
};

export function DialogRelatorioVendas() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateField, setDateField] = useState<DateField>("venda");
  /** Vazio significa "todos os status" — sem filtro de status na consulta. */
  const [statuses, setStatuses] = useState<string[]>([]);
  const [canal, setCanal] = useState("TODOS");
  const [categoriaId, setCategoriaId] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [criadorId, setCriadorId] = useState("");
  const [vendaId, setVendaId] = useState("");
  const [customer, setCustomer] = useState<Customer>();
  const [customerOpen, setCustomerOpen] = useState(false);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loadingCategorias, setLoadingCategorias] = useState(true);
  const [exporting, setExporting] = useState(false);
  const invalid = isInvalidPeriod(dateFrom, dateTo);

  useEffect(() => {
    let active = true;
    fetch("/api/tipos/categorias-venda?ativo=true", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Falha ao carregar categorias.");
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (active) setCategorias(items);
      })
      .catch(() => active && setCategorias([]))
      .finally(() => active && setLoadingCategorias(false));
    return () => { active = false; };
  }, []);

  // A mesma rota que a ficha da venda usa para atribuir vendedor. Ela exige a
  // permissão de Usuários; quem só tem a de Relatórios não a alcança, e nesse
  // caso os dois seletores ficam só com "Todos", em vez de derrubar o restante
  // dos filtros. Uma busca só alimenta vendedor e criador.
  useEffect(() => {
    let active = true;
    fetch("/api/users?ativos=1", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("sem acesso");
        const items = Array.isArray(payload?.users) ? payload.users : [];
        if (active) {
          setPeople(
            items
              .map((item: any) => ({
                id: String(item.id ?? ""),
                nome: String(item.nome ?? item.email ?? "").trim() || "Sem nome",
              }))
              .filter((item: Person) => item.id),
          );
        }
      })
      .catch(() => active && setPeople([]));
    return () => { active = false; };
  }, []);

  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  params.set("campoData", dateField);
  if (statuses.length) params.set("status", statuses.join(","));
  if (canal !== "TODOS") params.set("canal", canal);
  if (categoriaId) params.set("categoriaVendaId", categoriaId);
  if (vendedorId) params.set("vendedorId", vendedorId);
  if (criadorId) params.set("criadorId", criadorId);
  if (vendaId) params.set("vendaId", vendaId);
  if (customer?.id) params.set("clienteId", String(customer.id));
  const endpoint = `/api/reports/vendas/export?${params.toString()}`;

  /** Relação de vendas tem folha própria, em A4 retrato — não é a grade genérica. */
  const openListPdf = () => {
    window.open(
      `/print/relatorios/vendas?${new URLSearchParams({ endpoint }).toString()}`,
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
      link.download = "vendas.xlsx";
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
          icon={<ShoppingCart className="h-4 w-4" />}
          title="Relação de vendas"
          description="Listagem comercial das vendas com cliente, status, vendedor e total"
          tone="bg-emerald-500/10 text-emerald-600"
        />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Relação de vendas</DialogTitle>
          <DialogDescription>
            Combine os filtros para gerar uma relação objetiva das vendas.
          </DialogDescription>
        </DialogHeader>

        <ReportFiltersPanel>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} previousMonth />
          <Field label="Filtrar período por">
            <Select value={dateField} onValueChange={(value) => setDateField(value as DateField)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="venda">Data da venda</SelectItem>
                <SelectItem value="pagamento">Data de pagamento</SelectItem>
                <SelectItem value="baixa">Data da baixa</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{AJUDA_DO_EIXO[dateField]}</p>
          </Field>
          <Field label="Status da venda">
            <StatusMultiSelect value={statuses} onChange={setStatuses} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Canal">
              <Select value={canal} onValueChange={setCanal}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os canais</SelectItem>
                  {CANAL_OPTIONS.map(([codigo, rotulo]) => (
                    <SelectItem key={codigo} value={codigo}>{rotulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Categoria de venda">
              <Select
                value={categoriaId || "TODAS"}
                onValueChange={(value) => setCategoriaId(value === "TODAS" ? "" : value)}
                disabled={loadingCategorias}
              >
                <SelectTrigger><SelectValue placeholder={loadingCategorias ? "Carregando..." : "Todas as categorias"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas as categorias</SelectItem>
                  {categorias.map((categoria) => (
                    <SelectItem key={categoria.id} value={String(categoria.id)}>{categoria.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Vendedor">
              <Select
                value={vendedorId || "TODOS"}
                onValueChange={(value) => setVendedorId(value === "TODOS" ? "" : value)}
                disabled={people.length === 0}
              >
                <SelectTrigger><SelectValue placeholder="Todos os vendedores" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os vendedores</SelectItem>
                  {people.map((person) => <SelectItem key={person.id} value={person.id}>{person.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">A quem a venda é atribuída.</p>
            </Field>
            <Field label="Lançado por">
              <Select
                value={criadorId || "TODOS"}
                onValueChange={(value) => setCriadorId(value === "TODOS" ? "" : value)}
                disabled={people.length === 0}
              >
                <SelectTrigger><SelectValue placeholder="Todos os usuários" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os usuários</SelectItem>
                  {people.map((person) => <SelectItem key={person.id} value={person.id}>{person.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Quem cadastrou a venda no sistema.</p>
            </Field>
            <Field label="Número da venda">
              <Input inputMode="numeric" value={vendaId} onChange={(event) => setVendaId(event.target.value.replace(/\D/g, ""))} placeholder="Todas as vendas" />
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
          </div>
        </ReportFiltersPanel>

        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <Button type="button" variant="outline" onClick={openListPdf} disabled={invalid || exporting}>
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
                    value={`${rotulo} ${codigo}`}
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
