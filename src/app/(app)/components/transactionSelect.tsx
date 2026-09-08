"use client";

/**
 * O seletor de transacoes do ERP, em dialog.
 *
 * Nasceu da busca manual da conciliacao bancaria, que pedia 50 linhas quaisquer
 * ao servidor e so depois, no navegador, filtrava por valor exato: quando a
 * transacao certa nao caia naquelas 50 linhas, a tela dizia "nenhuma transacao
 * compativel nesta pagina" e o usuario nao tinha como saber se ela existia, se
 * estava em outra conta, ou se o valor diferia pela taxa da maquineta.
 *
 * Aqui os filtros vao TODOS para o servidor — os mesmos do Fluxo de Caixa, mais
 * faixa de valor e origem — e a lista mostra tambem o que nao serve, dizendo o
 * porque. Uma linha que aparece explicada resolve a duvida; uma linha ausente,
 * nao.
 *
 * O componente nao sabe nada de conciliacao: quem decide o que e selecionavel e
 * `avaliarLinha`. Sem ela, tudo e selecionavel, e ele serve a qualquer tela que
 * precise escolher uma transacao.
 */

import * as React from "react";
import axios, { isAxiosError } from "axios";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Ban,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ValueInput } from "@/components/ui/value-input";
import { cn } from "@/lib/utils";
import formatarEmReal from "@/utils/formatarEmReal";
import { ehBaixaParcial, saldoEmAberto, valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";

import { SelectSearchInput } from "./select-search-input";
import { SearchCombobox } from "../(pages)/(financeiro)/fluxodecaixa/components/search-combobox";
import { PlanoContaCombobox } from "../(pages)/(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { useBancos } from "../(pages)/(financeiro)/fluxodecaixa/hooks/use-bancos";
import { useCategoriasTransacao } from "../(pages)/(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { useCentrosCusto } from "../(pages)/(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { usePlanosDeConta } from "../(pages)/(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { getCategoryIcon, getTypeColor } from "../(pages)/(financeiro)/fluxodecaixa/utils";
import type {
  CampoOrdenacao,
  Pagination,
  Tipo_transacao,
  Transaction,
} from "../(pages)/(financeiro)/fluxodecaixa/types";

/* ------------------------------------------------------------------ tipos */

/** Um filtro por parametro da rota, com o nome que a rota usa. */
export type TransactionFiltros = {
  search: string;
  dateFrom: string;
  dateTo: string;
  valorMin: number | null;
  valorMax: number | null;
  /** Lista separada por virgula, como a rota espera. */
  tipos: string;
  pendente: boolean | null;
  bancoId: string;
  metodopagamento: string;
  categoriaId: string;
  planoContaId: string;
  centroCustoId: string;
  vinculo: string;
  comBanco: boolean | null;
  incluirBaixas: boolean | null;
  ordenarPor: CampoOrdenacao;
  ordem: "asc" | "desc";
};

/** O veredito de quem chamou sobre uma linha. `motivo` so faz sentido no nao. */
export type AvaliacaoDaLinha = {
  compativel: boolean;
  motivo?: string | null;
  /** Observacao exibida na linha compativel, do tipo "vira baixa parcial". */
  nota?: string | null;
};

type TransactionSelectProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Gatilho opcional, como nos demais seletores do sistema. */
  children?: React.ReactNode;
  onSelect: (transacao: Transaction) => void;
  title?: string;
  description?: string;
  /** Travados: vao para a consulta e somem da barra de filtros. */
  filtrosFixos?: Partial<TransactionFiltros>;
  /** Pre-preenchidos, e editaveis pelo usuario. */
  filtrosIniciais?: Partial<TransactionFiltros>;
  selectedId?: number | null;
  avaliarLinha?: (transacao: Transaction) => AvaliacaoDaLinha;
  /** Texto extra na lista vazia, para explicar o que fazer a seguir. */
  emptyHint?: React.ReactNode;
};

/* -------------------------------------------------------------- constantes */

const FILTROS_PADRAO: TransactionFiltros = {
  search: "",
  dateFrom: "",
  dateTo: "",
  valorMin: null,
  valorMax: null,
  tipos: "",
  pendente: null,
  bancoId: "",
  metodopagamento: "",
  categoriaId: "",
  planoContaId: "",
  centroCustoId: "",
  vinculo: "",
  comBanco: null,
  incluirBaixas: null,
  ordenarPor: "data",
  ordem: "desc",
};

const PAGINACAO_INICIAL: Pagination = {
  total: 0,
  page: 1,
  limit: 50,
  totalPages: 1,
  pageCount: 0,
};

/** As mesmas opcoes da tabela do Fluxo de Caixa. */
const OPCOES_DE_LIMITE = [50, 100, 200];

const OPCOES_DE_ORDEM: { value: CampoOrdenacao; label: string }[] = [
  { value: "data", label: "Data" },
  { value: "valor", label: "Valor" },
  { value: "descricao", label: "Descrição" },
  { value: "competencia_em", label: "Competência" },
  { value: "tipo", label: "Tipo" },
  { value: "categoria", label: "Categoria" },
  { value: "metodopagamento", label: "Forma de pagamento" },
];

const ROTULO_DO_TIPO: Record<string, string> = {
  RECEITA: "Receita",
  DESPESA: "Despesa",
  DEPOSITO: "Depósito",
  SAQUE: "Saque",
};

/** Os filtros que a barra oferece, e que por isso contam no badge. */
const FILTROS_CONTAVEIS: (keyof TransactionFiltros)[] = [
  "dateFrom",
  "valorMin",
  "valorMax",
  "tipos",
  "pendente",
  "bancoId",
  "metodopagamento",
  "categoriaId",
  "planoContaId",
  "centroCustoId",
  "vinculo",
];

/* ----------------------------------------------------------------- helpers */

function parseYYYYMMDD(valor: string): Date | undefined {
  if (!valor) return undefined;
  const data = new Date(`${valor}T00:00:00`);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

function toYYYYMMDD(data?: Date): string {
  return data ? format(data, "yyyy-MM-dd") : "";
}

/**
 * A data como o usuario a le, no fuso da oficina.
 *
 * `data` e timestamptz e cada caminho de escrita grava uma hora diferente para o
 * mesmo dia; mostrar so o dia evita a linha das 21h aparecer no dia seguinte.
 */
function diaDaTransacao(valor: Date | string | null | undefined): string {
  if (!valor) return "—";
  const instante = new Date(valor as string);
  if (Number.isNaN(instante.getTime())) return "—";
  return instante.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
}

function contraparteDaTransacao(transacao: Transaction): string {
  return (
    transacao.fornecedor?.nomerazaosocial ||
    transacao.fornecedor?.nomefantasia ||
    transacao.nomepagador ||
    ""
  );
}

/** O dinheiro que a linha representa hoje: saldo, no titulo pago em parte. */
function valorDaLinha(transacao: Transaction): number {
  return ehBaixaParcial(transacao) ? saldoEmAberto(transacao) : valorLiquidoEfetivo(transacao);
}

function comFiltrosIniciais(iniciais: Partial<TransactionFiltros>): TransactionFiltros {
  return { ...FILTROS_PADRAO, ...iniciais };
}

function montarParams(filtros: TransactionFiltros, pagina: number, limite: number) {
  return {
    page: pagina,
    limit: limite,
    search: filtros.search || undefined,
    dateFrom: filtros.dateFrom || undefined,
    dateTo: filtros.dateTo || undefined,
    valorMin: filtros.valorMin ?? undefined,
    valorMax: filtros.valorMax ?? undefined,
    tipos: filtros.tipos || undefined,
    pendente: filtros.pendente ?? undefined,
    bancoId: filtros.bancoId || undefined,
    metodopagamento: filtros.metodopagamento || undefined,
    categoriaId: filtros.categoriaId || undefined,
    planoContaId: filtros.planoContaId || undefined,
    centroCustoId: filtros.centroCustoId || undefined,
    vinculo: filtros.vinculo || undefined,
    comBanco: filtros.comBanco ?? undefined,
    incluirBaixas: filtros.incluirBaixas ?? undefined,
    ordenarPor: filtros.ordenarPor,
    ordem: filtros.ordem,
  };
}

/* --------------------------------------------------------------- componente */

export default function TransactionSelect({
  open,
  setOpen,
  children,
  onSelect,
  title = "Selecione uma transação",
  description = "Busque em todo o financeiro: descrição, pagador, documento, OS ou venda.",
  filtrosFixos,
  filtrosIniciais,
  selectedId,
  avaliarLinha,
  emptyHint,
}: TransactionSelectProps) {
  /*
   * Objeto vindo por prop é recriado a cada render de quem chama. Congelar pela
   * forma, e não pela identidade, evita que a lista se rebusque sozinha para
   * sempre.
   */
  const chaveDosFixos = JSON.stringify(filtrosFixos ?? {});
  const chaveDosIniciais = JSON.stringify(filtrosIniciais ?? {});
  const fixos = React.useMemo(
    () => JSON.parse(chaveDosFixos) as Partial<TransactionFiltros>,
    [chaveDosFixos],
  );

  const [filtros, setFiltros] = React.useState<TransactionFiltros>(() =>
    comFiltrosIniciais(filtrosIniciais ?? {}),
  );
  const [pagina, setPagina] = React.useState(1);
  const [limite, setLimite] = React.useState(PAGINACAO_INICIAL.limit);
  const [itens, setItens] = React.useState<Transaction[]>([]);
  const [paginacao, setPaginacao] = React.useState<Pagination>(PAGINACAO_INICIAL);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = React.useState(false);
  const [periodoAberto, setPeriodoAberto] = React.useState(false);

  // Rascunho do que se digita: vira filtro depois da pausa, para não disparar uma
  // varredura de texto no banco a cada tecla.
  const [texto, setTexto] = React.useState(filtros.search);
  const [valorMinDraft, setValorMinDraft] = React.useState(filtros.valorMin);
  const [valorMaxDraft, setValorMaxDraft] = React.useState(filtros.valorMax);

  const requisicaoAtual = React.useRef(0);
  const controlador = React.useRef<AbortController | null>(null);

  const { bancos, loadingBancos } = useBancos();
  const { categorias, loadingCategorias } = useCategoriasTransacao();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { options: metodosPagamento } = usePaymentMethodOptions();

  /* Reabrir recomeça do estado inicial: o uso anterior do dialog já terminou. */
  React.useEffect(() => {
    if (!open) return;
    const inicial = comFiltrosIniciais(JSON.parse(chaveDosIniciais) as Partial<TransactionFiltros>);
    setFiltros(inicial);
    setTexto(inicial.search);
    setValorMinDraft(inicial.valorMin);
    setValorMaxDraft(inicial.valorMax);
    setPagina(1);
    setErro(null);
  }, [open, chaveDosIniciais]);

  /* Pausa da digitação: texto e faixa de valor entram juntos. */
  React.useEffect(() => {
    const iguais =
      texto.trim() === filtros.search &&
      valorMinDraft === filtros.valorMin &&
      valorMaxDraft === filtros.valorMax;
    if (iguais) return;

    const timer = window.setTimeout(() => {
      setFiltros((atual) => ({
        ...atual,
        search: texto.trim(),
        valorMin: valorMinDraft,
        valorMax: valorMaxDraft,
      }));
      setPagina(1);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [texto, valorMinDraft, valorMaxDraft, filtros.search, filtros.valorMin, filtros.valorMax]);

  const buscar = React.useCallback(
    async (paginaAlvo: number, filtrosAlvo: TransactionFiltros, limiteAlvo: number) => {
      const idDaRequisicao = ++requisicaoAtual.current;
      controlador.current?.abort();
      const controller = new AbortController();
      controlador.current = controller;
      setCarregando(true);
      setErro(null);
      try {
        const resposta = await axios.get<{ data: Transaction[]; pagination: Pagination }>(
          "/api/transaction",
          {
            signal: controller.signal,
            // Os travados por último: quem chamou definiu o escopo, e a barra de
            // filtros não tem como sair dele.
            params: montarParams({ ...filtrosAlvo, ...fixos }, paginaAlvo, limiteAlvo),
          },
        );
        if (idDaRequisicao !== requisicaoAtual.current) return;
        setItens(resposta.data.data ?? []);
        setPaginacao(resposta.data.pagination ?? PAGINACAO_INICIAL);
      } catch (causa) {
        if (axios.isCancel(causa) || idDaRequisicao !== requisicaoAtual.current) return;
        /*
         * A tela do Fluxo engole a falha com `catch {}`. Num dialog de busca isso
         * é pior: a lista fica vazia sem dizer que houve erro, e o usuário
         * conclui que a transação não existe.
         */
        const mensagem = isAxiosError(causa)
          ? (causa.response?.data?.error ?? causa.message)
          : "Não foi possível buscar as transações.";
        setItens([]);
        setErro(mensagem);
        toast.error("Erro ao buscar transações", { description: mensagem });
      } finally {
        if (idDaRequisicao === requisicaoAtual.current) setCarregando(false);
      }
    },
    [fixos],
  );

  React.useEffect(() => {
    if (!open) return;
    void buscar(pagina, filtros, limite);
  }, [open, buscar, pagina, filtros, limite]);

  React.useEffect(() => () => controlador.current?.abort(), []);

  const definirFiltro = React.useCallback(
    <Chave extends keyof TransactionFiltros>(chave: Chave, valor: TransactionFiltros[Chave]) => {
      setFiltros((atual) => ({ ...atual, [chave]: valor }));
      setPagina(1);
    },
    [],
  );

  const periodo: DateRange | undefined = React.useMemo(() => {
    const de = parseYYYYMMDD(filtros.dateFrom);
    const ate = parseYYYYMMDD(filtros.dateTo);
    if (!de && !ate) return undefined;
    return { from: de, to: ate };
  }, [filtros.dateFrom, filtros.dateTo]);

  const rotuloDoPeriodo = React.useMemo(() => {
    if (periodo?.from && periodo.to)
      return `${format(periodo.from, "dd/MM/yyyy")} - ${format(periodo.to, "dd/MM/yyyy")}`;
    if (periodo?.from) return `${format(periodo.from, "dd/MM/yyyy")} - ...`;
    return "Qualquer período";
  }, [periodo]);

  /** Um filtro travado não aparece nem conta: o usuário não pode mexer nele. */
  const mostrar = React.useCallback(
    (chave: keyof TransactionFiltros) => !(chave in fixos),
    [fixos],
  );

  const filtrosAtivos = FILTROS_CONTAVEIS.filter(
    (chave) => mostrar(chave) && filtros[chave] !== null && filtros[chave] !== "",
  ).length;

  const limparFiltros = () => {
    // A ordenação é preferência de leitura, não filtro: sobrevive à limpeza.
    setFiltros({ ...FILTROS_PADRAO, ordenarPor: filtros.ordenarPor, ordem: filtros.ordem });
    setTexto("");
    setValorMinDraft(null);
    setValorMaxDraft(null);
    setPagina(1);
  };

  /**
   * O gesto de "eu sei que ela existe, me mostre tudo".
   *
   * Valor e período são o que mais estreita a busca — e são justamente os dois
   * que vêm pré-preenchidos quando quem chama sabe o que procura. Limpar os dois
   * de uma vez evita o usuário caçar campo por campo.
   */
  const ampliarBusca = () => {
    setValorMinDraft(null);
    setValorMaxDraft(null);
    setFiltros((atual) => ({ ...atual, valorMin: null, valorMax: null, dateFrom: "", dateTo: "" }));
    setPagina(1);
  };

  const buscaEstreitada =
    filtros.valorMin != null ||
    filtros.valorMax != null ||
    Boolean(filtros.dateFrom) ||
    Boolean(filtros.dateTo);

  const executarBusca = () => {
    const termo = texto.trim();
    if (termo === filtros.search) void buscar(1, filtros, limite);
    else definirFiltro("search", termo);
  };

  const irPara = (destino: number) => {
    setPagina(Math.min(Math.max(destino, 1), Math.max(paginacao.totalPages, 1)));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent className="flex h-[100dvh] max-h-none w-screen max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[88vh] sm:max-h-[880px] sm:w-[95vw] sm:max-w-5xl sm:rounded-2xl lg:max-w-6xl">
        <DialogHeader className="shrink-0 border-b bg-muted/20 px-4 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="h-0.5 shrink-0 overflow-hidden bg-muted">
          {carregando ? <div className="h-full w-1/2 animate-slideIn bg-primary" /> : null}
        </div>

        {/* ------------------------------------------------------- filtros */}
        <div className="shrink-0 space-y-3 border-b px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <SelectSearchInput
                value={texto}
                onValueChange={setTexto}
                onSearch={executarBusca}
                onClear={() => setTexto("")}
                placeholder="Descrição, pagador, documento, OS ou venda..."
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant={filtrosAbertos ? "secondary" : "outline"}
                onClick={() => setFiltrosAbertos((aberto) => !aberto)}
                className="hover:cursor-pointer"
              >
                <SlidersHorizontal className="size-4" />
                Filtros
                {filtrosAtivos > 0 ? (
                  <Badge variant="secondary" className="ml-1 px-1.5">
                    {filtrosAtivos}
                  </Badge>
                ) : null}
              </Button>
              {buscaEstreitada ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={ampliarBusca}
                  title="Remove a faixa de valor e o período, mantendo o resto"
                  className="hover:cursor-pointer"
                >
                  Ampliar busca
                </Button>
              ) : null}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Dicas: <code className="rounded bg-muted px-1">#123</code> acha o lançamento,{" "}
            <code className="rounded bg-muted px-1">os:1204</code> a ordem de serviço,{" "}
            <code className="rounded bg-muted px-1">venda:45</code> a venda. CPF/CNPJ vale com ou sem
            pontuação.
          </p>

          {filtrosAbertos ? (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Período</Label>
                <Popover open={periodoAberto} onOpenChange={setPeriodoAberto}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "w-full justify-between font-normal",
                        !periodo?.from && "text-muted-foreground",
                      )}
                    >
                      <span className="truncate">{rotuloDoPeriodo}</span>
                      <CalendarIcon className="ml-2 size-4 shrink-0 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <div className="p-3">
                      <Calendar
                        mode="range"
                        numberOfMonths={2}
                        selected={periodo}
                        onSelect={(proximo) => {
                          setFiltros((atual) => ({
                            ...atual,
                            dateFrom: toYYYYMMDD(proximo?.from),
                            dateTo: toYYYYMMDD(proximo?.to),
                          }));
                          setPagina(1);
                        }}
                        locale={ptBR}
                        initialFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="mt-2 w-full"
                        onClick={() => {
                          setFiltros((atual) => ({ ...atual, dateFrom: "", dateTo: "" }));
                          setPagina(1);
                          setPeriodoAberto(false);
                        }}
                      >
                        Qualquer período
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/*
                Zero é o "sem limite" destes dois campos, e está dito no rótulo
                porque o campo de dinheiro mostra "R$ 0,00" em vez de ficar em
                branco — sem o aviso, um filtro vazio se lê como filtro de zero.
              */}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Valor de{" "}
                  <span className="font-normal text-muted-foreground">(0 = sem limite)</span>
                </Label>
                <ValueInput
                  mode="decimal"
                  value={valorMinDraft ?? 0}
                  onValueChange={(valor) => setValorMinDraft(valor > 0 ? valor : null)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  Valor até{" "}
                  <span className="font-normal text-muted-foreground">(0 = sem limite)</span>
                </Label>
                <ValueInput
                  mode="decimal"
                  value={valorMaxDraft ?? 0}
                  onValueChange={(valor) => setValorMaxDraft(valor > 0 ? valor : null)}
                />
              </div>

              {mostrar("tipos") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo</Label>
                  <Select
                    value={filtros.tipos || "TODOS"}
                    onValueChange={(valor) => definirFiltro("tipos", valor === "TODOS" ? "" : valor)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Todos os tipos</SelectItem>
                      <SelectItem value="RECEITA">Receitas</SelectItem>
                      <SelectItem value="DESPESA">Despesas</SelectItem>
                      <SelectItem value="DEPOSITO">Depósitos</SelectItem>
                      <SelectItem value="SAQUE">Saques</SelectItem>
                      <SelectItem value="RECEITA,DEPOSITO">Entradas (receita + depósito)</SelectItem>
                      <SelectItem value="DESPESA,SAQUE">Saídas (despesa + saque)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {mostrar("pendente") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Situação</Label>
                  <Select
                    value={
                      filtros.pendente == null ? "TODAS" : filtros.pendente ? "ABERTO" : "LIQUIDADA"
                    }
                    onValueChange={(valor) =>
                      definirFiltro("pendente", valor === "TODAS" ? null : valor === "ABERTO")
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">Todas</SelectItem>
                      <SelectItem value="ABERTO">Em aberto</SelectItem>
                      <SelectItem value="LIQUIDADA">Liquidadas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {mostrar("bancoId") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Conta bancária</Label>
                  <SearchCombobox
                    value={filtros.bancoId}
                    onValueChange={(valor) => definirFiltro("bancoId", valor)}
                    loading={loadingBancos}
                    clearable
                    clearLabel="Todas as contas"
                    placeholder="Todas as contas"
                    options={bancos.map((banco) => ({
                      value: String(banco.id),
                      label: banco.titulo,
                      description: [banco.agencia, banco.contanumero].filter(Boolean).join(" · "),
                    }))}
                  />
                </div>
              ) : null}

              {mostrar("metodopagamento") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Forma de pagamento</Label>
                  <Select
                    value={filtros.metodopagamento || "TODAS"}
                    onValueChange={(valor) =>
                      definirFiltro("metodopagamento", valor === "TODAS" ? "" : valor)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">Todas as formas</SelectItem>
                      {metodosPagamento.map((opcao) => (
                        <SelectItem key={opcao.value} value={opcao.value}>
                          {opcao.label ?? opcao.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {mostrar("categoriaId") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Categoria</Label>
                  <SearchCombobox
                    value={filtros.categoriaId}
                    onValueChange={(valor) => definirFiltro("categoriaId", valor)}
                    loading={loadingCategorias}
                    clearable
                    clearLabel="Todas as categorias"
                    placeholder="Todas as categorias"
                    options={categorias.map((categoria) => ({
                      value: String(categoria.id),
                      label: categoria.nome,
                      description: categoria.descricao ?? undefined,
                    }))}
                  />
                </div>
              ) : null}

              {mostrar("planoContaId") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Plano de conta</Label>
                  <PlanoContaCombobox
                    value={filtros.planoContaId}
                    onValueChange={(valor) => definirFiltro("planoContaId", valor)}
                    onClear={() => definirFiltro("planoContaId", "")}
                    clearable
                    clearLabel="Todos os planos de conta"
                    placeholder="Todos os planos de conta"
                    loading={loadingPlanos}
                    groups={gruposPlanosDeConta}
                  />
                </div>
              ) : null}

              {mostrar("centroCustoId") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Centro de custo</Label>
                  <SearchCombobox
                    value={filtros.centroCustoId}
                    onValueChange={(valor) => definirFiltro("centroCustoId", valor)}
                    loading={loadingCentrosCusto}
                    clearable
                    clearLabel="Todos os centros de custo"
                    placeholder="Todos os centros de custo"
                    options={centrosCusto.map((centro) => ({
                      value: String(centro.id),
                      label: centro.nome,
                      description: centro.descricao ?? undefined,
                    }))}
                  />
                </div>
              ) : null}

              {mostrar("vinculo") ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Origem</Label>
                  <Select
                    value={filtros.vinculo || "TODOS"}
                    onValueChange={(valor) => definirFiltro("vinculo", valor === "TODOS" ? "" : valor)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Qualquer origem</SelectItem>
                      <SelectItem value="OS">Ordem de serviço</SelectItem>
                      <SelectItem value="VENDA">Venda</SelectItem>
                      <SelectItem value="EVENTO">Evento financeiro</SelectItem>
                      <SelectItem value="AVULSO">Lançamento avulso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label className="text-xs">Ordenar por</Label>
                <div className="flex gap-2">
                  <Select
                    value={filtros.ordenarPor}
                    onValueChange={(valor) => definirFiltro("ordenarPor", valor as CampoOrdenacao)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPCOES_DE_ORDEM.map((opcao) => (
                        <SelectItem key={opcao.value} value={opcao.value}>
                          {opcao.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 hover:cursor-pointer"
                    title={filtros.ordem === "asc" ? "Crescente" : "Decrescente"}
                    aria-label={filtros.ordem === "asc" ? "Ordem crescente" : "Ordem decrescente"}
                    onClick={() => definirFiltro("ordem", filtros.ordem === "asc" ? "desc" : "asc")}
                  >
                    {filtros.ordem === "asc" ? (
                      <ArrowUpNarrowWide className="size-4" />
                    ) : (
                      <ArrowDownWideNarrow className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex items-end sm:col-span-2 lg:col-span-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={limparFiltros}
                  className="hover:cursor-pointer"
                >
                  <X className="size-4" />
                  Limpar filtros
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* --------------------------------------------------------- lista */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="text-xs">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-10" />
                <TableHead className="min-w-[240px]">Transação</TableHead>
                <TableHead className="hidden w-28 sm:table-cell">Data</TableHead>
                <TableHead className="hidden w-24 md:table-cell">Tipo</TableHead>
                <TableHead className="hidden min-w-[140px] lg:table-cell">
                  Conta / Categoria
                </TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {carregando && itens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                    Buscando transações…
                  </TableCell>
                </TableRow>
              ) : erro ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center text-destructive">
                    {erro}
                  </TableCell>
                </TableRow>
              ) : itens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center">
                    <p className="text-muted-foreground">Nenhuma transação encontrada.</p>
                    {emptyHint ? (
                      <div className="mt-1 text-xs text-muted-foreground">{emptyHint}</div>
                    ) : null}
                    {buscaEstreitada ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 hover:cursor-pointer"
                        onClick={ampliarBusca}
                      >
                        Ampliar busca (remover valor e período)
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ) : (
                itens.map((transacao) => {
                  const avaliacao = avaliarLinha?.(transacao) ?? { compativel: true };
                  const selecionavel = avaliacao.compativel;
                  const atual = selectedId != null && Number(selectedId) === transacao.id;
                  const contraparte = contraparteDaTransacao(transacao);
                  const liquido = valorDaLinha(transacao);
                  const bruto = Number(transacao.valor ?? 0);

                  return (
                    <TableRow
                      key={transacao.id}
                      data-state={atual ? "selected" : undefined}
                      aria-disabled={!selecionavel}
                      className={cn(
                        selecionavel
                          ? "cursor-pointer"
                          : "cursor-not-allowed bg-muted/20 opacity-70 hover:bg-muted/20",
                      )}
                      onClick={() => {
                        if (!selecionavel) return;
                        onSelect(transacao);
                        setOpen(false);
                      }}
                    >
                      <TableCell className="align-top">
                        {selecionavel ? (
                          <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Ban className="size-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <p className="font-medium">
                          <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                            #{transacao.id}
                          </span>
                          {transacao.descricao || "Sem descrição"}
                        </p>
                        {contraparte ? (
                          <p className="truncate text-[11px] text-muted-foreground">{contraparte}</p>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground sm:hidden">
                          {diaDaTransacao(transacao.data)} ·{" "}
                          {ROTULO_DO_TIPO[transacao.tipo] ?? transacao.tipo}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {transacao.pendente ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              Em aberto
                            </Badge>
                          ) : null}
                          {ehBaixaParcial(transacao) ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              Parcial
                            </Badge>
                          ) : null}
                          {transacao.ordemservicoid ? (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              OS #{transacao.ordemservicoid}
                            </Badge>
                          ) : null}
                          {transacao.vendaid ? (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              Venda #{transacao.vendaid}
                            </Badge>
                          ) : null}
                          {atual ? (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              Atual
                            </Badge>
                          ) : null}
                        </div>
                        {/*
                          O motivo fica no corpo da linha, não só num tooltip: em
                          telefone não existe hover, e é justamente o motivo que
                          responde "por que não acho a transação".
                        */}
                        {!selecionavel && avaliacao.motivo ? (
                          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                            {avaliacao.motivo}
                          </p>
                        ) : null}
                        {selecionavel && avaliacao.nota ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">{avaliacao.nota}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden align-top sm:table-cell">
                        {diaDaTransacao(transacao.data)}
                        {transacao.pendente ? (
                          <span className="block text-[10px] text-muted-foreground">vencimento</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden align-top md:table-cell">
                        <span className={getTypeColor(transacao.tipo as Tipo_transacao)}>
                          {ROTULO_DO_TIPO[transacao.tipo] ?? transacao.tipo}
                        </span>
                      </TableCell>
                      <TableCell className="hidden align-top lg:table-cell">
                        <p className="truncate">{transacao.banco?.titulo ?? "Sem conta"}</p>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {getCategoryIcon(
                            transacao.categoria,
                            transacao.categoria_dados?.icone ?? null,
                          )}
                          <span className="truncate">{transacao.categoria || "Sem categoria"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <span
                          className={cn("font-semibold", getTypeColor(transacao.tipo as Tipo_transacao))}
                        >
                          {formatarEmReal(liquido)}
                        </span>
                        {Math.abs(bruto - liquido) >= 0.01 ? (
                          <span className="block text-[10px] text-muted-foreground">
                            bruto {formatarEmReal(bruto)}
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* ------------------------------------------------------- rodapé */}
        <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
          <div className="flex w-full flex-col items-center justify-between gap-3 sm:flex-row">
            <span className="text-xs text-muted-foreground">
              {paginacao.total} transaç{paginacao.total === 1 ? "ão" : "ões"}
            </span>
            <div className="flex items-center gap-2">
              <Select
                value={String(limite)}
                onValueChange={(valor) => {
                  setLimite(Number(valor));
                  setPagina(1);
                }}
              >
                <SelectTrigger className="h-8 w-[96px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPCOES_DE_LIMITE.map((opcao) => (
                    <SelectItem key={opcao} value={String(opcao)}>
                      {opcao} / pág.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Primeira página"
                  disabled={paginacao.page <= 1 || carregando}
                  onClick={() => irPara(1)}
                >
                  <ChevronsLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Página anterior"
                  disabled={paginacao.page <= 1 || carregando}
                  onClick={() => irPara(paginacao.page - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-24 text-center text-xs">
                  {carregando ? (
                    <Loader2 className="mx-auto size-4 animate-spin" />
                  ) : (
                    `Pág. ${paginacao.page} de ${Math.max(paginacao.totalPages, 1)}`
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Próxima página"
                  disabled={paginacao.page >= paginacao.totalPages || carregando}
                  onClick={() => irPara(paginacao.page + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Última página"
                  disabled={paginacao.page >= paginacao.totalPages || carregando}
                  onClick={() => irPara(paginacao.totalPages)}
                >
                  <ChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
