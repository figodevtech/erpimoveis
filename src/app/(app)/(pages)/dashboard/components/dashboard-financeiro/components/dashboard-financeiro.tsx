"use client";

import * as React from "react";
import clsx from "clsx";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

import { AreaChart, Area, CartesianGrid, XAxis, YAxis, BarChart, Bar, LabelList } from "recharts";
import { RefreshCcw, ArrowUpCircle, ArrowDownCircle, Wallet, AlertCircle, CreditCard, AlarmClock, HandCoins, ReceiptText } from "lucide-react";

import { cn } from "@/lib/utils";

import { PropriedadesDashboardFinanceiro, TipoSerieFluxo, ResumoFinanceiro } from "../lib/types";
import {
  COR_DESPESA,
  COR_RECEITA,
  COR_SALDO_NEGATIVO,
  COR_SALDO_POSITIVO,
  formatarMoeda,
} from "../lib/constants";
import { obterPeriodoInicial, formatarDataCompleta, formatarDataCurta } from "../lib/datas";
import { montarResumoDeLista } from "../lib/resumo";
import { useResumoFinanceiro } from "../hooks/use-resumo-financeiro";
import CabecalhoSecao from "../../shared/cabecalho-secao";
import ChartCard from "../../shared/chart-card";
import FaixaKpis from "../../shared/faixa-kpis";
import Kpi from "../../shared/kpi";
import PresetsPeriodo from "../../shared/presets-periodo";
import type { PeriodoDashboard } from "../../shared/periodo";
import { SheetFinanceiroFiltros } from "./sheet-financeiro-filtros";
import GraficoPlanoDeConta from "./grafico-plano-de-conta";

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

/**
 * Cada número diz de quando é. As duas faixas têm recortes de tempo
 * diferentes: a primeira segue o filtro de período, a segunda é o saldo em
 * aberto de agora e ignora o filtro.
 */
const DICAS_PERIODO = {
  receitas:
    "Entradas que passaram por uma conta bancária dentro do período, somadas pela data do movimento (fuso de Fortaleza). Conta lançamento de Receita e de Depósito, pelo valor líquido — bruto menos descontos. Título ainda pendente não entra: ele só vira receita quando é baixado. Título quitado por adiantamento fica sem banco e não é somado de novo, porque o dinheiro já entrou no lançamento do adiantamento.",
  despesas:
    "Saídas que passaram por uma conta bancária dentro do período, somadas pela data do movimento. Conta lançamento de Despesa e de Saque, pelo valor líquido — bruto menos descontos. Conta a pagar ainda pendente não entra: só quando é paga.",
  saldo:
    "Receitas menos Despesas do período. É caixa, não lucro: mede o que entrou menos o que saiu das contas no recorte escolhido. Não considera competência, não desconta o que ainda está a pagar, nem soma o que ainda está a receber.",
  receitasPendentes:
    "Títulos a receber com vencimento dentro do período que ainda não foram baixados, pelo saldo em aberto — valor do título menos o que já foi recebido em baixas parciais. Não entra no Saldo do período nem no gráfico de fluxo: ainda não é dinheiro em caixa. Adiantamento de cliente não conta aqui.",
} as const;

const DICAS_SITUACAO = {
  aPagar:
    "Tudo que está em aberto para pagar neste momento: contas a pagar ainda não baixadas, pelo saldo em aberto — valor menos o que já foi pago em baixas parciais. Soma todos os vencimentos, passados e futuros. Não segue o filtro de período.",
  aPagarVencido:
    "A parte do Total a pagar cujo vencimento já passou de hoje (fuso de Fortaleza). É o atraso com fornecedores neste momento. Não segue o filtro de período.",
  aReceber:
    "Tudo que está em aberto para receber neste momento: títulos a receber ainda não baixados, pelo saldo em aberto — valor menos o que já foi recebido. Soma todos os vencimentos, passados e futuros. Adiantamento de cliente não entra. Não segue o filtro de período.",
  aReceberVencido:
    "A parte do Total a receber cujo vencimento já passou de hoje. É a inadimplência de agora. Não segue o filtro de período.",
} as const;

const DICAS_GRAFICOS = {
  fluxo:
    "Entradas e saídas por dia do período, pela data do movimento, e o saldo acumulado. Só dinheiro que passou por uma conta bancária; título pendente não aparece. O saldo acumulado começa em zero no primeiro dia do período — é o resultado do recorte, não o saldo das contas.",
  categoria:
    "Soma das entradas e saídas do período pela categoria escolhida no lançamento. Lançamento sem categoria cai em “Outros”. Categoria é a etiqueta operacional; para a visão contábil, use o gráfico Por plano de conta.",
  metodos:
    "Distribuição só das entradas do período pelo método de pagamento, do maior para o menor. A barra compara com o maior método e a porcentagem é a fatia do total de entradas. Clique numa linha para filtrar o resto do painel por esse método; clique de novo para limpar.",
} as const;

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
    return {
      ...montarResumoDeLista(filtradas, dataInicio, dataFim, resumoBase.porPlanoDeConta),
      pendencias: resumoBase.pendencias,
    };
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
  // Ranking: a barra mede contra o maior método, e a porcentagem contra o total.
  const metodosOrdenados = React.useMemo(
    () => [...(resumoBase.porMetodoPagamento ?? [])].sort((a, b) => b.valor - a.valor),
    [resumoBase.porMetodoPagamento],
  );
  const maiorMetodo = metodosOrdenados[0]?.valor ?? 0;
  const totalMetodos = metodosOrdenados.reduce((soma, m) => soma + m.valor, 0);
  const linhasPlano = resumoFiltrado.porPlanoDeConta ?? [];
  const larguraMinimaGraficoCategorias = Math.max(640, categorias.length * 120);

  const saldoPositivo = saldo >= 0;
  const corSaldoLinha = saldoPositivo ? COR_SALDO_POSITIVO : COR_SALDO_NEGATIVO;

  const textoPeriodo =
    dataInicio && dataFim
      ? `${formatarDataCompleta(dataInicio)} — ${formatarDataCompleta(dataFim)}`
      : "Período não definido";

  // O filtro de método muda os números da faixa do período; sem dizer isso, o
  // gestor lê um recorte parcial como se fosse o período inteiro.
  const notaPeriodo = metodoSelecionado ? `${textoPeriodo} · só ${metodoSelecionado}` : textoPeriodo;

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

  function aplicarPeriodo(periodo: PeriodoDashboard) {
    setDataInicio(periodo.inicio);
    setDataFim(periodo.fim);
  }

  function limparFiltros() {
    aplicarPeriodo(obterPeriodoInicial());
    setMetodoSelecionado(null);
  }

  return (
    <Card className={clsx("dashboard-root w-full py-2", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex items-center gap-2 text-base leading-tight sm:text-lg">
            <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
            Dashboard Financeiro
          </CardTitle>

          <CardDescription className="hidden text-xs sm:block sm:text-sm">
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

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
          <PresetsPeriodo dataInicio={dataInicio} dataFim={dataFim} aoAplicar={aplicarPeriodo} />

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

        {/* KPIs, agrupados pelo recorte de tempo de cada número */}
        <div className="space-y-4">
          <FaixaKpis
            titulo="No período"
            nota={notaPeriodo}
            carregando={carregando}
            className="sm:grid-cols-2 lg:grid-cols-4"
          >
            <Kpi
              label="Receitas"
              value={formatarMoeda.format(receita)}
              icon={ArrowUpCircle}
              destaque="positivo"
              hint={DICAS_PERIODO.receitas}
            />
            <Kpi
              label="Despesas"
              value={formatarMoeda.format(despesa)}
              icon={ArrowDownCircle}
              destaque="negativo"
              hint={DICAS_PERIODO.despesas}
            />
            <Kpi
              label="Saldo do período"
              value={formatarMoeda.format(saldo)}
              icon={Wallet}
              destaque={saldoPositivo ? "positivo" : "negativo"}
              hint={DICAS_PERIODO.saldo}
            />
            <Kpi
              label="Receitas pendentes"
              value={formatarMoeda.format(receitaPendente)}
              icon={CreditCard}
              hint={DICAS_PERIODO.receitasPendentes}
            />
          </FaixaKpis>

          <FaixaKpis
            titulo="Situação atual"
            nota="não segue o filtro de período — é o saldo em aberto de agora"
            carregando={carregando}
            className="sm:grid-cols-2 lg:grid-cols-4"
          >
            <Kpi
              label="Total a pagar"
              value={formatarMoeda.format(resumoBase.pendencias.aPagar)}
              icon={ReceiptText}
              destaque="negativo"
              hint={DICAS_SITUACAO.aPagar}
            />
            <Kpi
              label="A pagar vencido"
              value={formatarMoeda.format(resumoBase.pendencias.aPagarVencido)}
              icon={AlarmClock}
              destaque="negativo"
              hint={DICAS_SITUACAO.aPagarVencido}
            />
            <Kpi
              label="Total a receber"
              value={formatarMoeda.format(resumoBase.pendencias.aReceber)}
              icon={HandCoins}
              destaque="positivo"
              hint={DICAS_SITUACAO.aReceber}
            />
            <Kpi
              label="A receber vencido"
              value={formatarMoeda.format(resumoBase.pendencias.aReceberVencido)}
              icon={CreditCard}
              destaque={resumoBase.pendencias.aReceberVencido > 0 ? "negativo" : undefined}
              hint={DICAS_SITUACAO.aReceberVencido}
            />
          </FaixaKpis>
        </div>

        {/* Os quatro gráficos saem da mesma consulta recortada pelo filtro. */}
        <section className="space-y-2">
          <CabecalhoSecao titulo="Gráficos" nota={notaPeriodo} />

          <div className={clsx("grid grid-cols-1 gap-3 lg:grid-cols-3", carregando && "opacity-80")}>
            {/* Fluxo */}
            <ChartCard
              title="Fluxo de caixa"
              description="Entradas, saídas e saldo acumulado por dia"
              hint={DICAS_GRAFICOS.fluxo}
              className="lg:col-span-3"
              acoes={
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
              }
            >
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
                  <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="var(--border)" opacity={0.7} />
                  <XAxis
                    dataKey="dataRotulo"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    fontSize={11}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tickMargin={12}
                    fontSize={11}
                    stroke="var(--muted-foreground)"
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
                  <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-3 gap-y-1 text-[10px] sm:text-xs" />} />
                </AreaChart>
              </ChartContainer>
            </ChartCard>

            {/* Plano de contas */}
            <GraficoPlanoDeConta linhas={linhasPlano} animKey={animKey} className="lg:col-span-3" />

            {/* Categorias */}
            <ChartCard
              title="Por categoria"
              description="Comparativo de receitas e despesas por categoria"
              hint={DICAS_GRAFICOS.categoria}
              className="lg:col-span-2"
            >
              <div
                className="mt-1 w-full touch-pan-x overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
                role="region"
                aria-label="Gráfico de receitas e despesas por categoria"
                tabIndex={0}
              >
                <div
                  className="h-64 w-full sm:h-72 md:h-80"
                  style={{ minWidth: `${larguraMinimaGraficoCategorias}px` }}
                >
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
                      <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="var(--border)" opacity={0.7} />
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
                        stroke="var(--muted-foreground)"
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
                      <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-3 gap-y-1 text-[10px] sm:text-xs" />} />
                    </BarChart>
                  </ChartContainer>
                </div>
              </div>
            </ChartCard>

            {/* Métodos */}
            <ChartCard
              title="Métodos de pagamento"
              description="Distribuição de receitas por método"
              hint={DICAS_GRAFICOS.metodos}
              className="lg:col-span-1"
            >
              {metodosOrdenados.length === 0 ? (
                <p className="py-12 text-center text-[11px] text-muted-foreground">
                  Ainda não há lançamentos no período.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {metodosOrdenados.map((m) => {
                    const selecionado = metodoSelecionado === m.metodo;
                    const filtroAtivo = !!metodoSelecionado;
                    const fatia = maiorMetodo > 0 ? (m.valor / maiorMetodo) * 100 : 0;
                    const participacao = totalMetodos > 0 ? (m.valor / totalMetodos) * 100 : 0;

                    return (
                      <li key={m.metodo}>
                        <button
                          type="button"
                          aria-pressed={selecionado}
                          onClick={() => setMetodoSelecionado((prev) => (prev === m.metodo ? null : m.metodo))}
                          title={`${m.metodo} · ${formatarMoeda.format(m.valor)} · ${participacao.toFixed(1)}% das entradas`}
                          className={cn(
                            "w-full rounded-md px-1.5 py-1 text-left transition-colors hover:cursor-pointer hover:bg-muted/60",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            filtroAtivo && !selecionado && "opacity-45",
                            selecionado && "bg-primary/10",
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate text-muted-foreground">{m.metodo}</span>
                            <span className="shrink-0 font-medium tabular-nums">
                              {formatarMoeda.format(m.valor)}
                              <span className="ml-1 font-normal text-muted-foreground">{participacao.toFixed(0)}%</span>
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${fatia}%`, backgroundColor: COR_RECEITA }}
                            />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ChartCard>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
