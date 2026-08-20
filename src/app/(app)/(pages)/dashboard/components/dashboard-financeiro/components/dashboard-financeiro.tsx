"use client";

import * as React from "react";
import clsx from "clsx";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

import { AreaChart, Area, CartesianGrid, XAxis, YAxis, BarChart, Bar, PieChart, Pie, Cell, LabelList } from "recharts";
import { RefreshCcw, ArrowUpCircle, ArrowDownCircle, Wallet, AlertCircle, CreditCard, AlarmClock, CalendarClock, HandCoins, ReceiptText } from "lucide-react";

import { cn } from "@/lib/utils";

import { PropriedadesDashboardFinanceiro, TipoSerieFluxo, ResumoFinanceiro } from "../lib/types";
import {
  CORES_METODOS,
  COR_DESPESA,
  COR_RECEITA,
  COR_SALDO_NEGATIVO,
  COR_SALDO_POSITIVO,
  formatarMoeda,
} from "../lib/constants";
import { obterPeriodoInicial, formatarDataCompleta, formatarDataCurta } from "../lib/datas";
import { montarResumoDeLista } from "../lib/resumo";
import { useResumoFinanceiro } from "../hooks/use-resumo-financeiro";
import { SheetFinanceiroFiltros } from "./sheet-financeiro-filtros";
import { KpiFinanceiro } from "./kpi-financeiro";

function CategoriaTick(props: any) {
  const { x, y, payload } = props;
  const label: string = payload?.value ?? "";
  const maxLen = 14;
  const display = label.length > maxLen ? label.slice(0, maxLen).trimEnd() + "…" : label;

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={16} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
        <title>{label}</title>
        {display}
      </text>
    </g>
  );
}

export default function DashboardFinanceiro({
  className,
  endpoint = "/api/dashboard/financeiro",
  autoAtualizarMs,
}: PropriedadesDashboardFinanceiro) {
  const periodoInicial = React.useMemo(() => obterPeriodoInicial(), []);
  const [dataInicio, setDataInicio] = React.useState<Date | null>(periodoInicial.inicio);
  const [dataFim, setDataFim] = React.useState<Date | null>(periodoInicial.fim);
  const [filtroAberto, setFiltroAberto] = React.useState(false);
  const [tipoFluxo, setTipoFluxo] = React.useState<TipoSerieFluxo>("TODOS");
  const [metodoSelecionado, setMetodoSelecionado] = React.useState<string | null>(null);

  const { dados, transacoes, carregando, erro, recarregar, animKey } = useResumoFinanceiro(endpoint, {
    inicio: dataInicio,
    fim: dataFim,
    autoAtualizarMs,
  });

  const resumoBase = dados;

  function obterMetodoTransacao(item: any): string {
    const metodoRaw = item?.metodopagamento ?? item?.metodo_pagamento ?? item?.metodoPagamento;
    return metodoRaw ? String(metodoRaw) : "Não informado";
  }

  const resumoFiltrado: ResumoFinanceiro = React.useMemo(() => {
    if (!metodoSelecionado || !dataInicio || !dataFim) return resumoBase;
    const filtradas = transacoes.filter((t) => obterMetodoTransacao(t) === metodoSelecionado);
    return { ...montarResumoDeLista(filtradas, dataInicio, dataFim), pendencias: resumoBase.pendencias };
  }, [metodoSelecionado, transacoes, dataInicio, dataFim, resumoBase]);

  const { receita, despesa, saldo, receitaPendente } = resumoFiltrado.totais;

  const fluxo = React.useMemo(
    () =>
      (resumoFiltrado.fluxoDiario ?? []).map((ponto) => ({
        ...ponto,
        dataRotulo: formatarDataCurta(new Date(ponto.data)),
      })),
    [resumoFiltrado.fluxoDiario]
  );

  const categorias = resumoFiltrado.porCategoria ?? [];
  const metodos = resumoBase.porMetodoPagamento ?? [];
  const muitasCategorias = (resumoBase.porCategoria ?? []).length > 8;

  const saldoPositivo = saldo >= 0;
  const corSaldoLinha = saldoPositivo ? COR_SALDO_POSITIVO : COR_SALDO_NEGATIVO;

  const textoPeriodo =
    dataInicio && dataFim
      ? `${formatarDataCompleta(dataInicio)} — ${formatarDataCompleta(dataFim)}`
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
    const { inicio, fim } = obterPeriodoInicial();
    setDataInicio(inicio);
    setDataFim(fim);
    setMetodoSelecionado(null);
  }

  return (
    <Card className={clsx("dashboard-root w-full", className)}>
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
            Dashboard Financeiro
          </CardTitle>

          <CardDescription className="text-xs sm:text-sm">
            Visão geral de receitas, despesas e fluxo de caixa a partir das transações.
          </CardDescription>
          
          <Badge variant="default" className="text-[10px] sm:text-xs">
            Período: {textoPeriodo}
          </Badge>

          {metodoSelecionado && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary text-[10px] text-primary sm:text-xs">
                Filtro de método: {metodoSelecionado}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setMetodoSelecionado(null)}
              >
                Limpar filtro de método
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <SheetFinanceiroFiltros
            aberto={filtroAberto}
            aoMudarAberto={setFiltroAberto}
            dataInicio={dataInicio}
            dataFim={dataFim}
            aoMudarDataInicio={tratarDataInicio}
            aoMudarDataFim={tratarDataFim}
            aoLimpar={limparFiltros}
          />

          <div className="flex items-center gap-2">
            {autoAtualizarMs ? (
              <Badge variant="secondary" className="whitespace-nowrap text-[10px] sm:text-xs">
                Auto · {Math.round((autoAtualizarMs ?? 0) / 1000)}s
              </Badge>
            ) : null}

            <Button
              variant="outline"
              size="icon"
              onClick={recarregar}
              aria-label="Atualizar"
              className="h-8 w-8 sm:h-9 sm:w-9"
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", carregando && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-3 pb-3 sm:space-y-5 sm:px-4 sm:pb-4">
        {erro && !carregando && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/60 bg-destructive/10 p-2 text-xs sm:p-3 sm:text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              <p className="font-medium">Erro ao carregar dados financeiros</p>
              <p className="text-xs text-destructive/80">{erro}</p>
            </div>
          </div>
        )}

        <div className={clsx("grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4", carregando && "opacity-80")}>
          <KpiFinanceiro
            rotulo="Receitas"
            valor={formatarMoeda.format(receita)}
            valorNumero={receita}
            Icone={ArrowUpCircle}
            destaque="positivo"
          />
          <KpiFinanceiro
            rotulo="Despesas"
            valor={formatarMoeda.format(despesa)}
            valorNumero={despesa}
            Icone={ArrowDownCircle}
            destaque="negativo"
          />
          <KpiFinanceiro
            rotulo="Saldo do período"
            valor={formatarMoeda.format(saldo)}
            valorNumero={saldo}
            Icone={Wallet}
            destaque={saldoPositivo ? "positivo" : "negativo"}
          />
          <KpiFinanceiro
            rotulo="Receitas pendentes"
            valor={formatarMoeda.format(receitaPendente)}
            valorNumero={receitaPendente}
            Icone={CreditCard}
          />
        </div>

        <div className={clsx("grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5", carregando && "opacity-80")}>
          <KpiFinanceiro
            rotulo="Total a pagar"
            valor={formatarMoeda.format(resumoBase.pendencias.aPagar)}
            valorNumero={resumoBase.pendencias.aPagar}
            Icone={ReceiptText}
            destaque="negativo"
          />
          <KpiFinanceiro
            rotulo="A pagar vencido"
            valor={formatarMoeda.format(resumoBase.pendencias.aPagarVencido)}
            valorNumero={resumoBase.pendencias.aPagarVencido}
            Icone={AlarmClock}
            destaque="negativo"
          />
          <KpiFinanceiro
            rotulo="A pagar em 30 dias"
            valor={formatarMoeda.format(resumoBase.pendencias.aPagar30Dias)}
            valorNumero={resumoBase.pendencias.aPagar30Dias}
            Icone={CalendarClock}
          />
          <KpiFinanceiro
            rotulo="Total a receber"
            valor={formatarMoeda.format(resumoBase.pendencias.aReceber)}
            valorNumero={resumoBase.pendencias.aReceber}
            Icone={HandCoins}
            destaque="positivo"
          />
          <KpiFinanceiro
            rotulo="A receber vencido"
            valor={formatarMoeda.format(resumoBase.pendencias.aReceberVencido)}
            valorNumero={resumoBase.pendencias.aReceberVencido}
            Icone={CreditCard}
            destaque={resumoBase.pendencias.aReceberVencido > 0 ? "negativo" : undefined}
          />
        </div>

        <div className={clsx("grid grid-cols-1 gap-3 lg:grid-cols-3", carregando && "opacity-80")}>
          {/* Fluxo */}
          <div className="dashboard-surface p-3 sm:p-4 lg:col-span-3">
            <div className="mb-2 flex flex-col items-start justify-between gap-2 sm:mb-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-medium sm:text-sm">Fluxo de caixa</p>
                <p className="text-[10px] text-muted-foreground sm:text-xs">
                  Entradas, saídas e saldo acumulado por dia
                </p>
              </div>

              <Select value={tipoFluxo} onValueChange={(v) => setTipoFluxo(v as TipoSerieFluxo)}>
                <SelectTrigger className="h-8 w-[180px] text-xs sm:h-9">
                  <SelectValue placeholder="Tipo de fluxo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Entradas e saídas</SelectItem>
                  <SelectItem value="ENTRADAS">Somente entradas</SelectItem>
                  <SelectItem value="SAIDAS">Somente saídas</SelectItem>
                  <SelectItem value="SALDO">Somente saldo acumulado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ChartContainer
              config={{
                receita: { label: "Receitas (entradas)", color: COR_RECEITA },
                despesa: { label: "Despesas (saídas)", color: COR_DESPESA },
                saldoAcumulado: {
                  label: `Saldo acumulado (${saldoPositivo ? "positivo" : "negativo"})`,
                  color: corSaldoLinha,
                },
              }}
              className="h-56 w-full sm:h-64 md:h-72 lg:h-80"
            >
              <AreaChart key={`fluxo-${animKey}`} data={fluxo} margin={{ top: 12, right: 16, left: 20, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis
                  dataKey="dataRotulo"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  fontSize={11}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tickMargin={12}
                  fontSize={11}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v) => formatarMoeda.format(v).replace("R$", "").trim()}
                />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => `Dia ${label}`} />} />

                {(tipoFluxo === "TODOS" || tipoFluxo === "ENTRADAS") && (
                  <Area
                    type="monotone"
                    dataKey="receita"
                    stroke={COR_RECEITA}
                    fill="hsl(142 76% 36% / 0.12)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                  />
                )}
                {(tipoFluxo === "TODOS" || tipoFluxo === "SAIDAS") && (
                  <Area
                    type="monotone"
                    dataKey="despesa"
                    stroke={COR_DESPESA}
                    fill="hsl(0 72% 51% / 0.10)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                  />
                )}
                {(tipoFluxo === "TODOS" || tipoFluxo === "SALDO") && (
                  <Area
                    type="monotone"
                    dataKey="saldoAcumulado"
                    stroke={corSaldoLinha}
                    fill="transparent"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                  />
                )}
              </AreaChart>
            </ChartContainer>
          </div>

          {/* Categorias */}
          <div
            className={clsx(
              "dashboard-surface p-3 sm:p-4",
              muitasCategorias ? "lg:col-span-3" : "lg:col-span-2"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
              <div>
                <p className="text-xs font-medium sm:text-sm">Por categoria</p>
                <p className="text-[10px] text-muted-foreground sm:text-xs">
                  Comparativo de receitas e despesas por categoria
                </p>
              </div>
            </div>

            <div className="mt-1 w-full overflow-x-auto">
              <div className={clsx("h-64 sm:h-72 md:h-80", muitasCategorias && "min-w-[640px]")}>
                <ChartContainer
                  config={{
                    receita: { label: "Receitas", color: COR_RECEITA },
                    despesa: { label: "Despesas", color: COR_DESPESA },
                  }}
                  className="h-full w-full"
                >
                  <BarChart
                    key={`cat-${animKey}`}
                    data={categorias}
                    margin={{ top: 20, right: 10, left: 10, bottom: 0 }}
                    barSize={40}
                    barCategoryGap={32}
                    barGap={12}
                  >
                    <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="hsl(var(--border))" opacity={0.55} />
                    <XAxis
                      dataKey="categoria"
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                      interval={0}
                      height={40}
                      tick={<CategoriaTick />}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                      fontSize={11}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v) => formatarMoeda.format(v).replace("R$", "").trim()}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />

                    <Bar dataKey="receita" stroke={COR_RECEITA} fill={COR_RECEITA} radius={[4, 4, 0, 0]}>
                      <LabelList
                        dataKey="receita"
                        position="top"
                        fontSize={12}
                        formatter={(v: number) => (v > 0 ? formatarMoeda.format(v).replace("R$", "").trim() : "")}
                      />
                    </Bar>
                    <Bar dataKey="despesa" stroke={COR_DESPESA} fill={COR_DESPESA} radius={[4, 4, 0, 0]}>
                      <LabelList
                        dataKey="despesa"
                        position="top"
                        fontSize={12}
                        formatter={(v: number) => (v > 0 ? formatarMoeda.format(v).replace("R$", "").trim() : "")}
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            </div>
          </div>

          {/* Métodos */}
          <div
            className={clsx(
              "dashboard-surface p-3 sm:p-4",
              muitasCategorias ? "lg:col-span-3" : "lg:col-span-1"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
              <div>
                <p className="text-xs font-medium sm:text-sm">Métodos de pagamento</p>
                <p className="text-[10px] text-muted-foreground sm:text-xs">Distribuição de receitas por método</p>
              </div>
            </div>

            <ChartContainer
              config={{ valor: { label: "Valor", color: "hsl(221 83% 53%)" } }}
              className={clsx("w-full", muitasCategorias ? "h-56 sm:h-60 md:h-64" : "h-52 sm:h-60 md:h-64")}
            >
              <PieChart key={`metodos-${animKey}`}>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(label) => String(label)}
                      formatter={(valor) => formatarMoeda.format(Number(valor ?? 0))}
                    />
                  }
                />
                <Pie
                  data={metodos}
                  dataKey="valor"
                  nameKey="metodo"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={3}
                  strokeWidth={2}
                  isAnimationActive
                  onClick={(_, index: number) => {
                    const metodo = metodos[index]?.metodo;
                    if (!metodo) return;
                    setMetodoSelecionado((prev) => (prev === metodo ? null : metodo));
                  }}
                >
                  {metodos.map((entrada, indice) => {
                    const metodo = entrada.metodo;
                    const selecionado = metodoSelecionado === metodo;
                    const filtroAtivo = !!metodoSelecionado;

                    return (
                      <Cell
                        key={metodo ?? indice}
                        fill={CORES_METODOS[indice % CORES_METODOS.length]}
                        stroke={selecionado ? "hsl(var(--primary))" : "hsl(var(--border))"}
                        strokeWidth={selecionado ? 2 : 1}
                        opacity={!filtroAtivo || selecionado ? 1 : 0.4}
                        className="cursor-pointer transition-all"
                      />
                    );
                  })}
                  <LabelList
                    dataKey="valor"
                    position="outside"
                    fontSize={12}
                    formatter={(v: number) => (v > 0 ? formatarMoeda.format(v).replace("R$", "").trim() : "")}
                    className="fill-foreground"
                  />
                </Pie>
              </PieChart>
            </ChartContainer>

            <div className="mt-2 space-y-1.5">
              {metodos.slice(0, 4).map((m) => {
                const selecionado = metodoSelecionado === m.metodo;
                const filtroAtivo = !!metodoSelecionado;

                return (
                  <button
                    key={m.metodo}
                    type="button"
                    onClick={() => setMetodoSelecionado((prev) => (prev === m.metodo ? null : m.metodo))}
                    className={cn(
                      "flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-xs transition-colors",
                      "hover:bg-muted/60",
                      filtroAtivo && !selecionado && "opacity-60",
                      selecionado && "bg-primary/10 text-primary"
                    )}
                  >
                    <span className="truncate text-muted-foreground">{m.metodo}</span>
                    <span className="font-medium">{formatarMoeda.format(m.valor)}</span>
                  </button>
                );
              })}
              {metodos.length === 0 && (
                <p className="text-center text-[11px] text-muted-foreground">Ainda não há lançamentos no período.</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
