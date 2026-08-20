"use client";

import * as React from "react";
import clsx from "clsx";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

import { RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";

import type { CartaoStatusClientesProps, StatusCliente } from "../lib/types";
import { ORDEM_STATUS, ROTULO_STATUS, COR_STATUS, statusConhecido } from "../lib/status";

import { useListaInterpolada } from "../hooks/use-lista-interpolada";
import { useContadorStatusClientes } from "../hooks/use-contador-status-clientes";

export function CartaoStatusClientes({
  className,
  endpoint = "/api/dashboard/clientes/status-counter",
  autoRefreshMs,
}: CartaoStatusClientesProps) {
  const { dados, carregando, erro, recarregar } = useContadorStatusClientes(endpoint, autoRefreshMs);

  const contagens = dados.countsByStatus ?? { ATIVO: 0, INATIVO: 0, PENDENTE: 0 };

  const series = (ORDEM_STATUS.concat(["NULL"]) as StatusCliente[])
    .map((chave) => ({
      key: chave,
      name: ROTULO_STATUS[chave],
      value: (contagens as any)[chave] ?? 0,
      fill: COR_STATUS[chave],
    }))
    .filter((s) => s.value > 0 || statusConhecido(s.key));

  const alvo = series.map((s) => s.value);
  const valoresInterpolados = useListaInterpolada(alvo, { duracao: 600, dependencias: [series.length] });

  const seriesAnimada = series.map((s, i) => ({ ...s, value: Math.round(valoresInterpolados[i] ?? 0) }));
  const tudoZero = seriesAnimada.every((s) => s.value === 0);

  return (
    <Card className={clsx("dashboard-root w-full py-2", className)}>
      <CardHeader className="flex flex-col items-start justify-between gap-3 px-3 py-3 sm:flex-row sm:px-4 sm:py-4">
        <div>
          <CardTitle className="text-base sm:text-lg">Status dos Clientes</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Distribuição por status da base</CardDescription>
        </div>

        <div className="flex items-center gap-2">
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
            className={cn("h-8 w-8 sm:h-9 sm:w-9", carregando && "cursor-wait")}
          >
            <RefreshCcw className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", carregando && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 sm:px-4 sm:pb-4">
        {erro && !carregando && (
          <div className="mb-3 rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs sm:p-3 sm:text-sm">
            Erro ao carregar: <span className="font-medium">{erro}</span>
          </div>
        )}

        <div className={clsx("grid grid-cols-1 gap-3 sm:grid-cols-2", carregando && "opacity-80")}>
          <ChartContainer
            config={{
              ATIVO: { label: ROTULO_STATUS["ATIVO"], color: COR_STATUS["ATIVO"] },
              PENDENTE: { label: ROTULO_STATUS["PENDENTE"], color: COR_STATUS["PENDENTE"] },
              INATIVO: { label: ROTULO_STATUS["INATIVO"], color: COR_STATUS["INATIVO"] },
              NULL: { label: ROTULO_STATUS["NULL"], color: COR_STATUS["NULL"] },
            }}
            className="h-44 w-full text-primary/30 sm:h-56"
          >
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} />
              <Pie data={seriesAnimada} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="76%" paddingAngle={4} strokeWidth={2} isAnimationActive={false}>
                {seriesAnimada.map((s) => (
                  <Cell key={s.key} fill={s.fill} stroke="oklch(0.623 0.214 259.815)" />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>

          <div className="grid grid-cols-2 gap-2 self-center sm:grid-cols-3">
            {seriesAnimada.map((s) => (
              <div key={s.key} className="dashboard-kpi min-w-0 p-2.5 sm:p-3">
                <div className="truncate text-[10px] text-muted-foreground" title={s.name}>{s.name}</div>
                <div className="text-lg font-semibold">{s.value}</div>
                <div className="mt-1 h-1.5 w-full rounded-full" style={{ background: s.fill }} />
              </div>
            ))}

            {tudoZero && (
              <div className="col-span-2 sm:col-span-3 text-center text-xs text-muted-foreground">
                Ainda não há clientes cadastrados.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
