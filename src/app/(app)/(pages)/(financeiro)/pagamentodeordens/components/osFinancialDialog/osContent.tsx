import { Ordem } from "@/app/(app)/(pages)/ordens/types";
import { DialogContent, DialogDescription, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";
import { Transaction } from "../../../fluxodecaixa/types";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import axios, { isAxiosError } from "axios";
import TransactionDialog from "../../../fluxodecaixa/components/transactionDialog/transactionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Eye, ExternalLink, FileText, Loader, Loader2, Package, Paperclip, Pencil, Percent, ReceiptText, Trash2Icon, Upload } from "lucide-react";
import { useSession } from "next-auth/react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { TransactionDeleteAlert } from "../../../components/transaction-delete-alert";
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

const tabTriggerClass =
  "group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

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
  const [ordem, setOrdem] = useState<Ordem | undefined>(undefined);
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

  const totalPago = transactions?.reduce((acc, t) => acc + Number(t?.valor ?? 0), 0) ?? 0;
  const subtotalItens = [...itensProduto, ...itensServico].reduce((acc, item) => acc + toNum(item.subtotal), 0);
  const subtotalBrutoItens = [...itensProduto, ...itensServico].reduce(
    (acc, item) => acc + toNum(item.quantidade) * toNum(item.precounitario),
    0,
  );
  const subtotalOrdem = subtotalItens > 0 ? subtotalItens : ordem?.subtotal ?? ordem?.orcamentototal ?? 0;
  const subtotalBrutoOrdem = subtotalBrutoItens > 0 ? subtotalBrutoItens : subtotalOrdem;
  const descontoItensAplicado = Math.max(0, arredondarMoeda(subtotalBrutoOrdem - subtotalOrdem));
  const descontoAplicado = calcularDescontoAplicado(subtotalOrdem, descontoTipo, desconto);
  const descontoTotalAplicado = arredondarMoeda(descontoItensAplicado + descontoAplicado);
  const totalComDesconto = calcularTotalComDesconto(subtotalOrdem, descontoTipo, desconto);
  const acrescimoAplicado = calculateFinancialSurcharge(totalComDesconto, acrescimoTipo, acrescimo);
  const totalFinanceiro = calculateFinancialTotal(totalComDesconto, acrescimoTipo, acrescimo);
  const saldoDevedor = Math.max(0, totalFinanceiro - totalPago);
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
        setAcrescimoTipo(response.data.os?.acrescimo_financeiro_tipo ?? null);
        setAcrescimo(toNum(response.data.os?.acrescimo_financeiro_valor ?? 0));
      }
    } catch {
      toast.error("Não foi possível carregar a OS");
    } finally {
      setHasLoadedOnce(true);
      if (!options?.silent) setIsLoadingOs(false);
    }
  };

  const handleGetTransactions = async (pageNumber?: number, ordemIdArg?: number) => {
    const targetId = ordemIdArg ?? ordem?.id;
    if (!targetId) return;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/transaction", {
        params: {
          page: pageNumber || 1,
          limit: pagination.limit,
          ordemservicoid: targetId,
          tipo: "RECEITA",
          excluirEventosFinanceiros: true,
        },
      });
      if (response.status === 200) {
        const { data } = response;
        setTransactions(data.data);
        setPagination(data.pagination);
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
      setAcrescimoTipo(null);
      setAcrescimo(0);
      setHasLoadedOnce(false);
    }
  }, [IsOpen]);

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
      <DialogContent className="h-dvh w-[100svw] max-w-[100svw] overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[95vw] sm:max-w-[1100px] sm:rounded-2xl">
        <DialogHeader className="hidden">
          <DialogTitle></DialogTitle>
        </DialogHeader>
        <div className="flex h-full min-h-0 flex-col justify-center items-center">
          <div className="size-8 border-t-2 border-primary rounded-t-full animate-spin"></div>
          <span className="text-primary">Carregando</span>
        </div>
      </DialogContent>
    );
  }

  if (!ordem && !hasLoadedOnce) {
    return (
      <DialogContent className="h-dvh w-[100svw] max-w-[100svw] overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[95vw] sm:max-w-[1100px] sm:rounded-2xl">
        <DialogHeader className="hidden">
          <DialogTitle></DialogTitle>
        </DialogHeader>
        <div className="flex h-full min-h-0 flex-col justify-center items-center">
          <div className="size-8 border-t-2 border-primary rounded-t-full animate-spin"></div>
          <span className="text-primary">Carregando</span>
        </div>
      </DialogContent>
    );
  }

  if (!ordem) {
    return (
      <DialogContent className="h-dvh w-[100svw] max-w-[100svw] overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[95vw] sm:max-w-[1100px] sm:rounded-2xl">
        <div className="flex h-full min-h-0 flex-col justify-center items-center">
          <div className="max-w-sm space-y-3 text-center">
            <p className="text-sm font-medium">Não foi possível carregar a OS.</p>
            <Button variant="outline" onClick={() => osId && handleGetOrdem(osId)}>
              Tentar novamente
            </Button>
          </div>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="h-dvh w-[100svw] max-w-[100svw] overflow-hidden rounded-none p-0 sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[95vw] sm:max-w-[1100px] sm:rounded-2xl">
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <DialogHeader className="shrink-0 px-6 py-4 border-b">
          <DialogTitle>
            OS #{ordem.id} <span className="text-muted-foreground text-sm font-light"> | PAGAMENTOS </span>
          </DialogTitle>
          <DialogDescription>Pagamentos da OS</DialogDescription>
        </DialogHeader>

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

        <div className="min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-6 py-4 dark:bg-muted-foreground/5">
          <Tabs defaultValue="detalhes" className="space-y-3">
            <div className="pb-1">
              <TabsList className="grid h-auto w-full grid-cols-5 gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                <TabsTrigger value="detalhes" className={tabTriggerClass}>
                  <span className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                    Detalhes
                  </span>
                </TabsTrigger>
                <TabsTrigger value="itens" className={tabTriggerClass}>
                  <span className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                    Itens
                  </span>
                </TabsTrigger>
                <TabsTrigger value="descontos" className={tabTriggerClass}>
                  <span className="flex items-center gap-2">
                    <Percent className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                    Descontos e Acréscimos
                  </span>
                </TabsTrigger>
                <TabsTrigger value="anexos" className={tabTriggerClass}>
                  <span className="flex items-center gap-2">
                    <Paperclip className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                    Anexos
                  </span>
                </TabsTrigger>
                <TabsTrigger value="transacoes" className={tabTriggerClass}>
                  <span className="flex items-center gap-2">
                    <ReceiptText className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                    Transações
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="detalhes" className="mt-0 space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
                <div className="rounded-lg border bg-card p-4 xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Cliente</span>
                  <p className="mt-1 text-sm font-medium">{ordem.cliente?.nome || ordem.cliente?.nomerazaosocial || "-"}</p>
                  <p className="text-xs text-muted-foreground">
                    {ordem.cliente?.telefone || ordem.cliente?.email || "Sem contato"}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4 xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">OS</span>
                  <p className="mt-1 text-sm font-medium">{ordem.status || "-"}</p>
                  <p className="text-xs text-muted-foreground">{ordem.setor?.nome || "Sem setor"}</p>
                </div>
                <div className="rounded-lg border bg-card p-4 xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Criador da OS</span>
                  <p className="mt-1 text-sm font-medium">{ordem.criador?.nome || ordem.usuariocriadorid || "-"}</p>
                  <p className="text-xs text-muted-foreground">Usuário responsável pela abertura</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Alvo</span>
                  <p className="mt-1 text-sm font-medium">{alvoLabel}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{alvoDescricao}</p>
                </div>

                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Cobrança</span>
                  <p className="mt-1 text-sm font-medium">{formatarEmReal(totalFinanceiro)}</p>
                  <p className="text-xs text-muted-foreground">Aberto: {formatarEmReal(saldoDevedor)}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-lg border bg-card p-4">
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
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Descrição para o financeiro
                  </span>
                  <p className="mt-1 text-sm whitespace-pre-wrap">
                    {ordem.descricao_financeiro || "Não informada"}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Garantia
                  </span>
                  <p className="mt-1 text-sm whitespace-pre-wrap">
                    {ordem.garantia || "Não informada"}
                  </p>
                </div>
              </div>
          {ordem.descricao || ordem.observacoes || ordem.observacoes_fiscais ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded-lg border bg-card p-4">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Descrição</span>
                <p className="mt-1 text-sm whitespace-pre-wrap">{ordem.descricao || "-"}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações</span>
                <p className="mt-1 text-sm whitespace-pre-wrap">{ordem.observacoes || "-"}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações fiscais</span>
                <p className="mt-1 text-sm whitespace-pre-wrap">{ordem.observacoes_fiscais || "-"}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-background px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma observação informada.
            </div>
          )}
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

            <TabsContent value="transacoes" className="mt-0 space-y-3">
          <div className="flex flex-row items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="m-0 text-base font-semibold">Transações: {transactions.length}</h1>

              <button
                type="button"
                className="flex w-fit flex-row items-center gap-1 text-xs text-muted-foreground transition-colors hover:cursor-pointer hover:text-foreground"
                onClick={() => handleGetTransactions()}
              >
                <span>Recarregar</span>
                <Loader2 className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <TransactionDialog
              handleGetTransactions={handleGetTransactions}
              osId={ordem.id}
              open={open}
              setOpen={setOpen}
              selectedTransactionId={selectedTransactionId}
              setSelectedTransactionId={setSelectedTransactionId}
              editable={podeEditarTransacao}
            >
              <Button disabled={ordem.status === "CONCLUIDO"} className="hover:cursor-pointer">
                Novo pagamento
              </Button>
            </TransactionDialog>
          </div>

          <Separator />

          {/* WRAPPER para rolagem horizontal no mobile */}
          <div className="w-full min-w-0 overflow-x-auto">
            <Table className="w-full table-fixed text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">ID</TableHead>
                  <TableHead className="w-[220px]">DESCRIÇÃO</TableHead>
                  <TableHead className="w-[120px]">DATA</TableHead>
                  <TableHead className="w-[220px]">BANCO/MÉTODO</TableHead>
                  <TableHead className="w-[120px]">VALOR</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length > 0 ? (
                  transactions.map((t) => (
                    <TableRow key={t.id} className="hover:cursor-pointer">
                      <TableCell className="whitespace-nowrap">{t.id}</TableCell>
                      <TableCell className="truncate max-w-[140px] sm:max-w-[220px]" title={t.descricao || "-"}>
                        {t.descricao}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(t.data)}</TableCell>
                      <TableCell
                        className="truncate max-w-[160px] sm:max-w-[220px]"
                        title={`${t.banco?.titulo ?? "-"} - ${t.metodopagamento ?? "-"}`}
                      >
                        {t.banco?.titulo} - {t.metodopagamento}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span>{formatarEmReal(t.valor)}</span>
                          <span className="text-xs text-muted-foreground">
                            Líquido: {formatarEmReal(t.valorLiquido)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer" aria-label="Ações">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="space-y-1 w-40" align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedTransactionId(t.id);
                                setOpen(true);
                              }}
                            >
                              {podeEditarTransacao ? (
                                <>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Editar
                                </>
                              ) : (
                                <>
                                  <Eye className="mr-2 h-4 w-4" />
                                  Visualizar
                                </>
                              )}
                            </DropdownMenuItem>
                            <TransactionDeleteAlert transactionId={t.id} onDelete={handleDeleteTransaction}>
                              <Button
                                variant="default"
                                className="size-full flex justify-start gap-5 px-0 rounded-sm py-2 hover:cursor-pointer bg-red-500/20 hover:bg-red-500 group hover:text-white transition-all"
                              >
                                <Trash2Icon className="-ml-1 -mr-1 h-4 w-4" />
                                <span>Excluir</span>
                              </Button>
                            </TransactionDeleteAlert>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell className="col-span-full">Sem Transações</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background">
          <div className="flex w-full flex-col justify-start gap-1 text-xs bg-card p-4">
            <span className="text-sm font-medium">Resumo:</span>
            <Separator />
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Subtotal:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left tabular-nums">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span></span>
                  <span>{formatarEmReal(subtotalBrutoOrdem)}</span>
                </span>
              </h1>
            </div>
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Desconto:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left tabular-nums">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span>-</span>
                  <span>{formatarEmReal(descontoTotalAplicado)}</span>
                </span>
              </h1>
            </div>
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Acréscimo financeiro:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left tabular-nums">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span>+</span>
                  <span>{formatarEmReal(acrescimoAplicado)}</span>
                </span>
              </h1>
            </div>
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Total a Pagar:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left tabular-nums">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span></span>
                  <span className="font-bold text-primary">{formatarEmReal(totalFinanceiro)}</span>
                </span>
              </h1>
            </div>
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Total Pago:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left font-bold tabular-nums text-blue-500">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span></span>
                  <span>{formatarEmReal(totalPago)}</span>
                </span>
              </h1>
            </div>
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Saldo Devedor:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left font-bold tabular-nums text-red-400">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span></span>
                  <span>{formatarEmReal(saldoDevedor)}</span>
                </span>
              </h1>
            </div>
            <div className="w-full flex flex-col space-y-1"></div>
          </div>
        </DialogFooter>
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


