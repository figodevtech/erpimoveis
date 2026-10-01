"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Download, FileText, Loader2, Search, Wrench, X } from "lucide-react";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import type { Customer } from "../../../clientes/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { AGRUPAMENTOS, CAMPOS_DATA, SITUACOES } from "@/lib/relatorios/servicos-realizados";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";
import { StatusMultiSelect } from "./dialog-relatorio-ordens";

type Opcoes = { pessoas: { id: string; nome: string; ativo: boolean }[]; setores: { id: string; nome: string }[] };
export default function DialogServicosRealizados() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Abre no eixo da Central Pessoal, para os totais baterem com o Meu Perfil.
  const [campoData, setCampoData] = useState("conclusao");
  const [agruparPor, setAgruparPor] = useState("realizador");
  const [status, setStatus] = useState<string[]>([]);
  const [criadorId, setCriadorId] = useState("");
  const [realizadorId, setRealizadorId] = useState("");
  const [setorId, setSetorId] = useState("");
  const [ordemId, setOrdemId] = useState("");
  const [situacao, setSituacao] = useState("");
  const [cliente, setCliente] = useState<Customer>();
  const [clienteAberto, setClienteAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroOpcoes, setErroOpcoes] = useState("");
  const [exportando, setExportando] = useState(false);
  const invalido = isInvalidPeriod(dateFrom, dateTo);

  async function carregarOpcoes() {
    if (carregando) return;
    setCarregando(true); setErroOpcoes("");
    try {
      const res = await fetch("/api/reports/servicos-realizados/opcoes", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Não foi possível carregar os filtros.");
      setOpcoes(data);
    } catch (e) { setErroOpcoes(e instanceof Error ? e.message : "Não foi possível carregar os filtros."); }
    finally { setCarregando(false); }
  }
  const params = new URLSearchParams({ campoData, agruparPor });
  Object.entries({ dateFrom, dateTo, criadorId, realizadorId, setorId, ordemId, situacao, status: status.join(","), clienteId: cliente?.id ? String(cliente.id) : "" }).forEach(([k, v]) => { if (v) params.set(k, v); });
  const endpoint = `/api/reports/servicos-realizados/export?${params}`;
  async function exportar() {
    if (invalido || exportando) return;
    setExportando(true);
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) { const erro = await res.json().catch(() => ({})); throw new Error(erro.error || "Não foi possível exportar o relatório."); }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a"); link.href = url; link.download = "servicos_realizados.xlsx";
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível exportar o relatório."); }
    finally { setExportando(false); }
  }
  const pessoas = opcoes?.pessoas.map(p => ({ id: p.id, nome: `${p.nome}${p.ativo ? "" : " (inativo)"}` })) ?? [];
  return <Dialog onOpenChange={open => { if (open) void carregarOpcoes(); }}>
    <DialogTrigger asChild><ReportTrigger icon={<Wrench className="h-4 w-4" />} title="Serviços Realizados" description="Serviços por realizador, setor da OS, setor do realizador ou criador, com valores, comissões e tempo de execução" tone="bg-violet-500/10 text-violet-600" /></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Serviços Realizados</DialogTitle><DialogDescription>Consulte os serviços vinculados aos realizadores, inclusive de ordens abertas, conforme os status selecionados.</DialogDescription></DialogHeader>
      <ReportFiltersPanel>
        <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
        <Field label="Filtrar período por"><Lista value={campoData} onChange={setCampoData} opcoes={CAMPOS_DATA} />
          {campoData !== "entrada" && <p className="text-xs text-muted-foreground">Com período preenchido, registros sem esta data ficam fora. Para consultar orçamentos, use a entrada da OS.</p>}
        </Field>
        <Field label="Status da OS"><StatusMultiSelect value={status} onChange={setStatus} /></Field>
        {erroOpcoes && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">{erroOpcoes}<Button variant="outline" size="sm" onClick={() => void carregarOpcoes()}>Tentar novamente</Button></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Criador da OS"><Pessoa value={criadorId} onChange={setCriadorId} opcoes={pessoas} disabled={carregando || !opcoes} todos="Todos os criadores" /></Field>
          <Field label="Realizador"><Pessoa value={realizadorId} onChange={setRealizadorId} opcoes={pessoas} disabled={carregando || !opcoes} todos="Todos os realizadores" /></Field>
          <Field label="Setor da OS"><Lista value={setorId || "TODOS"} onChange={v => setSetorId(v === "TODOS" ? "" : v)} disabled={carregando || !opcoes} opcoes={{ TODOS: "Todos os setores", SEM_SETOR: "Sem setor", ...Object.fromEntries((opcoes?.setores ?? []).map(s => [s.id, s.nome])) }} /></Field>
          <Field label="Situação da execução"><Lista value={situacao || "TODAS"} onChange={v => setSituacao(v === "TODAS" ? "" : v)} opcoes={{ TODAS: "Todas as situações", ...SITUACOES }} /></Field>
          <Field label="Número da OS"><Input inputMode="numeric" value={ordemId} onChange={e => setOrdemId(e.target.value.replace(/\D/g, ""))} placeholder="Todas as ordens" /></Field>
          <Field label="Cliente"><div className="flex gap-2"><Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal" onClick={() => setClienteAberto(true)}><Search className="mr-2 h-4 w-4" /><span className="truncate">{cliente?.nomerazaosocial || "Todos os clientes"}</span></Button>{cliente && <Button type="button" size="icon" variant="outline" aria-label="Limpar cliente" onClick={() => setCliente(undefined)}><X className="h-4 w-4" /></Button>}</div></Field>
        </div>
        <Field label="Agrupar e ordenar por"><Lista value={agruparPor} onChange={setAgruparPor} opcoes={AGRUPAMENTOS} /></Field>
      </ReportFiltersPanel>
      <CustomerSelect open={clienteAberto} setOpen={setClienteAberto} OnSelect={c => { setCliente(c); setClienteAberto(false); }} />
      <DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
        <Button variant="outline" disabled={invalido || exportando} onClick={() => window.open(`/print/relatorios/servicos-realizados?${new URLSearchParams({ endpoint })}`, "_blank", "noopener,noreferrer")}><FileText className="mr-2 h-4 w-4" />Gerar PDF</Button>
        <Button disabled={invalido || exportando} onClick={() => void exportar()}>{exportando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{exportando ? "Exportando..." : "Exportar Excel"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>; }
function Lista({ value, onChange, opcoes, disabled }: { value: string; onChange: (v: string) => void; opcoes: Record<string, string>; disabled?: boolean }) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(opcoes).map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}</SelectContent></Select>;
}
function Pessoa({ value, onChange, opcoes, disabled, todos }: { value: string; onChange: (v: string) => void; opcoes: { id: string; nome: string }[]; disabled: boolean; todos: string }) {
  const [open, setOpen] = useState(false);
  const items = [{ id: "", nome: todos }, ...opcoes];
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button variant="outline" role="combobox" aria-label={todos} aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal"><span className="truncate">{items.find(p => p.id === value)?.nome || todos}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="p-0" style={{ width: "var(--radix-popover-trigger-width)" }} onWheel={e => e.stopPropagation()}><Command><CommandInput placeholder="Buscar pessoa..." /><CommandList><CommandEmpty>Nenhuma pessoa encontrada.</CommandEmpty><CommandGroup>{items.map(p => <CommandItem key={p.id} value={`${p.nome} ${p.id}`} onSelect={() => { onChange(p.id); setOpen(false); }}>{p.nome}{p.id === value && <Check className="ml-auto h-4 w-4" />}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
  </Popover>;
}
