"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  PackageCheck,
  PackageMinus,
  PackageX,
  RefreshCcw,
  Tags,
} from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ProdutoResumo = {
  id: number;
  titulo: string;
  referencia: string | null;
  estoque: number;
  minimo: number;
  custo: number;
  valor: number;
  reposicaoSugerida: number;
};

type DadosEstoque = {
  totais: {
    produtos: number;
    unidades: number;
    valorEstoque: number;
    zerados: number;
    abaixoMinimo: number;
    adequados: number;
    semCusto: number;
  };
  distribuicao: Array<{ nome: string; valor: number; cor: string }>;
  reposicao: ProdutoResumo[];
  maiorValor: ProdutoResumo[];
};

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function KpiEstoque({
  rotulo,
  valor,
  Icone,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  Icone: React.ComponentType<{ className?: string }>;
  alerta?: boolean;
}) {
  return (
    <div className={cn("dashboard-kpi min-h-24 p-3.5", alerta && "bg-red-500/8")}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{rotulo}</p>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary", alerta && "bg-red-500/12 text-red-500")}>
          <Icone className="size-4" />
        </span>
      </div>
      <p className={cn("mt-2 text-xl font-semibold tracking-tight xl:text-2xl", alerta && "text-red-500")}>{valor}</p>
    </div>
  );
}

export default function DashboardEstoque() {
  const [dados, setDados] = React.useState<DadosEstoque | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const response = await fetch("/api/dashboard/estoque", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar o estoque.");
      setDados(json);
    } catch (error: any) {
      setErro(error?.message || "Falha ao carregar o estoque.");
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <Card className="dashboard-root w-full">
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-5" />
            Dashboard de Estoque
          </CardTitle>
          <CardDescription>Visão de disponibilidade, reposição e capital imobilizado em produtos.</CardDescription>
          <Badge>Posição atual</Badge>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/estoque">Abrir estoque</Link></Button>
          <Button variant="outline" size="icon" onClick={carregar} aria-label="Atualizar estoque">
            <RefreshCcw className={cn("size-4", carregando && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-3 pb-3 sm:px-4 sm:pb-4">
        {erro ? <div className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{erro}</div> : null}

        {!dados && carregando ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
          </div>
        ) : dados ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
              <KpiEstoque rotulo="Produtos cadastrados" valor={numero.format(dados.totais.produtos)} Icone={Tags} />
              <KpiEstoque rotulo="Unidades disponíveis" valor={numero.format(dados.totais.unidades)} Icone={Boxes} />
              <KpiEstoque rotulo="Valor em estoque" valor={moeda.format(dados.totais.valorEstoque)} Icone={CircleDollarSign} />
              <KpiEstoque rotulo="Produtos zerados" valor={numero.format(dados.totais.zerados)} Icone={PackageX} alerta={dados.totais.zerados > 0} />
              <KpiEstoque rotulo="Abaixo do mínimo" valor={numero.format(dados.totais.abaixoMinimo)} Icone={PackageMinus} alerta={dados.totais.abaixoMinimo > 0} />
              <KpiEstoque rotulo="Sem custo cadastrado" valor={numero.format(dados.totais.semCusto)} Icone={AlertTriangle} alerta={dados.totais.semCusto > 0} />
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-5">
              <section className="dashboard-surface p-4 lg:col-span-2">
                <div className="mb-2">
                  <h3 className="font-semibold">Saúde do estoque</h3>
                  <p className="text-xs text-muted-foreground">Distribuição dos produtos por disponibilidade.</p>
                </div>
                <ChartContainer
                  config={{ valor: { label: "Produtos" } }}
                  className="mx-auto h-72 w-full"
                >
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="nome" />} />
                    <Pie data={dados.distribuicao} dataKey="valor" nameKey="nome" innerRadius="55%" outerRadius="80%" paddingAngle={4}>
                      {dados.distribuicao.map((item) => <Cell key={item.nome} fill={item.cor} />)}
                    </Pie>
                    <ChartLegend content={<ChartLegendContent nameKey="nome" />} />
                  </PieChart>
                </ChartContainer>
              </section>

              <section className="dashboard-surface p-4 lg:col-span-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Prioridades de reposição</h3>
                    <p className="text-xs text-muted-foreground">Produtos zerados ou no limite do estoque mínimo.</p>
                  </div>
                  <PackageCheck className="size-5 text-emerald-500" />
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-1">
                  {dados.reposicao.length ? dados.reposicao.map((produto) => (
                    <div key={produto.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-2xl bg-muted/35 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{produto.titulo}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{produto.referencia ? `Ref. ${produto.referencia}` : `Produto #${produto.id}`}</p>
                      </div>
                      <div className="text-right">
                        <p className={cn("text-sm font-semibold", produto.estoque <= 0 && "text-red-500")}>{numero.format(produto.estoque)}</p>
                        <p className="text-[10px] text-muted-foreground">mín. {numero.format(produto.minimo)}</p>
                      </div>
                      <Badge variant={produto.estoque <= 0 ? "destructive" : "secondary"}>
                        {produto.estoque <= 0 ? "Zerado" : "Baixo"}
                      </Badge>
                    </div>
                  )) : <p className="py-16 text-center text-sm text-muted-foreground">Nenhum produto exige reposição.</p>}
                </div>
              </section>
            </div>

            <section className="dashboard-surface p-4">
              <div className="mb-3">
                <h3 className="font-semibold">Maior valor imobilizado</h3>
                <p className="text-xs text-muted-foreground">Produtos com maior valor de custo atualmente armazenado.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {dados.maiorValor.map((produto, index) => (
                  <div key={produto.id} className="rounded-2xl bg-muted/35 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                      <p className="text-sm font-semibold">{moeda.format(produto.valor)}</p>
                    </div>
                    <p className="mt-3 truncate text-sm font-medium">{produto.titulo}</p>
                    <p className="text-[11px] text-muted-foreground">{numero.format(produto.estoque)} un. × {moeda.format(produto.custo)}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
