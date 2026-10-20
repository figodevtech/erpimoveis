"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
  ScanBarcode,
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
import { DialogShell } from "@/app/(app)/(pages)/ordens/components/dialogs/dialog-shell";
import { CameraScannerDialog } from "@/app/(app)/(pages)/estoque/components/dialog-produto/camera-scanner-dialog";
import { criarDetectorDeLeitura, type ResultadoDaLeitura } from "@/lib/leitor-codigo-barras";

interface CartItem {
  id: number;
  titulo: string;
  precovenda: number;
  quantity: number;
  grupo: string;
  estoque: number;
}

/** O que /api/pdv/products/codigo-barras devolve do produto lido. */
type ProdutoLidoNoPdv = {
  id: number;
  titulo: string | null;
  precovenda: number | null;
  estoque: number | null;
  exibirPdv: boolean | null;
  grupo: { nome: string | null; exibirPdv: boolean | null } | null;
};

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
  const productsRequest = useRef<AbortController | null>(null);
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
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [lendoCodigo, setLendoCodigo] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // A leitura e assincrona (busca o produto) e pode chegar entre dois renders:
  // o carrinho e lido e gravado por ref para duas leituras seguidas do mesmo
  // item nao partirem da mesma quantidade.
  const cartRef = useRef<CartItem[]>([]);
  // Leituras em sequencia rapida sao atendidas uma de cada vez, na ordem.
  const filaDeLeituras = useRef<Promise<void>>(Promise.resolve());
  const { grupos } = useGruposProduto();
  const router = useRouter();
  const config = useConfig();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchTerm.trim();
      setSubmittedSearch((current) => current === nextSearch ? current : nextSearch);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const fetchProdutos = useCallback(async (page: number) => {
    productsRequest.current?.abort();
    const controller = new AbortController();
    productsRequest.current = controller;
    setLoadingProductsPage(true);
    try {
      const response = await axios.get("/api/pdv/products", {
        signal: controller.signal,
        params: {
          page,
          limit: 48,
          q: submittedSearch || undefined,
          groupId: selectedCategory === "TODOS" ? undefined : selectedCategory,
        },
      });
      if (controller.signal.aborted) return;
      const items: Produto[] = Array.isArray(response.data?.data)
        ? response.data.data
        : [];
      setProdutos(items);
      setProductsPage(Number(response.data?.pagination?.page ?? page));
      setProductsTotalPages(Number(response.data?.pagination?.totalPages ?? 1));
      setProductsTotal(Number(response.data?.pagination?.total ?? items.length));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAxiosError(error)) {
        toast.error("Falha ao buscar produtos", {
          description: error.response?.data?.error || error.message,
        });
      }
      setProdutos([]);
    } finally {
      if (productsRequest.current === controller) {
        productsRequest.current = null;
        setLoading(false);
        setLoadingProductsPage(false);
      }
    }
  }, [submittedSearch, selectedCategory]);

  useEffect(() => {
    void fetchProdutos(1);
    return () => productsRequest.current?.abort();
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

  const filteredProducts = produtos;
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
      // O limite vem do proprio item do carrinho: o produto pode ter entrado
      // pelo leitor ou por outra pagina do catalogo, fora de `produtos`.
      const item = cart.find((i) => i.id === productId);
      if (item && quantity <= item.estoque) {
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

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const adicionarPorCodigo = useCallback(async (codigo: string) => {
    setLendoCodigo(true);
    try {
      const response = await axios.get<ResultadoDaLeitura<ProdutoLidoNoPdv>>(
        "/api/pdv/products/codigo-barras",
        { params: { codigo } },
      );
      const leitura = response.data;

      if (leitura.resultado === "nao_encontrado") {
        toast.error("Produto não encontrado", {
          description: `Nenhum produto cadastrado com o código ${codigo}.`,
        });
        return;
      }

      if (leitura.resultado === "fora_do_pdv") {
        toast.error("Produto fora do PDV", {
          description: `${leitura.titulo || "O produto"} (código ${codigo}) não está liberado para venda no PDV.`,
        });
        return;
      }

      if (leitura.resultado === "ambiguo") {
        // O operador escolhe: o catalogo passa a mostrar so os produtos do codigo.
        setSearchTerm(codigo);
        setSubmittedSearch(codigo);
        toast.warning("Código em mais de um produto", {
          description: `${leitura.produtos.length} produtos usam o código ${codigo}. Escolha o certo no catálogo.`,
        });
        return;
      }

      const produto = leitura.produto;
      const titulo = produto.titulo || "SEM TÍTULO";
      const estoque = Number(produto.estoque ?? 0);
      const atual = cartRef.current;
      const noCarrinho = atual.find((item) => item.id === produto.id)?.quantity ?? 0;

      if (estoque <= 0) {
        toast.error("Produto sem estoque", {
          description: `${titulo} não tem estoque disponível.`,
        });
        return;
      }

      if (noCarrinho + 1 > estoque) {
        toast.error("Estoque insuficiente", {
          description: `${titulo}: ${noCarrinho} no carrinho e ${estoque} em estoque.`,
        });
        return;
      }

      if (produto.precovenda == null) {
        toast.error("Produto sem preço de venda", {
          description: `${titulo} não tem preço cadastrado.`,
        });
        return;
      }

      // O estoque do item e atualizado com o valor recem-lido do banco, mais
      // fresco que o da pagina do catalogo.
      const proximo: CartItem[] = noCarrinho > 0
        ? atual.map((item) =>
            item.id === produto.id ? { ...item, quantity: noCarrinho + 1, estoque } : item,
          )
        : [
            ...atual,
            {
              id: produto.id,
              titulo,
              precovenda: produto.precovenda,
              quantity: 1,
              grupo: produto.grupo?.nome || "SEM GRUPO",
              estoque,
            },
          ];
      cartRef.current = proximo;
      setCart(proximo);
      toast.success(`${titulo} adicionado`, {
        description: `Quantidade no carrinho: ${noCarrinho + 1}`,
      });
    } catch (error) {
      toast.error("Falha ao buscar o código de barras", {
        description: isAxiosError(error) ? error.response?.data?.error || error.message : undefined,
      });
    } finally {
      setLendoCodigo(false);
    }
  }, []);

  const enfileirarLeitura = useCallback((codigo: string) => {
    filaDeLeituras.current = filaDeLeituras.current.then(() => adicionarPorCodigo(codigo));
  }, [adicionarPorCodigo]);

  // Leitor USB/Bluetooth em modo teclado: escuta o PDV inteiro na fase de
  // captura, antes do Enter do aparelho acionar o botao focado ou enviar a busca.
  useEffect(() => {
    const detector = criarDetectorDeLeitura();
    let buscaAntesDaRajada: string | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;

      const alvo = event.target instanceof HTMLElement ? event.target : null;
      // Com um dialog aberto (cliente, conferencia, camera, detalhes) o leitor
      // nao mexe no carrinho que esta atras dele.
      if (alvo?.closest('[role="dialog"], [role="alertdialog"]')) return;

      const naBusca = alvo !== null && alvo === searchInputRef.current;
      const editavel =
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        alvo instanceof HTMLSelectElement ||
        alvo?.isContentEditable === true;
      // Em preco, desconto e frete a digitacao e do operador; so a busca e o
      // resto da tela (nada focado, botoes, cards) entregam a leitura ao PDV.
      if (editavel && !naBusca) return;

      const tecla = detector.registrar(event.key, event.timeStamp);

      if (tecla.tipo === "caractere" && tecla.inicio) {
        // keydown chega antes do caractere entrar no campo: e o texto que a
        // busca tinha antes do leitor comecar a digitar nela.
        buscaAntesDaRajada = naBusca ? searchInputRef.current?.value ?? "" : null;
        return;
      }

      if (tecla.tipo === "leitura") {
        event.preventDefault();
        event.stopPropagation();
        if (naBusca && buscaAntesDaRajada !== null) setSearchTerm(buscaAntesDaRajada);
        buscaAntesDaRajada = null;
        enfileirarLeitura(tecla.codigo);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enfileirarLeitura]);

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
    <div className="min-h-screen bg-muted/20 p-3 pb-28 sm:p-4 sm:pb-28 lg:h-[100dvh] lg:overflow-hidden lg:p-6">
      <div className="mx-auto max-w-[1800px] lg:h-full">
        <div className="grid items-start gap-4 lg:h-full lg:grid-cols-[minmax(0,2fr)_minmax(22rem,0.9fr)] lg:items-stretch">
          <main className="min-w-0 space-y-4 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
            <header className="relative overflow-hidden border border-border bg-card shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary">
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
            <div className="flex min-w-0 items-center gap-3 px-4 py-4 sm:px-6">
              <div className="flex size-11 shrink-0 items-center justify-center border border-border bg-background text-primary">
                <Store className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  Bancada comercial
                </p>
                <h1 className="truncate text-lg font-bold uppercase tracking-[0.06em] text-foreground sm:text-xl">
                  Ponto de Venda
                </h1>
                <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  Localize produtos, monte o carrinho e conclua a venda.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 border-t border-border sm:grid-cols-[auto_auto_auto] lg:border-l lg:border-t-0">
              <div className="flex min-w-28 flex-col justify-center border-r border-border px-4 py-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Itens
                </span>
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              </div>
              <div className="flex min-w-40 flex-col justify-center px-4 py-3 sm:border-r sm:border-border">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Total no carrinho
                </span>
                <span className="text-lg font-bold tabular-nums text-primary sm:text-xl">
                  {formatCurrencyBRL(total)}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push("/historicovendas")}
                className="col-span-2 min-h-12 rounded-none border-t border-border px-5 text-destructive hover:bg-destructive/10 hover:text-destructive sm:col-span-1 sm:border-t-0"
              >
                <ArrowLeftToLine className="size-4" aria-hidden="true" />
                Sair do PDV
              </Button>
            </div>
          </div>
            </header>

            <section className="overflow-hidden border border-border bg-card shadow-sm">
              <header className="flex items-start gap-3 border-b border-border bg-muted/25 px-3 py-3 sm:px-4">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center border border-border bg-background text-primary">
                  <Search className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground">
                    Catálogo de produtos
                  </h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {productsTotal} produtos encontrados · página {productsPage} de {productsTotalPages}
                  </p>
                </div>
              </header>
              <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] sm:p-4">
                <div className="flex min-w-0 gap-2">
                  <form
                    className="relative min-w-0 flex-1"
                    role="search"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setSubmittedSearch(searchTerm.trim());
                    }}
                  >
                    <button
                      type="submit"
                      className="absolute inset-y-0 left-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Buscar produtos"
                    >
                      <Search className="size-4" aria-hidden="true" />
                    </button>
                    <Input
                      ref={searchInputRef}
                      placeholder="Buscar por nome, referência ou código..."
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      className="h-10 rounded-none border-border bg-background pl-11 pr-10 text-foreground placeholder:text-muted-foreground"
                    />
                    {searchTerm ? (
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="Limpar busca"
                        onClick={() => {
                          setSearchTerm("");
                          setSubmittedSearch("");
                        }}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </form>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-10 shrink-0 rounded-none"
                        aria-label="Ler código de barras pela câmera"
                        onClick={() => setIsCameraOpen(true)}
                      >
                        {lendoCodigo ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ScanBarcode className="size-4" aria-hidden="true" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Ler código de barras pela câmera</TooltipContent>
                  </Tooltip>
                </div>

                <Select
                  value={selectedCategory}
                  onValueChange={setSelectedCategory}
                >
                  <SelectTrigger
                    className="h-10 w-full rounded-none bg-background"
                    aria-label="Filtrar por grupo de produtos"
                  >
                    <SelectValue placeholder="Todos os grupos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODOS">Todos os grupos</SelectItem>
                    {grupos.filter((group) => group.exibirPdv).map((group) => (
                      <SelectItem key={group.id} value={group.id.toString()}>
                        {group.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            {filteredProducts.length === 0 ? (
              <section className="flex min-h-64 flex-col items-center justify-center border border-dashed border-border bg-card px-6 py-12 text-center">
                <Wrench className="mb-3 size-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground">
                  Nenhum produto encontrado
                </h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Ajuste a busca ou selecione outro grupo de produtos.
                </p>
              </section>
            ) : (
              <section
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                aria-label="Lista de produtos"
              >
                {filteredProducts.map((product) => (
                  <article
                    key={product.id}
                    className={`group flex min-w-0 flex-col overflow-hidden border border-border bg-card shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md ${
                      (product.estoque ?? 0) <= 0 ? "opacity-60" : ""
                    }`}
                  >
                    <div className="relative aspect-[4/3] overflow-hidden border-b border-border bg-white">
                      {product.imgUrl ? (
                        <Image
                          alt={product.titulo || "Imagem do produto"}
                          className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.03]"
                          src={product.imgUrl}
                          width={500}
                          height={375}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-muted/15">
                          <Wrench className="size-9 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                        </div>
                      )}

                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="absolute left-2 top-2 z-20 size-9 rounded-none border border-border bg-background/95 shadow-sm"
                            aria-label={`Ver detalhes de ${product.titulo}`}
                            onClick={() => setSelectedProductInfo(product)}
                          >
                            <Info className="size-4" aria-hidden="true" />
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
                            <div className="flex h-40 items-center justify-center overflow-hidden border border-border bg-muted">
                              {selectedProductInfo?.imgUrl ? (
                                <Image
                                  alt={selectedProductInfo?.titulo || "Imagem do produto"}
                                  className="h-full w-full object-contain"
                                  src={selectedProductInfo.imgUrl}
                                  width={320}
                                  height={320}
                                />
                              ) : (
                                <Wrench className="size-10 text-muted-foreground" aria-hidden="true" />
                              )}
                            </div>
                            <div className="grid gap-3 text-sm">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="border border-border bg-card p-3">
                                  <p className="text-xs text-muted-foreground">Preço</p>
                                  <p className="font-semibold text-foreground">
                                    {formatCurrencyBRL(selectedProductInfo?.precovenda || 0)}
                                  </p>
                                </div>
                                <div className="border border-border bg-card p-3">
                                  <p className="text-xs text-muted-foreground">Estoque</p>
                                  <p className="font-semibold text-foreground">
                                    {selectedProductInfo?.estoque ?? 0}
                                  </p>
                                </div>
                              </div>
                              <div className="grid gap-2 border border-border bg-card p-3">
                                <p><span className="text-muted-foreground">Grupo:</span>{" "}{selectedProductInfo?.grupo?.nome || "-"}</p>
                                <p><span className="text-muted-foreground">Referência:</span>{" "}{selectedProductInfo?.referencia || "-"}</p>
                                <p><span className="text-muted-foreground">Fabricante:</span>{" "}{selectedProductInfo?.fabricante || "-"}</p>
                                <p><span className="text-muted-foreground">Unidade:</span>{" "}{selectedProductInfo?.unidade || "-"}</p>
                                <p><span className="text-muted-foreground">Código de barras:</span>{" "}{selectedProductInfo?.codigobarras || "-"}</p>
                                <p><span className="text-muted-foreground">Descrição:</span>{" "}{selectedProductInfo?.descricao || "-"}</p>
                              </div>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>

                      {config?.alerta_estoque_pdv && product.status_estoque === Estoque_status.CRITICO ? (
                        <div className="absolute right-2 top-2 z-20 flex size-8 items-center justify-center border border-red-500/30 bg-red-800 text-white not-dark:bg-red-300 not-dark:text-red-950">
                          <Tooltip>
                            <TooltipTrigger aria-label="Estoque crítico">
                              <AlertCircle className="size-4" aria-hidden="true" />
                            </TooltipTrigger>
                            <TooltipContent>Estoque crítico</TooltipContent>
                          </Tooltip>
                        </div>
                      ) : null}
                      {config?.alerta_estoque_pdv && product.status_estoque === Estoque_status.BAIXO ? (
                        <div className="absolute right-2 top-2 z-20 flex size-8 items-center justify-center border border-yellow-500/30 bg-yellow-800 text-white not-dark:bg-yellow-300 not-dark:text-yellow-950">
                          <Tooltip>
                            <TooltipTrigger aria-label="Estoque baixo">
                              <AlertTriangle className="size-4" aria-hidden="true" />
                            </TooltipTrigger>
                            <TooltipContent>Estoque baixo</TooltipContent>
                          </Tooltip>
                        </div>
                      ) : null}
                      {config?.alerta_estoque_pdv && product.status_estoque === Estoque_status.SEM_ESTOQUE ? (
                        <div className="absolute right-2 top-2 z-20 flex size-8 items-center justify-center border border-purple-500/30 bg-purple-800 text-white not-dark:bg-purple-300 not-dark:text-purple-950">
                          <Tooltip>
                            <TooltipTrigger aria-label="Sem estoque">
                              <CircleOff className="size-4" aria-hidden="true" />
                            </TooltipTrigger>
                            <TooltipContent>Sem estoque</TooltipContent>
                          </Tooltip>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex min-h-28 flex-1 flex-col p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        {product.grupo?.nome || "Sem grupo"}
                      </p>
                      <h3 className="mt-1 line-clamp-2 text-sm font-bold leading-snug text-foreground">
                        {product.titulo}
                      </h3>
                      <p className="mt-auto pt-3 text-xs text-muted-foreground">
                        Estoque disponível: <span className="font-semibold tabular-nums text-foreground">{product.estoque ?? 0}</span>
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/15 p-3">
                      <span className="font-bold tabular-nums text-primary">
                        {formatCurrencyBRL(product.precovenda || 0)}
                      </span>
                      <Button
                        type="button"
                        onClick={() => addToCart(product)}
                        disabled={(product.estoque ?? 0) <= 0}
                        size="sm"
                        className="h-9 rounded-none px-3 font-semibold disabled:cursor-not-allowed"
                        aria-label={`Adicionar ${product.titulo} ao carrinho`}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        Adicionar
                      </Button>
                    </div>
                  </article>
                ))}
              </section>
            )}

            <nav
              className="flex flex-col items-center justify-between gap-3 border border-border bg-card p-3 sm:flex-row"
              aria-label="Paginação dos produtos"
            >
              <p className="text-sm text-muted-foreground">
                Página {productsPage} de {productsTotalPages} · {productsTotal} produtos
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1">
                <Button type="button" size="icon" variant="outline" className="rounded-none" aria-label="Primeira página" disabled={productsPage <= 1 || loadingProductsPage} onClick={() => void fetchProdutos(1)}>
                  <ChevronsLeft className="size-4" aria-hidden="true" />
                </Button>
                <Button type="button" size="icon" variant="outline" className="rounded-none" aria-label="Página anterior" disabled={productsPage <= 1 || loadingProductsPage} onClick={() => void fetchProdutos(productsPage - 1)}>
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                {visibleProductPages.map((page) => (
                  <Button key={page} type="button" size="icon" variant={page === productsPage ? "default" : "outline"} className="rounded-none" aria-label={`Ir para a página ${page}`} aria-current={page === productsPage ? "page" : undefined} disabled={loadingProductsPage} onClick={() => void fetchProdutos(page)}>
                    {page}
                  </Button>
                ))}
                <Button type="button" size="icon" variant="outline" className="rounded-none" aria-label="Próxima página" disabled={productsPage >= productsTotalPages || loadingProductsPage} onClick={() => void fetchProdutos(productsPage + 1)}>
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
                <Button type="button" size="icon" variant="outline" className="rounded-none" aria-label="Última página" disabled={productsPage >= productsTotalPages || loadingProductsPage} onClick={() => void fetchProdutos(productsTotalPages)}>
                  <ChevronsRight className="size-4" aria-hidden="true" />
                </Button>
                {loadingProductsPage ? <Loader2 className="ml-2 size-4 animate-spin" aria-label="Carregando página" /> : null}
              </div>
            </nav>
          </main>

          <aside className="min-w-0 lg:h-full lg:min-h-0">
            <section className="flex flex-col overflow-hidden border border-border bg-card shadow-sm lg:h-full lg:min-h-0">
              <header className="flex shrink-0 items-center gap-3 border-b border-background/10 bg-foreground px-3 py-3 text-background dark:bg-primary/20 dark:text-foreground sm:px-4">
                <div className="flex size-9 shrink-0 items-center justify-center border border-background/20 bg-background/10 dark:border-border dark:bg-background">
                  <ShoppingCart className="size-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold uppercase tracking-[0.08em]">
                    Carrinho de produtos
                  </h2>
                  <p className="mt-0.5 text-xs text-background/60 dark:text-muted-foreground">
                    Venda em montagem
                  </p>
                </div>
                <span className="ml-auto shrink-0 border border-background/20 px-2 py-1 text-xs font-bold tabular-nums dark:border-border">
                  {cart.length} {cart.length === 1 ? "produto" : "produtos"}
                </span>
              </header>

              <div className="shrink-0 border-b border-border bg-muted/15 p-3 sm:p-4">
                {selectedCustomer ? (
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Cliente selecionado
                      </p>
                      <p className="truncate text-sm font-semibold text-foreground" title={selectedCustomer.nomerazaosocial}>
                        {selectedCustomer.nomerazaosocial}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Remover cliente selecionado"
                      onClick={() => setSelectedCustomer(undefined)}
                    >
                      <UserRoundX className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <CustomerSelect
                    open={isCustomerSelectOpen}
                    setOpen={setIsCustomerSelectOpen}
                    OnSelect={setSelectedCustomer}
                  >
                    <Button type="button" variant="outline" className="h-10 w-full justify-start rounded-none text-xs">
                      <Search className="size-4" aria-hidden="true" />
                      Selecionar cliente
                    </Button>
                  </CustomerSelect>
                )}
                <CustomerBlockedAlert status={selectedCustomer?.status} className="px-0 pt-2 text-left" />
              </div>

              <div className="min-h-0 flex-1 space-y-4 p-3 sm:p-4 lg:overflow-y-auto lg:overscroll-contain">
                {cart.length === 0 ? (
                  <div className="flex min-h-44 flex-col items-center justify-center border border-dashed border-border bg-muted/10 px-4 py-8 text-center">
                    <ShoppingCart className="mb-3 size-8 text-muted-foreground/50" aria-hidden="true" />
                    <p className="text-sm font-semibold text-foreground">Carrinho vazio</p>
                    <p className="mt-1 text-xs text-muted-foreground">Adicione um produto do catálogo para começar.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Itens adicionados
                      </span>
                      <button type="button" onClick={() => setCart([])} className="text-xs font-medium text-destructive hover:underline">
                        Esvaziar carrinho
                      </button>
                    </div>

                    <div className="space-y-2 pr-1">
                      {cart.map((item) => (
                        <article key={item.id} className="overflow-hidden border border-border bg-background">
                          <header className="flex items-start justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{item.titulo}</p>
                              <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                                {item.grupo || "Sem grupo"} · estoque {item.estoque}
                              </p>
                            </div>
                            <Button type="button" onClick={() => removeFromCart(item.id)} size="icon" variant="ghost" className="size-8 shrink-0 rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Remover ${item.titulo} do carrinho`}>
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </header>
                          <div className="grid grid-cols-[minmax(7rem,1fr)_auto] items-end gap-3 p-3">
                            <div className="min-w-0 space-y-1">
                              <span className="text-[10px] font-medium text-muted-foreground">Preço unitário</span>
                              <ValueInput value={item.precovenda} onValueChange={(value) => updatePrice(item.id, value)} className="h-9 rounded-none text-right text-xs" />
                            </div>
                            <div className="space-y-1 text-right">
                              <span className="text-[10px] font-medium text-muted-foreground">Quantidade</span>
                              <div className="flex items-center justify-end">
                                <Button type="button" onClick={() => updateQuantity(item.id, item.quantity - 1)} size="icon" variant="outline" className="size-9 rounded-none" aria-label={`Diminuir quantidade de ${item.titulo}`}>
                                  <Minus className="size-3" aria-hidden="true" />
                                </Button>
                                <span className="flex h-9 min-w-9 items-center justify-center border-y border-border px-2 text-sm font-bold tabular-nums text-foreground">{item.quantity}</span>
                                <Button type="button" onClick={() => updateQuantity(item.id, item.quantity + 1)} size="icon" variant="outline" className="size-9 rounded-none" disabled={item.quantity >= item.estoque} aria-label={`Aumentar quantidade de ${item.titulo}`}>
                                  <Plus className="size-3" aria-hidden="true" />
                                </Button>
                              </div>
                            </div>
                            <div className="col-span-2 flex items-center justify-between border-t border-border pt-2 text-xs">
                              <span className="text-muted-foreground">Total do item</span>
                              <span className="font-bold tabular-nums text-primary">{formatCurrencyBRL(item.precovenda * item.quantity)}</span>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>

                    <section className="space-y-3 border-t border-border pt-4" aria-labelledby="condicoes-venda-title">
                      <div>
                        <h3 id="condicoes-venda-title" className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">Condições da venda</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">Categoria, descontos e frete.</p>
                      </div>

                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Categoria de venda</span>
                        <Select value={selectedSaleCategoryId ? String(selectedSaleCategoryId) : "uncategorized"} onValueChange={(value) => setSelectedSaleCategoryId(value === "uncategorized" ? null : Number(value))} disabled={loadingCategoriasVenda}>
                          <SelectTrigger className="h-10 w-full rounded-none">
                            <SelectValue placeholder={loadingCategoriasVenda ? "Carregando..." : "Selecione uma categoria"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="uncategorized">Sem categoria</SelectItem>
                            {categoriasVenda.map((categoria) => (
                              <SelectItem key={categoria.id} value={String(categoria.id)}>{categoria.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">Tipo de desconto</span>
                          <Select value={discountType ?? "NONE"} onValueChange={(value) => setDiscountType(value === "NONE" ? null : (value as DiscountType))}>
                            <SelectTrigger className="h-10 w-full rounded-none"><SelectValue placeholder="Sem desconto" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">Sem desconto</SelectItem>
                              <SelectItem value="FIXO">Fixo</SelectItem>
                              <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">{discountType === "PORCENTAGEM" ? "Percentual (%)" : "Valor do desconto"}</span>
                          {discountType === "PORCENTAGEM" ? (
                            <Input type="number" min={0} max={100} step="0.01" value={discount} onChange={(event) => setDiscount(Number(event.target.value || 0))} disabled={!discountType} placeholder="0,00%" className="h-10 rounded-none" />
                          ) : (
                            <ValueInput value={discount} onValueChange={setDiscount} disabled={!discountType} className="h-10 rounded-none" />
                          )}
                        </div>
                      </div>

                      <div className="border border-border bg-muted/10 p-3">
                        <div className="flex items-center gap-2">
                          <Checkbox id="incluir-frete-venda" checked={hasFreight} onCheckedChange={(checked) => { const enabled = checked === true; setHasFreight(enabled); if (!enabled) setFreight(0); }} />
                          <label htmlFor="incluir-frete-venda" className="text-sm font-medium leading-none">Incluir frete na venda</label>
                        </div>
                        {hasFreight ? (
                          <div className="mt-3 space-y-1">
                            <span className="text-xs text-muted-foreground">Valor do frete</span>
                            <ValueInput value={freight} onValueChange={setFreight} aria-label="Valor do frete" className="h-10 rounded-none" />
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="space-y-2 border-t border-border pt-4" aria-label="Resumo financeiro da venda">
                      <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{formatCurrencyBRL(subtotal)}</span></div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Desconto</span>
                        <span className="tabular-nums">- {formatCurrencyBRL(discountAmount)}{discountType === "PORCENTAGEM" && normalizedDiscountInput > 0 ? ` (${Math.min(normalizedDiscountInput, 100).toFixed(2)}%)` : ""}</span>
                      </div>
                      {discountType && discountAmount > 0 ? (
                        <div className="flex justify-between text-xs text-muted-foreground"><span>Desconto informado</span><span>{discountType === "PORCENTAGEM" ? `${Math.min(normalizedDiscountInput, 100).toFixed(2)}%` : formatCurrencyBRL(normalizedDiscountInput)}</span></div>
                      ) : null}
                      {hasFreight ? <div className="flex justify-between text-sm text-muted-foreground"><span>Frete</span><span className="tabular-nums">+ {formatCurrencyBRL(freightAmount)}</span></div> : null}
                      <div className="flex items-center justify-between border border-primary/30 bg-primary/10 px-3 py-3 text-lg font-bold text-foreground">
                        <span>Total</span><span className="tabular-nums text-primary">{formatCurrencyBRL(total)}</span>
                      </div>
                    </section>

                  </>
                )}
              </div>
              {cart.length > 0 ? (
                <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 gap-2 border-t border-border bg-background/95 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur-sm lg:static lg:shrink-0 lg:grid-cols-1 lg:bg-background lg:p-3 lg:shadow-[0_-8px_20px_rgba(0,0,0,0.08)] lg:backdrop-blur-none xl:grid-cols-2">
                  <Button type="button" variant="outline" className="min-h-11 rounded-none font-semibold" onClick={() => abrirConfirmacao("ORCAMENTO")}>
                    <ReceiptText className="size-4" aria-hidden="true" />
                    Salvar orçamento
                  </Button>
                  <Button type="button" className="min-h-11 rounded-none font-semibold" onClick={() => abrirConfirmacao("PAGAMENTO")}>
                    Finalizar venda
                  </Button>
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      </div>

      <CameraScannerDialog
        open={isCameraOpen}
        onOpenChange={setIsCameraOpen}
        kind="barcode"
        title="Ler código de barras"
        description="Aponte a câmera para o código de barras da embalagem, centralizado na linha vermelha."
        onDetected={enfileirarLeitura}
      />

      <DialogShell
        open={isAlertOpen}
        onOpenChange={(open) => {
          if (!creatingVenda) setIsAlertOpen(open);
        }}
        title={acaoConfirmacao === "ORCAMENTO" ? "Salvar como orçamento" : "Finalizar venda"}
        titleSuffix={acaoConfirmacao === "ORCAMENTO" ? "Orçamento" : "Pagamento"}
        description="Revise as informações da venda e defina os dados que serão encaminhados ao financeiro."
        eyebrow="Conferência da venda"
        variant="workbench"
        maxW="md:max-w-[980px]"
        mobileFull
        fixedHeight
        footer={
          <>
            <Button type="button" variant="outline" className="rounded-none" disabled={creatingVenda} onClick={() => setIsAlertOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="min-w-36 rounded-none"
              disabled={creatingVenda}
              onClick={async () => {
                const success = await createVenda(acaoConfirmacao);
                if (success) setIsAlertOpen(false);
              }}
            >
              {creatingVenda ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {creatingVenda ? "Confirmando..." : acaoConfirmacao === "ORCAMENTO" ? "Salvar orçamento" : "Finalizar venda"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <section className="grid overflow-hidden border border-border bg-background shadow-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo da venda">
            <div className="min-w-0 border-b border-border p-3 sm:border-r lg:border-b-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Cliente</p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground" title={selectedCustomer?.nomerazaosocial}>{selectedCustomer?.nomerazaosocial || "Não informado"}</p>
            </div>
            <div className="border-b border-border p-3 lg:border-b-0 lg:border-r">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Produtos</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{cart.reduce((sum, item) => sum + item.quantity, 0)} itens</p>
            </div>
            <div className="border-b border-border p-3 sm:border-b-0 sm:border-r">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Ajustes</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">- {formatCurrencyBRL(discountAmount)} · + {formatCurrencyBRL(freightAmount)}</p>
            </div>
            <div className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Total</p>
              <p className="mt-1 text-sm font-bold tabular-nums text-primary">{formatCurrencyBRL(total)}</p>
            </div>
          </section>

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
            disabled={creatingVenda}
          />
        </div>
      </DialogShell>
    </div>
  );
}
