"use client";

import * as React from "react";

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

import {
  RefreshCcw,
  TrendingUp,
  Activity,
  Timer,
  DollarSign,
  ClipboardList,
  CheckCircle2,
  CircleAlert,
  UserX,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { ServiceOrdersDashboardProps } from "../lib/types";
import { obterPeriodoInicial, formatarDataYYYYMMDD, formatarDataCompleta } from "../lib/datas";
import { formatCurrencyBRL, formatDurationHours, formatNumber } from "../lib/format";
import { pickColorForKey } from "../lib/palette";
import { STATIC_ZERO_MONTHS, makeZeroedMonthlyFrom, formatMonthLabel } from "../lib/monthly";
import { useInsights } from "../hooks/use-insights";

import ChartCard from "./chart-card";
import Kpi from "./kpi-ordemservico";
import EmptyState from "./emply-state";
import SheetOsFiltros from "./sheet-os-filtros";

function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function abreviarSegundoNome(nome: string) {
  const parts = String(nome ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length <= 1) return parts.join(" ");

  const connectors = new Set(["de", "da", "do", "dos", "das", "e"]);
  let idx = 1;
  while (idx < parts.length && connectors.has(parts[idx].toLowerCase())) idx++;
  if (idx >= parts.length) return parts.join(" ");

  const p = parts[idx];
  parts[idx] = p ? `${p[0]}.` : p;
  return parts.join(" ");
}

function encurtarStatusOS(raw: string) {
  const base = String(raw ?? "")
    .trim()
    .replace(/_/g, " ")
    .toUpperCase();

  if (!base) return "";

  const tokenMap: Record<string, string> = {
    AGUARDANDO: "Aguard.",
    CHECKLIST: "Check.",
    APROVACAO: "Aprov.",
    ORCAMENTO: "Orc.",
    EM: "Em",
    ANDAMENTO: "and.",
    CONCLUIDO: "Concl.",
    CANCELADO: "Canc.",
    SEM: "Sem",
    COBRANCA: "cobr.",
  };

  const out = base
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => tokenMap[t] ?? (t.length > 12 ? `${t.slice(0, 12)}.` : t))
    .join(" ");

  return out.length > 18 ? `${out.slice(0, 18)}...` : out;
}

function StatusValueLabelRight(props: any) {
  const { x, y, width, height, value } = props ?? {};
  if (value === undefined || value === null) return null;
  const cx = Number(x ?? 0) + Number(width ?? 0) + 8;
  const cy = Number(y ?? 0) + Number(height ?? 0) / 2 + 4;
  return (
    <text x={cx} y={cy} textAnchor="start" fill="#fff" fontSize={12} fontWeight={400}>
      {value}
    </text>
  );
}

function StatusValueLabelTop(props: any) {
  const { x, y, width, value } = props ?? {};
  if (value === undefined || value === null) return null;
  const cx = Number(x ?? 0) + Number(width ?? 0) / 2;
  const cy = Number(y ?? 0) - 6;
  return (
    <text x={cx} y={cy} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={400}>
      {value}
    </text>
  );
}

export default function ServiceOrdersDashboard({
  className,
  insightsEndpoint = "/api/ordens/insights",
  autoRefreshMs,
}: ServiceOrdersDashboardProps) {
  const isMobile = useMediaQuery("(max-width: 640px)");

  const periodoInicial = React.useMemo(obterPeriodoInicial, []);
  const [dataInicio, setDataInicio] = React.useState<Date | null>(periodoInicial.inicio);
  const [dataFim, setDataFim] = React.useState<Date | null>(periodoInicial.fim);
  const [filtroAberto, setFiltroAberto] = React.useState(false);

  const endpointComFiltro = React.useMemo(() => {
    if (!dataInicio || !dataFim) return insightsEndpoint;
    const params = new URLSearchParams({
      dateFrom: formatarDataYYYYMMDD(dataInicio),
      dateTo: formatarDataYYYYMMDD(dataFim),
    });
    return `${insightsEndpoint}?${params.toString()}`;
  }, [insightsEndpoint, dataInicio, dataFim]);

  const { data, loading, error, refetch } = useInsights(endpointComFiltro, autoRefreshMs);

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

  // Base de 12 meses "zerados" para montar as séries
  const [zeroMonths, setZeroMonths] = React.useState<string[]>(STATIC_ZERO_MONTHS);
  React.useEffect(() => {
    setZeroMonths(makeZeroedMonthlyFrom(new Date(), 12));
  }, []);

  const monthly = React.useMemo(() => {
    const newMap = new Map((data?.monthlyNew ?? []).map((x) => [x.month, x.count]));
    const doneMap = new Map((data?.monthlyCompleted ?? []).map((x) => [x.month, x.count]));
    const revMap = new Map((data?.monthlyRevenue ?? []).map((x) => [x.month, x.amount]));

    const base = zeroMonths.map((m) => ({ month: m, label: formatMonthLabel(m) }));

    return {
      new: base.map(({ month, label }) => ({ label, count: newMap.get(month) ?? 0 })),
      done: base.map(({ month, label }) => ({ label, count: doneMap.get(month) ?? 0 })),
      rev: base.map(({ month, label }) => ({ label, amount: revMap.get(month) ?? 0 })),
    };
  }, [data, zeroMonths]);

  const seriesNewDone = (monthly.new ?? []).map((n, i) => ({
    label: n.label,
    new: n.count,
    done: (monthly.done ?? [])[i]?.count ?? 0,
  }));

  const statusKeys = React.useMemo(() => Object.keys(data?.countsByStatus ?? {}), [data?.countsByStatus]);

  // mantém como no seu original (não vamos usar para colorir, mas deixa disponível)
  const statusItems = (statusKeys.length ? statusKeys : []).map((name) => ({
    name,
    value: data?.countsByStatus?.[name] ?? 0,
    fill: pickColorForKey(name),
  }));

  const prioEntries = Object.entries(data?.countsByPriority ?? {}).filter(([, v]) => Number(v) > 0);
  const prioItems = prioEntries.map(([key, value]) => ({
    key,
    value: Number(value) || 0,
    color: pickColorForKey(key),
  }));

  const servicesByUser = data?.servicesByUser ?? [];
  const servicesByUserSorted = React.useMemo(() => {
    return [...servicesByUser].sort((a, b) => b.totalServicos - a.totalServicos);
  }, [servicesByUser]);

  // Altura dinamica para permitir scroll quando ha muitos usuarios.
  const servicesByUserChartHeight = React.useMemo(() => {
    const rowH = 38; // altura aproximada por usuario na barra horizontal
    const n = servicesByUserSorted.length || 1;
    return Math.max(220, n * rowH);
  }, [servicesByUserSorted.length]);

  const total = data?.totalOrders ?? 0;
  const inProgress = data?.countsByStatus?.EM_ANDAMENTO ?? 0;
  const completed = data?.ordersCompleted ?? 0;
  const avgHrs = data?.avgCompletionHours ?? 0;

  // novo: serviços sem realizador (padrão novo)
  const servicesWithoutRealizador = (data as any)?.servicesWithoutRealizador ?? 0;

  // altura dinâmica só para quando ficar vertical no mobile
  const statusChartHeight = React.useMemo(() => {
    const n = statusItems.length || 1;
    return Math.max(220, n * 38);
  }, [statusItems.length]);

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
            Dashboard de Ordens de Serviço
          </CardTitle>

          <CardDescription className="text-xs sm:text-sm">
            Visão executiva de produtividade, prazos e receita.
          </CardDescription>

          <Badge variant="default" className="text-[10px] sm:text-xs">
            Período: {textoPeriodo}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <SheetOsFiltros
            aberto={filtroAberto}
            aoMudarAberto={setFiltroAberto}
            dataInicio={dataInicio}
            dataFim={dataFim}
            aoMudarDataInicio={tratarDataInicio}
            aoMudarDataFim={tratarDataFim}
            aoLimpar={limparFiltros}
          />

          {autoRefreshMs ? (
            <Badge variant="secondary" className="whitespace-nowrap text-[10px] sm:text-xs">
              Auto · {Math.round((autoRefreshMs ?? 0) / 1000)}s
            </Badge>
          ) : null}

          <Button
            variant="outline"
            size="icon"
            onClick={refetch}
            aria-label="Atualizar dados"
            className={cn("h-8 w-8 sm:h-9 sm:w-9", loading && "cursor-wait opacity-80")}
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-7">
          <Kpi icon={ClipboardList} label="Total de OS" value={formatNumber(total)} />
          <Kpi icon={Activity} label="OS do dia" value={formatNumber(data?.ordersToday ?? 0)} />
          <Kpi icon={CheckCircle2} label="Concluídas" value={formatNumber(completed)} />
          <Kpi icon={CircleAlert} label="Em andamento" value={formatNumber(inProgress)} />
          <Kpi icon={Timer} label="Tempo médio" value={formatDurationHours(avgHrs)} />
          <Kpi icon={DollarSign} label="Receita (30d)" value={formatCurrencyBRL(data?.revenue30d ?? 0)} />
          <Kpi icon={UserX} label="Serviços sem realizador" value={formatNumber(servicesWithoutRealizador)} />
        </div>

        {error && !loading ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Erro ao carregar insights: <span className="font-medium">{error}</span>
          </div>
        ) : null}

        <div className="flex w-full flex-col gap-6 md:grid md:grid-cols-2 xl:grid-cols-3">
          {/* OS por mês */}
          <ChartCard
            title="OS por mês"
            description="Novas vs Concluídas (12m)"
            badge="Tendência"
            badgeIcon={<TrendingUp className="h-3.5 w-3.5" />}
            className="md:col-span-2 xl:col-span-2"
          >
            <ChartContainer
              config={{
                new: { label: "Novas", color: "hsl(var(--chart-1))" },
                done: { label: "Concluídas", color: "hsl(var(--chart-2))" },
              }}
              className="h-48 w-full xs:h-56 sm:h-64 md:h-72 lg:h-80"
            >
              <AreaChart data={seriesNewDone} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="areaNew" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(43, 127, 255)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="rgb(43, 127, 255)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="areaDone" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgba(255, 210, 0, 0.8)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="rgba(255, 210, 0, 0.8)" stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickMargin={8}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickMargin={8}
                  stroke="hsl(var(--muted-foreground))"
                />

                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />

                <Area
                  type="monotone"
                  dataKey="new"
                  stroke="rgb(43, 127, 255)"
                  fill="url(#areaNew)"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="done"
                  stroke="rgba(255, 210, 0, 0.8)"
                  fill="url(#areaDone)"
                  strokeWidth={2}
                  dot={false}
                />

                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </ChartCard>

          {/* Serviços por usuário */}
          <ChartCard
            title="Serviços por usuário"
            description="Ranking de serviços concluídos no período"
            badge="Ranking"
            className="md:col-span-2 xl:col-span-1"
          >
            <div className="max-h-60 overflow-y-auto pr-1 sm:max-h-80">
              <ChartContainer
                config={{
                  // ChartContainer injeta `--color-${key}`; usamos isso no `fill` do Bar.
                  totalServicos: { label: "Serviços", color: "hsl(var(--chart-3))" },
                }}
                className="w-full"
                style={{ height: servicesByUserChartHeight }}
              >
                <BarChart
                  accessibilityLayer
                  data={servicesByUserSorted}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                  barSize={18}
                >
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />

                  <XAxis
                    type="number"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    tickMargin={8}
                    stroke="hsl(var(--muted-foreground))"
                  />

                  <YAxis
                    type="category"
                    dataKey="usuarioNome"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    width={90}
                    tickFormatter={(v) => {
                      const s = abreviarSegundoNome(String(v ?? ""));
                      const max = isMobile ? 14 : 18;
                      return s.length > max ? `${s.slice(0, max)}...` : s;
                    }}
                    stroke="hsl(var(--muted-foreground))"
                  />

                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />

                  <Bar
                    dataKey="totalServicos"
                    radius={[0, 4, 4, 0]}
                    fill="rgba(43, 127, 255, 0.4)"
                    stroke="rgb(43, 127, 255)"
                    strokeWidth={2}
                  >
                    <LabelList dataKey="totalServicos" position="right" className="fill-foreground" fontSize={12} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
          </ChartCard>

          {/* OS por status (muda orientação só no mobile) */}
          <ChartCard title="OS por status" description="Distribuição atual" badge="Barras" className="md:col-span-2">
            <div className="w-full" style={{ height: isMobile ? statusChartHeight : 280 }}>
              <ChartContainer
                config={{
                  value: { label: "Quantidade de Ordens", color: "hsl(var(--chart-1))" },
                }}
                className="h-full w-full"
              >
                {isMobile ? (
                  <BarChart
                    data={statusItems}
                    layout="vertical"
                    margin={{ top: 8, right: 16, left: -20, bottom: 8 }}
                    barSize={14}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />

                    <XAxis
                      type="number"
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                      tickMargin={8}
                      stroke="hsl(var(--muted-foreground))"
                    />

                    <YAxis
                      type="category"
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                      width={120}
                      tickFormatter={encurtarStatusOS}
                      stroke="hsl(var(--muted-foreground))"
                    />

                    <ChartTooltip content={<ChartTooltipContent indicator="dashed" />} />

                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {statusItems.map((s) => (
                        <Cell key={s.name} fill="rgba(43, 127, 255, 0.3)" stroke="rgb(43, 127, 255)" strokeWidth={2} />
                      ))}
                      <LabelList dataKey="value" position="right" content={<StatusValueLabelRight />} />
                    </Bar>

                    <ChartLegend content={<ChartLegendContent />} />
                  </BarChart>
                ) : (
                  <BarChart data={statusItems} margin={{ top: 20, right: 20, left: 0, bottom: 0 }} barSize={50}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />

                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                      tickMargin={8}
                      tickFormatter={encurtarStatusOS}
                      stroke="hsl(var(--muted-foreground))"
                    />

                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                      tickMargin={8}
                      stroke="hsl(var(--muted-foreground))"
                    />

                    <ChartTooltip content={<ChartTooltipContent indicator="dashed" />} />

                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {statusItems.map((s) => (
                        <Cell key={s.name} fill="rgba(43, 127, 255, 0.3)" stroke="rgb(43, 127, 255)" strokeWidth={2} />
                      ))}
                      <LabelList dataKey="value" position="top" content={<StatusValueLabelTop />} />
                    </Bar>

                    <ChartLegend content={<ChartLegendContent />} />
                  </BarChart>
                )}
              </ChartContainer>
            </div>
          </ChartCard>

          {/* Prioridade (pizza) - mantém exatamente as cores originais (azul) */}
          <ChartCard
            title="Prioridade das OS"
            description="Carga por nível"
            badge="Pizza"
            className="md:col-span-2 xl:col-span-1"
          >
            <ChartContainer
              config={Object.fromEntries(prioItems.map((p) => [p.key, { label: p.key, color: p.color }]))}
              className="w-full h-52 sm:h-60 md:h-72"
            >
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie
                  data={prioItems}
                  dataKey="value"
                  nameKey="key"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={4}
                  strokeWidth={2}
                >
                  {prioItems.map((p) => (
                    <Cell key={p.key} fill="rgba(43, 127, 255, 0.3)" stroke="rgb(43, 127, 255)" strokeWidth={2} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="outside"
                    className="fill-foreground"
                    fontSize={12}
                    stroke="none"
                    formatter={(label: React.ReactNode) => {
                      const v = Number(label ?? 0);
                      return v > 0 ? String(v) : "";
                    }}
                  />
                </Pie>
                <ChartLegend content={<ChartLegendContent nameKey="key" />} />
              </PieChart>
            </ChartContainer>
          </ChartCard>
        </div>

        {!loading && !error && total === 0 ? <EmptyState /> : null}
      </CardContent>
    </Card>
  );
}
