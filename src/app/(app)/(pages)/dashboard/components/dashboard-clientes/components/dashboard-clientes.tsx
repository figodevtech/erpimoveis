"use client";

import * as React from "react";
import clsx from "clsx";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList, AreaChart, Area } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";

import { RefreshCcw, Users, TrendingUp, Activity, MapPin, Repeat2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

import ChartCard from "../../dashboard-ordemservico/components/chart-card";

import type { DashboardClientesProps } from "../lib/types";
import { INSIGHTS_INICIAIS, BARRAS_UF_PADRAO } from "../lib/constants";
import { obterPeriodoInicial, formatarDataYYYYMMDD, formatarDataCompleta } from "../lib/date";
import { percentualDe, taxaCrescimento, formatarRotuloMes, topUfs } from "../lib/helpers";
import { listarMesesEntre } from "../lib/months";

import { useInsightsClientes } from "../hooks/use-insights-clientes";
import IndicadorResumo from "./indicador-resumo";
import SheetClientesFiltros from "./sheet-clientes-filtros";

// ───────────────── helpers ─────────────────

function diffMesesInclusivo(inicio: Date, fim: Date) {
  const a = inicio.getFullYear() * 12 + inicio.getMonth();
  const b = fim.getFullYear() * 12 + fim.getMonth();
  return Math.max(1, b - a + 1);
}

function rotuloDia(yyyyMmDd: string) {
  const [, m, d] = yyyyMmDd.split("-");
  return `${d}/${m}`;
}

// ───────────────── componente ─────────────────

export default function DashboardClientes({
  className,
  endpointInsights = "/api/dashboard/clientes/insights",
  autoRefreshMs,
}: DashboardClientesProps) {
  // padrão: primeiro dia do mês até hoje
  const periodoInicial = React.useMemo(() => obterPeriodoInicial(), []);
  const [dataInicio, setDataInicio] = React.useState<Date | null>(periodoInicial.inicio);
  const [dataFim, setDataFim] = React.useState<Date | null>(periodoInicial.fim);
  const [filtroAberto, setFiltroAberto] = React.useState(false);

  const endpointComFiltro = React.useMemo(() => {
    const params = new URLSearchParams();
    if (dataInicio) params.set("dateFrom", formatarDataYYYYMMDD(dataInicio));
    if (dataFim) params.set("dateTo", formatarDataYYYYMMDD(dataFim));

    if (dataInicio && dataFim) {
      params.set("months", String(Math.min(36, diffMesesInclusivo(dataInicio, dataFim))));
    }

    const qs = params.toString();
    return qs ? `${endpointInsights}?${qs}` : endpointInsights;
  }, [endpointInsights, dataInicio, dataFim]);

  const {
    dados: insights,
    carregando,
    erro,
    recarregar,
    animKey,
  } = useInsightsClientes(endpointComFiltro, autoRefreshMs);

  const textoPeriodo =
    dataInicio && dataFim
      ? `${formatarDataCompleta(dataInicio)} - ${formatarDataCompleta(dataFim)}`
      : "Período não definido";

  function tratarDataInicio(date?: Date) {
    if (!date) return setDataInicio(null);
    if (dataFim && date > dataFim) setDataFim(date);
    setDataInicio(date);
  }

  function tratarDataFim(date?: Date) {
    if (!date) return setDataFim(null);
    if (dataInicio && date < dataInicio) setDataInicio(date);
    setDataFim(date);
  }

  function limparFiltros() {
    const p = obterPeriodoInicial();
    setDataInicio(p.inicio);
    setDataFim(p.fim);
  }

  const d = insights ?? INSIGHTS_INICIAIS;

  const total = d.totalClients;
  const ativos = d.countsByStatus?.["ATIVO"] ?? 0;
  const ativosPct = percentualDe(ativos, total);

  const novos30 = d.recent30d;
  const prev30 = d.prev30d;
  const crescimento30 = taxaCrescimento(novos30, prev30);

  const ufsAtendidas = Object.keys(d.byEstado ?? {}).length;

  const dadosTipoBase = [
    { key: "FISICA", name: "Pessoa Física", value: d.countsByTipo?.FISICA ?? 0 },
    { key: "JURIDICA", name: "Pessoa Jurídica", value: d.countsByTipo?.JURIDICA ?? 0 },
  ];

  // Decide se usa diário (1 mês) ou mensal (2+ meses)
  const mesesPeriodo = React.useMemo(() => {
    if (!dataInicio || !dataFim) return [];
    return listarMesesEntre(dataInicio, dataFim);
  }, [dataInicio, dataFim]);

  const usarDiario = mesesPeriodo.length <= 1;

  // ───── Série de novos clientes (linha) ─────
  const dadosLinha = React.useMemo(() => {
    if (!dataInicio || !dataFim) return [];

    if (usarDiario) {
      const lista = d.dailyNew ?? [];
      return lista.map((p) => ({
        key: p.date,
        rotulo: rotuloDia(p.date),
        count: Number(p.count ?? 0),
      }));
    }

    const mapa = new Map((d.monthlyNew ?? []).map((m) => [m.month, m.count]));
    return mesesPeriodo.map((m) => ({
      key: m,
      rotulo: formatarRotuloMes(m),
      count: mapa.get(m) ?? 0,
    }));
  }, [d.dailyNew, d.monthlyNew, dataInicio, dataFim, usarDiario, mesesPeriodo]);

  // ───── UFs (barras) ─────
  const ufsBrutas = topUfs(d.byEstado ?? {}, 8);
  const dadosUfs = (ufsBrutas.length ? ufsBrutas : BARRAS_UF_PADRAO).map((u) => ({
    ...u,
    count: u.count ?? 0,
  }));

  // ───── Tipos PF x PJ (pizza) ─────
  const dadosTipoAnimados = dadosTipoBase.map((t) => ({
    ...t,
    valor: t.value ?? 0,
  }));

  return (
    <Card className={clsx("dashboard-root w-full", className)}>
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 sm:h-5 sm:w-5" /> Dashboard de Clientes
          </CardTitle>

          <CardDescription className="text-xs sm:text-sm">
            Visão geral da base de clientes, distribuição geográfica e tendências.
          </CardDescription>

          <Badge variant="default" className="text-[10px] sm:text-xs">
            Período: {textoPeriodo}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <SheetClientesFiltros
            aberto={filtroAberto}
            aoMudarAberto={setFiltroAberto}
            dataInicio={dataInicio}
            dataFim={dataFim}
            aoMudarDataInicio={tratarDataInicio}
            aoMudarDataFim={tratarDataFim}
            aoLimpar={limparFiltros}
          />

          {autoRefreshMs ? (
            <Badge variant="secondary" className="whitespace-nowrap text-xs">
              Auto · {Math.round((autoRefreshMs ?? 0) / 1000)}s
            </Badge>
          ) : null}

          <Button
            variant="outline"
            size="icon"
            onClick={recarregar}
            aria-label="Atualizar"
            aria-busy={carregando}
            disabled={carregando}
            className={cn("h-8 w-8 bg-transparent sm:h-9 sm:w-9 md:h-10 md:w-10", carregando && "cursor-wait")}
          >
            <RefreshCcw className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", carregando && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 sm:grid-cols-3 xl:grid-cols-8 sm:gap-3 md:gap-4">
          <IndicadorResumo label="Cadastros no período" valor={total} icone={Users} />
          <IndicadorResumo label="Novos (30d)" valor={novos30} icone={Activity} />
          <IndicadorResumo label="Crescimento (30d)" valor={`${crescimento30}%`} />
          <IndicadorResumo label="% ativos no período" valor={`${ativosPct}%`} />
          <IndicadorResumo label="UFs atendidas" valor={ufsAtendidas} icone={MapPin} />
          <IndicadorResumo label="Atendidos (30d)" valor={d.clientesAtendidos30} icone={UserCheck} />
          <IndicadorResumo label="Recorrentes (90d)" valor={d.clientesRecorrentes90} icone={Repeat2} />
          <IndicadorResumo label="Taxa de recorrência" valor={`${Number(d.taxaRecorrencia90 ?? 0).toFixed(1)}%`} />
        </div>

        {/* Erro */}
        {erro && !carregando && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs sm:p-3 sm:text-sm">
            Erro ao carregar insights: <span className="font-medium">{erro}</span>
          </div>
        )}

        {/* Gráficos */}
        <div
          className={clsx("grid w-full grid-cols-1 gap-3 sm:gap-4 md:gap-6 lg:grid-cols-3", carregando && "opacity-80")}
        >
          {/* Linha: Novos clientes */}
          <div className="dashboard-surface p-3 sm:p-4 lg:col-span-3">
            <div className="mb-2 flex flex-col gap-2 sm:mb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium sm:text-sm">Novos clientes</p>
                <p className="text-[10px] text-muted-foreground sm:text-xs">
                  {usarDiario ? "Por dia (mês atual)" : "Por mês (período selecionado)"}
                </p>
              </div>
              <Badge variant="outline" className="w-fit gap-1 text-xs">
                <TrendingUp className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Tendência
              </Badge>
            </div>

            <ChartContainer
              config={{ count: { label: "Novos clientes", color: "hsl(var(--chart-1))" } }}
              className="h-48 w-full text-primary dark:text-primary xs:h-56 sm:h-64 md:h-72 lg:h-80"
            >
              <AreaChart
                key={`clientes-linha-${animKey}`}
                data={dadosLinha}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="areaFillClientes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis
                  dataKey="rotulo"
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickMargin={4}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickMargin={8}
                  stroke="hsl(var(--muted-foreground))"
                  domain={[0, "dataMax + 1"]}
                />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#8b5cf6"
                  fill="url(#areaFillClientes)"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                  isAnimationActive
                  animationDuration={700}
                />
              </AreaChart>
            </ChartContainer>
          </div>

          {/* Barras: UFs */}
          <div className="dashboard-surface p-3 sm:p-4 lg:col-span-2">
            <div className="mb-2 flex flex-col gap-1 sm:mb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium sm:text-sm">Top UFs por clientes</p>
                <p className="text-[10px] text-muted-foreground sm:text-xs">Estados com mais clientes</p>
              </div>
              <Badge variant="outline" className="w-fit text-xs">
                Barras
              </Badge>
            </div>

            <ChartContainer
              config={{ count: { label: "Clientes", color: "hsl(var(--chart-2))" } }}
              className="h-48 text-primary/30 xs:h-56 sm:h-64 md:h-72"
            >
              <BarChart
                key={`clientes-ufs-${animKey}`}
                data={dadosUfs}
                margin={{ top: 16, right: 8, left: -12, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis
                  dataKey="uf"
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  tickMargin={4}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                  tickMargin={8}
                  stroke="hsl(var(--muted-foreground))"
                  domain={[0, "dataMax + 1"]}
                />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <Bar
                  dataKey="count"
                  fill="#0ea5e9"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive
                  animationDuration={700}
                >
                  <LabelList dataKey="count" position="top" className="fill-foreground" fontSize={10} />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>

          {/* Pizza: Tipo de pessoa */}
          <ChartCard
            title="Tipo de pessoa"
            description="Física x Jurídica"
            badge="Pizza"
            className="md:col-span-2 xl:col-span-1"
          >
            <ChartContainer
              config={{
                FISICA: { label: "Pessoa Física", color: "hsl(var(--chart-4))" },
                JURIDICA: { label: "Pessoa Jurídica", color: "hsl(var(--chart-5))" },
              }}
              className="w-full text-primary/30 h-52 sm:h-60 md:h-72"
            >
              <PieChart key={`clientes-tipo-${animKey}`}>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie
                  data={dadosTipoAnimados}
                  dataKey="valor"
                  nameKey="key"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={4}
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={600}
                >
                  {dadosTipoAnimados.map((entrada, index) => (
                    <Cell key={entrada.key} fill={["#8b5cf6", "#06b6d4"][index]} />
                  ))}
                  <LabelList
                    dataKey="valor"
                    position="outside"
                    fontSize={12}
                    stroke="none"
                    formatter={(valor: number) => (valor > 0 ? valor : "")}
                    className="fill-foreground"
                  />
                </Pie>

                <ChartLegend
                  content={<ChartLegendContent nameKey="key" />}
                    
                />
              </PieChart>
            </ChartContainer>
          </ChartCard>
        </div>
      </CardContent>
    </Card>
  );
}
