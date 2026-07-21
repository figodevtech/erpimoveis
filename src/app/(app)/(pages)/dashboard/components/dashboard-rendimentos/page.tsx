"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCcw, SlidersHorizontal, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/lib/toast";
import Kpi from "../dashboard-ordemservico/components/kpi-ordemservico";
import ChartCard from "../dashboard-ordemservico/components/chart-card";

const money = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortMoney = (value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL" }).format(value || 0);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const COLORS = ["#6d28d9", "#f59e0b", "#0ea5e9", "#ef4444"];

export default function DashboardRendimentos() {
  const initial = new Date(); initial.setDate(initial.getDate() - 29);
  const [inicio, setInicio] = useState(iso(initial));
  const [fim, setFim] = useState(iso(new Date()));
  const [status, setStatus] = useState("TODOS");
  const [setorId, setSetorId] = useState("0");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ inicio, fim, status, setorId });
      const response = await fetch(`/api/dashboard/rentabilidade?${params}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar rendimentos.");
      setData(json);
    } catch (error: any) { toast.error("Erro ao carregar rendimentos", { description: error.message }); }
    finally { setLoading(false); }
  }

  // A primeira carga usa o período inicial; alterações só são aplicadas pelo botão de filtro.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  const k = data?.kpis ?? {};
  const cards = [
    ["Faturamento", k.faturamento], ["Lucro previsto", k.lucroPrevisto], ["Lucro realizado", k.lucroRealizado],
    ["Margem prevista", `${Number(k.margemPrevista || 0).toFixed(2)}%`], ["Custos de produtos", k.custoProdutos],
    ["Comissões", k.comissoes], ["Taxas", k.taxas], ["Despesas internas", k.despesas],
  ];

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" />Dashboard de Rendimentos</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Rentabilidade operacional, custos e margem das ordens de serviço.</CardDescription>
          <Badge variant="default" className="text-[10px] sm:text-xs">Período: {new Date(`${inicio}T12:00:00`).toLocaleDateString("pt-BR")} — {new Date(`${fim}T12:00:00`).toLocaleDateString("pt-BR")}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Sheet open={filtrosAbertos} onOpenChange={setFiltrosAbertos}>
            <SheetTrigger asChild><Button variant="outline" size="sm" className="gap-1"><SlidersHorizontal className="h-4 w-4" />Filtros</Button></SheetTrigger>
            <SheetContent>
              <SheetHeader><SheetTitle>Filtros de rendimentos</SheetTitle></SheetHeader>
              <div className="grid flex-1 auto-rows-min gap-5 px-4">
                <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs text-muted-foreground">Data inicial<Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="text-foreground" /></label><label className="space-y-1 text-xs text-muted-foreground">Data final<Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="text-foreground" /></label></div>
                <label className="space-y-1 text-xs text-muted-foreground">Status<Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full text-foreground"><SelectValue /></SelectTrigger><SelectContent>{["TODOS","ORCAMENTO","EM_ANDAMENTO","PAGAMENTO","CONCLUIDO","CANCELADO"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-1 text-xs text-muted-foreground">Setor<Select value={setorId} onValueChange={setSetorId}><SelectTrigger className="w-full text-foreground"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Todos os setores</SelectItem>{(data?.setores ?? []).map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>)}</SelectContent></Select></label>
                <div className="flex justify-end"><SheetClose asChild><Button onClick={load}>Aplicar filtros</Button></SheetClose></div>
              </div>
            </SheetContent>
          </Sheet>
          <Button variant="outline" size="icon" onClick={load} aria-label="Atualizar" className="h-8 w-8 sm:h-9 sm:w-9"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-3 pb-3 sm:space-y-5 sm:px-4 sm:pb-4">

      {data?.qualidade?.semCusto > 0 && <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="size-4 shrink-0 text-amber-500" /><span>Existem {data.qualidade.semCusto} item(ns) sem valor de compra informado. O lucro desses itens pode estar incorreto.</span></div>}
      <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 ${loading ? "opacity-80" : ""}`}>{cards.map(([label, value]) => <Kpi key={String(label)} label={String(label)} value={typeof value === "string" ? value : money(Number(value))} />)}</div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Evolução dos rendimentos" description="Faturamento e lucro por dia" className="xl:col-span-2"><ChartContainer className="h-72 w-full" config={{ faturamento: { label: "Faturamento", color: "#6d28d9" }, lucro: { label: "Lucro", color: "#10b981" } }}><AreaChart data={data?.evolucao ?? []}><CartesianGrid vertical={false} /><XAxis dataKey="data" tickFormatter={(v) => String(v).slice(5)} /><YAxis tickFormatter={shortMoney} /><ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="faturamento" stroke="var(--color-faturamento)" fill="var(--color-faturamento)" fillOpacity={0.15} /><Area dataKey="lucro" stroke="var(--color-lucro)" fill="var(--color-lucro)" fillOpacity={0.15} /></AreaChart></ChartContainer></ChartCard>
        <ChartCard title="Composição dos custos" description="Produtos, comissões, taxas e despesas"><ChartContainer className="h-72 w-full" config={{ valor: { label: "Valor", color: "#6d28d9" } }}><PieChart><ChartTooltip content={<ChartTooltipContent nameKey="nome" />} /><Pie data={data?.composicao ?? []} dataKey="valor" nameKey="nome" innerRadius={55} outerRadius={90}>{(data?.composicao ?? []).map((_: any, index: number) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie></PieChart></ChartContainer></ChartCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Lucro por setor</CardTitle></CardHeader><CardContent><ChartContainer className="h-72 w-full" config={{ lucro: { label: "Lucro", color: "#6d28d9" } }}><BarChart data={data?.setoresRentabilidade ?? []} layout="vertical"><CartesianGrid horizontal={false} /><XAxis type="number" tickFormatter={shortMoney} /><YAxis type="category" dataKey="nome" width={100} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="lucro" fill="var(--color-lucro)" radius={4} /></BarChart></ChartContainer></CardContent></Card>
        <Card><CardHeader><CardTitle>Produtos com maior lucro bruto</CardTitle></CardHeader><CardContent className="space-y-2">{(data?.produtos ?? []).map((item: any) => <div key={item.produtoid} className="flex items-center justify-between rounded-lg border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.nome}</p><p className="text-xs text-muted-foreground">Venda {money(item.receita)} · Custo {money(item.custo)}</p></div><span className="font-semibold">{money(item.lucro)}</span></div>)}</CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Detalhamento por OS ({k.ordens || 0})</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>OS</TableHead><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Setor</TableHead><TableHead>Faturamento</TableHead><TableHead>Custos</TableHead><TableHead>Lucro</TableHead><TableHead>Margem</TableHead></TableRow></TableHeader><TableBody>{(data?.ordens ?? []).map((item: any) => <TableRow key={item.id}><TableCell className="font-medium">#{item.id}</TableCell><TableCell>{new Date(`${item.data}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell><TableCell>{item.cliente}</TableCell><TableCell>{item.setor}</TableCell><TableCell>{money(item.faturamento)}</TableCell><TableCell>{money(item.custoProdutos + item.comissao + item.taxas + item.despesas)}</TableCell><TableCell className={item.lucroPrevisto < 0 ? "text-red-500" : "text-emerald-600"}>{money(item.lucroPrevisto)}</TableCell><TableCell><Badge variant="outline">{item.margemPrevista.toFixed(2)}%</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      </CardContent>
    </Card>
  );
}
