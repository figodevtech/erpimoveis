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
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/lib/toast";
import Kpi from "../dashboard-ordemservico/components/kpi-ordemservico";
import ChartCard from "../dashboard-ordemservico/components/chart-card";
import { ptBR } from "date-fns/locale";

const money = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortMoney = (value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact", style: "currency", currency: "BRL" }).format(value || 0);
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (value: string) => value ? new Date(`${value}T12:00:00`) : undefined;
const dateLabel = (value: string) => fromIso(value)?.toLocaleDateString("pt-BR") ?? "Selecione";
const COLORS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#f43f5e"];

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
  const percentualRecebido = Number(k.faturamento ?? 0) > 0 ? (Number(k.recebidoLiquido ?? 0) / Number(k.faturamento)) * 100 : 0;
  const itensAvaliados = Number(data?.qualidade?.itensAvaliados ?? 0);
  const custosConfiaveis = Math.max(0, itensAvaliados - Number(data?.qualidade?.estimados ?? 0) - Number(data?.qualidade?.semCusto ?? 0));
  const confiabilidadeCustos = itensAvaliados > 0 ? (custosConfiaveis / itensAvaliados) * 100 : 0;
  const cards = [
    [visao === "PREVISTO" ? "Faturamento" : "Recebido líquido", visao === "PREVISTO" ? k.faturamento : k.recebidoLiquido],
    [visao === "PREVISTO" ? "Lucro previsto" : "Lucro realizado", visao === "PREVISTO" ? k.lucroPrevisto : k.lucroRealizado],
    [visao === "PREVISTO" ? "Margem prevista" : "Margem realizada", `${Number((visao === "PREVISTO" ? k.margemPrevista : k.margemRealizada) ?? 0).toFixed(2)}%`],
    ["Registros", String(k.ordens || 0)], ["Custos de produtos", k.custoProdutos],
    ["Comissões", k.comissoes], ["Taxas", k.taxas], ["Despesas internas", k.despesas],
    ["Faturamento recebido", `${percentualRecebido.toFixed(1)}%`],
    ["Custos históricos", `${confiabilidadeCustos.toFixed(1)}%`],
    ["Gap previsto x realizado", Number(k.lucroRealizado ?? 0) - Number(k.lucroPrevisto ?? 0)],
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
    <Card className="dashboard-root w-full py-2">
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-3 sm:gap-4 sm:px-4">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex items-center gap-2 text-base leading-tight sm:text-lg"><TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" />Rendimentos</CardTitle>
          <CardDescription className="hidden text-xs sm:block sm:text-sm">Rentabilidade operacional de ordens, PDV e marketplaces.</CardDescription>
          <Badge variant="default" className="hidden text-[10px] sm:inline-flex sm:text-xs">Período: {new Date(`${inicio}T12:00:00`).toLocaleDateString("pt-BR")} — {new Date(`${fim}T12:00:00`).toLocaleDateString("pt-BR")}</Badge>
        </div>
        <div className="grid w-[9.75rem] shrink-0 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-1.5 sm:flex sm:w-auto sm:gap-3">
          <Sheet open={filtrosAbertos} onOpenChange={setFiltrosAbertos}>
            <SheetTrigger asChild><Button variant="outline" size="sm" aria-label="Abrir filtros" className="h-8 w-8 gap-1 px-0 sm:h-9 sm:w-auto sm:px-3"><SlidersHorizontal className="h-4 w-4" /><span className="hidden sm:inline">Filtros</span></Button></SheetTrigger>
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
                <div className="space-y-3"><p className="text-xs font-medium text-muted-foreground">Ordem de serviço</p><div className="space-y-3"><label className="block space-y-1 text-[11px] text-muted-foreground">Status<Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-full text-xs text-foreground"><SelectValue /></SelectTrigger><SelectContent>{["TODOS","AGUARDANDO_CHECKLIST","ORCAMENTO","APROVACAO_ORCAMENTO","ORCAMENTO_APROVADO","ORCAMENTO_RECUSADO","EM_ANDAMENTO","PAGAMENTO","CONCLUIDO","SEM_COBRANCA","CANCELADO"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label><label className="block space-y-1 text-[11px] text-muted-foreground">Setor<Select value={setorId} onValueChange={setSetorId}><SelectTrigger className="h-9 w-full text-xs text-foreground"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Todos os setores</SelectItem>{(data?.setores ?? []).map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>)}</SelectContent></Select></label></div></div>
                <div className="space-y-1"><p className="text-[11px] text-muted-foreground">Origem</p><Select value={origem} onValueChange={setOrigem}><SelectTrigger className="h-9 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODAS">Todas as origens</SelectItem><SelectItem value="OS">Ordens de serviço</SelectItem><SelectItem value="PDV">PDV</SelectItem><SelectItem value="MERCADO_LIVRE">Mercado Livre</SelectItem></SelectContent></Select></div>
                <div className="mt-2 flex justify-between gap-2"><Button type="button" variant="outline" onClick={limparFiltros}>Limpar filtros</Button><SheetClose asChild><Button type="button" onClick={load}>Aplicar filtros</Button></SheetClose></div>
              </div>
            </SheetContent>
          </Sheet>
          <Select value={visao} onValueChange={(value) => setVisao(value as "PREVISTO" | "REALIZADO")}><SelectTrigger aria-label="Visão dos rendimentos" className="h-8 w-full min-w-0 px-2 text-[11px] sm:h-9 sm:w-[130px] sm:px-3 sm:text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PREVISTO">Previsto</SelectItem><SelectItem value="REALIZADO">Realizado</SelectItem></SelectContent></Select>
          <Button variant="outline" size="icon" onClick={load} aria-label="Atualizar" className="h-8 w-8 sm:h-9 sm:w-9"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-3 pb-3 sm:space-y-5 sm:px-4 sm:pb-4">

      {(data?.qualidade?.semCusto > 0 || data?.qualidade?.estimados > 0) && <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="size-4 shrink-0 text-amber-500" /><span>{data.qualidade.semCusto > 0 ? `${data.qualidade.semCusto} item(ns) estão sem custo de compra; ` : ""}{data.qualidade.estimados > 0 ? `${data.qualidade.estimados} item(ns) usam o custo atual como estimativa. ` : ""}A margem pode variar até que os custos históricos sejam informados.</span></div>}
      {loading ? <div className="flex gap-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-6 w-52" /></div> : <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">Receita vs. período anterior: {variacaoReceita == null ? "sem base" : `${variacaoReceita >= 0 ? "+" : ""}${variacaoReceita.toFixed(2)}%`}</Badge><Badge variant="outline">Lucro vs. período anterior: {variacaoLucro == null ? "sem base" : `${variacaoLucro >= 0 ? "+" : ""}${variacaoLucro.toFixed(2)}%`}</Badge></div>}
      <div className="dashboard-kpi-strip grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4" data-loading={loading} aria-busy={loading}>{cards.map(([label, value]) => loading ? <div key={String(label)} className="dashboard-kpi p-3"><div className="flex items-center justify-between gap-2"><p className="line-clamp-2 text-xs leading-tight text-muted-foreground sm:text-sm">{String(label)}</p><Skeleton className="size-4 shrink-0 rounded-full" /></div><Skeleton className="mt-2 h-7 w-24 max-w-[70%]" /></div> : <Kpi key={String(label)} label={String(label)} value={typeof value === "string" ? value : money(Number(value))} />)}</div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Evolução dos rendimentos" description={`${visao === "PREVISTO" ? "Faturamento e lucro previsto" : "Recebimento e lucro realizado"} pela data do documento`} className="xl:col-span-2"><ChartContainer className="h-60 w-full sm:h-72" config={{ receita: { label: "Receita", color: "#8b5cf6" }, lucro: { label: "Lucro", color: "#10b981" }, faturamento: { label: "Faturamento", color: "#8b5cf6" }, recebidoLiquido: { label: "Recebido líquido", color: "#8b5cf6" }, lucroPrevisto: { label: "Lucro previsto", color: "#10b981" }, lucroRealizado: { label: "Lucro realizado", color: "#10b981" } }}><AreaChart key={`evolucao-${animKey}-${loading}`} data={evolucaoGrafico}><CartesianGrid vertical={false} strokeDasharray="4 8" opacity={0.55} /><XAxis dataKey="data" axisLine={false} tickLine={false} tickFormatter={(v) => String(v).slice(5)} /><YAxis axisLine={false} tickLine={false} tickFormatter={shortMoney} width={64} /><ChartTooltip content={<ChartTooltipContent />} /><Area isAnimationActive={!loading} animationDuration={700} dataKey={visao === "PREVISTO" ? "faturamento" : "recebidoLiquido"} name="receita" stroke="var(--color-receita)" strokeWidth={2.5} fill="var(--color-receita)" fillOpacity={0.14} /><Area isAnimationActive={!loading} animationDuration={700} dataKey={visao === "PREVISTO" ? "lucroPrevisto" : "lucroRealizado"} name="lucro" stroke="var(--color-lucro)" strokeWidth={2.5} fill="var(--color-lucro)" fillOpacity={0.1} /><ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-3 gap-y-1 text-[10px] sm:text-xs" />} /></AreaChart></ChartContainer></ChartCard>
        <ChartCard title="Composição dos custos" description="Produtos, comissões, taxas e despesas">
          <ChartContainer className="h-52 w-full sm:h-64" config={{ valor: { label: "Valor", color: "#6d28d9" } }}>
            <PieChart key={`composicao-${animKey}-${loading}`}>
              <ChartTooltip content={<ChartTooltipContent nameKey="nome" />} />
              <Pie data={composicaoGrafico} dataKey="valor" nameKey="nome" innerRadius="52%" outerRadius="78%" isAnimationActive={!loading} animationDuration={700}>
                {composicaoGrafico.map((_: any, index: number) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {composicaoGrafico.map((item: any, index: number) => (
              <div key={item.nome} className="flex min-w-0 items-center gap-1.5 rounded-lg bg-muted/35 px-2 py-1.5 text-[10px] sm:text-xs">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <span className="truncate text-muted-foreground" title={item.nome}>{item.nome}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <Card className="dashboard-surface min-w-0 gap-0 self-start overflow-hidden py-0">
          <CardHeader className="p-3 pb-2 sm:p-4 sm:pb-3">
            <CardTitle className="dashboard-card-title">Lucro por setor/canal</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 px-0 pb-2 sm:px-2 sm:pb-3">
            <ChartContainer
              className="h-56 min-w-0 w-full sm:h-72"
              config={{ lucro: { label: "Lucro", color: "#6d28d9" } }}
            >
              <BarChart key={`setores-${animKey}-${loading}`} data={setoresGrafico} layout="vertical" margin={{ left: 0, right: 8 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickFormatter={shortMoney} tick={{ fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="nome"
                  width={64}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => String(value).length > 9 ? `${String(value).slice(0, 8)}…` : String(value)}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  isAnimationActive={!loading}
                  animationDuration={700}
                  dataKey={visao === "PREVISTO" ? "lucroPrevisto" : "lucroRealizado"}
                  name="lucro"
                  fill="var(--color-lucro)"
                  radius={4}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="dashboard-surface min-w-0 gap-0 self-start overflow-hidden py-0">
          <CardHeader className="p-3 pb-2 sm:p-4 sm:pb-3">
            <CardTitle className="dashboard-card-title">Produtos com maior lucro</CardTitle>
          </CardHeader>
          <CardContent className="max-h-60 space-y-2 overflow-y-auto overscroll-contain px-2 pb-2 pr-1.5 sm:max-h-72 sm:px-4 sm:pb-3 sm:pr-2">
            {(data?.produtos ?? []).map((item: any, index: number) => (
              <div key={item.produtoid} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-xl bg-muted/35 p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3 sm:p-3">
                <span className="row-span-2 flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-semibold text-primary sm:row-span-1 sm:size-8">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.nome}</p>
                  <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Venda {money(item.receita)} · Custo {money(item.custo)}</p>
                </div>
                <span className="col-start-2 mt-1 justify-self-start whitespace-nowrap text-xs font-semibold text-emerald-600 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:justify-self-end sm:text-sm">
                  {money(item.lucro)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {(data?.prejuizos ?? []).length > 0 && <ChartCard title="Registros com prejuízo" description="Maiores resultados negativos do período"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{data.prejuizos.map((item: any) => <div key={`${item.origem}-${item.id}`} className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-3"><div><p className="text-sm font-medium">{item.origem === "MERCADO_LIVRE" ? "Mercado Livre" : item.origem} #{item.id}</p><p className="text-xs text-muted-foreground">{item.cliente}</p></div><span className="font-semibold text-red-500">{money(visao === "PREVISTO" ? item.lucroPrevisto : item.lucroRealizado)}</span></div>)}</div></ChartCard>}
      <Card><CardHeader><CardTitle>Detalhamento por origem ({k.ordens || 0})</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Origem</TableHead><TableHead>Registro</TableHead><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Setor/canal</TableHead><TableHead>{visao === "PREVISTO" ? "Faturamento" : "Recebido"}</TableHead><TableHead>Custos</TableHead><TableHead>Lucro</TableHead><TableHead>Margem</TableHead></TableRow></TableHeader><TableBody>{(data?.ordens ?? []).map((item: any) => { const lucro = visao === "PREVISTO" ? item.lucroPrevisto : item.lucroRealizado; const base = visao === "PREVISTO" ? item.faturamento : item.recebidoLiquido; const custos = visao === "PREVISTO" ? item.custosPrevistos : item.custosRealizados; const margem = base > 0 ? lucro / base * 100 : 0; return <TableRow key={`${item.origem}-${item.id}`}><TableCell><Badge variant="outline">{item.origem === "MERCADO_LIVRE" ? "Mercado Livre" : item.origem}</Badge></TableCell><TableCell className="font-medium">#{item.id}</TableCell><TableCell>{new Date(`${item.data}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell><TableCell>{item.cliente}</TableCell><TableCell>{item.setor}</TableCell><TableCell>{money(base)}</TableCell><TableCell>{money(custos)}</TableCell><TableCell className={lucro < 0 ? "text-red-500" : "text-emerald-600"}>{money(lucro)}</TableCell><TableCell><Badge variant="outline">{margem.toFixed(2)}%</Badge></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>
      </CardContent>
    </Card>
  );
}
