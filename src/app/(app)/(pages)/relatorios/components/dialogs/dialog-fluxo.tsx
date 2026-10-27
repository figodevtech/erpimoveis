"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, FilterX, Search, Wallet, X } from "lucide-react";

import CustomerSelect from "@/app/(app)/components/customerSelect";
import type { Customer } from "../../../clientes/types";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ValueInput from "@/components/ui/value-input";
import { ExportTransactionsButton } from "../../../(financeiro)/fluxodecaixa/components/ExportTransactionsButton";
import { PlanoContaCombobox } from "../../../(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "../../../(financeiro)/fluxodecaixa/components/search-combobox";
import { useCategoriasTransacao } from "../../../(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { useCentrosCusto } from "../../../(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { usePlanosDeConta } from "../../../(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { Tipo_transacao, type Banco } from "../../../(financeiro)/fluxodecaixa/types";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";

type Situacao = "TODAS" | "REALIZADAS" | "PENDENTES";
type Vinculo = "TODOS" | "OS" | "VENDA" | "EVENTO" | "AVULSO";

const initialRelations = { categoriaId: "", bancoId: "", planoContaId: "", centroCustoId: "" };

export default function DialogFluxo() {
  const [open, setOpen] = useState(false);
  const { options: metodosPagamento } = usePaymentMethodOptions(open);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tipo, setTipo] = useState<Tipo_transacao | "">("");
  const [situacao, setSituacao] = useState<Situacao>("TODAS");
  const [vinculo, setVinculo] = useState<Vinculo>("TODOS");
  const [metodo, setMetodo] = useState("");
  const [search, setSearch] = useState("");
  const [nomePagador, setNomePagador] = useState("");
  const [documentoPagador, setDocumentoPagador] = useState("");
  const [ordemId, setOrdemId] = useState("");
  const [vendaId, setVendaId] = useState("");
  const [valorMin, setValorMin] = useState(0);
  const [valorMax, setValorMax] = useState(0);
  const [selectedCliente, setSelectedCliente] = useState<Customer>();
  const [relations, setRelations] = useState(initialRelations);
  const [banks, setBanks] = useState<Banco[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);

  const { categorias, loadingCategorias, errorCategorias } = useCategoriasTransacao(open);
  const { gruposPlanosDeConta, loadingPlanos, errorPlanos } = usePlanosDeConta(open);
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto(open);

  useEffect(() => {
    if (!open || banks.length > 0) return;
    let active = true;
    fetch("/api/banks?limit=100", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Falha ao carregar bancos");
        if (active) setBanks(payload.data ?? []);
      })
      .catch(() => active && setBanks([]))
      .finally(() => active && setLoadingBanks(false));
    return () => {
      active = false;
    };
  }, [open, banks.length]);

  const periodoInvalido = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const faixaInvalida = valorMax > 0 && valorMin > valorMax;
  const activeCount = useMemo(
    () =>
      [
        dateFrom,
        dateTo,
        tipo,
        situacao !== "TODAS" ? situacao : "",
        vinculo !== "TODOS" ? vinculo : "",
        metodo,
        search,
        nomePagador,
        documentoPagador,
        ordemId,
        vendaId,
        valorMin > 0 ? valorMin : 0,
        valorMax > 0 ? valorMax : 0,
        selectedCliente?.id,
        ...Object.values(relations),
      ].filter(Boolean).length,
    [dateFrom, dateTo, tipo, situacao, vinculo, metodo, search, nomePagador, documentoPagador, ordemId, vendaId, valorMin, valorMax, selectedCliente?.id, relations],
  );

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setTipo("");
    setSituacao("TODAS");
    setVinculo("TODOS");
    setMetodo("");
    setSearch("");
    setNomePagador("");
    setDocumentoPagador("");
    setOrdemId("");
    setVendaId("");
    setValorMin(0);
    setValorMax(0);
    setSelectedCliente(undefined);
    setRelations(initialRelations);
  };

  const generatePdf = () => {
    const params = new URLSearchParams();
    const append = (key: string, value: string | number | boolean | null | undefined) => {
      if (value !== "" && value !== null && value !== undefined) params.set(key, String(value));
    };
    append("dateFrom", dateFrom);
    append("dateTo", dateTo);
    append("tipo", tipo);
    append("pendente", situacao === "TODAS" ? null : situacao === "PENDENTES");
    append("vinculo", vinculo === "TODOS" ? null : vinculo);
    append("metodopagamento", metodo);
    append("search", search);
    append("nomePagador", nomePagador);
    append("documentoPagador", documentoPagador);
    append("ordemservicoid", ordemId);
    append("vendaid", vendaId);
    append("valorMin", valorMin > 0 ? valorMin : null);
    append("valorMax", valorMax > 0 ? valorMax : null);
    append("clienteId", selectedCliente?.id);
    append("categoriaId", relations.categoriaId);
    append("bancoId", relations.bancoId);
    append("planoContaId", relations.planoContaId);
    append("centroCustoId", relations.centroCustoId);
    window.open(`/print/relatorios/fluxo-caixa?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-auto flex-col items-start justify-start gap-2 bg-transparent p-4 text-left hover:cursor-pointer">
          <div className="flex w-full items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted"><Wallet /></div>
            <span className="flex-1 font-medium">Fluxo de Caixa</span>
          </div>
          <p className="text-xs text-muted-foreground">Movimentações financeiras detalhadas</p>
        </Button>
      </DialogTrigger>

      <DialogContent className="flex h-svh w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[90vh] sm:max-h-[850px] sm:w-[95vw] sm:rounded-lg md:max-w-[1050px]">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>Relatório de fluxo de caixa</DialogTitle>
              <DialogDescription>Combine os filtros para exportar somente os lançamentos necessários.</DialogDescription>
            </div>
            {activeCount > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{activeCount} filtros</span>}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-4 py-5 sm:px-6">
          <div className="space-y-5">
            <section className="space-y-4 rounded-xl border bg-card p-4">
              <div><h3 className="text-sm font-semibold">Período e situação</h3><p className="text-xs text-muted-foreground">Data de competência e estado do lançamento.</p></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Data inicial"><DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Data inicial" /></Field>
                <Field label="Data final"><DatePicker value={dateTo} onChange={setDateTo} placeholder="Data final" /></Field>
                <Field label="Situação"><Select value={situacao} onValueChange={(value) => setSituacao(value as Situacao)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODAS">Todas</SelectItem><SelectItem value="REALIZADAS">Realizadas</SelectItem><SelectItem value="PENDENTES">Pendentes</SelectItem></SelectContent></Select></Field>
                <Field label="Origem / vínculo"><Select value={vinculo} onValueChange={(value) => setVinculo(value as Vinculo)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODOS">Todas</SelectItem><SelectItem value="OS">Ordem de serviço</SelectItem><SelectItem value="VENDA">Venda / PDV</SelectItem><SelectItem value="EVENTO">Evento financeiro</SelectItem><SelectItem value="AVULSO">Lançamento avulso</SelectItem></SelectContent></Select></Field>
              </div>
              {periodoInvalido && <p className="text-xs text-destructive">A data inicial não pode ser posterior à data final.</p>}
            </section>

            <section className="space-y-4 rounded-xl border bg-card p-4">
              <div><h3 className="text-sm font-semibold">Classificação financeira</h3><p className="text-xs text-muted-foreground">Natureza, categoria, plano de conta, centro de custo e conta bancária.</p></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Tipo"><Select value={tipo || "TODOS"} onValueChange={(value) => setTipo(value === "TODOS" ? "" : value as Tipo_transacao)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODOS">Todos</SelectItem>{Object.values(Tipo_transacao).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Método de pagamento"><Select value={metodo || "TODOS"} onValueChange={(value) => setMetodo(value === "TODOS" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODOS">Todos</SelectItem>{metodosPagamento.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Categoria"><SearchCombobox value={relations.categoriaId} onValueChange={(categoriaId) => setRelations((current) => ({ ...current, categoriaId }))} loading={loadingCategorias} disabled={!!errorCategorias} placeholder={errorCategorias ?? "Todas as categorias"} clearable clearLabel="Todas as categorias" options={categorias.map((item) => ({ value: String(item.id), label: item.nome, description: item.descricao ?? undefined }))} /></Field>
                <Field label="Plano de conta"><PlanoContaCombobox value={relations.planoContaId} groups={gruposPlanosDeConta} loading={loadingPlanos} disabled={!!errorPlanos} placeholder={errorPlanos ?? "Todos os planos"} clearable clearLabel="Todos os planos" onClear={() => setRelations((current) => ({ ...current, planoContaId: "" }))} onValueChange={(planoContaId) => setRelations((current) => ({ ...current, planoContaId }))} /></Field>
                <Field label="Centro de custo"><SearchCombobox value={relations.centroCustoId} onValueChange={(centroCustoId) => setRelations((current) => ({ ...current, centroCustoId }))} loading={loadingCentrosCusto} disabled={!!errorCentrosCusto} placeholder={errorCentrosCusto ?? "Todos os centros"} clearable clearLabel="Todos os centros" options={centrosCusto.map((item) => ({ value: String(item.id), label: item.nome, description: item.descricao ?? undefined }))} /></Field>
                <Field label="Banco / conta"><SearchCombobox value={relations.bancoId} onValueChange={(bancoId) => setRelations((current) => ({ ...current, bancoId }))} loading={loadingBanks} placeholder="Todos os bancos" clearable clearLabel="Todos os bancos" options={banks.map((item) => ({ value: String(item.id), label: item.titulo, description: [item.agencia, item.contanumero].filter(Boolean).join(" · ") }))} /></Field>
              </div>
            </section>

            <section className="space-y-4 rounded-xl border bg-card p-4">
              <div><h3 className="text-sm font-semibold">Valores e referências</h3><p className="text-xs text-muted-foreground">Busque pela descrição, vínculo operacional, cliente ou pagador.</p></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Descrição"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Parte da descrição" /></Field>
                <Field label="Valor mínimo"><ValueInput value={valorMin} onValueChange={setValorMin} /></Field>
                <Field label="Valor máximo"><ValueInput value={valorMax} onValueChange={setValorMax} /></Field>
                <Field label="Número da OS"><Input inputMode="numeric" value={ordemId} onChange={(event) => setOrdemId(event.target.value.replace(/\D/g, ""))} placeholder="Ex.: 123" /></Field>
                <Field label="Número da venda"><Input inputMode="numeric" value={vendaId} onChange={(event) => setVendaId(event.target.value.replace(/\D/g, ""))} placeholder="Ex.: 456" /></Field>
                <Field label="Cliente">
                  <div className="flex gap-2"><Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal" onClick={() => setCustomerOpen(true)}><Search className="mr-2 h-4 w-4" /><span className="truncate">{selectedCliente?.nomerazaosocial ?? "Todos os clientes"}</span></Button>{selectedCliente && <Button type="button" variant="outline" size="icon" onClick={() => setSelectedCliente(undefined)} aria-label="Limpar cliente"><X className="h-4 w-4" /></Button>}</div>
                  <CustomerSelect open={customerOpen} setOpen={setCustomerOpen} OnSelect={(customer) => { setSelectedCliente(customer); setCustomerOpen(false); }} />
                </Field>
                <Field label="Nome do pagador"><Input value={nomePagador} onChange={(event) => setNomePagador(event.target.value)} placeholder="Nome informado no lançamento" /></Field>
                <Field label="CPF/CNPJ do pagador"><Input inputMode="numeric" value={documentoPagador} onChange={(event) => setDocumentoPagador(event.target.value.replace(/\D/g, ""))} placeholder="Somente números" /></Field>
              </div>
              {faixaInvalida && <p className="text-xs text-destructive">O valor mínimo não pode ser maior que o valor máximo.</p>}
            </section>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {activeCount > 0 && <Button type="button" variant="ghost" onClick={clearFilters}><FilterX className="mr-2 h-4 w-4" />Limpar filtros</Button>}
            <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
            <Button type="button" variant="outline" onClick={generatePdf} disabled={periodoInvalido || faixaInvalida}>
              <FileText className="mr-2 h-4 w-4" />Gerar PDF
            </Button>
            <ExportTransactionsButton
              search={search}
              tipo={tipo}
              categoriaId={relations.categoriaId ? Number(relations.categoriaId) : null}
              bancoId={relations.bancoId ? Number(relations.bancoId) : null}
              planoContaId={relations.planoContaId ? Number(relations.planoContaId) : null}
              centroCustoId={relations.centroCustoId ? Number(relations.centroCustoId) : null}
              metodopagamento={metodo}
              ordemservicoid={ordemId || null}
              vendaid={vendaId || null}
              clienteId={selectedCliente?.id ?? null}
              pendente={situacao === "TODAS" ? null : situacao === "PENDENTES"}
              nomePagador={nomePagador}
              documentoPagador={documentoPagador}
              valorMin={valorMin > 0 ? valorMin : null}
              valorMax={valorMax > 0 ? valorMax : null}
              vinculo={vinculo === "TODOS" ? null : vinculo}
              dateFrom={dateFrom}
              dateTo={dateTo}
              filename="relatorio_fluxo_caixa"
              className="hover:cursor-pointer"
              disabled={periodoInvalido || faixaInvalida}
            >Exportar Excel</ExportTransactionsButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>;
}
