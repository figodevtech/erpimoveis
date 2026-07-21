"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarIcon, RefreshCcw, SlidersHorizontal, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/lib/toast";
import Kpi from "../dashboard-ordemservico/components/kpi-ordemservico";
import ChartCard from "../dashboard-ordemservico/components/chart-card";
import { ptBR } from "date-fns/locale";

const money = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortMoney = (value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL" }).format(value || 0);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const fromIso = (value: string) => value ? new Date(`${value}T12:00:00`) : undefined;
const dateLabel = (value: string) => fromIso(value)?.toLocaleDateString("pt-BR") ?? "Selecione";
const COLORS = ["#6d28d9", "#f59e0b", "#0ea5e9", "#ef4444"];

export default function DashboardRendimentos() {
  const initial = new Date(); initial.setDate(initial.getDate() - 29);
  const [inicio, setInicio] = useState(iso(initial));
  const [fim, setFim] = useState(iso(new Date()));
  const [status, setStatus] = useState("TODOS");
  const [setorId, setSetorId] = useState("0");
  const [origem, setOrigem] = useState("TODAS");
  const [visao, setVisao] = useState<"PREVISTO" | "REALIZADO">("PREVISTO");
  const [data, setData] = useState<any>(null);
  const [anterior, setAnterior] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [animKey, setAnimKey] = useState(0);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ inicio, fim, status, setorId, origem });
      const start = fromIso(inicio)!;
      const end = fromIso(fim)!;
      const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
      const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1);
      const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - duration + 1);
      const previousParams = new URLSearchParams({ inicio: iso(previousStart), fim: iso(previousEnd), status, setorId, origem });
      const [response, previousResponse] = await Promise.all([
        fetch(`/api/dashboard/rentabilidade?${params}`, { cache: "no-store" }),
        fetch(`/api/dashboard/rentabilidade?${previousParams}`, { cache: "no-store" }),
      ]);
      const [json, previousJson] = await Promise.all([response.json().catch(() => ({})), previousResponse.json().catch(() => ({}))]);
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar rendimentos.");
      setData(json);
      setAnterior(previousResponse.ok ? previousJson : null);
      setAnimKey((current) => current + 1);
    } catch (error: any) { toast.error("Erro ao carregar rendimentos", { description: error.message }); }
    finally { setLoading(false); }
  }

  // A primeira carga usa o período inicial; alterações só são aplicadas pelo botão de filtro.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  const k = data?.kpis ?? {};
  const cards = [
    [visao === "PREVISTO" ? "Faturamento" : "Recebido líquido", visao === "PREVISTO" ? k.faturamento : k.recebidoLiquido],
    [visao === "PREVISTO" ? "Lucro previsto" : "Lucro realizado", visao === "PREVISTO" ? k.lucroPrevisto : k.lucroRealizado],
    [visao === "PREVISTO" ? "Margem prevista" : "Margem realizada", `${Number((visao === "PREVISTO" ? k.margemPrevista : k.margemRealizada) ?? 0).toFixed(2)}%`],
    ["Registros", String(k.ordens || 0)], ["Custos de produtos", k.custoProdutos],
    ["Comissões", k.comissoes], ["Taxas", k.taxas], ["Despesas internas", k.despesas],
  ];

  function limparFiltros() {
    const dataInicial = new Date();
    dataInicial.setDate(dataInicial.getDate() - 29);
    setInicio(iso(dataInicial));
    setFim(iso(new Date()));
    setStatus("TODOS");
    setSetorId("0");
    setOrigem("TODAS");
  }

  const variacao = (atual: number, previo: number) => previo ? ((atual - previo) / Math.abs(previo)) * 100 : null;
  const variacaoReceita = variacao(Number(visao === "PREVISTO" ? k.faturamento : k.recebidoLiquido), Number(visao === "PREVISTO" ? anterior?.kpis?.faturamento : anterior?.kpis?.recebidoLiquido));
  const variacaoLucro = variacao(Number(visao === "PREVISTO" ? k.lucroPrevisto : k.lucroRealizado), Number(visao === "PREVISTO" ? anterior?.kpis?.lucroPrevisto : anterior?.kpis?.lucroRealizado));
  const evolucaoGrafico = loading
    ? (data?.evolucao ?? []).map((item: any) => ({ ...item, faturamento: 0, recebidoLiquido: 0, lucroPrevisto: 0, lucroRealizado: 0 }))
    : (data?.evolucao ?? []);
  const composicaoGrafico = loading
    ? (data?.composicao ?? []).map((item: any) => ({ ...item, valor: 0 }))
    : (data?.composicao ?? []);
  const setoresGrafico = loading
    ? (data?.setoresRentabilidade ?? []).map((item: any) => ({ ...item, lucroPrevisto: 0, lucroRealizado: 0 }))
    : (data?.setoresRentabilidade ?? []);

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
              <div className="grid flex-1 auto-rows-min gap-6 px-4">
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Intervalo de datas</p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <div className="flex-1 space-y-1">
                      <p className="text-[11px] text-muted-foreground">Data inicial</p>
                      <Popover><PopoverTrigger asChild><Button variant="outline" className="h-9 w-full justify-start text-left text-xs font-normal"><CalendarIcon className="mr-1.5 h-4 w-4" />{dateLabel(inicio)}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={fromIso(inicio)} onSelect={(date) => date && setInicio(iso(date))} locale={ptBR} initialFocus /></PopoverContent></Popover>
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-[11px] text-muted-foreground">Data final</p>
                      <Popover><PopoverTrigger asChild><Button variant="outline" className="h-9 w-full justify-start text-left text-xs font-normal"><CalendarIcon className="mr-1.5 h-4 w-4" />{dateLabel(fim)}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={fromIso(fim)} onSelect={(date) => date && setFim(iso(date))} locale={ptBR} initialFocus /></PopoverContent></Popover>
                    </div>
                  </div>
                </div>
                <div className="space-y-3"><p className="text-xs font-medium text-muted-foreground">Ordem de serviço</p><div className="space-y-3"><label className="block space-y-1 text-[11px] text-muted-foreground">Status<Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-full text-xs text-foreground"><SelectValue /></SelectTrigger><SelectContent>{["TODOS","ORCAMENTO","EM_ANDAMENTO","PAGAMENTO","CONCLUIDO","CANCELADO"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label><label className="block space-y-1 text-[11px] text-muted-foreground">Setor<Select value={setorId} onValueChange={setSetorId}><SelectTrigger className="h-9 w-full text-xs text-foreground"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Todos os setores</SelectItem>{(data?.setores ?? []).map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>)}</SelectContent></Select></label></div></div>
                <div className="space-y-1"><p className="text-[11px] text-muted-foreground">Origem</p><Select value={origem} onValueChange={setOrigem}><SelectTrigger className="h-9 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODAS">Todas as origens</SelectItem><SelectItem value="OS">Ordens de serviço</SelectItem><SelectItem value="PDV">PDV</SelectItem><SelectItem value="MERCADO_LIVRE">Mercado Livre</SelectItem></SelectContent></Select></div>
                <div className="mt-2 flex justify-between gap-2"><Button type="button" variant="outline" onClick={limparFiltros}>Limpar filtros</Button><SheetClose asChild><Button type="button" onClick={load}>Aplicar filtros</Button></SheetClose></div>
              </div>
            </SheetContent>
          </Sheet>
          <Select value={visao} onValueChange={(value) => setVisao(value as "PREVISTO" | "REALIZADO")}><SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PREVISTO">Previsto</SelectItem><SelectItem value="REALIZADO">Realizado</SelectItem></SelectContent></Select>
          <Button variant="outline" size="icon" onClick={load} aria-label="Atualizar" className="h-8 w-8 sm:h-9 sm:w-9"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-3 pb-3 sm:space-y-5 sm:px-4 sm:pb-4">

      {data?.qualidade?.semCusto > 0 && <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="size-4 shrink-0 text-amber-500" /><span>Existem {data.qualidade.semCusto} item(ns) sem valor de compra informado. O lucro desses itens pode estar incorreto.</span></div>}
      {loading ? <div className="flex gap-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-6 w-52" /></div> : <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">Receita vs. período anterior: {variacaoReceita == null ? "sem base" : `${variacaoReceita >= 0 ? "+" : ""}${variacaoReceita.toFixed(2)}%`}</Badge><Badge variant="outline">Lucro vs. período anterior: {variacaoLucro == null ? "sem base" : `${variacaoLucro >= 0 ? "+" : ""}${variacaoLucro.toFixed(2)}%`}</Badge></div>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => loading ? <div key={String(label)} className="rounded-lg border p-3"><div className="flex items-center justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="size-4 rounded-full" /></div><Skeleton className="mt-2 h-7 w-36" /></div> : <Kpi key={String(label)} label={String(label)} value={typeof value === "string" ? value : money(Number(value))} />)}</div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Evolução dos rendimentos" description={`${visao === "PREVISTO" ? "Faturamento e lucro previsto" : "Recebimento e lucro realizado"} por dia`} className="xl:col-span-2"><ChartContainer className="h-72 w-full" config={{ receita: { label: visao === "PREVISTO" ? "Faturamento" : "Recebido", color: "#6d28d9" }, lucro: { label: "Lucro", color: "#10b981" } }}><AreaChart key={`evolucao-${animKey}-${loading}`} data={evolucaoGrafico}><CartesianGrid vertical={false} /><XAxis dataKey="data" tickFormatter={(v) => String(v).slice(5)} /><YAxis tickFormatter={shortMoney} /><ChartTooltip content={<ChartTooltipContent />} /><Area isAnimationActive={!loading} animationDuration={700} dataKey={visao === "PREVISTO" ? "faturamento" : "recebidoLiquido"} name="receita" stroke="var(--color-receita)" fill="var(--color-receita)" fillOpacity={0.15} /><Area isAnimationActive={!loading} animationDuration={700} dataKey={visao === "PREVISTO" ? "lucroPrevisto" : "lucroRealizado"} name="lucro" stroke="var(--color-lucro)" fill="var(--color-lucro)" fillOpacity={0.15} /></AreaChart></ChartContainer></ChartCard>
        <ChartCard title="Composição dos custos" description="Produtos, comissões, taxas e despesas"><ChartContainer className="h-72 w-full" config={{ valor: { label: "Valor", color: "#6d28d9" } }}><PieChart key={`composicao-${animKey}-${loading}`}><ChartTooltip content={<ChartTooltipContent nameKey="nome" />} /><Pie data={composicaoGrafico} dataKey="valor" nameKey="nome" innerRadius={55} outerRadius={90} isAnimationActive={!loading} animationDuration={700}>{composicaoGrafico.map((_: any, index: number) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie></PieChart></ChartContainer></ChartCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Lucro por setor/canal</CardTitle></CardHeader><CardContent><ChartContainer className="h-72 w-full" config={{ lucro: { label: "Lucro", color: "#6d28d9" } }}><BarChart key={`setores-${animKey}-${loading}`} data={setoresGrafico} layout="vertical"><CartesianGrid horizontal={false} /><XAxis type="number" tickFormatter={shortMoney} /><YAxis type="category" dataKey="nome" width={100} /><ChartTooltip content={<ChartTooltipContent />} /><Bar isAnimationActive={!loading} animationDuration={700} dataKey={visao === "PREVISTO" ? "lucroPrevisto" : "lucroRealizado"} name="lucro" fill="var(--color-lucro)" radius={4} /></BarChart></ChartContainer></CardContent></Card>
        <Card><CardHeader><CardTitle>Produtos com maior lucro bruto</CardTitle></CardHeader><CardContent className="space-y-2">{(data?.produtos ?? []).map((item: any) => <div key={item.produtoid} className="flex items-center justify-between rounded-lg border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.nome}</p><p className="text-xs text-muted-foreground">Venda {money(item.receita)} · Custo {money(item.custo)}</p></div><span className="font-semibold">{money(item.lucro)}</span></div>)}</CardContent></Card>
      </div>
      {(data?.prejuizos ?? []).length > 0 && <ChartCard title="Registros com prejuízo" description="Maiores resultados negativos do período"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{data.prejuizos.map((item: any) => <div key={`${item.origem}-${item.id}`} className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-3"><div><p className="text-sm font-medium">{item.origem === "MERCADO_LIVRE" ? "Mercado Livre" : item.origem} #{item.id}</p><p className="text-xs text-muted-foreground">{item.cliente}</p></div><span className="font-semibold text-red-500">{money(visao === "PREVISTO" ? item.lucroPrevisto : item.lucroRealizado)}</span></div>)}</div></ChartCard>}
      <Card><CardHeader><CardTitle>Detalhamento por origem ({k.ordens || 0})</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Origem</TableHead><TableHead>Registro</TableHead><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Setor/canal</TableHead><TableHead>{visao === "PREVISTO" ? "Faturamento" : "Recebido"}</TableHead><TableHead>Custos</TableHead><TableHead>Lucro</TableHead><TableHead>Margem</TableHead></TableRow></TableHeader><TableBody>{(data?.ordens ?? []).map((item: any) => { const lucro = visao === "PREVISTO" ? item.lucroPrevisto : item.lucroRealizado; const base = visao === "PREVISTO" ? item.faturamento : item.recebidoLiquido; const margem = base > 0 ? lucro / base * 100 : 0; return <TableRow key={`${item.origem}-${item.id}`}><TableCell><Badge variant="outline">{item.origem === "MERCADO_LIVRE" ? "Mercado Livre" : item.origem}</Badge></TableCell><TableCell className="font-medium">#{item.id}</TableCell><TableCell>{new Date(`${item.data}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell><TableCell>{item.cliente}</TableCell><TableCell>{item.setor}</TableCell><TableCell>{money(base)}</TableCell><TableCell>{money(item.custoProdutos + item.comissao + item.taxas + item.despesas)}</TableCell><TableCell className={lucro < 0 ? "text-red-500" : "text-emerald-600"}>{money(lucro)}</TableCell><TableCell><Badge variant="outline">{margem.toFixed(2)}%</Badge></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>
      </CardContent>
    </Card>
  );
}
