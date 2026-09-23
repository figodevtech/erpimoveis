"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CANAIS_VENDAS, ENTREGAS_VENDAS, STATUS_VENDAS, dataDoFiltro, erroNosFiltros,
  quantidadeFiltros, type VendasListFilters,
} from "@/lib/vendas/filtros";

type Opcao = { id: string | number; nome: string };

function CampoSelect({ id, label, value, options, onChange }: {
  id: string; label: string; value?: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string | undefined) => void;
}) {
  return <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value || "TODOS"} onValueChange={(v) => onChange(v === "TODOS" ? undefined : v)}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="TODOS">Todos</SelectItem>
        {options.map(([valor, texto]) => <SelectItem key={valor} value={valor}>{texto}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}

export function VendasFiltros({ filters, onApply }: {
  filters: VendasListFilters;
  onApply: (filters: VendasListFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [opcoes, setOpcoes] = useState<{ categorias: Opcao[]; vendedores: Opcao[] }>({ categorias: [], vendedores: [] });
  const [erroOpcoes, setErroOpcoes] = useState(false);
  const erro = erroNosFiltros(draft);
  const quantidade = quantidadeFiltros(filters);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/venda/filtros", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Erro ao carregar opções");
        const data = await response.json();
        setOpcoes(data);
        setErroOpcoes(false);
      })
      .catch(() => { if (!controller.signal.aborted) setErroOpcoes(true); });
    return () => controller.abort();
  }, [open]);

  function periodo(dias: number | "mes") {
    const fim = new Date();
    fim.setHours(0, 0, 0, 0);
    const inicio = new Date(fim);
    if (dias === "mes") inicio.setDate(1);
    else inicio.setDate(inicio.getDate() - dias + 1);
    setDraft({ ...draft, dataInicio: inicio, dataFim: fim });
  }

  return <Sheet open={open} onOpenChange={(value) => { if (value) setDraft(filters); setOpen(value); }}>
    <SheetTrigger asChild>
      <Button variant="outline" size="sm"><SlidersHorizontal className="size-4" />Filtros{quantidade > 0 ? ` (${quantidade})` : ""}</Button>
    </SheetTrigger>
    <SheetContent className="w-full sm:max-w-md">
      <SheetHeader><SheetTitle>Filtrar vendas</SheetTitle><SheetDescription>Combine os filtros e aplique para atualizar a lista.</SheetDescription></SheetHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        if (erro) return;
        onApply(draft);
        setOpen(false);
      }}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <CampoSelect id="vendas-status" label="Status da venda" value={draft.status} options={STATUS_VENDAS} onChange={(status) => setDraft({ ...draft, status: status as VendasListFilters["status"] })} />
          <div className="space-y-2">
            <Label htmlFor="vendas-cliente">Cliente</Label>
            <Input id="vendas-cliente" value={draft.cliente} onChange={(e) => setDraft({ ...draft, cliente: e.target.value })} placeholder="Nome, CPF/CNPJ, telefone ou e-mail" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendas-nota">Número da nota fiscal</Label>
            <Input id="vendas-nota" inputMode="numeric" pattern="[0-9]{1,9}" value={draft.notaNumero} onChange={(e) => setDraft({ ...draft, notaNumero: e.target.value })} placeholder="Número exato" />
          </div>
          <fieldset className="space-y-3 border-t pt-3">
            <legend className="text-sm font-medium">Data da venda</legend>
            <div className="flex flex-wrap gap-2">
              {([[1, "Hoje"], [7, "7 dias"], [30, "30 dias"], ["mes", "Este mês"]] as const).map(([dias, label]) =>
                <Button key={dias} type="button" variant="outline" size="sm" onClick={() => periodo(dias)}>{label}</Button>)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([['dataInicio', 'De'], ['dataFim', 'Até']] as const).map(([campo, label]) => <div key={campo} className="space-y-2">
                <Label htmlFor={`vendas-${campo}`}>{label}</Label>
                <Input id={`vendas-${campo}`} type="date" value={dataDoFiltro(draft[campo])} onChange={(e) => setDraft({ ...draft, [campo]: e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined })} />
              </div>)}
            </div>
          </fieldset>
          <fieldset className="space-y-3 border-t pt-3">
            <legend className="text-sm font-medium">Valor total (R$)</legend>
            <div className="grid grid-cols-2 gap-3">
              {([['valorMin', 'Mínimo'], ['valorMax', 'Máximo']] as const).map(([campo, label]) => <div key={campo} className="space-y-2">
                <Label htmlFor={`vendas-${campo}`}>{label}</Label>
                <Input id={`vendas-${campo}`} type="number" min="0" step="0.01" value={draft[campo] ?? ""} onChange={(e) => setDraft({ ...draft, [campo]: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="Sem limite" />
              </div>)}
            </div>
          </fieldset>
          <CampoSelect id="vendas-canal" label="Canal" value={draft.canal} options={CANAIS_VENDAS} onChange={(canal) => setDraft({ ...draft, canal })} />
          <CampoSelect id="vendas-entrega" label="Entrega" value={draft.statusEntrega} options={ENTREGAS_VENDAS} onChange={(statusEntrega) => setDraft({ ...draft, statusEntrega })} />
          <CampoSelect id="vendas-categoria" label="Categoria" value={draft.categoriaVendaId} options={opcoes.categorias.map((c) => [String(c.id), c.nome])} onChange={(categoriaVendaId) => setDraft({ ...draft, categoriaVendaId })} />
          <CampoSelect id="vendas-vendedor" label="Vendedor" value={draft.vendedorId} options={opcoes.vendedores.map((v) => [String(v.id), v.nome || "Sem nome"])} onChange={(vendedorId) => setDraft({ ...draft, vendedorId })} />
          {erroOpcoes && <p role="alert" className="text-sm text-destructive">Não foi possível carregar categorias e vendedores. Feche e abra os filtros para tentar novamente.</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.apenasMinhas)} onChange={(e) => setDraft({ ...draft, apenasMinhas: e.target.checked })} />Apenas vendas criadas por mim</label>
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        </div>
        <div className="flex justify-between gap-2 border-t p-4">
          <Button type="button" variant="outline" onClick={() => { const vazio = { cliente: "", notaNumero: "" }; setDraft(vazio); onApply(vazio); setOpen(false); }}>Limpar filtros</Button>
          <Button type="submit" disabled={Boolean(erro)}>Aplicar filtros</Button>
        </div>
      </form>
    </SheetContent>
  </Sheet>;
}
