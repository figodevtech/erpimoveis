"use client";

import * as React from "react";
import {
  Activity,
  BanknoteArrowDown,
  BanknoteArrowUp,
  CalendarDays,
  ClipboardList,
  Eye,
  FileText,
  PackagePlus,
  RefreshCcw,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import ChartCard from "../dashboard-ordemservico/components/chart-card";
import Kpi from "../dashboard-ordemservico/components/kpi-ordemservico";
import { formatCurrencyBRL, formatNumber } from "../dashboard-ordemservico/lib/format";
import { OSDetalhesDialog } from "../../../ordens/components/dialogs/detalhes-os-dialog";
import { VendaDetailsDialog } from "../../../(vendas)/historicovendas/components/venda-detail-dialog";
import TransactionDialog from "../../../(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog";
import { CustomerDialog } from "../../../clientes/components/customerDialogRegister/customerDialog";
import { DialogProduto } from "../../../estoque/components/dialog-produto/dialog-produto";

type ResumoDiario = {
  periodo: { date: string; inicio: string; fim: string };
  kpis: {
    movimentacoes: number;
    receita: number;
    despesa: number;
    saldo: number;
    osCriadas: number;
    vendas: number;
    clientesNovos: number;
    agendamentos: number;
  };
  ordens: any;
  vendas: any;
  financeiro: any;
  clientes: any;
  agendamentos: any;
  estoque: any;
  fiscal: any;
};

function formatarDataYYYYMMDD(d: Date) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function formatarDataCompleta(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatarHora(value?: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatarDataHora(value?: string | null) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  const data = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${data} às ${hora}`;
}

function mapToList(map?: Record<string, number>) {
  return Object.entries(map ?? {})
    .map(([label, value]) => ({ label, value: Number(value ?? 0) }))
    .sort((a, b) => b.value - a.value);
}

function statusText(value?: string | null) {
  return String(value ?? "Não informado").replace(/_/g, " ");
}

function classificarLancamentoFinanceiro(item: any) {
  const tipo = String(item?.tipo ?? "").toUpperCase();
  const pendente = item?.pendente === true;

  if (pendente && tipo === "DESPESA") return { label: "A pagar", className: "border-red-500/40 text-red-600" };
  if (pendente && tipo === "RECEITA") return { label: "A receber", className: "border-emerald-500/40 text-emerald-600" };
  if (tipo === "DESPESA") return { label: "Despesa", className: "border-red-500/30 text-red-600" };
  if (tipo === "RECEITA") return { label: "Receita", className: "border-emerald-500/30 text-emerald-600" };

  return { label: statusText(tipo), className: "" };
}

function useResumoDiario(date: string) {
  const [data, setData] = React.useState<ResumoDiario | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetcher = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ date });
      const response = await fetch(`/api/dashboard/resumo-diario?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      setData((await response.json()) as ResumoDiario);
    } catch (err: any) {
      setError(err?.message ?? "Erro ao carregar resumo diário");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  React.useEffect(() => {
    void fetcher();
  }, [fetcher]);

  return { data, loading, error, refetch: fetcher };
}

function MiniStats({ items }: { items: Array<{ label: string; value: string | number; tone?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[11px] text-muted-foreground">{item.label}</p>
          <p className={cn("mt-1 text-lg font-semibold", item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function StatusStrip({ items }: { items: Array<{ label: string; value: number }> }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem distribuição para o dia.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item.label} variant="outline" className="gap-1">
          <span className="max-w-36 truncate">{statusText(item.label)}</span>
          <span className="font-semibold">{formatNumber(item.value)}</span>
        </Badge>
      ))}
    </div>
  );
}

function Timeline({
  items,
  empty,
  render,
}: {
  items: any[];
  empty: string;
  render: (item: any) => React.ReactNode;
}) {
  if (!items?.length) {
    return <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <div className={cn("space-y-2", items.length > 5 && "max-h-[380px] overflow-y-auto pr-1")}>
      {items.map((item, index) => (
        <div key={`${item.id ?? index}-${index}`} className="flex gap-3 rounded-lg border bg-card p-3">
          <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">{render(item)}</div>
        </div>
      ))}
    </div>
  );
}

function BotaoVisualizar({ onClick, label = "Visualizar" }: { onClick: () => void; label?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Eye className="h-3.5 w-3.5" />
    </Button>
  );
}

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon className="h-4 w-4 text-primary" />
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function ResumoDiarioDashboard() {
  const [date, setDate] = React.useState(() => formatarDataYYYYMMDD(new Date()));
  const { data, loading, error, refetch } = useResumoDiario(date);
  const [osDialogOpen, setOsDialogOpen] = React.useState(false);
  const [selectedOsId, setSelectedOsId] = React.useState<number | null>(null);
  const [vendaDialogOpen, setVendaDialogOpen] = React.useState(false);
  const [selectedVendaId, setSelectedVendaId] = React.useState<number | null>(null);
  const [transactionDialogOpen, setTransactionDialogOpen] = React.useState(false);
  const [selectedTransactionId, setSelectedTransactionId] = React.useState<number | undefined>(undefined);
  const [clienteDialogOpen, setClienteDialogOpen] = React.useState(false);
  const [selectedClienteId, setSelectedClienteId] = React.useState<number | undefined>(undefined);
  const [produtoDialogOpen, setProdutoDialogOpen] = React.useState(false);
  const [selectedProdutoId, setSelectedProdutoId] = React.useState<number | undefined>(undefined);

  function abrirOs(id: number) {
    setSelectedOsId(id);
    setOsDialogOpen(true);
  }

  function abrirVenda(id: number) {
    setSelectedVendaId(id);
    setVendaDialogOpen(true);
  }

  function abrirTransacao(id: number) {
    setSelectedTransactionId(id);
    setTransactionDialogOpen(true);
  }

  function abrirCliente(id: number) {
    setSelectedClienteId(id);
    setClienteDialogOpen(true);
  }

  function abrirProduto(id: number) {
    setSelectedProdutoId(id);
    setProdutoDialogOpen(true);
  }

  const chartData = React.useMemo(() => {
    if (!data) return [];
    return [
      { name: "OS", value: data.ordens?.criadas ?? 0, color: "hsl(221 83% 53%)" },
      { name: "Vendas", value: data.vendas?.total ?? 0, color: "hsl(142 76% 36%)" },
      { name: "Financeiro", value: data.financeiro?.transacoes ?? 0, color: "hsl(24 94% 50%)" },
      { name: "Clientes", value: data.clientes?.novos ?? 0, color: "hsl(196 100% 50%)" },
      { name: "Agenda", value: data.agendamentos?.total ?? 0, color: "hsl(262 83% 58%)" },
      {
        name: "Fiscal",
        value: (data.fiscal?.nfe ?? 0) + (data.fiscal?.nfse ?? 0),
        color: "hsl(48 96% 53%)",
      },
    ];
  }, [data]);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Resumo Diário
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Tudo que entrou e movimentou o sistema no dia selecionado.
          </CardDescription>
          <Badge variant="default" className="text-[10px] sm:text-xs">
            Dia: {formatarDataCompleta(date)}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-8 w-[150px] text-xs sm:h-9"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={refetch}
            aria-label="Atualizar resumo diário"
            className="h-8 w-8 sm:h-9 sm:w-9"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && !loading ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Erro ao carregar resumo: <span className="font-medium">{error}</span>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-72" />
          </div>
        ) : null}

        {data ? (
          <>
            <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", loading && "opacity-80")}>
              <Kpi icon={Activity} label="Movimentações" value={formatNumber(data.kpis.movimentacoes)} />
              <Kpi icon={ClipboardList} label="OS criadas" value={formatNumber(data.kpis.osCriadas)} />
              <Kpi icon={ShoppingCart} label="Vendas" value={formatNumber(data.kpis.vendas)} />
              <Kpi icon={Users} label="Clientes novos" value={formatNumber(data.kpis.clientesNovos)} />
              <Kpi className="text-green-600" icon={BanknoteArrowUp} label="Receitas" value={formatCurrencyBRL(data.kpis.receita)} />
              <Kpi className="text-red-600" icon={BanknoteArrowDown} label="Despesas" value={formatCurrencyBRL(data.kpis.despesa)} />
              <Kpi icon={Wallet} label="Saldo" value={formatCurrencyBRL(data.kpis.saldo)} />
              <Kpi icon={CalendarDays} label="Agendamentos" value={formatNumber(data.kpis.agendamentos)} />
            </div>

            <ChartCard title="Volume por categoria" description="Quantidade de registros e eventos no dia" badge="Dia">
              <ChartContainer
                config={{ value: { label: "Total", color: "hsl(var(--chart-1))" } }}
                className="h-60 w-full sm:h-72"
              >
                <BarChart data={chartData} margin={{ top: 20, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tickMargin={8} fontSize={12} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tickMargin={8} fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {chartData.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                    <LabelList dataKey="value" position="top" className="fill-foreground" fontSize={12} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </ChartCard>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Section title="Ordens de Serviço" description="OS criadas e concluídas no dia." icon={ClipboardList}>
                <MiniStats
                  items={[
                    { label: "Criadas", value: formatNumber(data.ordens.criadas) },
                    { label: "Concluídas", value: formatNumber(data.ordens.concluidas) },
                    { label: "Orçado", value: formatCurrencyBRL(data.ordens.valorOrcado) },
                  ]}
                />
                <StatusStrip items={mapToList(data.ordens.porStatus)} />
                <Timeline
                  items={data.ordens.recentes}
                  empty="Nenhuma OS criada neste dia."
                  render={(item) => (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-medium">OS #{item.id}</p>
                          <Badge variant="secondary" className="max-w-40 truncate text-[10px]">
                            {statusText(item.status)}
                          </Badge>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-xs text-muted-foreground">{formatarHora(item.horario)}</span>
                          <BotaoVisualizar label={`Visualizar OS #${item.id}`} onClick={() => abrirOs(Number(item.id))} />
                        </div>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.cliente ?? "Cliente não informado"}</p>
                      <p className="truncate text-xs">{item.veiculo ?? item.descricao ?? "Sem descrição"}</p>
                    </>
                  )}
                />
              </Section>

              <Section title="Vendas" description="Pedidos e faturamento comercial do dia." icon={ShoppingCart}>
                <MiniStats
                  items={[
                    { label: "Total", value: formatNumber(data.vendas.total) },
                    { label: "Valor", value: formatCurrencyBRL(data.vendas.valorTotal) },
                    { label: "Ticket médio", value: formatCurrencyBRL(data.vendas.ticketMedio) },
                  ]}
                />
                <StatusStrip items={mapToList(data.vendas.porStatus)} />
                <Timeline
                  items={data.vendas.recentes}
                  empty="Nenhuma venda registrada neste dia."
                  render={(item) => (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-medium">Venda #{item.id}</p>
                          <Badge variant="secondary" className="max-w-40 truncate text-[10px]">
                            {statusText(item.status)}
                          </Badge>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-xs text-muted-foreground">{formatarHora(item.horario)}</span>
                          <BotaoVisualizar
                            label={`Visualizar venda #${item.id}`}
                            onClick={() => abrirVenda(Number(item.id))}
                          />
                        </div>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.cliente ?? "Cliente não informado"}</p>
                      <p className="text-xs font-medium">{formatCurrencyBRL(item.valor)}</p>
                    </>
                  )}
                />
              </Section>

              <Section title="Financeiro" description="Entradas, saídas e pendências lançadas." icon={Wallet}>
                <MiniStats
                  items={[
                    { label: "Receitas", value: formatCurrencyBRL(data.financeiro.receitas), tone: "text-emerald-600" },
                    { label: "Despesas", value: formatCurrencyBRL(data.financeiro.despesas), tone: "text-red-600" },
                    { label: "Pendentes", value: formatCurrencyBRL(data.financeiro.receitaPendente) },
                  ]}
                />
                <StatusStrip items={mapToList(data.financeiro.porTipo)} />
                <Timeline
                  items={data.financeiro.recentes}
                  empty="Nenhuma transação registrada neste dia."
                  render={(item) => {
                    const classificacao = classificarLancamentoFinanceiro(item);

                    return (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate text-sm font-medium">{item.descricao}</p>
                            <Badge variant="outline" className={cn("shrink-0 text-[10px]", classificacao.className)}>
                              {classificacao.label}
                            </Badge>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-muted-foreground">{formatarHora(item.horario)}</span>
                            <BotaoVisualizar
                              label={`Visualizar transação #${item.id}`}
                              onClick={() => abrirTransacao(Number(item.id))}
                            />
                          </div>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.categoria ?? "Sem categoria"}
                          {item.metodo ? ` - ${item.metodo}` : ""}
                        </p>
                        <p className="text-xs font-medium">{formatCurrencyBRL(item.valor)}</p>
                      </>
                    );
                  }}
                />
              </Section>

              <Section title="Clientes" description="Novos cadastros incluídos no dia." icon={Users}>
                <MiniStats
                  items={[
                    { label: "Novos", value: formatNumber(data.clientes.novos) },
                    { label: "Cidades", value: formatNumber(data.clientes.topCidades?.length ?? 0) },
                    { label: "Ativos", value: formatNumber(data.clientes.porStatus?.ATIVO ?? 0) },
                  ]}
                />
                <StatusStrip items={mapToList(data.clientes.porStatus)} />
                <Timeline
                  items={data.clientes.recentes}
                  empty="Nenhum cliente novo neste dia."
                  render={(item) => (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{item.nome}</p>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-xs text-muted-foreground">{formatarHora(item.horario)}</span>
                          <BotaoVisualizar
                            label={`Visualizar cliente #${item.id}`}
                            onClick={() => abrirCliente(Number(item.id))}
                          />
                        </div>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.local ?? "Local não informado"}</p>
                    </>
                  )}
                />
              </Section>

              <Section title="Agendamentos" description="Agendamentos criados no dia." icon={CalendarDays}>
                <MiniStats
                  items={[
                    { label: "Criados", value: formatNumber(data.agendamentos.total) },
                    { label: "Agendados", value: formatNumber(data.agendamentos.porStatus?.AGENDADO ?? 0) },
                    { label: "Pendentes", value: formatNumber(data.agendamentos.porStatus?.PENDENTE ?? 0) },
                  ]}
                />
                <StatusStrip items={mapToList(data.agendamentos.porStatus)} />
                <Timeline
                  items={data.agendamentos.itens}
                  empty="Nenhum agendamento criado neste dia."
                  render={(item) => (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{item.titulo}</p>
                        <span className="text-xs text-muted-foreground">{formatarHora(item.horario)}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.cliente ?? "Solicitante não informado"}</p>
                      <p className="truncate text-xs">
                        Agendado para {formatarDataHora(item.inicio)}
                        {item.veiculo ? ` - ${item.veiculo}` : ""}
                      </p>
                    </>
                  )}
                />
              </Section>

              <Section title="Estoque" description="Produtos e entradas incluídos no estoque." icon={PackagePlus}>
                <MiniStats
                  items={[
                    { label: "Produtos novos", value: formatNumber(data.estoque.produtosNovos) },
                    { label: "Entradas", value: formatNumber(data.estoque.entradas) },
                    { label: "Com fiscal", value: formatNumber(data.estoque.entradasRecentes?.filter((e: any) => e.fiscal).length ?? 0) },
                  ]}
                />
                <StatusStrip items={mapToList(data.estoque.produtosPorStatus)} />
                <Timeline
                  items={[...(data.estoque.produtos ?? []), ...(data.estoque.entradasRecentes ?? [])].sort(
                    (a: any, b: any) =>
                      new Date(b.horario ?? 0).getTime() - new Date(a.horario ?? 0).getTime(),
                  )}
                  empty="Nenhum movimento de estoque neste dia."
                  render={(item) => {
                    const isProduto = Boolean(item.titulo);

                    return (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {isProduto ? `Produto #${item.id}` : `Entrada #${item.id}`}
                          </p>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-muted-foreground">{formatarHora(item.horario)}</span>
                            {isProduto ? (
                              <BotaoVisualizar
                                label={`Visualizar produto #${item.id}`}
                                onClick={() => abrirProduto(Number(item.id))}
                              />
                            ) : null}
                          </div>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.titulo ?? item.fornecedor ?? "Sem fornecedor informado"}
                        </p>
                        <p className="truncate text-xs">{item.status ? statusText(item.status) : item.tipo}</p>
                      </>
                    );
                  }}
                />
              </Section>

              <Section title="Fiscal" description="Notas emitidas ou geradas no dia." icon={FileText}>
                <MiniStats
                  items={[
                    { label: "NFe", value: formatNumber(data.fiscal.nfe) },
                    { label: "NFSe", value: formatNumber(data.fiscal.nfse) },
                    { label: "Valor", value: formatCurrencyBRL(data.fiscal.valorNfe + data.fiscal.valorNfse) },
                  ]}
                />
                <StatusStrip items={[...mapToList(data.fiscal.nfePorStatus), ...mapToList(data.fiscal.nfsePorStatus)]} />
                <Timeline
                  items={data.fiscal.recentes}
                  empty="Nenhuma nota emitida neste dia."
                  render={(item) => {
                    const fiscalTarget = item.vendaid
                      ? {
                          label: `Visualizar venda #${item.vendaid}`,
                          onClick: () => abrirVenda(Number(item.vendaid)),
                        }
                      : item.ordemservicoid
                        ? {
                            label: `Visualizar OS #${item.ordemservicoid}`,
                            onClick: () => abrirOs(Number(item.ordemservicoid)),
                          }
                        : null;

                    return (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {item.tipo} {item.numero ? `#${item.numero}` : `#${item.id}`}
                          </p>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-muted-foreground">{formatarHora(item.horario)}</span>
                            {fiscalTarget ? (
                              <BotaoVisualizar label={fiscalTarget.label} onClick={fiscalTarget.onClick} />
                            ) : null}
                          </div>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{item.origem ?? statusText(item.status)}</p>
                        <p className="text-xs font-medium">{formatCurrencyBRL(item.valor)}</p>
                      </>
                    );
                  }}
                />
              </Section>
            </div>
          </>
        ) : null}

        <OSDetalhesDialog
          open={osDialogOpen}
          onOpenChange={(open) => {
            setOsDialogOpen(open);
            if (!open) setSelectedOsId(null);
          }}
          osId={selectedOsId}
        />
        <VendaDetailsDialog
          open={vendaDialogOpen}
          onOpenChange={(open) => {
            setVendaDialogOpen(open);
            if (!open) setSelectedVendaId(null);
          }}
          vendaId={selectedVendaId}
        />
        <TransactionDialog
          open={transactionDialogOpen}
          setOpen={(open) => {
            setTransactionDialogOpen(open);
            if (!open) setSelectedTransactionId(undefined);
          }}
          selectedTransactionId={selectedTransactionId}
          setSelectedTransactionId={setSelectedTransactionId}
        >
          <span className="hidden" />
        </TransactionDialog>
        <CustomerDialog
          customerId={selectedClienteId}
          isOpen={clienteDialogOpen}
          setIsOpen={(open) => {
            setClienteDialogOpen(open);
            if (!open) setSelectedClienteId(undefined);
          }}
          setSelectedCustomerId={setSelectedClienteId}
        >
          <span className="hidden" />
        </CustomerDialog>
        <DialogProduto
          productId={selectedProdutoId}
          isOpen={produtoDialogOpen}
          setIsOpen={(open) => {
            setProdutoDialogOpen(open);
            if (!open) setSelectedProdutoId(undefined);
          }}
          setSelectedProductId={setSelectedProdutoId}
        />
      </CardContent>
    </Card>
  );
}
