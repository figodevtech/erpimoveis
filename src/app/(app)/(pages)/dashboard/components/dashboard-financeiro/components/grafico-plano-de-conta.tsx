"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  consolidarPorGrupo,
  montarBarras,
  type MovimentoPorPlanoDeConta,
  type NivelDoPlano,
} from "@/lib/financeiro/plano-contas/movimento-por-conta";

import ChartCard from "../../shared/chart-card";
import { COR_DESPESA, COR_RECEITA, formatarMoeda } from "../lib/constants";

const DICA_PLANO_DE_CONTA =
  "Entradas e saídas do período somadas pela conta do plano de contas do lançamento, pela data do movimento — o mesmo eixo de caixa do resto deste painel. Não é a DRE e não vai bater com ela: a DRE trabalha por competência e reconhece parcelamento e rateio, então os dois números são diferentes de propósito. Só dinheiro que passou por uma conta bancária entra; título pendente, não. Lançamento sem conta cadastrada aparece como \u201CSem plano de conta\u201D. Alterne entre grupo e conta no seletor ao lado.";

function PlanoTick(props: any) {
  const { x, y, payload } = props;
  const rotulo: string = payload?.value ?? "";
  const maxLen = 14;
  const visivel = rotulo.length > maxLen ? rotulo.slice(0, maxLen).trimEnd() + "…" : rotulo;

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={16} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
        <title>{rotulo}</title>
        {visivel}
      </text>
    </g>
  );
}

export type GraficoPlanoDeContaProps = {
  linhas: MovimentoPorPlanoDeConta[];
  /** Muda a cada recarga: reinicia a animação junto com os outros gráficos. */
  animKey: number;
  className?: string;
};

export default function GraficoPlanoDeConta({ linhas, animKey, className }: GraficoPlanoDeContaProps) {
  const [nivel, setNivel] = React.useState<NivelDoPlano>("GRUPO");

  const barras = React.useMemo(
    () => montarBarras(nivel === "GRUPO" ? consolidarPorGrupo(linhas) : linhas, nivel),
    [linhas, nivel],
  );

  // Nada é cortado: o gráfico cresce e rola na horizontal, como o de categoria.
  const larguraMinima = Math.max(640, barras.length * 120);

  return (
    <ChartCard
      title="Por plano de conta"
      description="Comparativo de receitas e despesas por conta do plano de contas"
      hint={DICA_PLANO_DE_CONTA}
      className={className}
      acoes={
        <Select value={nivel} onValueChange={(valor) => setNivel(valor as NivelDoPlano)}>
          <SelectTrigger className="h-8 w-[130px] text-xs sm:h-9" aria-label="Nível do plano de contas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GRUPO">Por grupo</SelectItem>
            <SelectItem value="CONTA">Por conta</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      {barras.length === 0 ? (
        <p className="py-12 text-center text-[11px] text-muted-foreground">
          Nenhum lançamento com movimento no período.
        </p>
      ) : (
        <div
          className="mt-1 w-full touch-pan-x overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
          role="region"
          aria-label="Gráfico de receitas e despesas por plano de conta"
          tabIndex={0}
        >
          <div className="h-64 w-full sm:h-72 md:h-80" style={{ minWidth: `${larguraMinima}px` }}>
            <ChartContainer
              config={{
                receita: { label: "Receitas", color: COR_RECEITA },
                despesa: { label: "Despesas", color: COR_DESPESA },
              }}
              className="h-full w-full"
            >
              <BarChart
                key={`plano-${nivel}-${animKey}`}
                data={barras}
                margin={{ top: 20, right: 10, left: 10, bottom: 0 }}
                barSize={40}
                barCategoryGap={32}
                barGap={12}
              >
                <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="var(--border)" opacity={0.7} />
                <XAxis
                  dataKey="rotulo"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={12}
                  interval={0}
                  height={40}
                  tick={<PlanoTick />}
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
      )}
    </ChartCard>
  );
}
