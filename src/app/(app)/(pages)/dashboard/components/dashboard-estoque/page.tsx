"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CircleDollarSign,
  Layers,
  PackageCheck,
  PackageMinus,
  PackageX,
  RefreshCcw,
  ShoppingCart,
  Tags,
  Trophy,
} from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import FaixaKpis from "../shared/faixa-kpis";
import Kpi from "../shared/kpi";
import PresetsPeriodo from "../shared/presets-periodo";
import SheetPeriodoFiltros from "../shared/sheet-periodo-filtros";
import { usePeriodo } from "../shared/use-periodo";
import GraficoMaisVendidos from "./components/grafico-mais-vendidos";
import { useProdutosVendidos } from "./hooks/use-produtos-vendidos";
import { TOTAIS_VAZIOS, type DadosEstoque, type ProdutoVendido } from "./lib/types";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
// Quantidade é integer no banco: fração aqui seria inventar precisão.
const unidades = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const ROTULOS_KPI_ESTOQUE = [
  "Produtos cadastrados",
  "Unidades disponíveis",
  "Valor em estoque",
  "Produtos zerados",
  "Abaixo do mínimo",
  "Sem custo cadastrado",
];

const ROTULOS_KPI_VENDIDOS = [
  "Unidades vendidas",
  "Faturamento em produtos",
  "Produtos distintos vendidos",
  "Produto campeão",
];

const NOTA_ESTOQUE = "Posição atual — não segue o filtro de período";

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
    <div className={cn("dashboard-kpi min-h-20 p-3 sm:min-h-24 sm:p-3.5", alerta && "bg-red-500/8")}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <p className="line-clamp-2 text-xs leading-tight text-muted-foreground sm:text-sm">{rotulo}</p>
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:size-8", alerta && "bg-red-500/12 text-red-500")}>
          <Icone className="size-4" />
        </span>
      </div>
      <p className={cn("mt-2 break-words text-lg font-semibold tracking-tight sm:text-xl xl:text-2xl", alerta && "text-red-500")}>{valor}</p>
    </div>
  );
}

/** Mantém os rótulos e esqueleta só os números: a faixa não muda de forma ao carregar. */
function SkeletonKpis({ rotulos }: { rotulos: string[] }) {
  return (
    <>
      {rotulos.map((rotulo) => (
        <div key={rotulo} className="dashboard-kpi min-h-20 p-3 sm:min-h-24 sm:p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-xs leading-tight text-muted-foreground sm:text-sm">{rotulo}</p>
            <Skeleton className="size-4 shrink-0 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-7 w-20 max-w-[70%]" />
        </div>
      ))}
    </>
  );
}

export default function DashboardEstoque() {
  const [dados, setDados] = React.useState<DadosEstoque | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(true);

  const {
    dataInicio,
    dataFim,
    filtroAberto,
    setFiltroAberto,
    tratarDataInicio,
    tratarDataFim,
    aplicarPeriodo,
    limparFiltros,
    textoPeriodo,
  } = usePeriodo();

  // A posição do estoque não tem eixo de tempo: trocar a data não a rebusca.
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

  const {
    dados: vendidos,
    carregando: carregandoVendidos,
    erro: erroVendidos,
    recarregar: recarregarVendidos,
    animKey,
  } = useProdutosVendidos("/api/dashboard/produtos-vendidos", { inicio: dataInicio, fim: dataFim });

  const totaisVendidos = vendidos?.totais.todas ?? TOTAIS_VAZIOS;
  // O ranking já vem ordenado por quantidade, mas não dependo disso aqui: o
  // campeão é o campeão mesmo que a ordenação do servidor mude um dia.
  const campeao = React.useMemo(
    () =>
      (vendidos?.ranking ?? []).reduce<ProdutoVendido | null>(
        (melhor, produto) => (!melhor || produto.quantidade > melhor.quantidade ? produto : melhor),
        null,
      ),
    [vendidos],
  );

  const recarregarTudo = React.useCallback(() => {
    void carregar();
    void recarregarVendidos();
  }, [carregar, recarregarVendidos]);

  const recarregando = carregando || carregandoVendidos;
  const primeiraCargaEstoque = !dados && carregando;
  const primeiraCargaVendidos = !vendidos && carregandoVendidos;

  const ticketMedio =
    totaisVendidos.quantidade > 0 ? totaisVendidos.faturamento / totaisVendidos.quantidade : 0;

  return (
    <Card className="dashboard-root w-full py-2">
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 px-3 sm:flex sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6">
        <div className="contents sm:block sm:min-w-0 sm:flex-1 sm:space-y-1">
          <CardTitle className="flex min-w-0 items-center gap-1.5 text-sm leading-tight sm:gap-2 sm:text-lg">
            <Boxes className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" aria-hidden="true" />
            <span className="truncate sm:hidden" title="Estoque">Estoque</span>
            <span className="hidden sm:inline">Dashboard Estoque</span>
          </CardTitle>

          <CardDescription className="hidden text-xs sm:block sm:text-sm">
            Disponibilidade, reposição e capital imobilizado em produtos — e o que saiu no período.
          </CardDescription>

          <Badge
            variant="default"
            className="col-start-1 row-start-2 min-w-0 max-w-full justify-self-start whitespace-normal text-[10px] sm:text-xs"
            title={`Período: ${textoPeriodo}`}
          >
            Período: {textoPeriodo}
          </Badge>
        </div>

        <div className="contents sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
          <PresetsPeriodo
            dataInicio={dataInicio}
            dataFim={dataFim}
            aoAplicar={aplicarPeriodo}
            className="col-span-2 col-start-2 row-start-1"
          />

          <SheetPeriodoFiltros
            titulo="Filtros de produtos vendidos"
            aberto={filtroAberto}
            aoMudarAberto={setFiltroAberto}
            dataInicio={dataInicio}
            dataFim={dataFim}
            aoMudarDataInicio={tratarDataInicio}
            aoMudarDataFim={tratarDataFim}
            aoLimpar={limparFiltros}
          />

          {/* Atalho de navegação: fora do grid do mobile, que já cabe só o
              período, o filtro e o refresh — os mesmos três das outras abas. */}
          <Button asChild variant="outline" size="sm" className="hidden h-8 shrink-0 sm:inline-flex">
            <Link href="/estoque">Abrir Estoque</Link>
          </Button>

          <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={recarregarTudo} aria-label="Atualizar estoque">
            <RefreshCcw className={cn("size-4", recarregando && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-3 pb-3 sm:px-4 sm:pb-4">
        {erro ? <div className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{erro}</div> : null}

        <FaixaKpis
          titulo="Estoque"
          nota={NOTA_ESTOQUE}
          carregando={carregando}
          className="sm:grid-cols-2 sm:gap-3 md:grid-cols-3 2xl:grid-cols-6"
        >
          {primeiraCargaEstoque ? (
            <SkeletonKpis rotulos={ROTULOS_KPI_ESTOQUE} />
          ) : dados ? (
            <>
              <KpiEstoque rotulo="Produtos cadastrados" valor={numero.format(dados.totais.produtos)} Icone={Tags} />
              <KpiEstoque rotulo="Unidades disponíveis" valor={numero.format(dados.totais.unidades)} Icone={Boxes} />
              <KpiEstoque rotulo="Valor em estoque" valor={moeda.format(dados.totais.valorEstoque)} Icone={CircleDollarSign} />
              <KpiEstoque rotulo="Produtos zerados" valor={numero.format(dados.totais.zerados)} Icone={PackageX} alerta={dados.totais.zerados > 0} />
              <KpiEstoque rotulo="Abaixo do mínimo" valor={numero.format(dados.totais.abaixoMinimo)} Icone={PackageMinus} alerta={dados.totais.abaixoMinimo > 0} />
              <KpiEstoque rotulo="Sem custo cadastrado" valor={numero.format(dados.totais.semCusto)} Icone={AlertTriangle} alerta={dados.totais.semCusto > 0} />
            </>
          ) : null}
        </FaixaKpis>

        <div className="space-y-4">
          <FaixaKpis
            titulo="Vendas de produtos"
            nota={textoPeriodo}
            carregando={carregandoVendidos}
            className="sm:grid-cols-2 sm:gap-3 xl:grid-cols-4"
          >
            {primeiraCargaVendidos ? (
              <SkeletonKpis rotulos={ROTULOS_KPI_VENDIDOS} />
            ) : (
              <>
                <Kpi
                  label="Unidades vendidas"
                  value={unidades.format(totaisVendidos.quantidade)}
                  icon={ShoppingCart}
                  hint={`Total de unidades de produto cobradas do cliente no período, somando venda de balcão e peça aplicada em ordem de serviço. Sai de ${unidades.format(totaisVendidos.documentos)} documentos. É o total do gráfico abaixo — e não muda quando o gráfico é filtrado por origem ou por grupo: os números desta faixa somam sempre o período inteiro.`}
                />
                <Kpi
                  label="Faturamento em produtos"
                  value={moeda.format(totaisVendidos.faturamento)}
                  icon={Banknote}
                  hint={`Valor dos itens de produto, já líquido do desconto de cada item e sem o frete. Dá um ticket médio de ${moeda.format(ticketMedio)} por unidade — uma média que mistura óleo com peça cara, então serve de referência, não de meta. O desconto geral do documento não é rateado entre os itens.`}
                />
                <Kpi
                  label="Produtos distintos vendidos"
                  value={unidades.format(totaisVendidos.produtosDistintos)}
                  icon={Layers}
                  hint="Quantos produtos diferentes do cadastro tiveram saída no período. Lido junto com as unidades, separa a oficina que gira poucos itens em volume da que gira um catálogo largo."
                />
                <Kpi
                  label="Produto campeão"
                  value={campeao?.titulo ?? "—"}
                  icon={Trophy}
                  hint={
                    campeao
                      ? `${campeao.grupoNome} · ${unidades.format(campeao.quantidade)} unidades e ${moeda.format(campeao.faturamento)} no período, em ${unidades.format(campeao.documentos)} documentos. É o primeiro do gráfico quando a ordenação é por unidades e os dois filtros estão abertos.`
                      : "Nenhum produto vendido no período."
                  }
                />
              </>
            )}
          </FaixaKpis>

          {/* Banner próprio: falha nas vendas não pode derrubar a posição do estoque. */}
          {erroVendidos ? (
            <div className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{erroVendidos}</div>
          ) : null}

          {vendidos?.truncado ? (
            <p className="text-[11px] text-muted-foreground">
              O período tem mais produtos do que o ranking comporta: a lista foi cortada nos mais vendidos.
            </p>
          ) : null}

          {primeiraCargaVendidos ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : (
            <GraficoMaisVendidos
              ranking={vendidos?.ranking ?? []}
              carregando={carregandoVendidos}
              animKey={animKey}
            />
          )}
        </div>

        {primeiraCargaEstoque ? (
          <div className="space-y-5">
            <div className="grid items-start gap-4 lg:grid-cols-5">
              <section className="dashboard-surface min-w-0 p-3 sm:p-4 lg:col-span-2">
                <h3 className="dashboard-card-title">Saúde do estoque</h3>
                <p className="dashboard-card-description">Distribuição dos produtos por disponibilidade.</p>
                <Skeleton className="mt-3 h-44 rounded-2xl sm:h-60 lg:h-64" />
              </section>
              <section className="dashboard-surface min-w-0 p-3 sm:p-4 lg:col-span-3">
                <h3 className="dashboard-card-title">Prioridades de reposição</h3>
                <p className="dashboard-card-description">Produtos zerados ou no limite do estoque mínimo.</p>
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-2xl" />)}
                </div>
              </section>
            </div>

            <section className="dashboard-surface min-w-0 p-3 sm:p-4">
              <h3 className="dashboard-card-title">Maior valor imobilizado</h3>
              <p className="dashboard-card-description">Produtos que concentram mais capital parado no estoque.</p>
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-2xl" />)}
              </div>
            </section>
          </div>
        ) : dados ? (
          <>
            <div className="grid items-start gap-4 lg:grid-cols-5">
              <section className="dashboard-surface min-w-0 p-3 sm:p-4 lg:col-span-2">
                <div className="mb-2">
                  <h3 className="dashboard-card-title">Saúde do estoque</h3>
                  <p className="dashboard-card-description">Distribuição dos produtos por disponibilidade.</p>
                </div>
                <ChartContainer
                  config={{ valor: { label: "Produtos" } }}
                  className="mx-auto h-44 w-full sm:h-60 lg:h-64"
                >
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="nome" />} />
                    <Pie data={dados.distribuicao} dataKey="valor" nameKey="nome" innerRadius="52%" outerRadius="76%" paddingAngle={4}>
                      {dados.distribuicao.map((item) => <Cell key={item.nome} fill={item.cor} />)}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-1 grid gap-1.5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  {dados.distribuicao.map((item) => (
                    <div key={item.nome} className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/35 px-2.5 py-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.cor }} />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={item.nome}>{item.nome}</span>
                      <span className="shrink-0 text-xs font-semibold">{numero.format(item.valor)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dashboard-surface min-w-0 p-3 sm:p-4 lg:col-span-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="dashboard-card-title">Prioridades de reposição</h3>
                    <p className="dashboard-card-description">Produtos zerados ou no limite do estoque mínimo.</p>
                  </div>
                  <PackageCheck className="hidden size-5 shrink-0 text-emerald-500 sm:block" />
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-1">
                  {dados.reposicao.length ? dados.reposicao.map((produto) => (
                    <div key={produto.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2 rounded-2xl bg-muted/35 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-3 sm:p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{produto.titulo}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{produto.referencia ? `Ref. ${produto.referencia}` : `Produto #${produto.id}`}</p>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className={cn("text-sm font-semibold", produto.estoque <= 0 && "text-red-500")}>{numero.format(produto.estoque)}</p>
                        <p className="text-[10px] text-muted-foreground">mín. {numero.format(produto.minimo)}</p>
                      </div>
                      <Badge variant={produto.estoque <= 0 ? "destructive" : "secondary"} className="hidden sm:inline-flex">
                        {produto.estoque <= 0 ? "Zerado" : "Baixo"}
                      </Badge>
                    </div>
                  )) : <p className="py-16 text-center text-sm text-muted-foreground">Nenhum produto exige reposição.</p>}
                </div>
              </section>
            </div>

            <section className="dashboard-surface min-w-0 p-3 sm:p-4">
              <div className="mb-3">
                <h3 className="dashboard-card-title">Maior valor imobilizado</h3>
                <p className="dashboard-card-description">Produtos com maior valor de custo atualmente armazenado.</p>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {dados.maiorValor.length ? dados.maiorValor.map((produto, index) => (
                  <div key={produto.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl bg-muted/35 p-2.5 sm:gap-3 sm:p-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" title={produto.titulo}>{produto.titulo}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{numero.format(produto.estoque)} un. × {moeda.format(produto.custo)}</p>
                    </div>
                    <p className="max-w-28 truncate text-right text-sm font-semibold sm:max-w-none" title={moeda.format(produto.valor)}>{moeda.format(produto.valor)}</p>
                  </div>
                )) : <p className="py-16 text-center text-sm text-muted-foreground">Nenhum produto com custo cadastrado.</p>}
              </div>
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
