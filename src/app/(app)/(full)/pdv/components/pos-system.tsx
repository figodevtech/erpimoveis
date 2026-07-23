"use client";

import { useState, useEffect } from "react";
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
  ChevronsUpDown,
} from "lucide-react";
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
  AlertDialogTrigger,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import { Customer } from "@/app/(app)/(pages)/clientes/types";
import { useGruposProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/hooks/use-grupo-produtos";
import { useRouter } from "next/navigation";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import { formatCurrencyBRL } from "@/app/(app)/(pages)/dashboard/components/dashboard-ordemservico/lib/format";

interface CartItem {
  id: number;
  titulo: string;
  precovenda: number;
  quantity: number;
  grupo: string;
  estoque: number;
}

type DiscountType = "FIXO" | "PORCENTAGEM";
type PaymentMethod =
  | "CREDITO"
  | "DEBITO"
  | "DINHEIRO"
  | "PIX"
  | "BOLETO"
  | "NAO_INFORMAR";
type PaymentMethodOption = Exclude<PaymentMethod, "NAO_INFORMAR">;
type PaymentAmounts = Partial<Record<PaymentMethodOption, string>>;
type CategoriaVenda = {
  id: number;
  nome: string;
  descricao?: string | null;
  ativo?: boolean | null;
};

const PAYMENT_METHOD_OPTIONS: Array<{
  value: PaymentMethodOption;
  label: string;
}> = [
  { value: "CREDITO", label: "Crédito" },
  { value: "DEBITO", label: "Débito" },
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
];

const moneyToCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);

const amountInputToCents = (value: string): number | null => {
  const raw = value.trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (digits) return Number(digits);

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return moneyToCents(parsed);
};

const centsToNumber = (value: number) => value / 100;

const formatCentsToPaymentInput = (value: number) =>
  formatCurrencyBRL(centsToNumber(Math.max(0, value)));

export function POSSystem() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoriasVenda, setCategoriasVenda] = useState<CategoriaVenda[]>([]);
  const [loadingCategoriasVenda, setLoadingCategoriasVenda] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("TODOS");
  const [selectedSaleCategoryId, setSelectedSaleCategoryId] = useState<number | null>(null);
  const [creatingVenda, setCreatingVenda] = useState(false);
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<
    Customer | undefined
  >(undefined);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(
    ["NAO_INFORMAR"]
  );
  const [paymentAmounts, setPaymentAmounts] = useState<PaymentAmounts>({});
  const [paymentMethodsOpen, setPaymentMethodsOpen] = useState(false);
  const [selectedProductInfo, setSelectedProductInfo] = useState<
    Produto | undefined
  >(undefined);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const { grupos } = useGruposProduto();
  const router = useRouter();
  const config = useConfig();

  useEffect(() => {
    const fetchProdutos = async () => {
      try {
        setLoading(true);
        const response = await axios.get("/api/pdv/products");
        if (response.status === 200) {
          const items = response.data.data;
          setProdutos(items);
        }
      } catch (error) {
        if (isAxiosError(error)) {
          toast.error("Falha ao buscar produtos", {
            description: error.message,
          });
          console.log(error);
        }
        setProdutos([]);
      } finally {
        setLoading(false);
      }
    };

    fetchProdutos();
  }, []);

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
    const q = searchTerm.trim().toLowerCase();
    const matchesText = p.titulo?.toLowerCase().includes(q);

    // se ALL, nÃ£o filtra por grupo
    const matchesCategory =
      selectedCategory === ALL || p.grupo?.nome === selectedCategory;

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
        item.id === productId ? { ...item, precovenda: price } : item
      )
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
  const total = Math.max(0, subtotal - discountAmount);
  const hasPaymentMethodSelected = paymentMethods.some(
    (method) => method !== "NAO_INFORMAR"
  );
  const selectedPaymentMethods = paymentMethods.filter(
    (method): method is PaymentMethodOption => method !== "NAO_INFORMAR"
  );
  const hasAnyPaymentAmount = selectedPaymentMethods.some((method) =>
    Boolean(paymentAmounts[method]?.trim())
  );
  const paymentAmountEntries = selectedPaymentMethods.map((method) => ({
    method,
    label:
      PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)?.label ??
      method,
    cents: amountInputToCents(paymentAmounts[method] ?? ""),
  }));
  const paymentAmountsTotalCents = paymentAmountEntries.reduce(
    (sum, item) => sum + (item.cents ?? 0),
    0,
  );

  const togglePaymentMethod = (method: PaymentMethodOption) => {
    setPaymentMethods((current) => {
      const hasMethod = current.includes(method);

      if (hasMethod) {
        const next = current.filter((value) => value !== method);
        setPaymentAmounts((amounts) => {
          const { [method]: _removed, ...remaining } = amounts;
          return remaining;
        });
        return next.length > 0 ? next : ["NAO_INFORMAR"];
      }

      return [
        ...current.filter((value) => value !== "NAO_INFORMAR"),
        method,
      ];
    });
  };

  const toggleNaoInformar = (checked: boolean) => {
    setPaymentMethods(checked ? ["NAO_INFORMAR"] : []);
    if (checked) setPaymentAmounts({});
  };

  const updatePaymentAmount = (method: PaymentMethodOption, value: string) => {
    const digits = value.replace(/\D/g, "");
    if (!digits) {
      setPaymentAmounts((current) => ({
        ...current,
        [method]: "",
      }));
      return;
    }

    const requestedCents = Number(digits);
    const totalCents = moneyToCents(total);
    const otherMethodsTotalCents = selectedPaymentMethods
      .filter((selectedMethod) => selectedMethod !== method)
      .reduce(
        (sum, selectedMethod) =>
          sum + (amountInputToCents(paymentAmounts[selectedMethod] ?? "") ?? 0),
        0,
      );
    const maxAllowedCents = Math.max(0, totalCents - otherMethodsTotalCents);
    const nextCents = Math.min(requestedCents, maxAllowedCents);

    setPaymentAmounts((current) => ({
      ...current,
      [method]: formatCentsToPaymentInput(nextCents),
    }));
  };

  const buildFormaPagamento = (): string | null => {
    if (!hasPaymentMethodSelected) return null;

    if (!hasAnyPaymentAmount) {
      return selectedPaymentMethods.join(", ");
    }

    return paymentAmountEntries
      .map((item) => `${item.method}: ${formatCurrencyBRL(centsToNumber(item.cents ?? 0))}`)
      .join(", ");
  };

  const validatePaymentAmounts = (): boolean => {
    if (!hasPaymentMethodSelected || !hasAnyPaymentAmount) return true;

    const invalidEntry = paymentAmountEntries.find(
      (item) => item.cents === null || item.cents <= 0,
    );

    if (invalidEntry) {
      toast.error("Informe valores válidos para os métodos selecionados.", {
        description: "Ao preencher valores, cada método selecionado precisa ter um valor maior que zero.",
      });
      return false;
    }

    const totalCents = moneyToCents(total);
    if (paymentAmountsTotalCents !== totalCents) {
      toast.error("A soma dos pagamentos precisa fechar o total da venda.", {
        description: `Total informado: ${formatCurrencyBRL(centsToNumber(paymentAmountsTotalCents))}. Total da venda: ${formatCurrencyBRL(total)}.`,
      });
      return false;
    }

    return true;
  };

  const paymentMethodsLabel = !hasPaymentMethodSelected
    ? "Não informar"
    : PAYMENT_METHOD_OPTIONS.filter((method) =>
        paymentMethods.includes(method.value)
      )
        .map((method) => method.label)
        .join(", ");

  const handleSaveBudget = async () => {
    if (cart.length === 0) {
      toast.error("Carrinho vazio.", {
        description: "Adicione produtos antes de salvar o orçamento.",
      });
      return;
    }

    if (!selectedCustomer) {
      toast.error("Erro ao salvar orçamento.", {
        description: "É necessário selecionar um cliente para continuar.",
      });
      return;
    }

    toast(
      <div className="flex flex-row flex-nowrap gap-2">
        <Loader2 className="animate-spin w-4 h-4" />
        <span>Salvando orçamento...</span>
      </div>,
    );

    const payload = {
      clienteId: selectedCustomer.id,
      status: "ORCAMENTO",
      descontoTipo: discountType,
      descontoValor: discountAmount > 0 ? discountAmount : null,
      categoriaVendaId: selectedSaleCategoryId,
      subTotal: subtotal,
      valorTotal: total,
      formaPagamento: null,
      dataVenda: null,
      itens: cart.map((item) => ({
        produtoId: item.id,
        quantidade: item.quantity,
        subTotal: item.precovenda * item.quantity,
        valorTotal: item.precovenda * item.quantity,
        valorDesconto: 0,
        tipoDesconto: null,
      })),
    };

    try {
      const { data } = await axios.post("/api/venda", payload);

      toast.success(`Orçamento #${data?.id ?? ""} salvo com sucesso.`);
      setCart([]);
      setDiscount(0);
      setDiscountType(null);
      setSelectedSaleCategoryId(null);
      setPaymentMethods(["NAO_INFORMAR"]);
      setPaymentAmounts({});
      setSelectedCustomer(undefined);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        toast.error("Erro ao salvar orçamento.", {
          description: error.response?.data?.error || error.message,
        });
      } else {
        toast.error("Erro interno ao salvar orçamento.");
      }
    }
  };

  const createVenda = async (): Promise<boolean> => {
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

      if (!validatePaymentAmounts()) {
        return false;
      }

      setCreatingVenda(true);
      toast(
        <div className="flex flex-row flex-nowrap gap-2">
          <Loader2 className="animate-spin w-4 h-4" />{" "}
          <span>Cadastrando Venda...</span>
        </div>,
      );

      // TODO: substituir pelos valores reais

      const payload = {
      clienteId: selectedCustomer?.id,
      status: "PAGAMENTO", // enum_status_venda
      descontoTipo: discountType,
      descontoValor: discountAmount > 0 ? discountAmount : null,
      categoriaVendaId: selectedSaleCategoryId,
      subTotal: subtotal,
      valorTotal: total,
      formaPagamento:
        buildFormaPagamento(),
      dataVenda: null,
      itens: cart.map((item) => ({
        produtoId: item.id,
        quantidade: item.quantity,
        subTotal: item.precovenda * item.quantity,
        valorTotal: item.precovenda * item.quantity,
        valorDesconto: 0,
        tipoDesconto: null,
      })),
    };

    // chamada com axios
    await axios.post("/api/venda", payload);
      toast.success("Venda cadastrada com sucesso.");

      setCart([]);
      setDiscount(0);
      setDiscountType(null);
      setSelectedSaleCategoryId(null);
      setPaymentMethods(["NAO_INFORMAR"]);
      setPaymentAmounts({});
      setSelectedCustomer(undefined);
      return true;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        toast.error("Erro código: " + error.status, {
          description: error.response?.data.error,
        });
      } else {
        toast.error("Erro interno ao criar venda");
      }
      return false;
    } finally {
      setCreatingVenda(false);
    }
  };

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
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
              <Store className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="flex flex-row items-center gap-4">
              <h1 className="text-3xl font-bold text-foreground">
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
          <div className="text-right">
            <div className="text-sm text-muted-foreground">
              Total em Carrinho
            </div>
            <div className="text-3xl font-bold text-primary">
              {formatCurrencyBRL(total)}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Products Section */}
          <div className="lg:col-span-2 space-y-6">
            {/* Search and Filter */}
            <Card className="bg-card border-border">
              <CardContent className="pt-6 space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar produtos..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="border-border bg-card pl-10 text-foreground placeholder:text-muted-foreground"
                  />
                </div>

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
                  className={`bg-card border-border hover:border-primary/50 transition-all ${
                    product.estoque && product.estoque <= 0
                      ? "opacity-60"
                      : "cursor-default group"
                  }`}
                >
                  <CardContent className="p-4 space-y-3">
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
                            <img
                              alt={product.titulo || "imagem do produto"}
                              className="h-full group-hover:scale-105 transition-all duration-500"
                              src={product.imgUrl}
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
                            className="absolute top-2 left-2 z-20 h-8 w-8 rounded-full bg-background/90 hover:bg-background hover:cursor-pointer"
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
                                <img
                                  alt={
                                    selectedProductInfo?.titulo ||
                                    "imagem do produto"
                                  }
                                  className="h-full w-full object-contain"
                                  src={selectedProductInfo.imgUrl}
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
                          <div className="absolute z-20 top-1 right-1 flex p-1 items-center justify-center rounded-full bg-red-800 not-dark:bg-red-300">
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
                          <div className="absolute top-1 z-20 right-1 flex p-1 items-center justify-center rounded-full bg-yellow-800 not-dark:bg-yellow-300">
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
                          <div className="absolute z-20 top-1 right-1 flex p-1 items-center justify-center rounded-full bg-purple-800 not-dark:bg-purple-300">
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
                          product.estoque && product.estoque <= 0 ? true : false
                        }
                        size="sm"
                        className={`bg-primary hover:cursor-pointer hover:bg-primary/90 text-primary-foreground h-8 px-2 disabled:opacity-50 ${product.estoque ? "hover:cursor-pointer" : "hover:cursor-not-allowed"}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Cart Section */}
          <div className="lg:col-span-1">
            <Card className="bg-card border-border h-fit sticky top-4">
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
                        onClick={handleSaveBudget}
                      >
                        <ReceiptText className="h-4 w-4" />
                        Salvar como orçamento
                      </Button>
                      <AlertDialog
                        open={isAlertOpen}
                        onOpenChange={setIsAlertOpen}
                      >
                        <AlertDialogTrigger asChild>
                          <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold hover:cursor-pointer">
                            Finalizar Venda
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>

                        <AlertDialogHeader>
                          <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Ao selecionar esta opção, o pagamento da venda ficará em aberto
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-2">
                          <span className="text-sm font-medium text-foreground">
                            Métodos de pagamento
                          </span>
                          <Popover
                            open={paymentMethodsOpen}
                            onOpenChange={setPaymentMethodsOpen}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-between font-normal"
                              >
                                <span className="truncate">
                                  {paymentMethodsLabel}
                                </span>
                                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="start"
                              className="w-[var(--radix-popover-trigger-width)] p-0"
                            >
                              <Command>
                                <CommandList>
                                  <CommandGroup>
                                    <CommandItem
                                      value="nao-informar"
                                      onSelect={() =>
                                        toggleNaoInformar(!paymentMethods.includes("NAO_INFORMAR"))
                                      }
                                      className="flex items-center gap-3"
                                    >
                                      <Checkbox checked={!hasPaymentMethodSelected} />
                                      <span>Não informar</span>
                                    </CommandItem>
                                    {PAYMENT_METHOD_OPTIONS.map((method) => (
                                      <CommandItem
                                        key={method.value}
                                        value={method.value}
                                        onSelect={() => togglePaymentMethod(method.value)}
                                        className="flex items-center gap-3"
                                      >
                                        <Checkbox checked={paymentMethods.includes(method.value)} />
                                        <span>{method.label}</span>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          {hasPaymentMethodSelected && (
                            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-medium text-muted-foreground">
                                  Valores por método (opcional)
                                </span>
                                {hasAnyPaymentAmount && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatCurrencyBRL(centsToNumber(paymentAmountsTotalCents))} / {formatCurrencyBRL(total)}
                                  </span>
                                )}
                              </div>

                              <div className="space-y-2">
                                {selectedPaymentMethods.map((method) => {
                                  const label =
                                    PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)?.label ??
                                    method;

                                  return (
                                    <div key={method} className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-2">
                                      <span className="truncate text-sm text-foreground">{label}</span>
                                      <ValueInput
                                        value={centsToNumber(amountInputToCents(paymentAmounts[method] ?? "") ?? 0)}
                                        onValueChange={(value) =>
                                          updatePaymentAmount(method, formatCentsToPaymentInput(moneyToCents(value)))
                                        }
                                        className="h-9 text-right"
                                      />
                                    </div>
                                  );
                                })}
                              </div>

                              {hasAnyPaymentAmount && paymentAmountsTotalCents !== moneyToCents(total) && (
                                <p className="text-xs text-muted-foreground">
                                  Restante: {formatCurrencyBRL(centsToNumber(moneyToCents(total) - paymentAmountsTotalCents))}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="hover:cursor-pointer">Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            className="hover:cursor-pointer"
                            disabled={creatingVenda}
                            onClick={async (event) => {
                              event.preventDefault();
                              const success = await createVenda();
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
