import { DialogContent, DialogDescription, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";
import { Metodo_pagamento, Transaction } from "../../../fluxodecaixa/types";
import { useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import TransactionDialog from "../../../fluxodecaixa/components/transactionDialog/transactionDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ExternalLink, FileText, Loader, Loader2, Package, Paperclip, Percent, ReceiptText, Trash2Icon } from "lucide-react";
import DeleteAlert from "./deleteAlert";
import { toast } from "@/lib/toast";
import { formatDate } from "@/utils/formatDate";
import { VendaComItens } from "@/app/(app)/(pages)/(vendas)/historicovendas/types";
import {
  getVendaAnexoCategoriaLabel,
  type VendaAnexoCategoria,
} from "@/lib/venda-anexo-categorias";

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
};

const tabTriggerClass =
  "group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

const toNum = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const arredondarMoeda = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const calcularDescontoAplicado = (base: number, tipo: TipoDesconto, desconto: number) => {
  const baseSeguro = Math.max(0, toNum(base));
  const valor = Math.max(0, toNum(desconto));
  if (!tipo || valor <= 0 || baseSeguro <= 0) return 0;
  if (tipo === "PORCENTAGEM") return arredondarMoeda(baseSeguro * (Math.min(valor, 100) / 100));
  return arredondarMoeda(Math.min(valor, baseSeguro));
};

const calcularTotalComDesconto = (base: number, tipo: TipoDesconto, desconto: number) =>
  arredondarMoeda(Math.max(0, toNum(base) - calcularDescontoAplicado(base, tipo, desconto)));

// Ajuste conforme a sua estrutura real

export default function VendasContent({ vendaId, IsOpen }: VendasContentProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOs, setIsLoadingOs] = useState(false);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [venda, setVenda] = useState<VendaComItens | undefined>(undefined);
  const [anexos, setAnexos] = useState<VendaAnexo[]>([]);
  const [isLoadingAnexos, setIsLoadingAnexos] = useState(false);
  const [descontoTipo, setDescontoTipo] = useState<TipoDesconto>(null);
  const [desconto, setDesconto] = useState(0);
  const [isSavingDiscount, setIsSavingDiscount] = useState(false);
  const [, setIsDeleting] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const totalPago = transactions?.reduce((acc, t) => acc + Number(t?.valor ?? 0), 0) ?? 0;
  const subtotalVenda = toNum(venda?.sub_total ?? venda?.valortotal ?? 0);
  const descontoAplicado = calcularDescontoAplicado(subtotalVenda, descontoTipo, desconto);
  const totalComDesconto = calcularTotalComDesconto(subtotalVenda, descontoTipo, desconto);
  const saldoDevedor = totalComDesconto - totalPago;
  const initialMetodoPagamento = (() => {
    const value = String(venda?.forma_pagamento ?? "").toUpperCase();
    return Object.values(Metodo_pagamento).includes(value as Metodo_pagamento)
      ? (value as Metodo_pagamento)
      : undefined;
  })();
  const formatFileSize = (value?: number | null) => {
    if (!value) return "Tamanho não informado";
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };
  const isImageAnexo = (anexo: VendaAnexo) => String(anexo.tipo ?? "").startsWith("image/");
  const paymentMethods = (() => {
    const raw = String(venda?.forma_pagamento ?? "").trim();
    if (!raw) return [];

    if (raw.includes(":")) {
      return raw.split(/,\s+(?=[A-Z_]+:)/).map((entry) => {
        const [method, ...amountParts] = entry.split(":");
        const key = method.trim().toUpperCase();
        return {
          method: PAYMENT_METHOD_LABELS[key] ?? method.trim(),
          amount: amountParts.join(":").trim() || null,
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
        };
      });
  })();

  // ====== DATA LOADERS
  const handleGetVenda = async (vendaId: number, options?: { silent?: boolean }) => {
    if (!options?.silent) setIsLoadingOs(true);
    try {
      const response = await axios.get(`/api/venda/${vendaId}`);
      if (response.status === 200) {
        const nextVenda = response.data.data as VendaComItens;
        setVenda(nextVenda);
        setDescontoTipo(
          nextVenda.desconto_tipo === "FIXO" || nextVenda.desconto_tipo === "PORCENTAGEM"
            ? nextVenda.desconto_tipo
            : null,
        );
        setDesconto(toNum(nextVenda.desconto_valor ?? 0));
      }
    } catch {
      toast.error("Não foi possível carregar a Venda");
    } finally {
      if (!options?.silent) setIsLoadingOs(false);
    }
  };

  const handleGetTransactions = async (pageNumber?: number, vendaIdArg?: number) => {
    const targetId = vendaIdArg ?? venda?.id;
    if (!targetId) return;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/transaction", {
        params: {
          page: pageNumber || 1,
          limit: pagination.limit,
          vendaid: targetId,
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
      setIsAlertOpen(false);
    }
  };

  const handleSaveDiscounts = async () => {
    if (!venda?.id) return;
    if (totalComDesconto < totalPago) {
      toast.error("O total com desconto não pode ficar menor que o total já pago.");
      return;
    }

    setIsSavingDiscount(true);
    try {
      await axios.patch(`/api/venda/${venda.id}`, {
        descontoTipo,
        descontoValor: descontoTipo ? Math.max(0, desconto) : 0,
        subTotal: subtotalVenda,
        valorTotal: totalComDesconto,
      });
      toast.success("Desconto salvo.");
      await handleGetVenda(venda.id, { silent: true });
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao salvar desconto", {
          description: error.response?.data?.error || "Tente novamente.",
        });
      } else {
        toast.error("Erro ao salvar desconto");
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
      <DialogContent className="h-dvh w-[100svw] max-w-[100svw] p-0 overflow-hidden rounded-none sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:rounded-2xl">
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

  if (!venda) return null;

  return (
    <DialogContent className="h-svh w-[100svw] max-w-[100svw] p-0 overflow-hidden rounded-none sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:rounded-2xl">
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <DialogHeader className="shrink-0 px-6 py-4 border-b">
          <DialogTitle>
            Venda #{venda.id} <span className="text-muted-foreground text-sm font-light"> | PAGAMENTOS </span>
          </DialogTitle>
          <DialogDescription>Pagamentos da Venda</DialogDescription>
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

        <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden min-w-0 dark:bg-muted-foreground/5 px-6 py-4 space-y-2">
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
                    Descontos
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
                  <p className="mt-1 truncate text-sm font-medium" title={venda.cliente?.nomerazaosocial || "-"}>
                    {venda.cliente?.nomerazaosocial || "-"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {venda.cliente?.telefone || venda.cliente?.email || "Sem contato"}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-4 xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Venda</span>
                  <p className="mt-1 text-sm font-medium">{venda.status || "-"}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(venda.datavenda)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4 xl:col-span-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Vendedor</span>
                  <p className="mt-1 truncate text-sm font-medium">{venda.criador?.nome || venda.created_by || "-"}</p>
                  <p className="text-xs text-muted-foreground">Responsável pela venda</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Cobrança</span>
                  <p className="mt-1 text-sm font-medium">{formatarEmReal(totalComDesconto)}</p>
                  <p className="text-xs text-muted-foreground">Aberto: {formatarEmReal(saldoDevedor)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Itens</span>
                  {venda.itens?.length ? (
                    <div className="mt-2 space-y-2">
                      {venda.itens.slice(0, 3).map((item) => (
                        <div key={`detalhes-item-${item.id}`} className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {item.produto?.titulo || item.produto?.descricao || `Produto #${item.produtoid}`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.quantidade} x{" "}
                              {formatarEmReal((item.valor_total || 0) / Math.max(item.quantidade || 1, 1))}
                            </p>
                          </div>
                          <span className="shrink-0 font-medium">{formatarEmReal(item.valor_total)}</span>
                        </div>
                      ))}
                      {venda.itens.length > 3 ? (
                        <p className="text-xs text-muted-foreground">+ {venda.itens.length - 3} item(ns) na aba Itens</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Nenhum item informado.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Desconto</span>
                  <p className="mt-1 text-sm font-medium">
                    {descontoTipo ? `${descontoTipo} - ${descontoTipo === "PORCENTAGEM" ? `${desconto}%` : formatarEmReal(desconto)}` : "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">Aplicado: {formatarEmReal(descontoAplicado)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Anexos</span>
                  <p className="mt-1 text-sm font-medium">{anexos.length} arquivo(s)</p>
                  <p className="text-xs text-muted-foreground">Vinculados à venda</p>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Métodos de pagamento</span>
                  <Badge variant="outline">{paymentMethods.length}</Badge>
                </div>
                {paymentMethods.length > 0 ? (
                  <div className="divide-y rounded-md border">
                    {paymentMethods.map((item, index) => (
                      <div key={`${item.method}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="truncate font-medium">{item.method}</span>
                        <span className="shrink-0 text-muted-foreground">{item.amount ?? "Valor não informado"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                    Nenhum método informado.
                  </div>
                )}
              </div>

              {venda.observacoes_fiscais ? (
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Observações fiscais</span>
                  <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">{venda.observacoes_fiscais}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma observação fiscal informada.
                </div>
              )}
            </TabsContent>

            <TabsContent value="descontos" className="mt-0 space-y-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_200px_150px_auto] lg:items-end">
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Desconto total</span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Aplicado sobre o subtotal da venda.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Tipo</span>
                    <Select
                      value={descontoTipo ?? "NONE"}
                      onValueChange={(value) => {
                        setDescontoTipo(value === "NONE" ? null : (value as Exclude<TipoDesconto, null>));
                        if (value === "NONE") setDesconto(0);
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
                    <div className="relative">
                      {descontoTipo === "PORCENTAGEM" ? (
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={desconto > 0 ? desconto : ""}
                        disabled={!descontoTipo}
                        onChange={(event) => setDesconto(Number(event.target.value || 0))}
                        className="pr-8"
                      />
                      ) : (
                        <ValueInput value={desconto} onValueChange={setDesconto} disabled={!descontoTipo} />
                      )}
                      {descontoTipo === "PORCENTAGEM" ? (
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                          %
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button type="button" onClick={handleSaveDiscounts} disabled={isSavingDiscount || venda.status === "FINALIZADA"}>
                    {isSavingDiscount ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Subtotal</span>
                  <p className="mt-1 text-sm font-medium">{formatarEmReal(subtotalVenda)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Desconto aplicado</span>
                  <p className="mt-1 text-sm font-medium">- {formatarEmReal(descontoAplicado)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</span>
                  <p className="mt-1 text-sm font-medium">{formatarEmReal(totalComDesconto)}</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="itens" className="mt-0">
              {venda.itens?.length ? (
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Itens da cobrança</span>
                    <Badge variant="outline">{venda.itens.length}</Badge>
                  </div>
                  <div className="divide-y rounded-md border">
                    {venda.itens.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium line-clamp-2">
                            {item.produto?.titulo || item.produto?.descricao || `Produto #${item.produtoid}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantidade} x{" "}
                            {formatarEmReal((item.valor_total || 0) / Math.max(item.quantidade || 1, 1))}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium">{formatarEmReal(item.valor_total)}</span>
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
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Anexos da venda</span>
                    <Badge variant="outline">{anexos.length}</Badge>
                  </div>
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleGetAnexos(venda.id)}
                  >
                    Recarregar
                    <Loader2 className={`h-3 w-3 ${isLoadingAnexos ? "animate-spin" : ""}`} />
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
                      <div key={anexo.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/50">
                          {isImageAnexo(anexo) ? (
                            <img src={anexo.url} alt={anexo.nome} className="h-full w-full object-cover" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={anexo.nome}>
                            {anexo.nome}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {getVendaAnexoCategoriaLabel(anexo.categoria)} - {formatFileSize(anexo.tamanho)}
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 px-2" asChild>
                          <a href={anexo.url} target="_blank" rel="noreferrer" aria-label="Abrir anexo">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="transacoes" className="mt-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h1 className="m-0 text-base font-semibold">Transações: {transactions.length}</h1>
                  <button
                    type="button"
                    className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleGetTransactions()}
                  >
                    <span>Recarregar</span>
                    <Loader2 className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <TransactionDialog
                  handleGetTransactions={handleGetTransactions}
                  vendaId={venda.id}
                  initialMetodoPagamento={initialMetodoPagamento}
                  open={open}
                  setOpen={setOpen}
                >
                  <Button disabled={venda.status === "FINALIZADA"} className="hover:cursor-pointer">
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
                                <DeleteAlert
                                  statusVenda={venda.status}
                                  handleDeleteTransaction={handleDeleteTransaction}
                                  isAlertOpen={isAlertOpen}
                                  setIsAlertOpen={setIsAlertOpen}
                                  idToDelete={t.id}
                                >
                                  <Button
                                    variant="default"
                                    className="size-full flex justify-start gap-5 px-0 rounded-sm py-2 hover:cursor-pointer bg-red-500/20 hover:bg-red-500 group hover:text-white transition-all"
                                  >
                                    <Trash2Icon className="-ml-1 -mr-1 h-4 w-4" />
                                    <span>Excluir</span>
                                  </Button>
                                </DeleteAlert>
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

        <DialogFooter className="px-6 py-4 border-t">
          <div className="flex w-full flex-col justify-start gap-2.5 text-xs bg-card p-4">
            <span className="text-sm font-medium">Resumo:</span>
            <Separator />
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Subtotal:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left tabular-nums">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span></span>
                  <span>{formatarEmReal(subtotalVenda)}</span>
                </span>
              </h1>
            </div>
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Desconto:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left tabular-nums">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span>-</span>
                  <span>{formatarEmReal(descontoAplicado)}</span>
                </span>
              </h1>
            </div>
            <div className="grid w-full grid-cols-[max-content_minmax(24px,1fr)_max-content] items-center gap-2">
              <span className="text-nowrap">Total a Pagar:</span>
              <div className="h-full w-full border-b border-dashed"></div>
              <h1 className="text-left tabular-nums">
                <span className="inline-grid grid-cols-[0.75rem_auto]">
                  <span></span>
                  <span>{formatarEmReal(totalComDesconto)}</span>
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
              <h1 className="text-left font-bold tabular-nums text-gray-400">
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
    </DialogContent>
  );
}
