import { Ordem } from "@/app/(app)/(pages)/ordens/types";
import { DialogContent } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";
import { Transaction } from "../../../fluxodecaixa/types";
import { Fragment, useEffect, useRef, useState, type ChangeEvent } from "react";
import axios, { isAxiosError } from "axios";
import TransactionDialog from "../../../fluxodecaixa/components/transactionDialog/transactionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Eye, ExternalLink, FileText, HandCoins, Loader, Loader2, Package, Paperclip, Pencil, Percent, Printer, ReceiptText, RotateCcw, Share2, Trash2Icon, Upload } from "lucide-react";
import { useSession } from "next-auth/react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { TransactionDeleteAlert } from "../../../components/transaction-delete-alert";
import { estornarBaixa } from "../../../components/transaction-estorno-alert";
import { TransactionAbonoAlert, abonarTransacao } from "../../../components/transaction-abono-alert";
import { excluirPagamentoMultiplo } from "../../../components/pagamento-multiplo";
import { toast } from "@/lib/toast";
import { formatDate } from "@/utils/formatDate";
import { calculateFinancialSurcharge, calculateFinancialTotal } from "@/lib/financial-surcharge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatPaymentMethodLabel } from "@/lib/payment-methods";
import { valorDeFace, saldoEmAberto } from "@/lib/financeiro/transacao";
import { podeRegistrarPagamentoOs, type ResumoFinanceiroOs } from "@/lib/ordens/financeiro";
import { ClienteResumoCard } from "@/components/cliente/cliente-resumo-card";
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
import { printTransactionReceipt, shareTransactionReceipt } from "../../../components/financial-transaction-receipt";

interface OsContentProps {
  osId: number;
  IsOpen?: boolean;
}

function CampoValorDesconto({
  tipo,
  valor,
  onChange,
  className,
}: {
  tipo: "FIXO" | "PORCENTAGEM" | null | undefined;
  valor: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  if (tipo !== "PORCENTAGEM") {
    return (
      <ValueInput
        value={valor}
        onValueChange={onChange}
        disabled={!tipo}
        className={className}
      />
    );
  }

  return (
    <div className="relative">
      <Input
        type="number"
        min={0}
        max={100}
        step="0.01"
        value={valor > 0 ? valor : ""}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        className={`${className ?? ""} pr-7`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
        %
      </span>
    </div>
  );
}

type OsProdutoItem = {
  ordemservicoid: number;
  produtoid: number;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  descontoTipo?: "FIXO" | "PORCENTAGEM" | null;
  desconto?: number;
  produto?: {
    id: number;
    codigo?: string | null;
    titulo?: string | null;
    descricao?: string | null;
    unidade?: string | null;
  } | null;
};

type OsServicoItem = {
  ordemservicoid: number;
  servicoid: number;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  descontoTipo?: "FIXO" | "PORCENTAGEM" | null;
  desconto?: number;
  descricaoServico?: string | null;
  servico?: {
    id: number;
    codigo?: string | null;
    descricao?: string | null;
  } | null;
};

type OsAnexo = {
  id: number;
  nome: string;
  tipo?: string | null;
  tamanho?: number | null;
  url: string;
  descricao?: string | null;
  createdat?: string | null;
};

// Ajuste conforme a sua estrutura real

/** Espelha o limite aplicado em /api/ordens/[id]/anexos, para avisar antes do envio. */
const MAX_ANEXOS_POR_OS = 10;

const toNum = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const arredondarMoeda = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const calcularDescontoAplicado = (base: number, tipo?: "FIXO" | "PORCENTAGEM" | null, desconto?: number | null) => {
  const baseSeguro = Math.max(0, toNum(base));
  const valor = Math.max(0, toNum(desconto));
  if (!tipo || valor <= 0 || baseSeguro <= 0) return 0;
  if (tipo === "PORCENTAGEM") return arredondarMoeda(baseSeguro * (Math.min(valor, 100) / 100));
  return arredondarMoeda(Math.min(valor, baseSeguro));
};

const calcularTotalComDesconto = (base: number, tipo?: "FIXO" | "PORCENTAGEM" | null, desconto?: number | null) =>
  arredondarMoeda(Math.max(0, toNum(base) - calcularDescontoAplicado(base, tipo, desconto)));

const limitarDesconto = (
  base: number,
  tipo: "FIXO" | "PORCENTAGEM" | null | undefined,
  valor: number,
) => {
  const seguro = Math.max(0, toNum(valor));
  if (tipo === "PORCENTAGEM") return Math.min(seguro, 100);
  if (tipo === "FIXO") return Math.min(seguro, Math.max(0, toNum(base)));
  return 0;
};

export default function OsContent({ osId, IsOpen }: OsContentProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOs, setIsLoadingOs] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
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
  const [ordem, setOrdem] = useState<Ordem | undefined>(undefined);
  const [resumoFinanceiro, setResumoFinanceiro] = useState<ResumoFinanceiroOs | null>(null);
  const [itensProduto, setItensProduto] = useState<OsProdutoItem[]>([]);
  const [itensServico, setItensServico] = useState<OsServicoItem[]>([]);
  const [anexos, setAnexos] = useState<OsAnexo[]>([]);
  const [isLoadingAnexos, setIsLoadingAnexos] = useState(false);
  const [uploadingAnexo, setUploadingAnexo] = useState(false);
  const [deletingAnexoId, setDeletingAnexoId] = useState<number | null>(null);
  const [anexoParaRemover, setAnexoParaRemover] = useState<OsAnexo | null>(null);
  const anexoInputRef = useRef<HTMLInputElement | null>(null);
  const [descontoTipo, setDescontoTipo] = useState<"FIXO" | "PORCENTAGEM" | null>(null);
  const [desconto, setDesconto] = useState(0);
  const [valorFrete, setValorFrete] = useState(0);
  const [acrescimoTipo, setAcrescimoTipo] = useState<"FIXO" | "PORCENTAGEM" | null>(null);
  const [acrescimo, setAcrescimo] = useState(0);
  const [isSavingDiscount, setIsSavingDiscount] = useState(false);
  const [, setIsDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedTransactionId, setSelectedTransactionId] = useState<number | undefined>(undefined);
  const { data: session } = useSession();
  const config = useConfig();
  const canEdit = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_EDITAR,
  );
  // A mesma trava do fluxo de caixa: sem ela o dialog abre em modo leitura.
  const podeEditarTransacao = canEdit && config?.habilitar_edicao_transacoes === true;

  const totalPago = resumoFinanceiro?.valorComprometido ??
    (transactions?.reduce((acc, transaction) => acc + valorDeFace(transaction), 0) ?? 0);
  const subtotalItens = [...itensProduto, ...itensServico].reduce((acc, item) => acc + toNum(item.subtotal), 0);
  const subtotalBrutoItens = [...itensProduto, ...itensServico].reduce(
    (acc, item) => acc + toNum(item.quantidade) * toNum(item.precounitario),
    0,
  );
  const subtotalOrdem = subtotalItens > 0
    ? subtotalItens
    : ordem?.subtotal ?? Math.max(0, toNum(ordem?.orcamentototal) - Math.max(0, valorFrete));
  const subtotalBrutoOrdem = subtotalBrutoItens > 0 ? subtotalBrutoItens : subtotalOrdem;
  const descontoItensAplicado = Math.max(0, arredondarMoeda(subtotalBrutoOrdem - subtotalOrdem));
  const descontoAplicado = calcularDescontoAplicado(subtotalOrdem, descontoTipo, desconto);
  const descontoTotalAplicado = arredondarMoeda(descontoItensAplicado + descontoAplicado);
  const totalComDesconto = calcularTotalComDesconto(subtotalOrdem, descontoTipo, desconto);
  const totalComercial = arredondarMoeda(totalComDesconto + Math.max(0, valorFrete));
  const acrescimoAplicado = calculateFinancialSurcharge(totalComercial, acrescimoTipo, acrescimo);
  const totalFinanceiro = calculateFinancialTotal(totalComercial, acrescimoTipo, acrescimo);
  const saldoDevedor = Math.max(0, totalFinanceiro - totalPago);
  const saldoDisponivel =
    resumoFinanceiro?.saldoDisponivelParaLancamento ?? saldoDevedor;
  const bloqueioNovoPagamento = !podeRegistrarPagamentoOs(ordem?.status, config?.habilitar_faturamento_os)
    ? `A OS está ${ordem?.status?.toLowerCase()}: não é possível registrar pagamentos.`
    : saldoDisponivel <= 0
      ? "A OS já está quitada ou coberta por títulos pendentes."
      : null;
  const alvoLabel =
    ordem?.alvo_tipo === "PECA"
      ? "Peça"
      : ordem?.alvo_tipo === "EQUIPAMENTO"
        ? "Máquina/Equipamento"
        : "Veículo";
  const alvoDescricao =
    ordem?.alvo_tipo === "PECA"
      ? ordem?.peca?.titulo || ordem?.peca?.descricao || "Peça"
      : ordem?.alvo_tipo === "EQUIPAMENTO"
        ? [
            ordem?.equipamento?.nome,
            ordem?.equipamento?.patrimonio
              ? `Patrimônio ${ordem.equipamento.patrimonio}`
              : null,
            ordem?.equipamento?.ano ? `Ano ${ordem.equipamento.ano}` : null,
            ordem?.equipamento?.horimetro != null
              ? `Horímetro ${ordem.equipamento.horimetro}h`
              : null,
          ]
            .filter(Boolean)
            .join(" — ") || "Equipamento não informado"
      : ordem?.veiculo
        ? `${ordem.veiculo.marca ?? ""} ${ordem.veiculo.modelo ?? ""} ${ordem.veiculo.placa ? `- ${ordem.veiculo.placa}` : ""}`.trim()
        : "Não vinculado";

  const formatFileSize = (value?: number | null) => {
    if (!value) return "Tamanho nao informado";
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };
  const isImageAnexo = (anexo: OsAnexo) => String(anexo.tipo ?? "").startsWith("image/");

  // ====== DATA LOADERS
  const handleGetOrdem = async (osId: number, options?: { silent?: boolean }) => {
    if (!options?.silent) setIsLoadingOs(true);
    try {
      const response = await axios.get(`/api/ordens/${osId}`);
      if (response.status === 200) {
        setOrdem(response.data.os);
        setItensProduto(response.data.itensProduto ?? []);
        setItensServico(response.data.itensServico ?? []);
        setDescontoTipo(response.data.os?.desconto_tipo ?? null);
        setDesconto(toNum(response.data.os?.desconto ?? 0));
        setValorFrete(toNum(response.data.os?.valor_frete ?? 0));
        setAcrescimoTipo(response.data.os?.acrescimo_financeiro_tipo ?? null);
        setAcrescimo(toNum(response.data.os?.acrescimo_financeiro_valor ?? 0));
        setResumoFinanceiro(response.data.resumoFinanceiro ?? null);
      }
    } catch {
      toast.error("Não foi possível carregar a OS");
    } finally {
      setHasLoadedOnce(true);
      if (!options?.silent) setIsLoadingOs(false);
    }
  };

  const handleGetTransactions = async (
    pageNumber?: number,
    ordemIdArg?: number,
    filtersArg?: FinancialTransactionFilters,
  ) => {
    const targetId = ordemIdArg ?? ordem?.id;
    if (!targetId) return;
    setIsLoading(true);
    try {
      const filters = filtersArg ?? transactionFilters;
      const response = await axios.get("/api/transaction", {
        params: {
          page: pageNumber || 1,
          limit: pagination.limit,
          ordemservicoid: targetId,
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
        const detalhes = await axios.get(`/api/ordens/${targetId}`);
        setResumoFinanceiro(detalhes.data?.resumoFinanceiro ?? null);
      }
    } catch {
      toast.error("Não foi possível carregar as transações");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetAnexos = async (ordemIdArg?: number) => {
    const targetId = ordemIdArg ?? ordem?.id;
    if (!targetId) return;

    setIsLoadingAnexos(true);
    try {
      const response = await axios.get(`/api/ordens/${targetId}/anexos`);
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
            descricao: item.descricao ?? null,
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

  const handleAnexoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Zera o input para permitir reenviar o mesmo arquivo depois de um erro.
    event.target.value = "";
    if (!file || !ordem?.id) return;

    if (anexos.length >= MAX_ANEXOS_POR_OS) {
      toast.error("Limite de anexos atingido", {
        description: `Esta OS aceita no máximo ${MAX_ANEXOS_POR_OS} anexos.`,
      });
      return;
    }

    setUploadingAnexo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/ordens/${ordem.id}/anexos`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Erro ao anexar arquivo");

      toast.success("Anexo enviado", {
        description: file.type.startsWith("image/")
          ? "Imagem otimizada e anexada à OS."
          : "Arquivo anexado à OS.",
      });
      await handleGetAnexos(ordem.id);
    } catch (error) {
      toast.error("Erro ao anexar", {
        description: error instanceof Error ? error.message : "Erro ao anexar arquivo",
      });
    } finally {
      setUploadingAnexo(false);
    }
  };

  const handleDeleteAnexo = async () => {
    const alvo = anexoParaRemover;
    if (!ordem?.id || !alvo) return;

    const anexoId = alvo.id;
    setAnexoParaRemover(null);
    setDeletingAnexoId(anexoId);
    try {
      const response = await fetch(`/api/ordens/${ordem.id}/anexos/${anexoId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Erro ao remover anexo");

      toast.success("Anexo removido");
      await handleGetAnexos(ordem.id);
    } catch (error) {
      toast.error("Erro ao remover", {
        description: error instanceof Error ? error.message : "Erro ao remover anexo",
      });
    } finally {
      setDeletingAnexoId(null);
    }
  };

  useEffect(() => {
    if (!IsOpen) {
      setTransactions([]);
      setOrdem(undefined);
      setItensProduto([]);
      setItensServico([]);
      setAnexos([]);
      setDescontoTipo(null);
      setDesconto(0);
      setValorFrete(0);
      setAcrescimoTipo(null);
      setAcrescimo(0);
      setResumoFinanceiro(null);
      setHasLoadedOnce(false);
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
      toast.error(erro instanceof Error ? erro.message : "Não foi possível excluir o pagamento.");
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Tira o pagamento do fluxo de caixa e devolve o título para em aberto.
   *
   * Pagamento de OS é quase sempre título liquidado, e liquidado não se exclui:
   * a exclusão apagaria o título junto com o pagamento. Sem esta ação a tela
   * ficaria só com a recusa, mandando a operadora procurar a saída em outro
   * lugar.
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
        erro instanceof Error ? erro.message : "Não foi possível tirar do fluxo de caixa.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Perdoa um título a receber sem lançar nada no banco. A OS continua
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
      const response = await axios.delete(`/api/transaction/${id}`);
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

  useEffect(() => {
    if (osId) {
      setHasLoadedOnce(false);
      handleGetOrdem(osId);
      handleGetTransactions(undefined, osId);
      handleGetAnexos(osId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osId]);

  const handleProdutoDiscountChange = (index: number, patch: Partial<OsProdutoItem>) => {
    setItensProduto((prev) => {
      const next = [...prev];
      const item = { ...next[index], ...patch };
      item.desconto = limitarDesconto(
        item.quantidade * item.precounitario,
        item.descontoTipo,
        toNum(item.desconto ?? 0),
      );
      item.subtotal = calcularTotalComDesconto(item.quantidade * item.precounitario, item.descontoTipo, item.desconto);
      next[index] = item;
      return next;
    });
  };

  const handleServicoDiscountChange = (index: number, patch: Partial<OsServicoItem>) => {
    setItensServico((prev) => {
      const next = [...prev];
      const item = { ...next[index], ...patch };
      item.desconto = limitarDesconto(
        item.quantidade * item.precounitario,
        item.descontoTipo,
        toNum(item.desconto ?? 0),
      );
      item.subtotal = calcularTotalComDesconto(item.quantidade * item.precounitario, item.descontoTipo, item.desconto);
      next[index] = item;
      return next;
    });
  };

  const handleSaveDiscounts = async () => {
    if (!ordem?.id) return;
    setIsSavingDiscount(true);
    try {
      const resposta = await axios.put(`/api/ordens/${ordem.id}/orcamento`, {
        produtos: itensProduto.map((item) => ({
          produtoid: item.produtoid,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        servicos: itensServico.map((item) => ({
          servicoid: item.servicoid,
          descricao: item.descricaoServico ?? null,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        descontoTipo,
        desconto,
        valorFrete,
        acrescimoFinanceiroTipo: acrescimoTipo,
        acrescimoFinanceiroValor: acrescimoTipo ? Math.max(0, acrescimo) : 0,
      });
      toast.success("Descontos e acréscimos salvos.");
      // A reconciliação alcançou mês já fechado na DRE: exige conferência, por
      // isso fica mais tempo em tela que o sucesso.
      const aviso = resposta?.data?.aviso;
      if (aviso) toast.warning(String(aviso), { duration: 10000 });
      await handleGetOrdem(ordem.id, { silent: true });
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

  // ====== RENDER
  if (isLoadingOs) {
    return (
      <DialogContent className={financialDialogContentClass}>
        <FinancialDialogLoadingState label="Dados financeiros da ordem de serviço" />
      </DialogContent>
    );
  }

  if (!ordem && !hasLoadedOnce) {
    return (
      <DialogContent className={financialDialogContentClass}>
        <FinancialDialogLoadingState label="Dados financeiros da ordem de serviço" />
      </DialogContent>
    );
  }

  if (!ordem) {
    return (
      <DialogContent className={financialDialogContentClass}>
        <div className="flex h-full min-h-0 flex-col">
          <FinancialDialogHeader
            entity="Ordem de serviço"
            entityId={osId}
            description="Não foi possível carregar as informações financeiras."
          />
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-muted/25 p-6">
            <div className="max-w-sm space-y-3 border border-border bg-background p-6 text-center shadow-sm">
              <p className="text-sm font-semibold">Não foi possível carregar a OS.</p>
              <Button className="rounded-none" variant="outline" onClick={() => osId && handleGetOrdem(osId)}>
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className={financialDialogContentClass}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <FinancialDialogHeader
          entity="Ordem de serviço"
          entityId={ordem.id}
          description="Consulte a composição da OS, ajuste valores e acompanhe os pagamentos registrados."
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

        <Tabs defaultValue="detalhes" className="min-h-0 min-w-0 flex-1 gap-0 overflow-hidden">
            <div className="shrink-0 border-b border-border bg-background">
              <TabsList className={financialTabListClass}>
                <TabsTrigger value="detalhes" className={financialTabTriggerClass}>
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
                <TabsTrigger value="descontos" className={financialTabTriggerClass}>
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
                <TabsTrigger value="transacoes" className={financialTabTriggerClass}>
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
                  cliente={ordem.cliente}
                  className="xl:col-span-4"
                  onClienteAtualizado={() => handleGetOrdem(ordem.id, { silent: true })}
                />
                <div className="border border-border bg-card p-4 shadow-sm xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">OS</span>
                  <p className="mt-1 text-sm font-medium">{ordem.status || "-"}</p>
                  <p className="text-xs text-muted-foreground">{ordem.setor?.nome || "Sem setor"}</p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Criador da OS</span>
                  <p className="mt-1 text-sm font-medium">{ordem.criador?.nome || ordem.usuariocriadorid || "-"}</p>
                  <p className="text-xs text-muted-foreground">Usuário responsável pela abertura</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Alvo do reparo</span>
                  <p className="mt-1 text-sm font-medium">{alvoLabel}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{alvoDescricao}</p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Cobrança</span>
                  <p className="mt-1 text-sm font-semibold text-primary">{formatarEmReal(totalFinanceiro)}</p>
                  <p className="text-xs text-muted-foreground">Em aberto: {formatarEmReal(saldoDevedor)}</p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Anexos</span>
                  <p className="mt-1 text-sm font-medium">{anexos.length} arquivo(s)</p>
                  <p className="text-xs text-muted-foreground">Vinculados à ordem de serviço</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Pagamento previsto
                  </span>
                  {ordem.pagamentos_previstos?.length ? (
                    <div className="mt-1 space-y-1 text-sm font-medium">
                      {ordem.pagamentos_previstos.map((pagamento) => (
                        <p key={pagamento.metodo}>
                          {formatPaymentMethodLabel(pagamento.metodo)}
                          {pagamento.parcelas ? ` em ${pagamento.parcelas}x` : ""}
                          {" — "}
                          {formatarEmReal(pagamento.valor)}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm font-medium">
                      {ordem.forma_pagamento || "Não informado"}
                      {ordem.parcelas_pagamento
                        ? ` em ${ordem.parcelas_pagamento}x`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Descrição para o financeiro
                  </span>
                  <p className="mt-1 text-sm whitespace-pre-wrap">
                    {ordem.descricao_financeiro || "Não informada"}
                  </p>
                </div>
                <div className="border border-border bg-card p-4 shadow-sm">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Garantia
                  </span>
                  <p className="mt-1 text-sm whitespace-pre-wrap">
                    {ordem.garantia || "Não informada"}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="border border-border bg-card p-4 shadow-sm">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Descrição</span>
                <p className="mt-1 text-sm whitespace-pre-wrap">{ordem.descricao || "Nenhuma descrição informada."}</p>
              </div>
              <div className="border border-border bg-card p-4 shadow-sm">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações internas</span>
                <p className="mt-1 text-sm whitespace-pre-wrap">{ordem.observacoes || "Nenhuma observação interna informada."}</p>
              </div>
              <div className="border border-border bg-card p-4 shadow-sm">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações fiscais</span>
                <p className="mt-1 text-sm whitespace-pre-wrap">{ordem.observacoes_fiscais || "Nenhuma observação fiscal informada."}</p>
              </div>
            </div>
            </TabsContent>

            <TabsContent value="descontos" className="mt-0 space-y-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_150px_auto] lg:items-end">
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-bold">Desconto total</span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Aplicado depois dos descontos individuais.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Tipo</span>
                    <Select
                      value={descontoTipo ?? "NONE"}
                      onValueChange={(value) => {
                        const nextType = value === "NONE" ? null : (value as "FIXO" | "PORCENTAGEM");
                        setDescontoTipo(nextType);
                        setDesconto((current) => limitarDesconto(subtotalOrdem, nextType, current));
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
                      {descontoTipo === "PORCENTAGEM" ? "Percentual (%)" : "Valor"}
                    </span>
                    <CampoValorDesconto
                      tipo={descontoTipo}
                      valor={desconto}
                      onChange={(value) => setDesconto(limitarDesconto(subtotalOrdem, descontoTipo, value))}
                    />
                  </div>
                  <Button type="button" onClick={handleSaveDiscounts} disabled={isSavingDiscount || ordem.status === "CONCLUIDO"}>
                    {isSavingDiscount ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_auto] lg:items-end">
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-bold">Frete da OS</span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Compõe o total comercial e será sugerido integralmente na NF-e.
                    </p>
                  </div>
                  <ValueInput value={valorFrete} onValueChange={setValorFrete} />
                  <Button type="button" onClick={handleSaveDiscounts} disabled={isSavingDiscount || ordem.status === "CONCLUIDO"}>
                    {isSavingDiscount ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_150px_auto] lg:items-end">
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-bold">Acréscimo financeiro</span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Incide somente sobre a cobrança, sem alterar orçamento, itens ou fiscal.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Tipo</span>
                    <Select
                      value={acrescimoTipo ?? "NONE"}
                      onValueChange={(value) => {
                        setAcrescimoTipo(value === "NONE" ? null : (value as "FIXO" | "PORCENTAGEM"));
                        if (value === "NONE") setAcrescimo(0);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Sem acréscimo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Sem acréscimo</SelectItem>
                        <SelectItem value="FIXO">Fixo</SelectItem>
                        <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      {acrescimoTipo === "PORCENTAGEM" ? "Percentual (%)" : "Valor"}
                    </span>
                    <CampoValorDesconto tipo={acrescimoTipo} valor={acrescimo} onChange={setAcrescimo} />
                  </div>
                  <Button type="button" onClick={handleSaveDiscounts} disabled={isSavingDiscount || ordem.status === "CONCLUIDO"}>
                    {isSavingDiscount ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Produtos</span>
                  <div className="mt-2 space-y-2">
                    {itensProduto.length > 0 ? itensProduto.map((item, index) => (
                      <div key={`${item.produtoid}-desconto-${index}`} className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_170px_110px] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.produto?.titulo || item.produto?.descricao || `Produto #${item.produtoid}`}</p>
                          <p className="text-xs text-muted-foreground">{formatarEmReal(item.subtotal)}</p>
                        </div>
                        <Select
                          value={item.descontoTipo ?? "NONE"}
                          onValueChange={(value) =>
                            handleProdutoDiscountChange(index, {
                              descontoTipo: value === "NONE" ? null : (value as "FIXO" | "PORCENTAGEM"),
                              desconto: value === "NONE" ? 0 : item.desconto ?? 0,
                            })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Sem desconto" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">Sem desconto</SelectItem>
                            <SelectItem value="FIXO">Fixo</SelectItem>
                            <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                          </SelectContent>
                        </Select>
                        <CampoValorDesconto
                          tipo={item.descontoTipo}
                          valor={item.desconto ?? 0}
                          onChange={(desconto) => handleProdutoDiscountChange(index, { desconto })}
                          className="h-8"
                        />
                      </div>
                    )) : (
                      <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Nenhum produto.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Serviços</span>
                  <div className="mt-2 space-y-2">
                    {itensServico.length > 0 ? itensServico.map((item, index) => (
                      <div key={`${item.servicoid}-desconto-${index}`} className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_170px_110px] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.servico?.descricao || item.servico?.codigo || `Serviço #${item.servicoid}`}</p>
                          <p className="text-xs text-muted-foreground">{formatarEmReal(item.subtotal)}</p>
                        </div>
                        <Select
                          value={item.descontoTipo ?? "NONE"}
                          onValueChange={(value) =>
                            handleServicoDiscountChange(index, {
                              descontoTipo: value === "NONE" ? null : (value as "FIXO" | "PORCENTAGEM"),
                              desconto: value === "NONE" ? 0 : item.desconto ?? 0,
                            })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Sem desconto" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">Sem desconto</SelectItem>
                            <SelectItem value="FIXO">Fixo</SelectItem>
                            <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                          </SelectContent>
                        </Select>
                        <CampoValorDesconto
                          tipo={item.descontoTipo}
                          valor={item.desconto ?? 0}
                          onChange={(desconto) => handleServicoDiscountChange(index, { desconto })}
                          className="h-8"
                        />
                      </div>
                    )) : (
                      <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Nenhum serviço.</p>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="itens" className="mt-0">
          {itensProduto.length > 0 || itensServico.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Produtos da cobrança</span>
                {itensProduto.length > 0 ? (
                  <div className="mt-2 space-y-1 ">
                    {itensProduto.map((item, index) => (
                      <div
                        key={`${item.produtoid}-${index}`}
                        className="flex items-start justify-between gap-3 text-xs bg-muted/10 rounded-md p-2 border"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold line-clamp-2">
                            {item.produto?.titulo?.toUpperCase()  || `Produto #${item.produtoid}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantidade} x {formatarEmReal(item.precounitario)}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium">{formatarEmReal(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum produto na cobrança.</p>
                )}
              </div>

              <div className="rounded-lg border bg-card p-4">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Serviços da cobrança</span>
                {itensServico.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {itensServico.map((item, index) => (
                      <div
                        key={`${item.servicoid}-${index}`}
                        className="flex items-start justify-between gap-3 text-xs bg-muted/10 rounded-md p-2 border"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold line-clamp-2">
                            {item.servico?.descricao?.toUpperCase() || `Serviço #${item.servicoid}`}
                          </p>
                          <p className="text-muted-foreground">
                            {item.quantidade} x {formatarEmReal(item.precounitario)}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium">{formatarEmReal(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum serviço na cobrança.</p>
                )}
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
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Anexos da OS</span>
                    <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                      {anexos.length}/{MAX_ANEXOS_POR_OS}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <input
                      ref={anexoInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={handleAnexoChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={uploadingAnexo || isLoadingAnexos || anexos.length >= MAX_ANEXOS_POR_OS}
                      onClick={() => anexoInputRef.current?.click()}
                    >
                      {uploadingAnexo ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="mr-1 h-3.5 w-3.5" />
                      )}
                      {uploadingAnexo
                        ? "Enviando..."
                        : anexos.length >= MAX_ANEXOS_POR_OS
                          ? "Limite atingido"
                          : "Anexar"}
                    </Button>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => handleGetAnexos(ordem.id)}
                    >
                      Recarregar
                      <Loader2 className={`h-3 w-3 ${isLoadingAnexos ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Imagem ou PDF, até 10 MB. Imagens são otimizadas no envio.
                </p>

                {isLoadingAnexos ? (
                  <div className="flex h-16 items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
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
                      <div key={anexo.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/50">
                          {isImageAnexo(anexo) ? (
                            <div
                              className="h-full w-full bg-cover bg-center"
                              style={{ backgroundImage: `url(${anexo.url})` }}
                              aria-label={anexo.nome}
                            />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={anexo.nome}>
                            {anexo.nome}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatFileSize(anexo.tamanho)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" variant="outline" size="sm" className="h-8 px-2" asChild>
                            <a href={anexo.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${anexo.nome}`}>
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remover ${anexo.nome}`}
                            disabled={deletingAnexoId === anexo.id || uploadingAnexo}
                            onClick={() => setAnexoParaRemover(anexo)}
                          >
                            {deletingAnexoId === anexo.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2Icon className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
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
                      osId={ordem.id}
                      initialTransaction={{
                        valor: saldoDisponivel,
                        valorLiquido: saldoDisponivel,
                      }}
                      maximumAmount={saldoDisponivel}
                      open={open}
                      setOpen={setOpen}
                      selectedTransactionId={selectedTransactionId}
                      setSelectedTransactionId={setSelectedTransactionId}
                      editable={podeEditarTransacao}
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
                        const previousGroupId = transactions[index - 1]?.pagamento_multiplo?.id;
                        const startsGroup = group && group.id !== previousGroupId;
                        const receiptContext = {
                          transaction: t,
                          documentType: "Ordem de serviço" as const,
                          documentId: ordem.id,
                          customerName: ordem.cliente?.nome,
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
                                      {podeEditarTransacao ? <Pencil className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
                                      {podeEditarTransacao ? "Editar lançamento" : "Visualizar lançamento"}
                                    </DropdownMenuItem>
                                    {canEdit &&
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
          subtotal={subtotalBrutoOrdem}
          discount={descontoTotalAplicado}
          freight={valorFrete}
          surcharge={acrescimoAplicado}
          total={totalFinanceiro}
          paid={totalPago}
          debt={saldoDevedor}
          paidLabel="Total coberto"
        />
      </div>

      <AlertDialog
        open={anexoParaRemover !== null}
        onOpenChange={(open) => {
          if (!open) setAnexoParaRemover(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover este anexo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O arquivo é apagado do armazenamento e o
              vínculo com a OS é removido.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="truncate font-medium" title={anexoParaRemover?.nome}>
              {anexoParaRemover?.nome}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(anexoParaRemover?.tamanho)}
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel className="hover:cursor-pointer">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:cursor-pointer"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteAnexo();
              }}
            >
              Remover anexo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContent>
  );
}


