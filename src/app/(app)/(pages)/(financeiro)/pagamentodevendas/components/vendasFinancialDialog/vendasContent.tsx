import { DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  TableHead,
} from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";
import { Metodo_pagamento, Transaction } from "../../../fluxodecaixa/types";
import { Fragment, useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import TransactionDialog from "../../../fluxodecaixa/components/transactionDialog/transactionDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "next-auth/react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  Eye,
  ExternalLink,
  FileText,
  HandCoins,
  Loader,
  Loader2,
  Package,
  Paperclip,
  Pencil,
  Percent,
  Printer,
  ReceiptText,
  RotateCcw,
  Share2,
  Trash2Icon,
} from "lucide-react";
import { TransactionDeleteAlert } from "../../../components/transaction-delete-alert";
import { estornarBaixa } from "../../../components/transaction-estorno-alert";
import { TransactionAbonoAlert, abonarTransacao } from "../../../components/transaction-abono-alert";
import { excluirPagamentoMultiplo } from "../../../components/pagamento-multiplo";
import { toast } from "@/lib/toast";
import { formatDate } from "@/utils/formatDate";
import { saldoEmAberto } from "@/lib/financeiro/transacao";
import { VendaComItens } from "@/app/(app)/(pages)/(vendas)/historicovendas/types";
import {
  getVendaAnexoCategoriaLabel,
  type VendaAnexoCategoria,
} from "@/lib/venda-anexo-categorias";
import {
  calculateFinancialSurcharge,
  calculateFinancialTotal,
} from "@/lib/financial-surcharge";
import { ClienteResumoCard } from "@/components/cliente/cliente-resumo-card";
import Image from "next/image";
import {
  FinancialDialogHeader,
  FinancialDialogLoadingState,
  FinancialSummaryFooter,
  FinancialStatusBadge,
  FinancialTransactionFiltersBar,
  FinancialTransactionPagination,
  FinancialTransactionsPanel,
  EMPTY_FINANCIAL_TRANSACTION_FILTERS,
  type FinancialTransactionFilters,
  financialDialogContentClass,
  financialTabListClass,
  financialTabTriggerClass,
} from "../../../components/financial-details-dialog-ui";
import {
  printTransactionReceipt,
  shareTransactionReceipt,
} from "../../../components/financial-transaction-receipt";
import { calcularResumoFinanceiroOs } from "@/lib/ordens/financeiro";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";

interface VendasContentProps {
  vendaId: number;
  IsOpen?: boolean;
}

type VendaAnexo = {
  id: number;
  nome: string;
  tipo?: string | null;
  tamanho?: number | null;
  url: string;
  categoria: VendaAnexoCategoria;
  createdat?: string | null;
};

type TipoDesconto = "FIXO" | "PORCENTAGEM" | null;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CREDITO: "Credito",
  DEBITO: "Debito",
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferencia",
  TED: "TED",
  DOC: "DOC",
};

const toNum = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const arredondarMoeda = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const calcularDescontoAplicado = (
  base: number,
  tipo: TipoDesconto,
  desconto: number,
) => {
  const baseSeguro = Math.max(0, toNum(base));
  const valor = Math.max(0, toNum(desconto));
  if (!tipo || valor <= 0 || baseSeguro <= 0) return 0;
  if (tipo === "PORCENTAGEM")
    return arredondarMoeda(baseSeguro * (Math.min(valor, 100) / 100));
  return arredondarMoeda(Math.min(valor, baseSeguro));
};

const calcularTotalComDesconto = (
  base: number,
  tipo: TipoDesconto,
  desconto: number,
) =>
  arredondarMoeda(
    Math.max(0, toNum(base) - calcularDescontoAplicado(base, tipo, desconto)),
  );

const limitarDesconto = (base: number, tipo: TipoDesconto, valor: number) => {
  const seguro = Math.max(0, toNum(valor));
  if (tipo === "PORCENTAGEM") return Math.min(seguro, 100);
  if (tipo === "FIXO") return Math.min(seguro, Math.max(0, toNum(base)));
  return 0;
};

// Ajuste conforme a sua estrutura real

export default function VendasContent({ vendaId, IsOpen }: VendasContentProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOs, setIsLoadingOs] = useState(false);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [transactionFilters, setTransactionFilters] =
    useState<FinancialTransactionFilters>({
      ...EMPTY_FINANCIAL_TRANSACTION_FILTERS,
    });
  const [venda, setVenda] = useState<VendaComItens | undefined>(undefined);
  const [anexos, setAnexos] = useState<VendaAnexo[]>([]);
  const [isLoadingAnexos, setIsLoadingAnexos] = useState(false);
  const [descontoTipo, setDescontoTipo] = useState<TipoDesconto>(null);
  const [desconto, setDesconto] = useState(0);
  const [acrescimoTipo, setAcrescimoTipo] = useState<TipoDesconto>(null);
  const [acrescimo, setAcrescimo] = useState(0);
  const [isSavingDiscount, setIsSavingDiscount] = useState(false);
  const [, setIsDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedTransactionId, setSelectedTransactionId] = useState<
    number | undefined
  >(undefined);
  const { data: session } = useSession();
  const config = useConfig();
  const canEdit = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_EDITAR,
  );
  // A mesma trava do fluxo de caixa: sem ela o dialog abre em modo leitura.
  const podeEditarTransacao =
    canEdit && config?.habilitar_edicao_transacoes === true;
  // Pagamento lancado por outra pessoa aparece e abre, mas so para leitura
  // quando quem ve nao pode ver todas as transacoes.
  const transacaoSelecionada = transactions?.find((t) => t.id === selectedTransactionId);
  const dialogEditavel =
    podeEditarTransacao && (!transacaoSelecionada || transacaoSelecionada.pode_alterar !== false);
  const subtotalVenda = toNum(venda?.sub_total ?? venda?.valortotal ?? 0);
  const descontoItensAplicado = arredondarMoeda(
    venda?.itens?.reduce(
      (total, item) => total + Math.max(0, toNum(item.valor_desconto)),
      0,
    ) ?? 0,
  );
  const baseDescontoGeral = Math.max(
    0,
    arredondarMoeda(subtotalVenda - descontoItensAplicado),
  );
  const descontoAplicado = calcularDescontoAplicado(
    baseDescontoGeral,
    descontoTipo,
    desconto,
  );
  const descontoTotalAplicado = arredondarMoeda(
    descontoItensAplicado + descontoAplicado,
  );
  const totalComDesconto = calcularTotalComDesconto(
    baseDescontoGeral,
    descontoTipo,
    desconto,
  );
  const valorFrete = Math.max(0, toNum(venda?.valor_frete));
  const totalComercial = arredondarMoeda(totalComDesconto + valorFrete);
  const acrescimoAplicado = calculateFinancialSurcharge(
    totalComercial,
    acrescimoTipo,
    acrescimo,
  );
  const totalFinanceiro = calculateFinancialTotal(
    totalComercial,
    acrescimoTipo,
    acrescimo,
  );
  const resumoFinanceiroVenda = calcularResumoFinanceiroOs({
    totalComercial,
    acrescimoFinanceiroTipo: acrescimoTipo,
    acrescimoFinanceiroValor: acrescimo,
    transacoes: (venda?.transacoes ?? []) as never[],
  });
  const totalPago = resumoFinanceiroVenda.valorComprometido;
  const saldoDevedor = resumoFinanceiroVenda.saldoAReceber;
  const saldoDisponivel = resumoFinanceiroVenda.saldoDisponivelParaLancamento;
  const vendaAceitaPagamento = ["ORCAMENTO_APROVADO", "ABERTA", "PAGAMENTO"].includes(
    String(venda?.status ?? "").toUpperCase(),
  );
  const bloqueioNovoPagamento = !vendaAceitaPagamento
    ? `A venda está ${venda?.status?.toLowerCase()}: não é possível registrar pagamentos.`
    : saldoDisponivel <= 0
      ? "A venda já está quitada ou coberta por títulos pendentes."
      : null;
  /*
   * Pre-preenche o metodo com o da venda, se ele for um metodo conhecido.
   *
   * A conferencia usa a lista do banco, nao o enum do codigo: com a lista
   * parcial, uma venda paga em DEBITO AUTOMATICO caia no `undefined` e o campo
   * abria vazio, obrigando a escolher de novo o que a venda ja dizia.
   */
  const initialMetodoPagamento = (() => {
    const value = String(venda?.forma_pagamento ?? "").toUpperCase();
    return metodosPagamento.some((metodo) => metodo.value === value)
      ? (value as Metodo_pagamento)
      : undefined;
  })();
  const formatFileSize = (value?: number | null) => {
    if (!value) return "Tamanho não informado";
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };
  const isImageAnexo = (anexo: VendaAnexo) =>
    String(anexo.tipo ?? "").startsWith("image/");
  const paymentMethods = (() => {
    /*
     * `pagamentos_previstos` é a fonte quando existe: guarda forma, valor e
     * parcelas separados, e é de lá que sai o "3x" que `forma_pagamento` nunca
     * soube dizer. Vendas anteriores à coluna caem no texto de sempre.
     */
    if (
      Array.isArray(venda?.pagamentos_previstos) &&
      venda.pagamentos_previstos.length > 0
    ) {
      return venda.pagamentos_previstos.map((pagamento) => {
        const key = String(pagamento?.metodo ?? "").toUpperCase();
        const parcelas = Number(pagamento?.parcelas ?? 0);
        return {
          method: PAYMENT_METHOD_LABELS[key] ?? key,
          amount: formatarEmReal(Number(pagamento?.valor ?? 0)),
          parcelas: parcelas > 1 ? `${parcelas}x` : null,
        };
      });
    }

    const raw = String(venda?.forma_pagamento ?? "").trim();
    if (!raw) return [];

    if (raw.includes(":")) {
      return raw.split(/,\s+(?=[A-Z_]+:)/).map((entry) => {
        const [method, ...amountParts] = entry.split(":");
        const key = method.trim().toUpperCase();
        return {
          method: PAYMENT_METHOD_LABELS[key] ?? method.trim(),
          amount: amountParts.join(":").trim() || null,
          parcelas: null as string | null,
        };
      });
    }

    return raw
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean)
      .map((method) => {
        const key = method.toUpperCase();
        return {
          method: PAYMENT_METHOD_LABELS[key] ?? method,
          amount: null,
          parcelas: null as string | null,
        };
      });
  })();

  // ====== DATA LOADERS
  const handleGetVenda = async (
    vendaId: number,
    options?: { silent?: boolean },
  ) => {
    if (!options?.silent) setIsLoadingOs(true);
    try {
      const response = await axios.get(`/api/venda/${vendaId}`);
      if (response.status === 200) {
        const nextVenda = response.data.data as VendaComItens;
        setVenda(nextVenda);
        setDescontoTipo(
          nextVenda.desconto_tipo === "FIXO" ||
            nextVenda.desconto_tipo === "PORCENTAGEM"
            ? nextVenda.desconto_tipo
            : null,
        );
        setDesconto(toNum(nextVenda.desconto_valor ?? 0));
        setAcrescimoTipo(nextVenda.acrescimo_financeiro_tipo ?? null);
        setAcrescimo(toNum(nextVenda.acrescimo_financeiro_valor ?? 0));
      }
    } catch {
      toast.error("Não foi possível carregar a Venda");
    } finally {
      if (!options?.silent) setIsLoadingOs(false);
    }
  };

  const handleGetTransactions = async (
    pageNumber?: number,
    vendaIdArg?: number,
    filtersArg?: FinancialTransactionFilters,
  ) => {
    const targetId = vendaIdArg ?? venda?.id;
    if (!targetId) return;
    setIsLoading(true);
    try {
      const filters = filtersArg ?? transactionFilters;
      const response = await axios.get("/api/transaction", {
        params: {
          page: pageNumber || 1,
          limit: pagination.limit,
          vendaid: targetId,
          tipo: "RECEITA",
          excluirEventosFinanceiros: true,
          search: filters.search.trim() || undefined,
          metodo: filters.method || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
      });
      if (response.status === 200) {
        const { data } = response;
        const requestedPage = pageNumber || 1;
        if (
          data.data.length === 0 &&
          data.pagination.total > 0 &&
          requestedPage > data.pagination.totalPages
        ) {
          await handleGetTransactions(
            data.pagination.totalPages,
            targetId,
            filters,
          );
          return;
        }
        setTransactions(data.data);
        setPagination(data.pagination);
        await handleGetVenda(targetId, { silent: true });
      }
    } catch {
      toast.error("Não foi possível carregar as transações");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetAnexos = async (vendaIdArg?: number) => {
    const targetId = vendaIdArg ?? venda?.id;
    if (!targetId) return;

    setIsLoadingAnexos(true);
    try {
      const response = await axios.get(`/api/venda/${targetId}/anexos`);
      const items = Array.isArray(response.data?.items)
        ? response.data.items.map((item: any) => ({
            id: Number(item.id),
            nome: String(item.nome ?? "Anexo"),
            tipo: item.tipo ?? null,
            tamanho:
              typeof item.tamanho === "number"
                ? item.tamanho
                : Number(item.tamanho ?? 0) || null,
            url: String(item.url ?? ""),
            categoria: (item.categoria ?? "OUTROS") as VendaAnexoCategoria,
            createdat: item.createdat ?? null,
          }))
        : [];
      setAnexos(items);
    } catch {
      toast.error("Não foi possível carregar os anexos");
    } finally {
      setIsLoadingAnexos(false);
    }
  };

  useEffect(() => {
    if (!IsOpen) {
      setTransactions([]);
      setVenda(undefined);
      setAnexos([]);
      setDescontoTipo(null);
      setDesconto(0);
      setAcrescimoTipo(null);
      setAcrescimo(0);
      setTransactionFilters({ ...EMPTY_FINANCIAL_TRANSACTION_FILTERS });
    }
  }, [IsOpen]);

  const handleDeleteGrupo = async (grupoId: number) => {
    setIsDeleting(true);
    try {
      await excluirPagamentoMultiplo(grupoId);
      handleGetTransactions(pagination.page);
      toast.success("Pagamento múltiplo desfeito.");
    } catch (erro) {
      toast.error(
        erro instanceof Error
          ? erro.message
          : "Não foi possível excluir o pagamento.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Tira o pagamento do fluxo de caixa e devolve o título para em aberto.
   *
   * Pagamento de venda é quase sempre título liquidado, e liquidado não se
   * exclui: a exclusão apagaria o título junto com o pagamento. Sem esta ação a
   * tela ficaria só com a recusa, sem caminho.
   */
  const handleEstornarBaixa = async (id: number) => {
    setIsDeleting(true);
    try {
      const { acrescimos_removidos } = await estornarBaixa(id);
      const removidos = Number(acrescimos_removidos ?? 0);
      handleGetTransactions(pagination.page);
      toast.success(
        removidos > 0
          ? `Título reaberto. Os ${formatarEmReal(removidos)} de acréscimo saíram junto com a baixa.`
          : "Título reaberto: voltou a ficar em aberto.",
      );
    } catch (erro) {
      toast.error(
        erro instanceof Error
          ? erro.message
          : "Não foi possível tirar do fluxo de caixa.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Perdoa um título a receber sem lançar nada no banco. A venda continua
   * quitada; só não passa pelo fluxo de caixa.
   */
  const handleAbonar = async (id: number, motivo?: string) => {
    setIsDeleting(true);
    try {
      await abonarTransacao(id, motivo);
      handleGetTransactions(pagination.page);
      toast.success("Cobrança abonada.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível abonar a cobrança.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteTransaction = async (id: number) => {
    setIsDeleting(true);
    toast(
      <div className="flex gap-2 items-center flex-nowrap">
        <Loader className="animate-spin w-4" />
        <span className="text-nowrap">Deletando transação...</span>
      </div>,
    );
    try {
      const response = await axios.delete(`/api/transaction/${id}/os`);
      if (response.status === 204) {
        handleGetTransactions(pagination.page);
        toast.success("Transação deletada!");
      } else {
        toast.warning(`Status inesperado: ${response.status}`);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao deletar", {
          description: error.response?.data?.error || "Tente novamente.",
        });
      } else {
        toast.error("Erro ao deletar");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveDiscounts = async () => {
    if (!venda?.id) return;
    if (totalFinanceiro < totalPago) {
      toast.error(
        "O total com desconto não pode ficar menor que o total já pago.",
      );
      return;
    }

    setIsSavingDiscount(true);
    try {
      await axios.patch(`/api/venda/${venda.id}`, {
        descontoTipo,
        descontoValor: descontoTipo ? Math.max(0, desconto) : 0,
        subTotal: subtotalVenda,
        valorTotal: totalComercial,
        valorFrete,
        acrescimoFinanceiroTipo: acrescimoTipo,
        acrescimoFinanceiroValor: acrescimoTipo ? Math.max(0, acrescimo) : 0,
      });
      toast.success("Descontos e acréscimos salvos.");
      await handleGetVenda(venda.id, { silent: true });
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao salvar descontos e acréscimos", {
          description: error.response?.data?.error || "Tente novamente.",
        });
      } else {
        toast.error("Erro ao salvar descontos e acréscimos");
      }
    } finally {
      setIsSavingDiscount(false);
    }
  };

  useEffect(() => {
    if (vendaId && IsOpen) {
      handleGetVenda(vendaId);
      handleGetTransactions(undefined, vendaId);
      handleGetAnexos(vendaId);
    }
  }, [vendaId, IsOpen]);

  // ====== RENDER
  if (isLoadingOs) {
    return (
      <DialogContent className={financialDialogContentClass}>
        <FinancialDialogLoadingState label="Dados financeiros da venda" />
      </DialogContent>
    );
  }

  if (!venda) return null;

  return (
    <DialogContent className={financialDialogContentClass}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <FinancialDialogHeader
          entity="Venda"
          entityId={venda.id}
          description="Consulte a composição da venda, ajuste valores e acompanhe os pagamentos registrados."
        />

        {/* Barra de progresso fina no topo */}
        <div
          className={`transition-all ${
            isLoading ? "opacity-100" : "opacity-0"
          } h-0.5 bg-slate-400 w-full overflow-hidden left-0 right-0 top-0 relative`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <Tabs
          defaultValue="detalhes"
          className="min-h-0 min-w-0 flex-1 gap-0 overflow-hidden"
        >
          <div className="shrink-0 border-b border-border bg-background">
            <TabsList className={financialTabListClass}>
              <TabsTrigger
                value="detalhes"
                className={financialTabTriggerClass}
              >
                <span className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                  Detalhes
                </span>
              </TabsTrigger>
              <TabsTrigger value="itens" className={financialTabTriggerClass}>
                <span className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                  Itens
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="descontos"
                className={financialTabTriggerClass}
              >
                <span className="flex items-center gap-2">
                  <Percent className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                  Descontos e Acréscimos
                </span>
              </TabsTrigger>
              <TabsTrigger value="anexos" className={financialTabTriggerClass}>
                <span className="flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                  Anexos
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="transacoes"
                className={financialTabTriggerClass}
              >
                <span className="flex items-center gap-2">
                  <ReceiptText className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                  Transações
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden bg-muted/25 px-3 py-3 sm:px-5 sm:py-4">
            <TabsContent value="detalhes" className="mt-0 space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
                <ClienteResumoCard
                  cliente={venda.cliente}
                  className="xl:col-span-4"
                  onClienteAtualizado={() =>
                    handleGetVenda(venda.id, { silent: true })
                  }
                />
                <div className="border border-border bg-card p-4 shadow-sm xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Venda
                  </span>
                  <p className="mt-1 text-sm font-medium">
                    {venda.status || "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(venda.datavenda)}
                  </p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Vendedor
                  </span>
                  <p className="mt-1 truncate text-sm font-medium">
                    {venda.criador?.nome || venda.created_by || "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Responsável pela venda
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Cobrança
                  </span>
                  <p className="mt-1 text-sm font-semibold text-primary">
                    {formatarEmReal(totalFinanceiro)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Em aberto: {formatarEmReal(saldoDevedor)}
                  </p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Anexos
                  </span>
                  <p className="mt-1 text-sm font-medium">{anexos.length} arquivo(s)</p>
                  <p className="text-xs text-muted-foreground">Vinculados à venda</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="border border-border bg-card p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Pagamento previsto
                    </span>
                    <Badge variant="outline">{paymentMethods.length}</Badge>
                  </div>
                  {paymentMethods.length > 0 ? (
                    <div className="space-y-2">
                      {paymentMethods.map((item, index) => (
                        <div
                          key={`${item.method}-${index}`}
                          className="border border-border bg-muted/20 px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{item.method}</span>
                            {item.parcelas ? (
                              <span className="shrink-0 border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                                {item.parcelas}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.amount ?? "Valor não informado"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                      Nenhum método informado.
                    </div>
                  )}
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Descrição para o financeiro
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {venda.descricao_financeiro?.trim() ||
                      "Nenhuma orientação informada."}
                  </p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Garantia
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {venda.garantia?.trim() || "Nenhuma garantia informada."}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Descrição
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {venda.descricao?.trim() || "Nenhuma descrição informada."}
                  </p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Observações internas
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {venda.observacoes?.trim() || "Nenhuma observação interna informada."}
                  </p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Observações fiscais
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {venda.observacoes_fiscais?.trim() || "Nenhuma observação fiscal informada."}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="descontos" className="mt-0 space-y-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_150px_auto] lg:items-end">
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Desconto total
                    </span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Aplicado sobre o subtotal da venda.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Tipo</span>
                    <Select
                      value={descontoTipo ?? "NONE"}
                      onValueChange={(value) => {
                        const nextType =
                          value === "NONE"
                            ? null
                            : (value as Exclude<TipoDesconto, null>);
                        setDescontoTipo(nextType);
                        setDesconto((current) =>
                          limitarDesconto(baseDescontoGeral, nextType, current),
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sem desconto" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Sem desconto</SelectItem>
                        <SelectItem value="FIXO">Fixo</SelectItem>
                        <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      {descontoTipo === "PORCENTAGEM"
                        ? "Percentual (%)"
                        : "Valor"}
                    </span>
                    <div className="relative">
                      {descontoTipo === "PORCENTAGEM" ? (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={desconto > 0 ? desconto : ""}
                          disabled={!descontoTipo}
                          onChange={(event) =>
                            setDesconto(
                              limitarDesconto(
                                baseDescontoGeral,
                                descontoTipo,
                                Number(event.target.value || 0),
                              ),
                            )
                          }
                          className="pr-8"
                        />
                      ) : (
                        <ValueInput
                          value={desconto}
                          onValueChange={(value) =>
                            setDesconto(
                              limitarDesconto(
                                baseDescontoGeral,
                                descontoTipo,
                                value,
                              ),
                            )
                          }
                          disabled={!descontoTipo}
                        />
                      )}
                      {descontoTipo === "PORCENTAGEM" ? (
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                          %
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={handleSaveDiscounts}
                    disabled={isSavingDiscount || venda.status === "FINALIZADA"}
                  >
                    {isSavingDiscount ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Salvar"
                    )}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_150px_auto] lg:items-end">
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Acréscimo financeiro
                    </span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Incide somente sobre a cobrança, sem alterar a venda ou o
                      fiscal.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Tipo</span>
                    <Select
                      value={acrescimoTipo ?? "NONE"}
                      onValueChange={(value) => {
                        setAcrescimoTipo(
                          value === "NONE"
                            ? null
                            : (value as Exclude<TipoDesconto, null>),
                        );
                        if (value === "NONE") setAcrescimo(0);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sem acréscimo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Sem acréscimo</SelectItem>
                        <SelectItem value="FIXO">Fixo</SelectItem>
                        <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      {acrescimoTipo === "PORCENTAGEM"
                        ? "Percentual (%)"
                        : "Valor"}
                    </span>
                    <div className="relative">
                      {acrescimoTipo === "PORCENTAGEM" ? (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={acrescimo > 0 ? acrescimo : ""}
                          disabled={!acrescimoTipo}
                          onChange={(event) =>
                            setAcrescimo(Number(event.target.value || 0))
                          }
                          className="pr-8"
                        />
                      ) : (
                        <ValueInput
                          value={acrescimo}
                          onValueChange={setAcrescimo}
                          disabled={!acrescimoTipo}
                        />
                      )}
                      {acrescimoTipo === "PORCENTAGEM" ? (
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                          %
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={handleSaveDiscounts}
                    disabled={isSavingDiscount || venda.status === "FINALIZADA"}
                  >
                    {isSavingDiscount ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Salvar"
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Subtotal
                  </span>
                  <p className="mt-1 text-sm font-medium">
                    {formatarEmReal(subtotalVenda)}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Desconto aplicado
                  </span>
                  <p className="mt-1 text-sm font-medium">
                    - {formatarEmReal(descontoTotalAplicado)}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Frete
                  </span>
                  <p className="mt-1 text-sm font-medium">
                    + {formatarEmReal(valorFrete)}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Acréscimo aplicado
                  </span>
                  <p className="mt-1 text-sm font-medium">
                    + {formatarEmReal(acrescimoAplicado)}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Total financeiro
                  </span>
                  <p className="mt-1 text-sm font-medium">
                    {formatarEmReal(totalFinanceiro)}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="itens" className="mt-0">
              {venda.itens?.length ? (
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Itens da cobrança
                    </span>
                    <Badge variant="outline">{venda.itens.length}</Badge>
                  </div>
                  <div className="divide-y rounded-md border">
                    {venda.itens.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium line-clamp-2">
                            {item.produto?.titulo ||
                              item.produto?.descricao ||
                              `Produto #${item.produtoid}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantidade} x{" "}
                            {formatarEmReal(
                              (item.valor_total || 0) /
                                Math.max(item.quantidade || 1, 1),
                            )}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium">
                          {formatarEmReal(item.valor_total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum item na cobrança.
                </div>
              )}
            </TabsContent>

            <TabsContent value="anexos" className="mt-0">
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Anexos da venda
                    </span>
                    <Badge variant="outline">{anexos.length}</Badge>
                  </div>
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleGetAnexos(venda.id)}
                  >
                    Recarregar
                    <Loader2
                      className={`h-3 w-3 ${isLoadingAnexos ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>

                {isLoadingAnexos ? (
                  <div className="mt-2 flex h-16 items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
                    <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />
                    Carregando anexos...
                  </div>
                ) : anexos.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    Nenhum anexo vinculado.
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {anexos.map((anexo) => (
                      <div
                        key={anexo.id}
                        className="flex min-w-0 items-center gap-2 px-3 py-2"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/50">
                          {isImageAnexo(anexo) ? (
                            <Image
                              src={anexo.url}
                              alt={anexo.nome}
                              width={36}
                              height={36}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium"
                            title={anexo.nome}
                          >
                            {anexo.nome}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {getVendaAnexoCategoriaLabel(anexo.categoria)} -{" "}
                            {formatFileSize(anexo.tamanho)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 px-2"
                          asChild
                        >
                          <a
                            href={anexo.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Abrir anexo"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="transacoes" className="mt-0">
              <FinancialTransactionsPanel
                count={pagination.total}
                loading={isLoading}
                onReload={() => handleGetTransactions()}
                status={<FinancialStatusBadge paid={totalPago} debt={saldoDevedor} />}
                action={
                  <div className="max-w-80 text-right">
                    <TransactionDialog
                      handleGetTransactions={handleGetTransactions}
                      vendaId={venda.id}
                      initialMetodoPagamento={initialMetodoPagamento}
                      initialTransaction={{
                        valor: saldoDisponivel,
                        valorLiquido: saldoDisponivel,
                      }}
                      maximumAmount={saldoDisponivel}
                      open={open}
                      setOpen={setOpen}
                      selectedTransactionId={selectedTransactionId}
                      setSelectedTransactionId={setSelectedTransactionId}
                      editable={dialogEditavel}
                    >
                      <Button
                        disabled={Boolean(bloqueioNovoPagamento)}
                        className="h-9 w-full rounded-none sm:w-auto"
                        title={bloqueioNovoPagamento ?? "Registrar novo pagamento"}
                      >
                        <ReceiptText className="size-4" aria-hidden="true" />
                        Novo pagamento
                      </Button>
                    </TransactionDialog>
                    {bloqueioNovoPagamento ? (
                      <p className="mt-1 text-[10px] leading-tight text-destructive">
                        {bloqueioNovoPagamento}
                      </p>
                    ) : null}
                  </div>
                }
                toolbar={
                  <FinancialTransactionFiltersBar
                    value={transactionFilters}
                    onChange={setTransactionFilters}
                    onApply={() => handleGetTransactions(1)}
                    onClear={() => {
                      const cleared = { ...EMPTY_FINANCIAL_TRANSACTION_FILTERS };
                      setTransactionFilters(cleared);
                      handleGetTransactions(1, undefined, cleared);
                    }}
                    loading={isLoading}
                  />
                }
                footer={
                  <FinancialTransactionPagination
                    page={pagination.page}
                    totalPages={pagination.totalPages}
                    total={pagination.total}
                    pageCount={transactions.length}
                    limit={pagination.limit}
                    loading={isLoading}
                    onPageChange={(page) => handleGetTransactions(page)}
                  />
                }
              >
                <Table className="min-w-[860px] table-fixed text-xs">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[80px] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Registro</TableHead>
                      <TableHead className="w-[270px] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Descrição</TableHead>
                      <TableHead className="w-[120px] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Data</TableHead>
                      <TableHead className="w-[220px] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Banco e método</TableHead>
                      <TableHead className="w-[140px] px-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Valores</TableHead>
                      <TableHead className="w-[60px] px-3"><span className="sr-only">Ações</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length > 0 ? (
                      transactions.map((t, index) => {
                        const group = t.pagamento_multiplo;
                        const previousGroupId =
                          transactions[index - 1]?.pagamento_multiplo?.id;
                        const startsGroup = group && group.id !== previousGroupId;
                        const alteravel = t.pode_alterar !== false;
                        const receiptContext = {
                          transaction: t,
                          documentType: "Venda" as const,
                          documentId: venda.id,
                          customerName: venda.cliente?.nomerazaosocial,
                        };

                        return (
                          <Fragment key={t.id}>
                            {startsGroup ? (
                              <TableRow className="border-y border-sky-500/25 bg-sky-500/[0.07] hover:bg-sky-500/[0.07]">
                                <TableCell colSpan={6} className="px-3 py-2">
                                  <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.08em] text-sky-700 dark:text-sky-300">
                                    <span>Pagamento múltiplo #{group.id}</span>
                                    <span className="tabular-nums">
                                      {formatarEmReal(Number(group.valor_total ?? 0))}
                                      {group.modo === "PARCELADO" ? " · parcelado" : " · à vista"}
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null}
                            <TableRow className="group hover:bg-primary/[0.04]">
                              <TableCell className="px-3">
                                <span className="inline-flex border border-border bg-muted/30 px-2 py-1 font-bold tabular-nums text-foreground">#{t.id}</span>
                              </TableCell>
                              <TableCell className="whitespace-normal px-3">
                                <p className="line-clamp-2 font-medium text-foreground" title={t.descricao || "Sem descrição"}>
                                  {t.descricao || "Sem descrição"}
                                </p>
                              </TableCell>
                              <TableCell className="px-3 tabular-nums text-muted-foreground">{formatDate(t.data)}</TableCell>
                              <TableCell className="whitespace-normal px-3" title={t.abonado ? "Abonado" : `${t.banco?.titulo ?? "-"} - ${t.metodopagamento ?? "-"}`}>
                                {t.abonado ? (
                                  <p className="truncate font-medium text-muted-foreground">Abonado — não passou pelo banco</p>
                                ) : t.metodopagamento === "CREDITO CLIENTE" ? (
                                  <p className="truncate font-medium text-muted-foreground">Crédito do cliente — não passou pelo banco</p>
                                ) : (
                                  <>
                                    <p className="truncate font-medium text-foreground">{t.banco?.titulo || "Banco não informado"}</p>
                                    <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{t.metodopagamento || "Método não informado"}</p>
                                  </>
                                )}
                              </TableCell>
                              <TableCell className="px-3 text-right">
                                <p className="font-bold tabular-nums text-foreground">{formatarEmReal(t.valor)}</p>
                                <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">Líquido {formatarEmReal(t.valorLiquido)}</p>
                              </TableCell>
                              <TableCell className="px-3 text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="icon" className="size-8 rounded-none" aria-label={`Ações da transação #${t.id}`}>
                                      <ChevronDown className="size-4" aria-hidden="true" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent className="w-52" align="end">
                                    <DropdownMenuItem
                                      onClick={() => {
                                        try {
                                          printTransactionReceipt(receiptContext);
                                        } catch (error) {
                                          toast.error(error instanceof Error ? error.message : "Não foi possível imprimir o recibo.");
                                        }
                                      }}
                                    >
                                      <Printer className="mr-2 size-4" />
                                      Imprimir recibo
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          const result = await shareTransactionReceipt(receiptContext);
                                          if (result === "copied") toast.success("Recibo copiado para compartilhar.");
                                        } catch (error) {
                                          if ((error as Error)?.name !== "AbortError") {
                                            toast.error(error instanceof Error ? error.message : "Não foi possível compartilhar o recibo.");
                                          }
                                        }
                                      }}
                                    >
                                      <Share2 className="mr-2 size-4" />
                                      Compartilhar recibo
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => { setSelectedTransactionId(t.id); setOpen(true); }}>
                                      {podeEditarTransacao && alteravel ? <Pencil className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
                                      {podeEditarTransacao && alteravel ? "Editar lançamento" : "Visualizar lançamento"}
                                    </DropdownMenuItem>
                                    {canEdit &&
                                      alteravel &&
                                      t.pendente === true &&
                                      !t.adiantamento_id &&
                                      !t.eh_adiantamento &&
                                      !t.pagamento_multiplo &&
                                      !t.pagamento_multiplo_id &&
                                      t.evento_financeiro_id == null && (
                                      <TransactionAbonoAlert
                                        transactionId={t.id}
                                        valor={saldoEmAberto(t)}
                                        onAbonar={handleAbonar}
                                      >
                                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                          <HandCoins className="mr-2 size-4" />
                                          Abonar cobrança
                                        </DropdownMenuItem>
                                      </TransactionAbonoAlert>
                                    )}
                                    {!alteravel ? (
                                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                        Lançado por outra pessoa — só ela ou quem pode ver todas as transações altera.
                                      </p>
                                    ) : (
                                      <TransactionDeleteAlert transactionId={t.id} onDelete={handleDeleteTransaction} onDeleteGrupo={handleDeleteGrupo} onEstornar={handleEstornarBaixa}>
                                        <Button variant="ghost" className="h-9 w-full justify-start rounded-none px-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
                                          {t.pagamento_multiplo || t.pendente === false ? (
                                            <RotateCcw className="mr-2 size-4" />
                                          ) : (
                                            <Trash2Icon className="mr-2 size-4" />
                                          )}
                                          {t.pagamento_multiplo
                                            ? "Desfazer pagamento múltiplo"
                                            : t.pendente === false
                                              ? t.abonado
                                                ? "Desfazer abono"
                                                : "Estornar pagamento"
                                              : "Excluir lançamento"}
                                        </Button>
                                      </TransactionDeleteAlert>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        );
                      })
                    ) : (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="h-44 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground">
                            <ReceiptText className="mb-2 size-7 opacity-50" aria-hidden="true" />
                            <p className="text-sm font-semibold text-foreground">
                              {transactionFilters.search || transactionFilters.method || transactionFilters.dateFrom || transactionFilters.dateTo
                                ? "Nenhuma transação encontrada"
                                : "Nenhuma transação registrada"}
                            </p>
                            <p className="mt-1 text-xs">
                              {transactionFilters.search || transactionFilters.method || transactionFilters.dateFrom || transactionFilters.dateTo
                                ? "Revise os filtros aplicados para ampliar a busca."
                                : "Use “Novo pagamento” para registrar o primeiro recebimento."}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </FinancialTransactionsPanel>
            </TabsContent>
          </div>
        </Tabs>

        <FinancialSummaryFooter
          subtotal={subtotalVenda}
          discount={descontoTotalAplicado}
          freight={valorFrete}
          surcharge={acrescimoAplicado}
          total={totalFinanceiro}
          paid={totalPago}
          debt={saldoDevedor}
          paidLabel={resumoFinanceiroVenda.valorPendente > 0 ? "Total coberto" : "Total pago"}
        />
      </div>
    </DialogContent>
  );
}
