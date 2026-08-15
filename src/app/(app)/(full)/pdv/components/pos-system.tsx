"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  Wrench,
  AlertCircle,
  Loader2,
  AlertTriangle,
  Store,
  UserRoundX,
  CircleOff,
  ArrowLeftToLine,
  ReceiptText,
  Info,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import Image from "next/image";
import { Estoque_status, Produto } from "@/app/(app)/(pages)/estoque/types";
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectContent,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import { Customer } from "@/app/(app)/(pages)/clientes/types";
import { useGruposProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/hooks/use-grupo-produtos";
import { useRouter } from "next/navigation";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { formatCurrencyBRL } from "@/app/(app)/(pages)/dashboard/components/dashboard-ordemservico/lib/format";
import { CustomerBlockedAlert } from "@/components/cliente/customer-blocked-alert";
import {
  dadosParaFinanceiroVazios,
  montarFormaPagamento,
  montarPagamentosPrevistos,
  validarDadosParaFinanceiro,
  type DadosParaFinanceiro,
} from "@/components/financeiro/dados-para-financeiro";
import { VendaConfirmacaoFields } from "@/components/vendas/venda-confirmacao-fields";

interface CartItem {
  id: number;
  titulo: string;
  precovenda: number;
  quantity: number;
  grupo: string;
  estoque: number;
}

type DiscountType = "FIXO" | "PORCENTAGEM";
type CategoriaVenda = {
  id: number;
  nome: string;
  descricao?: string | null;
  ativo?: boolean | null;
};

const moneyToCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);

export function POSSystem() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProductsPage, setLoadingProductsPage] = useState(false);
  const [productsPage, setProductsPage] = useState(1);
  const [productsTotalPages, setProductsTotalPages] = useState(1);
  const [productsTotal, setProductsTotal] = useState(0);
  const [categoriasVenda, setCategoriasVenda] = useState<CategoriaVenda[]>([]);
  const [loadingCategoriasVenda, setLoadingCategoriasVenda] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("TODOS");
  const [selectedSaleCategoryId, setSelectedSaleCategoryId] = useState<number | null>(null);
  const [creatingVenda, setCreatingVenda] = useState(false);
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<
    Customer | undefined
  >(undefined);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [hasFreight, setHasFreight] = useState(false);
  const [freight, setFreight] = useState(0);
  // Formas previstas, orientação ao financeiro e garantia — o mesmo conjunto que
  // a OS recolhe ao ser enviada ao financeiro.
  const [dadosFinanceiro, setDadosFinanceiro] = useState<DadosParaFinanceiro>(
    dadosParaFinanceiroVazios,
  );
  const [descricao, setDescricao] = useState("");
  const [observacoesInternas, setObservacoesInternas] = useState("");
  const [observacoesFiscais, setObservacoesFiscais] = useState("");
  const [acaoConfirmacao, setAcaoConfirmacao] = useState<"ORCAMENTO" | "PAGAMENTO">(
    "PAGAMENTO",
  );
  const [selectedProductInfo, setSelectedProductInfo] = useState<Produto>();
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const { grupos } = useGruposProduto();
  const router = useRouter();
  const config = useConfig();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSubmittedSearch(searchTerm.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const fetchProdutos = useCallback(async (page: number) => {
    setLoadingProductsPage(true);
    try {
      const response = await axios.get("/api/pdv/products", {
        params: {
          page,
          limit: 48,
          q: submittedSearch || undefined,
          groupId: selectedCategory === "TODOS" ? undefined : selectedCategory,
        },
      });
      const items: Produto[] = Array.isArray(response.data?.data)
        ? response.data.data
        : [];
      setProdutos(items);
      setProductsPage(Number(response.data?.pagination?.page ?? page));
      setProductsTotalPages(Number(response.data?.pagination?.totalPages ?? 1));
      setProductsTotal(Number(response.data?.pagination?.total ?? items.length));
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Falha ao buscar produtos", {
          description: error.response?.data?.error || error.message,
        });
      }
      setProdutos([]);
    } finally {
      setLoading(false);
      setLoadingProductsPage(false);
    }
  }, [submittedSearch, selectedCategory]);

  useEffect(() => {
    void fetchProdutos(1);
  }, [fetchProdutos]);

  useEffect(() => {
    const fetchCategoriasVenda = async () => {
      try {
        setLoadingCategoriasVenda(true);
        const response = await axios.get("/api/tipos/categorias-venda", {
          params: { ativo: "true" },
        });
        const items = Array.isArray(response.data?.items)
          ? response.data.items.map((categoria: any) => ({
              id: Number(categoria.id),
              nome: String(categoria.nome ?? ""),
              descricao: categoria.descricao ?? null,
              ativo: typeof categoria.ativo === "boolean" ? categoria.ativo : true,
            }))
          : [];
        setCategoriasVenda(items);
      } catch (error) {
        if (isAxiosError(error)) {
          toast.error("Falha ao buscar categorias de venda", {
            description: error.response?.data?.error || error.message,
          });
        }
        setCategoriasVenda([]);
      } finally {
        setLoadingCategoriasVenda(false);
      }
    };

    fetchCategoriasVenda();
  }, []);

  const ALL = "TODOS";

  const filteredProducts = produtos.filter((p) => {
    const q = submittedSearch.toLowerCase();
    const matchesText = submittedSearch
      ? true // a busca completa já foi aplicada pelo servidor
      : [p.titulo, p.referencia, p.descricao, p.fabricante]
          .some((value) => value?.toLowerCase().includes(q));

    // se ALL, nÃ£o filtra por grupo
    const matchesCategory =
      selectedCategory === ALL || String(p.grupo?.id) === selectedCategory;

    return matchesText && matchesCategory;
  });
  const addToCart = (product: Produto) => {
    // Garante que tem estoque vÃ¡lido
    if (product.estoque == null || product.estoque <= 0) return;

    // Garante que id e precovenda nÃ£o sÃ£o undefined/null
    if (product.id == null || product.precovenda == null) {
      console.error(
        "Produto inválido para o PDV (id ou precovenda ausentes)",
        product,
      );
      return;
    }

    const existingItem = cart.find((item) => item.id === product.id);

    if (existingItem) {
      const newQuantity = existingItem.quantity + 1;
      if (newQuantity <= product.estoque) {
        setCart(
          cart.map((item) =>
            item.id === product.id ? { ...item, quantity: newQuantity } : item,
          ),
        );
      }
    } else {
      setCart([
        ...cart,
        {
          id: product.id, // agora Ã© number garantido
          titulo: product.titulo || "SEM TÍTULO",
          precovenda: product.precovenda, // agora Ã© number garantido
          quantity: 1,
          grupo: product.grupo?.nome || "SEM GRUPO",
          estoque: product.estoque, // jÃ¡ garantimos que nÃ£o Ã© null/undefined
        },
      ]);
    }
  };

  const removeFromCart = (productId: number) => {
    setCart(cart.filter((item) => item.id !== productId));
  };

  const updateQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
    } else {
      const product = produtos.find((p) => p.id === productId);
      if (product?.estoque === undefined) return;
      if (product && quantity <= product.estoque) {
        setCart(
          cart.map((item) =>
            item.id === productId ? { ...item, quantity } : item,
          ),
        );
      }
    }
  };

  const updatePrice = (productId: number, price: number) => {
    if (!Number.isFinite(price) || price < 0) return;

    setCart(
      cart.map((item) =>
        item.id === productId ? { ...item, precovenda: price } : item,
      ),
    );
  };

  const subtotal = cart.reduce(
    (sum, item) => sum + item.precovenda * item.quantity,
    0,
  );
  const normalizedDiscountInput = Number.isFinite(discount)
    ? Math.max(discount, 0)
    : 0;
  const discountAmount =
    discountType === "PORCENTAGEM"
      ? Math.min(
          subtotal,
          subtotal * (Math.min(normalizedDiscountInput, 100) / 100),
        )
      : Math.min(subtotal, normalizedDiscountInput);
  const freightAmount = hasFreight && Number.isFinite(freight) ? Math.max(0, freight) : 0;
  const total = Math.max(0, subtotal - discountAmount + freightAmount);
  const soleSelectedPaymentMethod =
    dadosFinanceiro.metodos.length === 1 ? dadosFinanceiro.metodos[0] : null;

  // Com uma única forma selecionada, o valor só pode ser o total da venda —
  // preenche automaticamente para não exigir digitação redundante.
  useEffect(() => {
    if (!soleSelectedPaymentMethod) return;
    setDadosFinanceiro((current) =>
      current.valores[soleSelectedPaymentMethod] === total
        ? current
        : {
            ...current,
            valores: { ...current.valores, [soleSelectedPaymentMethod]: total },
          },
    );
  }, [soleSelectedPaymentMethod, total]);

  const abrirConfirmacao = (acao: "ORCAMENTO" | "PAGAMENTO") => {
    if (cart.length === 0) {
      toast.error("Carrinho vazio.", {
        description: "Adicione produtos antes de continuar.",
      });
      return;
    }

    if (!selectedCustomer) {
      toast.error("Cliente obrigatório.", {
        description: "É necessário selecionar um cliente para continuar.",
      });
      return;
    }

    setAcaoConfirmacao(acao);
    setIsAlertOpen(true);
  };

  const createVenda = async (status: "ORCAMENTO" | "PAGAMENTO"): Promise<boolean> => {
    try {
      if (cart.length === 0) {
        return false;
      }

      if (!selectedCustomer) {
        toast.error("Erro ao cadastrar venda.", {
          description: "É necessário selecionar um cliente para continuar.",
        });
        return false;
      }

      const recusa = validarDadosParaFinanceiro(dadosFinanceiro, moneyToCents(total));
      if (recusa) {
        toast.error(recusa);
        return false;
      }

      setCreatingVenda(true);
      toast(
        <div className="flex flex-row flex-nowrap gap-2">
          <Loader2 className="animate-spin w-4 h-4" />{" "}
          <span>{status === "ORCAMENTO" ? "Salvando orçamento..." : "Cadastrando venda..."}</span>
        </div>,
      );

      const payload = {
      clienteId: selectedCustomer?.id,
      status,
      descontoTipo: discountType,
      descontoValor: discountAmount > 0 ? discountAmount : null,
      categoriaVendaId: selectedSaleCategoryId,
      subTotal: subtotal,
      valorFrete: freightAmount,
      valorTotal: total,
      formaPagamento: montarFormaPagamento(dadosFinanceiro),
      // O que o financeiro precisa saber e mais ninguém tem como reconstituir:
      // em quantas parcelas ficou combinado, o que o vendedor prometeu e a
      // garantia dada ao cliente.
      pagamentosPrevistos: montarPagamentosPrevistos(dadosFinanceiro),
      descricaoFinanceiro: dadosFinanceiro.descricaoFinanceiro.trim() || null,
      garantia: dadosFinanceiro.garantia.trim() || null,
      descricao: descricao.trim() || null,
      observacoes: observacoesInternas.trim() || null,
      observacoesFiscais: observacoesFiscais.trim() || null,
      dataVenda: null,
      itens: cart.map((item) => ({
        produtoId: item.id,
        quantidade: item.quantity,
        precoUnitario: item.precovenda,
        subTotal: item.precovenda * item.quantity,
        valorTotal: item.precovenda * item.quantity,
        valorDesconto: 0,
        tipoDesconto: null,
      })),
    };

      const response = await axios.post("/api/venda", payload);
      toast.success(
        status === "ORCAMENTO"
          ? `Orçamento #${response.data?.id ?? ""} salvo com sucesso.`
          : "Venda cadastrada com sucesso.",
      );

      setCart([]);
      setDiscount(0);
      setDiscountType(null);
      setHasFreight(false);
      setFreight(0);
      setSelectedSaleCategoryId(null);
      setDadosFinanceiro(dadosParaFinanceiroVazios());
      setDescricao("");
      setObservacoesInternas("");
      setObservacoesFiscais("");
      setSelectedCustomer(undefined);
      return true;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        toast.error(status === "ORCAMENTO" ? "Erro ao salvar orçamento." : "Erro ao criar venda.", {
          description: error.response?.data.error,
        });
      } else {
        toast.error(status === "ORCAMENTO" ? "Erro interno ao salvar orçamento." : "Erro interno ao criar venda.");
      }
      return false;
    } finally {
      setCreatingVenda(false);
    }
  };

  const firstVisibleProductPage = Math.max(
    1,
    Math.min(productsPage - 2, productsTotalPages - 4),
  );
  const visibleProductPages = Array.from(
    { length: Math.min(5, productsTotalPages) },
    (_, index) => firstVisibleProductPage + index,
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto" />
          <p className="text-foreground font-semibold">
            Carregando produtos...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto ">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
              <Store className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
                Ponto de Venda
              </h1>
              <div
                onClick={() => router.push("/historicovendas")}
                className=" hover:cursor-pointer flex felx-row gap-1 items-center text-red-800 hover:text-red-500 bg-muted/20 hover:bg-muted/50 py-2 px-3 rounded-2xl"
              >
                <ArrowLeftToLine className="w-5 h-5" />
                <span>SAIR</span>
              </div>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-sm text-muted-foreground">
              Total em Carrinho
            </div>
            <div className="text-2xl font-bold text-primary sm:text-3xl">
              {formatCurrencyBRL(total)}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Products Section */}
          <div className="lg:col-span-2 space-y-6">
            {/* Search and Filter */}
            <Card className="bg-card border-border">
              <CardContent className="space-y-4">
                <form
                  className="relative"
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSubmittedSearch(searchTerm.trim());
                  }}
                >
                  <button
                    type="submit"
                    className="absolute left-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Buscar produtos"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                  <Input
                    placeholder="Buscar produtos..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="border-border bg-card pl-10 pr-10 text-foreground placeholder:text-muted-foreground"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Limpar busca"
                      onClick={() => {
                        setSearchTerm("");
                        setSubmittedSearch("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </form>

                {/* Categories */}
                <div className="flex gap-2 flex-wrap">
                  <Select
                    value={selectedCategory}
                    onValueChange={(v) => setSelectedCategory(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="TODOS" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">TODOS</SelectItem>
                      {grupos.map((group) => (
                        <SelectItem key={group.id} value={group.id.toString()}>
                          {group.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Products Grid */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filteredProducts.map((product) => (
                <Card
                  key={product.id}
                  className={`group bg-card border-border hover:border-primary/50 transition-all ${
                    (product.estoque ?? 0) <= 0
                      ? "opacity-60"
                      : "cursor-default"
                  }`}
                >
                  <CardContent className=" space-y-3">
                    <div className="aspect-[1/1] bg-white rounded-lg flex items-center justify-center group-hover:bg-white duration-75 transition-all relative">
                      {product.imgUrl ? (
                        <div className="w-full h-full relative">
                          <div className="w-full h-full overflow-hidden flex items-center justify-center absolute">
                            {/* <img
                              alt={product.titulo || "imagem do produto"}
                              className="w-full blur-xs opacity-50"
                              src={product.imgUrl}
                            /> */}
                          </div>
                          <div className="w-full h-full overflow-hidden flex items-center justify-center absolute z-10">
                            <Image
                              alt={product.titulo || "imagem do produto"}
                              className="h-full group-hover:scale-105 transition-all duration-500"
                              src={product.imgUrl}
                              width={500}
                              height={500}
                            />
                          </div>
                        </div>
                      ) : (
                        <Wrench className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
                      )}
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="absolute left-2 top-2 z-20 h-8 w-8 rounded-full bg-background/90 opacity-100 transition-opacity hover:bg-background md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                            onClick={() => setSelectedProductInfo(product)}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-xl">
                          <DialogHeader>
                            <DialogTitle>
                              {selectedProductInfo?.titulo || "Produto"}
                            </DialogTitle>
                            <DialogDescription>
                              Informações detalhadas do produto selecionado.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                            <div className="h-40 overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center">
                              {selectedProductInfo?.imgUrl ? (
                                <Image
                                  alt={
                                    selectedProductInfo?.titulo ||
                                    "imagem do produto"
                                  }
                                  className="h-full w-full object-contain"
                                  src={selectedProductInfo.imgUrl}
                                  width={320}
                                  height={320}
                                />
                              ) : (
                                <Wrench className="h-10 w-10 text-muted-foreground" />
                              )}
                            </div>
                            <div className="grid gap-3 text-sm">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-lg border border-border bg-card p-3">
                                  <p className="text-xs text-muted-foreground">
                                    Preço
                                  </p>
                                  <p className="font-semibold text-foreground">
                                    {formatCurrencyBRL(
                                      selectedProductInfo?.precovenda || 0
                                    )}
                                  </p>
                                </div>
                                <div className="rounded-lg border border-border bg-card p-3">
                                  <p className="text-xs text-muted-foreground">
                                    Estoque
                                  </p>
                                  <p className="font-semibold text-foreground ">
                                    {selectedProductInfo?.estoque ?? 0}
                                  </p>
                                </div>
                              </div>
                              <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
                                <p>
                                  <span className="text-muted-foreground">
                                    Grupo:
                                  </span>{" "}
                                  {selectedProductInfo?.grupo?.nome || "-"}
                                </p>
                                <p>
                                  <span className="text-muted-foreground">
                                    Referência:
                                  </span>{" "}
                                  {selectedProductInfo?.referencia || "-"}
                                </p>
                                <p>
                                  <span className="text-muted-foreground">
                                    Fabricante:
                                  </span>{" "}
                                  {selectedProductInfo?.fabricante || "-"}
                                </p>
                                <p>
                                  <span className="text-muted-foreground">
                                    Unidade:
                                  </span>{" "}
                                  {selectedProductInfo?.unidade || "-"}
                                </p>
                                <p>
                                  <span className="text-muted-foreground">
                                    Código de barras:
                                  </span>{" "}
                                  {selectedProductInfo?.codigobarras || "-"}
                                </p>
                                <p>
                                  <span className="text-muted-foreground">
                                    Descrição:
                                  </span>{" "}
                                  {selectedProductInfo?.descricao || "-"}
                                </p>
                              </div>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>

                      {config?.alerta_estoque_pdv &&
                        product.status_estoque === Estoque_status.CRITICO && (
                          <div className="absolute right-1 top-1 z-20 flex items-center justify-center rounded-full bg-red-800 p-1 opacity-100 transition-opacity not-dark:bg-red-300 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertCircle className="h-4 w-4" />
                              </TooltipTrigger>
                              <TooltipContent>Estoque Crítico</TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      {config?.alerta_estoque_pdv &&
                        product.status_estoque === Estoque_status.BAIXO && (
                          <div className="absolute right-1 top-1 z-20 flex items-center justify-center rounded-full bg-yellow-800 p-1 opacity-100 transition-opacity not-dark:bg-yellow-300 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-4 w-4" />
                              </TooltipTrigger>
                              <TooltipContent>Estoque Baixo</TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      {config?.alerta_estoque_pdv &&
                        product.status_estoque ===
                          Estoque_status.SEM_ESTOQUE && (
                          <div className="absolute right-1 top-1 z-20 flex items-center justify-center rounded-full bg-purple-800 p-1 opacity-100 transition-opacity not-dark:bg-purple-300 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                            <Tooltip>
                              <TooltipTrigger>
                                <CircleOff className="h-4 w-4" />
                              </TooltipTrigger>
                              <TooltipContent>Sem estoque</TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-semibold text-foreground text-sm line-clamp-2">
                        {product.titulo}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {product.grupo?.nome}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Estoque: {product.estoque}
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <span className="font-bold text-primary">
                        {formatCurrencyBRL(product.precovenda || 0)}
                      </span>
                      <Button
                        onClick={() => addToCart(product)}
                        disabled={
                          (product.estoque ?? 0) <= 0
                        }
                        size="sm"
                        className="h-8 bg-primary px-2 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <nav
              className="flex flex-col items-center justify-between gap-3 rounded-lg border bg-card p-3 sm:flex-row"
              aria-label="Paginação dos produtos"
            >
              <p className="text-sm text-muted-foreground">
                Página {productsPage} de {productsTotalPages} · {productsTotal} produtos
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Primeira página"
                  disabled={productsPage <= 1 || loadingProductsPage}
                  onClick={() => void fetchProdutos(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Página anterior"
                  disabled={productsPage <= 1 || loadingProductsPage}
                  onClick={() => void fetchProdutos(productsPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {visibleProductPages.map((page) => (
                  <Button
                    key={page}
                    type="button"
                    size="icon"
                    variant={page === productsPage ? "default" : "outline"}
                    aria-label={`Ir para a página ${page}`}
                    aria-current={page === productsPage ? "page" : undefined}
                    disabled={loadingProductsPage}
                    onClick={() => void fetchProdutos(page)}
                  >
                    {page}
                  </Button>
                ))}

                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Próxima página"
                  disabled={productsPage >= productsTotalPages || loadingProductsPage}
                  onClick={() => void fetchProdutos(productsPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Última página"
                  disabled={productsPage >= productsTotalPages || loadingProductsPage}
                  onClick={() => void fetchProdutos(productsTotalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
                {loadingProductsPage && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              </div>
            </nav>
          </div>

          {/* Cart Section */}
          <div className="lg:col-span-1">
            <Card className="h-fit border-border bg-card lg:sticky lg:top-4">
              <CardHeader className="border-b border-border">
                <CardTitle className="flex flex-col items-center gap-2 text-foreground">
                  <div className="flex flex-row justify-between w-full items-center gap-2">
                    <ShoppingCart className="h-5 w-5 text-primary" />
                    Carrinho
                    <span className="ml-auto text-sm font-normal text-muted-foreground">
                      ({cart.length})
                    </span>
                  </div>

                  <div className="flex w-full justify-start">
                    {selectedCustomer ? (
                      <div className="flex flex-row items-center gap-2 text-sm font-light">
                        <span>Cliente:</span>
                        <span className="">
                          {selectedCustomer.nomerazaosocial}
                        </span>
                        <UserRoundX
                          onClick={() => setSelectedCustomer(undefined)}
                          className="h-4 w-4 hover:cursor-pointer hover:text-red-500 "
                        />
                      </div>
                    ) : (
                      <CustomerSelect
                        open={isCustomerSelectOpen}
                        setOpen={setIsCustomerSelectOpen}
                        OnSelect={(c) => setSelectedCustomer(c)}
                      >
                        <Button
                          size={"sm"}
                          variant={"outline"}
                          className="text-xs hover:cursor-pointer"
                        >
                          <Search className="size-4" />
                          Selecionar Cliente
                        </Button>
                      </CustomerSelect>
                    )}
                  </div>
                  <CustomerBlockedAlert
                    status={selectedCustomer?.status}
                    className="px-0 pt-1 text-left"
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cart.length === 0 ? (
                  <div className="py-8 text-center">
                    <ShoppingCart className="h-8 w-8 text-muted mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-muted-foreground">
                      Carrinho vazio
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex w-full items-center justify-between pb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Itens adicionados
                      </span>
                      <button
                        type="button"
                        onClick={() => setCart([])}
                        className="text-xs text-red-500 not-dark:text-red-500 hover:cursor-pointer hover:underline"
                      >
                        Esvaziar carrinho
                      </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {cart.map((item) => (
                        <div
                          key={item.id}
                          className="bg-muted/50 p-3 rounded-lg space-y-2"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-foreground">
                                {item.titulo}
                              </p>
                            </div>
                            <Button
                              onClick={() => removeFromCart(item.id)}
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/20 hover:cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-end gap-3">
                              <div className="space-y-1 max-w-32">
                                <span className="text-[10px] text-muted-foreground">
                                  Preço unitário
                                </span>
                                <ValueInput
                                  value={item.precovenda}
                                  onValueChange={(value) => updatePrice(item.id, value)}
                                  className="h-7 text-right text-xs"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1">
                                <Button
                                  onClick={() =>
                                    updateQuantity(item.id, item.quantity - 1)
                                  }
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0"
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="text-sm font-semibold text-foreground w-8 text-center">
                                  {item.quantity}
                                </span>
                                <Button
                                  onClick={() =>
                                    updateQuantity(item.id, item.quantity + 1)
                                  }
                                  size="sm"
                                  variant="outline"
                                  className="h-6 w-6 p-0"
                                  disabled={item.quantity >= item.estoque}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                              <span className="text-sm font-semibold text-primary min-w-20 text-right">
                               {formatCurrencyBRL(item.precovenda * item.quantity)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Totals */}
                    <div className="border-t border-border pt-4 space-y-2">
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          Categoria de venda
                        </span>
                        <Select
                          value={selectedSaleCategoryId ? String(selectedSaleCategoryId) : "uncategorized"}
                          onValueChange={(value) =>
                            setSelectedSaleCategoryId(value === "uncategorized" ? null : Number(value))
                          }
                          disabled={loadingCategoriasVenda}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={loadingCategoriasVenda ? "Carregando..." : "Selecione uma categoria"}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="uncategorized">Sem categoria</SelectItem>
                            {categoriasVenda.map((categoria) => (
                              <SelectItem key={categoria.id} value={String(categoria.id)}>
                                {categoria.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">
                            Tipo de desconto
                          </span>
                          <Select
                            value={discountType ?? "NONE"}
                            onValueChange={(value) =>
                              setDiscountType(
                                value === "NONE"
                                  ? null
                                  : (value as DiscountType),
                              )
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Sem desconto" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">Sem desconto</SelectItem>
                              <SelectItem value="FIXO">Fixo</SelectItem>
                              <SelectItem value="PORCENTAGEM">
                                Porcentagem
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">
                            {discountType === "PORCENTAGEM"
                              ? "Percentual (%)"
                              : "Valor do desconto"}
                          </span>
                          {discountType === "PORCENTAGEM" ? (
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={discount}
                              onChange={(e) => setDiscount(Number(e.target.value || 0))}
                              disabled={!discountType}
                              placeholder="0,00%"
                            />
                          ) : (
                            <ValueInput
                              value={discount}
                              onValueChange={setDiscount}
                              disabled={!discountType}
                            />
                          )}
                        </div>
                      </div>
                      <div className="rounded-md border border-border p-3">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="incluir-frete-venda"
                            checked={hasFreight}
                            onCheckedChange={(checked) => {
                              const enabled = checked === true;
                              setHasFreight(enabled);
                              if (!enabled) setFreight(0);
                            }}
                          />
                          <label htmlFor="incluir-frete-venda" className="text-sm font-medium leading-none">
                            Incluir frete na venda
                          </label>
                        </div>
                        {hasFreight ? (
                          <div className="mt-3 space-y-1">
                            <span className="text-xs text-muted-foreground">Valor do frete</span>
                            <ValueInput
                              value={freight}
                              onValueChange={setFreight}
                              aria-label="Valor do frete"
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Subtotal:</span>
                        <span>{formatCurrencyBRL(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Desconto:</span>
                        <span>
                          - {formatCurrencyBRL(discountAmount)}
                          {discountType === "PORCENTAGEM" &&
                          normalizedDiscountInput > 0
                            ? ` (${Math.min(normalizedDiscountInput, 100).toFixed(2)}%)`
                            : ""}
                        </span>
                      </div>
                      {discountType && discountAmount > 0 && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Desconto informado:</span>
                          <span>
                            {discountType === "PORCENTAGEM"
                              ? `${Math.min(normalizedDiscountInput, 100).toFixed(2)}%`
                              : formatCurrencyBRL(normalizedDiscountInput)}
                          </span>
                        </div>
                      )}

                      {hasFreight ? (
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>Frete:</span>
                          <span>+ {formatCurrencyBRL(freightAmount)}</span>
                        </div>
                      ) : null}

                      <div className="flex justify-between text-sm text-muted-foreground"></div>
                      <div className="flex justify-between text-lg font-bold text-primary-foreground bg-primary p-2 rounded">
                        <span>Total:</span>
                        <span>{formatCurrencyBRL(total)}</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="space-y-2 pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full hover:cursor-pointer"
                        onClick={() => abrirConfirmacao("ORCAMENTO")}
                      >
                        <ReceiptText className="h-4 w-4" />
                        Salvar como orçamento
                      </Button>
                      <Button
                        type="button"
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold hover:cursor-pointer"
                        onClick={() => abrirConfirmacao("PAGAMENTO")}
                      >
                        Finalizar Venda
                      </Button>
                      <AlertDialog
                        open={isAlertOpen}
                        onOpenChange={setIsAlertOpen}
                      >
                        <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">

                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {acaoConfirmacao === "ORCAMENTO" ? "Salvar como orçamento" : "Finalizar venda"}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Confira as informações da venda e os dados que serão encaminhados ao financeiro.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="p-4 bg-card rounded-2xl">
                          <VendaConfirmacaoFields
                            idPrefix="pdv-venda"
                            descricao={descricao}
                            onDescricaoChange={setDescricao}
                            observacoesInternas={observacoesInternas}
                            onObservacoesInternasChange={setObservacoesInternas}
                            observacoesFiscais={observacoesFiscais}
                            onObservacoesFiscaisChange={setObservacoesFiscais}
                            dadosFinanceiro={dadosFinanceiro}
                            onDadosFinanceiroChange={setDadosFinanceiro}
                            totalCents={moneyToCents(total)}
                          />
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="hover:cursor-pointer">Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            className="hover:cursor-pointer"
                            disabled={creatingVenda}
                            onClick={async (event) => {
                              event.preventDefault();
                              const success = await createVenda(acaoConfirmacao);
                              if (success) setIsAlertOpen(false);
                            }}
                          >
                            {creatingVenda ? "Confirmando..." : "Confirmar"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
