"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import {
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  FolderTree,
  Package,
  Receipt,
  RotateCcw,
  Search,
  ShoppingCart,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { DocumentoDre, LinhaDre, PeriodoDre } from "../types";
import {
  ClassificarCadastroDialog,
  type AlvoClassificacao,
  type ContextoDaLinha,
} from "./classificar-cadastro-dialog";

/*
 * Os diálogos de documento são pesados e só abrem quando alguém clica na origem.
 * Carregar sob demanda evita que abrir a DRE baixe o formulário da OS inteiro.
 */
const OSDetalhesDialog = dynamic(
  () => import("@/app/(app)/(pages)/ordens/components/dialogs/detalhes-os-dialog").then((m) => m.OSDetalhesDialog),
  { ssr: false },
);
const VendaDetailsDialog = dynamic(
  () =>
    import("@/app/(app)/(pages)/(vendas)/historicovendas/components/venda-detail-dialog").then(
      (m) => m.VendaDetailsDialog,
    ),
  { ssr: false },
);
const EntryDetailsDialog = dynamic(
  () => import("@/app/(app)/(pages)/estoque/components/entry-details-dialog").then((m) => m.EntryDetailsDialog),
  { ssr: false },
);
const TransactionDialog = dynamic(
  () => import("@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog"),
  { ssr: false },
);

/** Mesma forma da fila de pendências: as duas telas abrem o mesmo documento. */
export type DocumentoLancamento = DocumentoDre;

/** Plano de conta de um lançamento avulso — o único caso em que a conta decide a linha. */
export type PlanoDoLancamento = {
  id: number;
  codigo: string | null;
  nome: string;
  grupo: string;
  linhaPropria: boolean;
};

export type LancamentoDre = {
  id: number;
  competenciaEm: string | null;
  origem: string | null;
  natureza: string | null;
  descricao: string;
  detalhe: string | null;
  valor: number;
  isManual: boolean;
  isEstorno: boolean;
  semCusto: boolean;
  documento: DocumentoLancamento | null;
  planoConta: PlanoDoLancamento | null;
};

type Resultado = {
  chave: string;
  items: LancamentoDre[];
  total: number;
  planosIndisponiveis: boolean;
  erro: string | null;
};

type Aba = "todos" | "sistema" | "avulsos";
type Ordem = "valor" | "data";

/** Fatia da composição: um documento de sistema, ou um plano de conta dos avulsos. */
type Fatia = {
  chave: string;
  rotulo: string;
  detalhe: string;
  plano: PlanoDoLancamento | null;
  valor: number;
  quantidade: number;
};

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

/** Cor de cada fatia, da maior para a menor. Da sexta em diante, cinza. */
const CORES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
const COR_RESTO = "bg-muted-foreground/40";
const FATIAS_INICIAIS = 4;

const DOCUMENTO: Record<DocumentoLancamento["tipo"], { rotulo: string; icone: LucideIcon }> = {
  OS: { rotulo: "OS", icone: Wrench },
  VENDA: { rotulo: "Venda", icone: ShoppingCart },
  ENTRADA: { rotulo: "Entrada", icone: Package },
  USO_CONSUMO: { rotulo: "Uso e consumo", icone: Package },
  TRANSACAO: { rotulo: "Lançamento", icone: Receipt },
};

const ehAvulso = (item: LancamentoDre) => item.documento?.tipo === "TRANSACAO";

const nomeDoPlano = (plano: PlanoDoLancamento) => [plano.codigo, plano.nome].filter(Boolean).join(" · ");

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** "2026-08-01" -> "01/08/2026", sem passar por Date: não há fuso a errar. */
const dataDoPeriodo = (iso: string) => iso.split("-").reverse().join("/");

function dataCurta(iso: string | null) {
  if (!iso) return { dia: "—", ano: "" };
  const data = new Date(iso);
  return {
    dia: data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", ""),
    ano: String(data.getFullYear()),
  };
}

/** O que o lançamento é dentro do documento: a mesma OS gera receita, custo, comissão e desconto. */
function papelNoDocumento(item: LancamentoDre) {
  const despesa = item.natureza === "DESPESA";
  switch (item.origem) {
    case "PRODUTO":
      return despesa ? "custo da peça" : "venda de peça";
    case "SERVICO":
      return despesa ? "custo do serviço" : "serviço";
    case "COMISSAO":
      return "comissão";
    case "DESCONTO":
      return "desconto";
    case "FRETE":
      return "frete";
    case "CONSUMO":
      return "material consumido";
    default:
      return null;
  }
}

function fatiaDoLancamento(item: LancamentoDre): Omit<Fatia, "valor" | "quantidade"> {
  if (item.planoConta) {
    return {
      chave: `plano:${item.planoConta.id}`,
      rotulo: nomeDoPlano(item.planoConta),
      detalhe: `Plano de conta · ${item.planoConta.grupo}`,
      plano: item.planoConta,
    };
  }
  switch (item.documento?.tipo) {
    case "TRANSACAO":
      return { chave: "avulso", rotulo: "Lançamentos do financeiro", detalhe: "Avulsos", plano: null };
    case "OS":
      return { chave: "os", rotulo: "Ordens de serviço", detalhe: "Gerado pelo sistema", plano: null };
    case "VENDA":
      return { chave: "venda", rotulo: "Vendas", detalhe: "Gerado pelo sistema", plano: null };
    case "ENTRADA":
    case "USO_CONSUMO":
      return { chave: "entrada", rotulo: "Entradas de nota", detalhe: "Gerado pelo sistema", plano: null };
    default:
      return { chave: "outros", rotulo: "Outras origens", detalhe: "Sem documento", plano: null };
  }
}

function combinaComBusca(item: LancamentoDre, termo: string) {
  const documento = item.documento ? `${DOCUMENTO[item.documento.tipo].rotulo} #${item.documento.id}` : "";
  return [item.descricao, item.detalhe, item.planoConta?.nome, item.planoConta?.codigo, documento].some(
    (campo) => !!campo && normalizar(campo).includes(termo),
  );
}

/**
 * Lançamentos que compõem uma linha da DRE, com a composição por origem, busca,
 * filtros e o atalho para mover o plano de conta de um avulso para outra linha.
 *
 * O total da lista precisa bater com o da linha: é a conferência de que o
 * detalhamento e a soma usam a mesma resolução.
 */
export function DetalheLinhaDialog({
  linha,
  periodo,
  versao,
  onFechar,
  onAlterado,
}: {
  linha: LinhaDre | null;
  periodo: PeriodoDre;
  /** Sobe quando a DRE é refeita: o detalhamento acompanha sem fechar. */
  versao: number;
  onFechar: () => void;
  /** Algo aberto daqui mudou lançamentos: a DRE precisa ser refeita. */
  onAlterado: () => void;
}) {
  return (
    <Dialog open={!!linha} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="flex h-[90vh] max-h-[56rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {linha && (
          // A chave zera busca e filtros ao trocar de linha ou de período.
          <Conteudo
            key={`${linha.id}|${periodo.de}|${periodo.ate}`}
            linha={linha}
            periodo={periodo}
            versao={versao}
            onAlterado={onAlterado}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({
  linha,
  periodo,
  versao,
  onAlterado,
}: {
  linha: LinhaDre;
  periodo: PeriodoDre;
  versao: number;
  onAlterado: () => void;
}) {
  const { data: session } = useSession();
  const podeMover = permissionSetHas((session?.user as any)?.permissoes, PERMS.CONFIG_EDITAR);

  const [tentativa, setTentativa] = useState(0);
  const chave = `${linha.id}|${periodo.de}|${periodo.ate}|${versao}|${tentativa}`;
  const [resultado, setResultado] = useState<Resultado>({
    chave: "",
    items: [],
    total: 0,
    planosIndisponiveis: false,
    erro: null,
  });

  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<Aba>("todos");
  const [fatiaAtiva, setFatiaAtiva] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<Ordem>("valor");
  const [todasFatias, setTodasFatias] = useState(false);
  const [mover, setMover] = useState<{ alvo: NonNullable<AlvoClassificacao>; contexto: ContextoDaLinha } | null>(
    null,
  );
  const [documento, setDocumento] = useState<DocumentoLancamento | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/dre/drilldown?linha=${linha.id}&de=${periodo.de}&ate=${periodo.ate}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (resposta) => {
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(corpo?.error || "Não foi possível carregar os lançamentos.");
        return corpo as { items?: LancamentoDre[]; total?: number; planosIndisponiveis?: boolean };
      })
      .then((corpo) => {
        if (controller.signal.aborted) return;
        setResultado({
          chave,
          items: corpo.items ?? [],
          total: Number(corpo.total ?? 0),
          planosIndisponiveis: corpo.planosIndisponiveis === true,
          erro: null,
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResultado((atual) => ({
          ...atual,
          chave,
          erro: e instanceof Error ? e.message : "Não foi possível carregar os lançamentos.",
        }));
      });

    return () => controller.abort();
  }, [chave, linha.id, periodo.ate, periodo.de]);

  /*
   * Primeira carga mostra esqueleto; recarga depois de mover um plano mantém a
   * lista na tela, esmaecida. Quem acabou de mover está olhando os números que
   * quer ver mudar — piscar a lista inteira esconderia justamente isso.
   */
  const primeiraCarga = resultado.chave === "";
  const carregando = resultado.chave !== chave;
  const itens = resultado.items;

  const fatias = useMemo(() => {
    const mapa = new Map<string, Fatia>();
    for (const item of itens) {
      const base = fatiaDoLancamento(item);
      const atual = mapa.get(base.chave) ?? { ...base, valor: 0, quantidade: 0 };
      atual.valor += item.valor;
      atual.quantidade += 1;
      mapa.set(base.chave, atual);
    }
    return [...mapa.values()].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  }, [itens]);

  const indiceDaFatia = useMemo(() => new Map(fatias.map((f, i) => [f.chave, i])), [fatias]);
  const corDaFatia = (chaveDaFatia: string) => CORES[indiceDaFatia.get(chaveDaFatia) ?? CORES.length] ?? COR_RESTO;
  const somaAbsoluta = fatias.reduce((soma, f) => soma + Math.abs(f.valor), 0);

  const avulsos = useMemo(() => itens.filter(ehAvulso).length, [itens]);
  const doSistema = itens.length - avulsos;

  const termo = normalizar(busca.trim());
  const visiveis = useMemo(() => {
    const filtrados = itens.filter((item) => {
      if (aba === "avulsos" && !ehAvulso(item)) return false;
      if (aba === "sistema" && ehAvulso(item)) return false;
      if (fatiaAtiva && fatiaDoLancamento(item).chave !== fatiaAtiva) return false;
      return !termo || combinaComBusca(item, termo);
    });
    return filtrados.sort((a, b) =>
      ordem === "valor"
        ? Math.abs(b.valor) - Math.abs(a.valor)
        : (b.competenciaEm ?? "").localeCompare(a.competenciaEm ?? ""),
    );
  }, [itens, aba, fatiaAtiva, termo, ordem]);

  const filtrando = aba !== "todos" || fatiaAtiva !== null || termo !== "";
  const somaVisivel = visiveis.reduce((soma, item) => soma + item.valor, 0);
  const confere = Math.abs(resultado.total - linha.valor) < 0.01;
  const mostrarComposicao = !primeiraCarga && !resultado.erro && (fatias.length > 1 || fatias.some((f) => f.plano));
  const periodoTexto = `${dataDoPeriodo(periodo.de)} a ${dataDoPeriodo(periodo.ate)}`;

  function limparFiltros() {
    setBusca("");
    setAba("todos");
    setFatiaAtiva(null);
  }

  function abrirMover(plano: PlanoDoLancamento) {
    const daConta = itens.filter((item) => item.planoConta?.id === plano.id);
    setMover({
      alvo: { tipo: "CONTA", id: plano.id, nome: nomeDoPlano(plano) },
      contexto: {
        linha: { codigo: linha.codigo, nome: linha.nome },
        periodo: periodoTexto,
        lancamentos: daConta.length,
        valor: daConta.reduce((soma, item) => soma + item.valor, 0),
        naturezas: [...new Set(daConta.map((item) => item.natureza).filter((n): n is string => !!n))],
      },
    });
  }

  return (
    <>
      <DialogHeader className="space-y-0 border-b px-5 py-4 text-left sm:px-6">
        <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground tabular-nums">
                {linha.codigo}
              </span>
              Linha da DRE
            </p>
            <DialogTitle className="mt-1.5 text-lg leading-tight">{linha.nome}</DialogTitle>
            <DialogDescription className="mt-1 flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              {periodoTexto}
            </DialogDescription>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-xs text-muted-foreground">Total no período</p>
            <p className={cn("text-2xl font-semibold tabular-nums", linha.valor < 0 && "text-destructive")}>
              {brl(linha.valor)}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {primeiraCarga ? "carregando…" : `${itens.length} lançamento(s)`}
            </p>
          </div>
        </div>
      </DialogHeader>

      {mostrarComposicao && (
        <section aria-label="De onde vem o valor" className="border-b px-5 py-4 sm:px-6">
          <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
            <h3 className="text-sm font-medium">De onde vem o valor</h3>
            {fatiaAtiva && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setFatiaAtiva(null)}>
                <X className="mr-1 size-3.5" aria-hidden />
                Limpar seleção
              </Button>
            )}
          </div>

          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            {fatias.map((fatia) => (
              <div
                key={fatia.chave}
                className={cn(
                  "h-full transition-opacity",
                  corDaFatia(fatia.chave),
                  fatiaAtiva && fatiaAtiva !== fatia.chave && "opacity-25",
                )}
                style={{ width: `${somaAbsoluta ? (Math.abs(fatia.valor) / somaAbsoluta) * 100 : 0}%` }}
              />
            ))}
          </div>

          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {(todasFatias ? fatias : fatias.slice(0, FATIAS_INICIAIS)).map((fatia) => {
              const ativa = fatiaAtiva === fatia.chave;
              return (
                <li
                  key={fatia.chave}
                  className={cn(
                    "flex min-w-0 items-stretch overflow-hidden rounded-md border bg-card transition-colors",
                    ativa && "border-primary ring-1 ring-primary/30",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setFatiaAtiva(ativa ? null : fatia.chave)}
                    aria-pressed={ativa}
                    title={ativa ? "Mostrar todos os lançamentos" : "Mostrar só estes lançamentos"}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", corDaFatia(fatia.chave))} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{fatia.rotulo}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {fatia.detalhe} · {fatia.quantidade} lanç.
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm tabular-nums">{brl(fatia.valor)}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {somaAbsoluta ? pct((Math.abs(fatia.valor) / somaAbsoluta) * 100) : "—"}
                      </span>
                    </span>
                  </button>
                  {fatia.plano && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => abrirMover(fatia.plano!)}
                          aria-label={`Mover ${fatia.rotulo} para outra linha`}
                          className="flex w-10 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        >
                          <ArrowRightLeft className="size-4" aria-hidden />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Mover este plano de conta para outra linha</TooltipContent>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>

          {fatias.length > FATIAS_INICIAIS && (
            <Button
              variant="link"
              size="sm"
              className="mt-1 h-auto px-0 text-xs"
              onClick={() => setTodasFatias((atual) => !atual)}
            >
              {todasFatias ? "Mostrar menos" : `Ver todas as ${fatias.length} origens`}
            </Button>
          )}
        </section>
      )}

      <div className="flex flex-col gap-2 border-b px-5 py-3 sm:flex-row sm:items-center sm:px-6">
        <Tabs value={aba} onValueChange={(valor) => setAba(valor as Aba)}>
          <TabsList className="h-9 w-full sm:w-auto">
            <TabsTrigger value="todos" className="flex-1 text-xs sm:flex-none">
              Todos <Contador valor={itens.length} />
            </TabsTrigger>
            <TabsTrigger value="sistema" className="flex-1 text-xs sm:flex-none" disabled={doSistema === 0}>
              Do sistema <Contador valor={doSistema} />
            </TabsTrigger>
            <TabsTrigger value="avulsos" className="flex-1 text-xs sm:flex-none" disabled={avulsos === 0}>
              Avulsos <Contador valor={avulsos} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar descrição, plano de conta, OS…"
            aria-label="Buscar lançamentos"
            className="h-9 pl-8"
          />
        </div>
        <Select value={ordem} onValueChange={(valor) => setOrdem(valor as Ordem)}>
          <SelectTrigger className="h-9 w-full sm:w-[11.5rem]" aria-label="Ordenar lançamentos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="valor">Maior valor primeiro</SelectItem>
            <SelectItem value="data">Mais recentes primeiro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {resultado.planosIndisponiveis && (
        <p className="flex items-center gap-2 border-b bg-amber-500/5 px-5 py-2 text-xs text-muted-foreground sm:px-6">
          <CircleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          Não foi possível carregar o plano de conta dos lançamentos avulsos. A lista e o total estão corretos.
        </p>
      )}

      <div
        aria-busy={carregando}
        className={cn("min-h-0 flex-1 overflow-y-auto transition-opacity", carregando && !primeiraCarga && "opacity-60")}
      >
        {resultado.erro ? (
          <EstadoVazio
            icone={CircleAlert}
            titulo="Não foi possível carregar os lançamentos"
            texto={resultado.erro}
            acao={
              <Button size="sm" variant="outline" onClick={() => setTentativa((n) => n + 1)}>
                <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                Tentar de novo
              </Button>
            }
          />
        ) : primeiraCarga ? (
          <ul className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-3 sm:px-6">
                <Skeleton className="h-9 w-12" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-4 w-20" />
              </li>
            ))}
          </ul>
        ) : itens.length === 0 ? (
          <EstadoVazio
            icone={Receipt}
            titulo="Nenhum lançamento no período"
            texto="Esta linha não recebeu valor entre as datas escolhidas."
          />
        ) : visiveis.length === 0 ? (
          <EstadoVazio
            icone={Search}
            titulo="Nada com esses filtros"
            texto="Tente outro termo ou limpe os filtros para ver todos os lançamentos da linha."
            acao={
              <Button size="sm" variant="outline" onClick={limparFiltros}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {visiveis.map((item) => (
              <LinhaLancamento
                key={item.id}
                item={item}
                cor={corDaFatia(fatiaDoLancamento(item).chave)}
                onAbrirDocumento={setDocumento}
                onMoverPlano={abrirMover}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex flex-col gap-1.5 border-t bg-muted/30 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-h-6 items-center gap-2 text-muted-foreground">
          {filtrando ? (
            <>
              <span>
                Mostrando {visiveis.length} de {itens.length} ·{" "}
                <span className="text-foreground tabular-nums">{brl(somaVisivel)}</span>
              </span>
              <Button variant="link" size="sm" className="h-auto px-0" onClick={limparFiltros}>
                Limpar filtros
              </Button>
            </>
          ) : (
            <span>{primeiraCarga ? "" : `${itens.length} lançamento(s)`}</span>
          )}
        </div>
        {!carregando && !resultado.erro && (
          confere ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              Soma confere com a DRE:
              <span className="font-semibold tabular-nums">{brl(resultado.total)}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              Soma {brl(resultado.total)} diferente da DRE ({brl(linha.valor)})
            </span>
          )
        )}
      </footer>

      <ClassificarCadastroDialog
        alvo={mover?.alvo ?? null}
        contexto={mover?.contexto ?? null}
        podeEditar={podeMover}
        onFechar={() => setMover(null)}
        onClassificado={() => {
          setFatiaAtiva(null);
          onAlterado();
        }}
      />

      {documento?.tipo === "OS" && (
        <OSDetalhesDialog
          open
          osId={documento.id}
          onOpenChange={(aberto) => {
            if (aberto) return;
            setDocumento(null);
            onAlterado();
          }}
        />
      )}
      {documento?.tipo === "VENDA" && (
        <VendaDetailsDialog
          open
          vendaId={documento.id}
          onOpenChange={(aberto) => !aberto && setDocumento(null)}
          onSaved={onAlterado}
        />
      )}
      {(documento?.tipo === "ENTRADA" || documento?.tipo === "USO_CONSUMO") && (
        <EntryDetailsDialog
          open
          entryId={documento.id}
          inventory={documento.tipo === "ENTRADA" ? "produto" : "usoconsumo"}
          onOpenChange={(aberto) => !aberto && setDocumento(null)}
        />
      )}
      {documento?.tipo === "TRANSACAO" && (
        // O mesmo formulário do fluxo de caixa: editar o lançamento daqui refaz a DRE.
        <TransactionDialog
          open
          setOpen={(aberto) => !aberto && setDocumento(null)}
          selectedTransactionId={documento.id}
          setSelectedTransactionId={(id) => id === undefined && setDocumento(null)}
          editable
          handleGetTransactions={onAlterado}
        />
      )}
    </>
  );
}

function LinhaLancamento({
  item,
  cor,
  onAbrirDocumento,
  onMoverPlano,
}: {
  item: LancamentoDre;
  cor: string;
  onAbrirDocumento: (documento: DocumentoLancamento) => void;
  onMoverPlano: (plano: PlanoDoLancamento) => void;
}) {
  const data = dataCurta(item.competenciaEm);
  const documento = item.documento;
  const Icone = documento ? DOCUMENTO[documento.tipo].icone : Receipt;
  const papel = papelNoDocumento(item);
  // No avulso o detalhe é o nome da conta, que já aparece no link: repetir só polui.
  const detalhe = item.detalhe && item.detalhe !== item.planoConta?.nome ? item.detalhe : null;

  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-x-3 px-5 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:px-6">
      <div className="pt-0.5 text-center leading-tight">
        <span className="block text-sm font-medium tabular-nums">{data.dia}</span>
        <span className="block text-[11px] text-muted-foreground tabular-nums">{data.ano}</span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={item.descricao}>
          {item.descricao}
        </p>
        {detalhe && (
          <p className="truncate text-xs text-muted-foreground" title={detalhe}>
            {detalhe}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <span className={cn("size-2 shrink-0 rounded-full", cor)} aria-hidden />
            {documento ? (
              <button
                type="button"
                onClick={() => onAbrirDocumento(documento)}
                title={`Abrir ${DOCUMENTO[documento.tipo].rotulo.toLowerCase()} #${documento.id}`}
                className="inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Icone className="size-3.5 shrink-0" aria-hidden />
                {DOCUMENTO[documento.tipo].rotulo} #{documento.id}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Icone className="size-3.5 shrink-0" aria-hidden />
                Sem documento
              </span>
            )}
            {papel && <span>· {papel}</span>}
          </span>

          {item.planoConta && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onMoverPlano(item.planoConta!)}
                  className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm font-medium text-primary underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <FolderTree className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{nomeDoPlano(item.planoConta)}</span>
                  <ArrowRightLeft className="size-3 shrink-0 opacity-60" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Grupo {item.planoConta.grupo} · {item.planoConta.linhaPropria ? "linha própria" : "segue o grupo"}.
                Clique para mover este plano de conta para outra linha.
              </TooltipContent>
            </Tooltip>
          )}

          {item.isEstorno && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
              Estorno
            </Badge>
          )}
          {item.isManual && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
              Manual
            </Badge>
          )}
          {item.semCusto && (
            <Badge
              variant="outline"
              className="h-5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-normal text-amber-700 dark:text-amber-400"
            >
              Sem custo
            </Badge>
          )}
        </div>
      </div>

      <p className={cn("pt-0.5 text-right text-sm font-medium tabular-nums", item.valor < 0 && "text-destructive")}>
        {brl(item.valor)}
      </p>
    </li>
  );
}

function Contador({ valor }: { valor: number }) {
  return <span className="ml-1 rounded bg-background/60 px-1 text-[10px] text-muted-foreground tabular-nums">{valor}</span>;
}

function EstadoVazio({
  icone: Icone,
  titulo,
  texto,
  acao,
}: {
  icone: LucideIcon;
  titulo: string;
  texto: string;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icone className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <p className="text-sm font-medium">{titulo}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{texto}</p>
      {acao}
    </div>
  );
}
