"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Customer } from "../../types";
import { formatCpfCnpj } from "./utils";

type VendaCliente = {
  id: number;
  status: string;
  valorTotal: number;
  dataVenda: string;
  formaPagamento: string | null;
  valorFrete: number;
  quantidadeItens: number;
};

type SituacaoTitulo =
  | "A_VENCER"
  | "VENCE_HOJE"
  | "VENCIDO"
  | "PAGO_A_VISTA"
  | "PAGO_EM_DIA"
  | "PAGO_EM_ATRASO";

type TituloFinanceiro = {
  id: number;
  valor: number;
  vencimentoEm: string;
  pagoEm: string | null;
  diasAtraso: number;
  nota: number | null;
  situacao: SituacaoTitulo;
  ordemServicoId: number | null;
  vendaId: number | null;
  metodoPagamento: string | null;
};

type ResumoFinanceiro = {
  score: number | null;
  scoreBase: number | null;
  tetoAplicado: number | null;
  maiorAtrasoEmAberto: number | null;
  classificacao: "EXCELENTE" | "BOM" | "ATENCAO" | "CRITICO" | "SEM_HISTORICO";
  totalEmAberto: number;
  totalVencido: number;
  totalAVencer: number;
  totalRecebido: number;
  quantidadeEmAberto: number;
  quantidadeVencida: number;
  quantidadeAvaliada: number;
  percentualPagoEmDia: number | null;
  mediaDiasAtraso: number | null;
  titulos: TituloFinanceiro[];
  quantidadeTitulosExibidos: number;
  quantidadeTitulos: number;
};

type RelacionamentoClienteResponse = {
  data: {
    cliente: { id: number; nome: string; cpfCnpj: string };
    vendas: VendaCliente[];
    financeiro: ResumoFinanceiro;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
};

type CustomerRelationshipTabsProps = {
  customer: Customer;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatarData(valor: string | null) {
  if (!valor) return "—";
  const normalizado = /^\d{4}-\d{2}-\d{2}$/.test(valor)
    ? `${valor}T12:00:00-03:00`
    : valor;
  const data = new Date(normalizado);
  return Number.isNaN(data.getTime()) ? "—" : dataCurta.format(data);
}

function timestampData(valor: string | null) {
  if (!valor) return 0;
  const timestamp = new Date(valor).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function textoEnum(valor: string | null) {
  if (!valor) return "Não informado";
  return valor
    .toLocaleLowerCase("pt-BR")
    .replaceAll("_", " ")
    .replace(/(^|\s)\p{L}/gu, (letra) => letra.toLocaleUpperCase("pt-BR"));
}

function statusVenda(status: string) {
  const normalizado = status.toUpperCase();
  if (["PAGO", "FINALIZADA", "CONCLUIDA"].includes(normalizado)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (["CANCELADA", "CANCELADO"].includes(normalizado)) {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  }
  if (["PAGAMENTO", "PENDENTE"].includes(normalizado)) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

const classesScore = {
  EXCELENTE: {
    cor: "text-emerald-600 dark:text-emerald-400",
    fundo: "bg-emerald-50 dark:bg-emerald-950/30",
    texto: "Excelente",
  },
  BOM: {
    cor: "text-sky-600 dark:text-sky-400",
    fundo: "bg-sky-50 dark:bg-sky-950/30",
    texto: "Bom",
  },
  ATENCAO: {
    cor: "text-amber-600 dark:text-amber-400",
    fundo: "bg-amber-50 dark:bg-amber-950/30",
    texto: "Atenção",
  },
  CRITICO: {
    cor: "text-red-600 dark:text-red-400",
    fundo: "bg-red-50 dark:bg-red-950/30",
    texto: "Crítico",
  },
  SEM_HISTORICO: {
    cor: "text-muted-foreground",
    fundo: "bg-muted/50",
    texto: "Sem histórico",
  },
} as const;

/**
 * Explica por que o número exibido é menor que o histórico. Sem isso, um cliente
 * com histórico ótimo e um título vencido mostra 39 sem justificativa aparente.
 */
function AvisoTeto({ resumo }: { resumo: ResumoFinanceiro }) {
  if (resumo.tetoAplicado == null) return null;

  const grave = resumo.tetoAplicado <= 39;
  const dias = resumo.maiorAtrasoEmAberto ?? 0;

  return (
    <p
      className={cn(
        "mt-3 rounded-lg border px-3 py-2 text-center text-xs leading-relaxed",
        grave
          ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
      )}
    >
      Limitado a <strong className="font-semibold tabular-nums">{resumo.tetoAplicado}</strong> por
      título vencido há {dias} dia{dias === 1 ? "" : "s"}. Só pelo histórico seria{" "}
      <strong className="font-semibold tabular-nums">{resumo.scoreBase}</strong>.
    </p>
  );
}

function ScoreCircular({ resumo }: { resumo: ResumoFinanceiro }) {
  const estilo = classesScore[resumo.classificacao];
  const score = resumo.score ?? 0;
  const raio = 47;
  const circunferencia = 2 * Math.PI * raio;
  const deslocamento = circunferencia * (1 - score / 100);

  return (
    <div className={cn("flex flex-col items-center rounded-xl p-4", estilo.fundo)}>
      <div
        className="relative size-32"
        role="progressbar"
        aria-label={
          resumo.score == null
            ? "Score ainda sem histórico"
            : resumo.tetoAplicado != null
              ? `Score ${resumo.score} de 100, limitado por título vencido em aberto`
              : `Score ${resumo.score} de 100`
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={resumo.score ?? undefined}
      >
        <svg className="size-full" viewBox="0 0 120 120" aria-hidden="true">
          <g transform="rotate(-90 60 60)">
            <circle
              className="text-border"
              cx="60"
              cy="60"
              r={raio}
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
            />
            {resumo.score != null && (
              <circle
                className={cn(
                  "transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none",
                  estilo.cor,
                )}
                cx="60"
                cy="60"
                r={raio}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="10"
                strokeDasharray={circunferencia}
                strokeDashoffset={deslocamento}
              />
            )}
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-3xl font-semibold tabular-nums", estilo.cor)}>
            {resumo.score ?? "—"}
          </span>
          <span className="text-xs text-muted-foreground">de 100</span>
        </div>
      </div>
      <p className={cn("mt-2 text-sm font-semibold", estilo.cor)}>{estilo.texto}</p>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        {resumo.quantidadeAvaliada > 0
          ? `${resumo.quantidadeAvaliada} título${resumo.quantidadeAvaliada === 1 ? "" : "s"} avaliado${resumo.quantidadeAvaliada === 1 ? "" : "s"}`
          : "Ainda não há recebimentos nem títulos vencidos para avaliar"}
      </p>
      <AvisoTeto resumo={resumo} />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-label="Carregando dados do cliente">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

function ErrorState({ retry }: { retry: () => void }) {
  return (
    <div
      className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50/60 p-6 text-center dark:border-red-900 dark:bg-red-950/20"
      role="alert"
    >
      <AlertCircle className="size-7 text-red-600 dark:text-red-400" aria-hidden="true" />
      <p className="mt-3 font-medium">Não foi possível carregar os dados do cliente</p>
      <p className="mt-1 text-sm text-muted-foreground">Tente novamente em alguns instantes.</p>
      <Button type="button" variant="outline" className="mt-4 min-h-11" onClick={retry}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  );
}

function VendasContent({
  vendas,
  total,
  hasNextPage,
  loadingMore,
  onLoadMore,
}: {
  vendas: VendaCliente[];
  total: number;
  hasNextPage: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (vendas.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
        <ShoppingBag className="size-7 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 font-medium">Nenhuma venda encontrada</p>
        <p className="mt-1 text-sm text-muted-foreground">Este cliente ainda não possui vendas registradas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Histórico de vendas</h3>
          <p className="text-sm text-muted-foreground">
            {total} venda{total === 1 ? "" : "s"} registrada{total === 1 ? "" : "s"}
          </p>
        </div>
        <Badge variant="outline" className="tabular-nums">{vendas.length} exibidas</Badge>
      </div>

      <div className="space-y-2">
        {vendas.map((venda) => (
          <article key={venda.id} className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">Venda #{venda.id}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarClock className="size-4" aria-hidden="true" />
                  {formatarData(venda.dataVenda)}
                </p>
              </div>
              <Badge variant="outline" className={statusVenda(venda.status)}>
                {textoEnum(venda.status)}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Valor total</p>
                <p className="mt-1 font-semibold tabular-nums">{moeda.format(venda.valorTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pagamento</p>
                <p className="mt-1 text-sm font-medium">{textoEnum(venda.formaPagamento)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Itens</p>
                <p className="mt-1 text-sm font-medium tabular-nums">{venda.quantidadeItens}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Frete</p>
                <p className="mt-1 text-sm font-medium tabular-nums">{moeda.format(venda.valorFrete)}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      {hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore && <RefreshCw className="size-4 animate-spin" aria-hidden="true" />}
          {loadingMore ? "Carregando…" : "Carregar mais vendas"}
        </Button>
      )}
    </div>
  );
}

function KpiCard({
  titulo,
  valor,
  detalhe,
  icon: Icon,
  className,
}: {
  titulo: string;
  valor: number;
  detalhe: string;
  icon: typeof CircleDollarSign;
  className?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <Icon className={cn("size-5 text-muted-foreground", className)} aria-hidden="true" />
      </div>
      <p className={cn("mt-3 text-xl font-semibold tabular-nums", className)}>{moeda.format(valor)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function badgeTitulo(situacao: SituacaoTitulo) {
  if (situacao === "PAGO_A_VISTA") {
    return { texto: "Pago à vista", classe: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" };
  }
  if (situacao === "PAGO_EM_DIA") {
    return { texto: "Pago em dia", classe: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" };
  }
  if (situacao === "PAGO_EM_ATRASO") {
    return { texto: "Pago em atraso", classe: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" };
  }
  if (situacao === "VENCIDO") {
    return { texto: "Vencido", classe: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" };
  }
  if (situacao === "VENCE_HOJE") {
    return { texto: "Vence hoje", classe: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" };
  }
  return { texto: "A vencer", classe: "border-border bg-muted text-muted-foreground" };
}

function FinanceiroContent({ resumo }: { resumo: ResumoFinanceiro }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <ScoreCircular resumo={resumo} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiCard
            titulo="Em aberto"
            valor={resumo.totalEmAberto}
            detalhe={`${resumo.quantidadeEmAberto} título${resumo.quantidadeEmAberto === 1 ? "" : "s"}`}
            icon={WalletCards}
          />
          <KpiCard
            titulo="Vencido"
            valor={resumo.totalVencido}
            detalhe={`${resumo.quantidadeVencida} título${resumo.quantidadeVencida === 1 ? "" : "s"} em atraso`}
            icon={AlertCircle}
            className="text-red-600 dark:text-red-400"
          />
          <KpiCard titulo="A vencer" valor={resumo.totalAVencer} detalhe="Compromissos futuros" icon={Clock3} />
          <KpiCard
            titulo="Total recebido"
            valor={resumo.totalRecebido}
            detalhe="Receitas de OS e vendas"
            icon={CheckCircle2}
            className="text-emerald-600 dark:text-emerald-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Pagamentos em dia</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {resumo.percentualPagoEmDia == null ? "—" : `${resumo.percentualPagoEmDia}%`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Somente títulos a prazo</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Média de atraso</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {resumo.mediaDiasAtraso == null
              ? "—"
              : `${resumo.mediaDiasAtraso} dia${resumo.mediaDiasAtraso === 1 ? "" : "s"}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Somente títulos a prazo</p>
        </div>
      </div>

      <aside className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20">
        <div className="flex gap-3">
          <TrendingUp className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <div>
            <p className="font-medium">Como o Score é calculado</p>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
              Entram no cálculo os recebimentos de OS e vendas já pagos e os títulos em aberto que
              já chegaram ao vencimento. Cada título começa com 100 pontos e perde 2 pontos por dia
              de atraso; o resultado é ponderado pelo valor. Pagamento à vista mantém os 100 pontos.
              Parcela ainda não vencida e não paga fica fora até o vencimento chegar.
            </p>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              <strong className="font-medium text-foreground">Enquanto houver título vencido em
              aberto</strong>, o Score não passa de 59 (Atenção) — e não passa de 39 (Crítico) se o
              atraso ultrapassar 30 dias. O histórico resume o passado; dívida em aberto é o
              presente, e o presente manda.
            </p>
          </div>
        </div>
      </aside>

      <section aria-labelledby="titulos-cliente">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="titulos-cliente" className="font-semibold">Títulos considerados</h3>
            <p className="text-sm text-muted-foreground">Recebimentos e parcelas vinculados a OS ou vendas</p>
          </div>
          <Badge variant="outline" className="tabular-nums">{resumo.quantidadeTitulos} no histórico</Badge>
        </div>

        {resumo.titulos.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <FileText className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 font-medium">Nenhum título encontrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              O Score aparecerá no primeiro recebimento de OS ou venda vinculado a este cliente.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {resumo.titulos.map((titulo) => {
              const badge = badgeTitulo(titulo.situacao);
              const origem = titulo.ordemServicoId
                ? `OS #${titulo.ordemServicoId}`
                : `Venda #${titulo.vendaId}`;

              return (
                <article key={titulo.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{origem}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Vencimento em {formatarData(titulo.vencimentoEm)}
                      </p>
                    </div>
                    <Badge variant="outline" className={badge.classe}>{badge.texto}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t pt-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Valor de face</p>
                      <p className="mt-1 font-semibold tabular-nums">{moeda.format(titulo.valor)}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p>{textoEnum(titulo.metodoPagamento)}</p>
                      {titulo.diasAtraso > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {titulo.diasAtraso} dia{titulo.diasAtraso === 1 ? "" : "s"} de atraso
                          {titulo.nota != null ? ` · Nota ${titulo.nota}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
            {resumo.quantidadeTitulos > resumo.quantidadeTitulosExibidos && (
              <p className="pt-1 text-center text-xs text-muted-foreground">
                Exibindo os {resumo.quantidadeTitulosExibidos} títulos mais recentes de {resumo.quantidadeTitulos}.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CustomerContext({ customer }: { customer: Customer }) {
  return (
    <div className="mb-4 flex min-w-0 items-center gap-3 rounded-xl border bg-muted/35 px-4 py-3">
      <span className="rounded-full bg-background p-2 shadow-xs">
        <CircleDollarSign className="size-5 text-primary" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" title={customer.nomerazaosocial}>
          {customer.nomerazaosocial}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatCpfCnpj(customer.cpfcnpj, customer.tipopessoa)}
        </p>
      </div>
    </div>
  );
}

export default function CustomerRelationshipTabs({
  customer,
}: CustomerRelationshipTabsProps) {
  const [dados, setDados] = useState<RelacionamentoClienteResponse | null>(null);
  const [vendas, setVendas] = useState<VendaCliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const carregar = useCallback(async (page = 1, append = false) => {
    if (!customer.id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(false);

    try {
      const response = await fetch(
        `/api/clientes/${customer.id}/relacionamento?page=${page}&limit=20`,
        { signal: controller.signal },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Falha ao carregar os dados do cliente.");

      const resultado = body as RelacionamentoClienteResponse;
      setDados(resultado);
      setVendas((atuais) => {
        const todas = append ? [...atuais, ...resultado.data.vendas] : resultado.data.vendas;
        return [...todas].sort((a, b) => timestampData(b.dataVenda) - timestampData(a.dataVenda));
      });
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [customer.id]);

  useEffect(() => {
    setDados(null);
    setVendas([]);
    setError(false);
    abortRef.current?.abort();
  }, [customer.id]);

  useEffect(() => {
    if (customer.id && !dados && !loading && !error) {
      void carregar();
    }
  }, [carregar, customer.id, dados, error, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const carregarMais = () => {
    if (!dados?.pagination.hasNextPage || loadingMore) return;
    void carregar(dados.pagination.page + 1, true);
  };

  return (
    <>
      <TabsContent value="Vendas" className="h-full min-h-0 overflow-hidden p-0">
        <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 sm:px-6">
          <CustomerContext customer={customer} />
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState retry={() => void carregar()} />
          ) : dados ? (
            <VendasContent
              vendas={vendas}
              total={dados.pagination.total}
              hasNextPage={dados.pagination.hasNextPage}
              loadingMore={loadingMore}
              onLoadMore={carregarMais}
            />
          ) : null}
        </div>
      </TabsContent>
      <TabsContent value="Financeiro" className="h-full min-h-0 overflow-hidden p-0">
        <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 sm:px-6">
            <CustomerContext customer={customer} />
            {loading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState retry={() => void carregar()} />
            ) : dados ? (
              <FinanceiroContent resumo={dados.data.financeiro} />
            ) : null}
        </div>
      </TabsContent>
    </>
  );
}
