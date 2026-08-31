"use client";
import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { Fornecedor } from "../../types";
import { toast } from "@/lib/toast";
import ProductSelect from "@/app/(app)/components/productSelect";
import { ItemSelectDialog } from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ArrowDownToLine,
  Boxes,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Loader2,
  Minus,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import formatarEmReal from "@/utils/formatarEmReal";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Banco,
  Metodo_pagamento,
} from "../../../(financeiro)/fluxodecaixa/types";
import { useCategoriasTransacao } from "../../../(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { usePlanosDeConta } from "../../../(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../../(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { PlanoContaCombobox } from "../../../(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "../../../(financeiro)/fluxodecaixa/components/search-combobox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTiposEntrada } from "../../hooks/use-tipos-entrada";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import { rotuloDeEscopo, type UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";
import {
  adicionarOuIncrementarItem,
  buildEntradaPayload,
  criarItemDeSelecionavel,
  endpointDaEntrada,
  numero,
  totalDaEntrada,
  validarEntrada,
  type EntradaFinanceiroForm,
  type EntradaInventory,
  type EntradaItemForm,
  type EntradaItemSelecionavel,
  type EntradaParcela,
} from "./register-model";

interface RegisterContentProps {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  inventory?: EntradaInventory;
  escopo?: UsoConsumoEscopo;
  onSaved?: () => void | Promise<void>;
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/10">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: ReactNode;
  emphasized?: boolean;
}) {
  return (
    <div
      className={
        emphasized
          ? "rounded-xl border border-primary/15 bg-primary/[0.06] px-3 py-2.5"
          : "rounded-xl border bg-muted/25 px-3 py-2.5"
      }
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={
          emphasized
            ? "mt-0.5 text-base font-semibold tabular-nums text-primary"
            : "mt-0.5 text-base font-semibold tabular-nums text-foreground"
        }
      >
        {value}
      </p>
    </div>
  );
}

export default function RegisterContent({
  open,
  onOpenChange,
  inventory = "produto",
  escopo,
  onSaved,
}: RegisterContentProps) {
  const [tipo, setTipo] = useState<string>("COMPRA_FORNECEDOR");
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const [itens, setItens] = useState<EntradaItemForm[]>([]);
  const { tipos, loadingTipos } = useTiposEntrada(open !== false, inventory);
  // Se o tipo selecionado nao estiver na lista ativa (desativado no cadastro),
  // cai no primeiro disponivel. Derivado na leitura, sem setState em efeito.
  const tipoAtual = tipos.some((item) => item.codigo === tipo)
    ? tipo
    : (tipos[0]?.codigo ?? tipo);

  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<
    Fornecedor | undefined
  >(undefined);
  const [openFornecedor, setOpenFornecedor] = useState(false);
  const [openProduto, setOpenProduto] = useState(false);
  const [loadingConcluirEntrada, setLoadingConcluirEntrada] = useState(false);
  const [lancarFinanceiro, setLancarFinanceiro] = useState(true);
  const [pagamentoFuturo, setPagamentoFuturo] = useState(true);
  const [parcelas, setParcelas] = useState<EntradaParcela[]>([]);
  const [banks, setBanks] = useState<Banco[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [selectedMetodo, setSelectedMetodo] = useState<Metodo_pagamento | "">(
    "",
  );
  const [selectedCategoria, setSelectedCategoria] = useState("");
  const [selectedPlanoId, setSelectedPlanoId] = useState("");
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState("");
  const { categorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();

  const totalGeral = useMemo(() => totalDaEntrada(itens), [itens]);
  const totalParcelas = useMemo(
    () => parcelas.reduce((sum, parcela) => sum + parcela.valor, 0),
    [parcelas],
  );
  const escopoEfetivo = escopo ?? "USOCONSUMO";
  const rotuloEstoque =
    inventory === "produto"
      ? { nome: "Produtos", item: "produto", compra: "Compra de mercadorias" }
      : rotuloDeEscopo(escopoEfetivo);

  const resetForm = useCallback(() => {
    setTipo("COMPRA_FORNECEDOR");
    setItens([]);
    setFornecedorSelecionado(undefined);
    setOpenFornecedor(false);
    setOpenProduto(false);
    setLoadingConcluirEntrada(false);
    setLancarFinanceiro(true);
    setPagamentoFuturo(true);
    setParcelas([]);
    setSelectedBankId("");
    setSelectedMetodo("");
    setSelectedCategoria("");
    setSelectedPlanoId("");
    setSelectedCentroCustoId("");
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  useEffect(() => {
    if (!open || !lancarFinanceiro) return;
    let cancelled = false;
    setLoadingBanks(true);
    fetch("/api/banks")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(payload?.error || "Falha ao carregar bancos");
        if (!cancelled)
          setBanks(Array.isArray(payload?.data) ? payload.data : []);
      })
      .catch((error) => {
        if (!cancelled)
          toast.error(error?.message || "Não foi possível carregar os bancos");
      })
      .finally(() => {
        if (!cancelled) setLoadingBanks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lancarFinanceiro, open]);

  const handleAdicionarItem = (selecionado: EntradaItemSelecionavel) => {
    const novoItem = criarItemDeSelecionavel(selecionado);
    if (!novoItem.itemId) {
      toast.error("O item selecionado não possui um ID válido.");
      return;
    }
    setItens((current) => adicionarOuIncrementarItem(current, novoItem));
  };

  const updateItem = <K extends keyof EntradaItemForm>(
    index: number,
    key: K,
    value: EntradaItemForm[K],
  ) => {
    setItens((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [key]: value } as EntradaItemForm;
      return copy;
    });
  };

  const handleRemove = (index: number) => {
    setItens((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRegistrarEntrada = async () => {
    const financeiro: EntradaFinanceiroForm = {
      lancar: lancarFinanceiro,
      pagamentoFuturo,
      parcelas,
      bancoId: selectedBankId ? Number(selectedBankId) : null,
      metodoPagamento: selectedMetodo || null,
      categoria: selectedCategoria || null,
      categoriaId:
        categorias.find((categoria) => categoria.nome === selectedCategoria)
          ?.id ?? null,
      planoContaId: selectedPlanoId ? Number(selectedPlanoId) : null,
      centroCustoId: selectedCentroCustoId
        ? Number(selectedCentroCustoId)
        : null,
      nomePagador:
        fornecedorSelecionado?.nomerazaosocial || "Fornecedor não informado",
      cpfCnpjPagador: fornecedorSelecionado?.cpfcnpj || "NAO INFORMADO",
    };

    const exigeValor =
      tipos.find((item) => item.codigo === tipoAtual)?.exigeValor !== false;
    const validationError = validarEntrada({
      itens,
      exigeValor,
      financeiro,
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const payload = buildEntradaPayload({
      inventory,
      escopo: inventory === "usoconsumo" ? escopoEfetivo : undefined,
      fornecedorId: fornecedorSelecionado?.id ?? null,
      tipo: tipoAtual,
      itens,
      financeiro,
    });

    setLoadingConcluirEntrada(true);
    try {
      const res = await fetch(endpointDaEntrada(inventory), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data?.error || "Não foi possível registrar a entrada.");

      toast.success(
        `Entrada em ${rotuloEstoque.nome.toLocaleLowerCase("pt-BR")} registrada com sucesso!`,
      );
      resetForm();
      onOpenChange?.(false);
      try {
        await onSaved?.();
      } catch (refreshError) {
        toast.error(
          "A entrada foi registrada, mas a lista não pôde ser atualizada.",
          {
            description:
              refreshError instanceof Error
                ? refreshError.message
                : "Atualize a página para consultar o novo saldo.",
          },
        );
      }
    } catch (error: unknown) {
      toast.error("Erro ao registrar entrada", {
        description:
          error instanceof Error
            ? error.message
            : "Verifique sua conexão e tente novamente.",
      });
    } finally {
      setLoadingConcluirEntrada(false);
    }
  };

  return (
    <DialogContent
      showCloseButton={false}
      className="left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none motion-reduce:animate-none motion-reduce:duration-0 sm:left-1/2 sm:top-1/2 sm:h-[min(850px,calc(100dvh-2rem))] sm:w-[95vw] sm:max-w-[1100px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-xl"
      onEscapeKeyDown={(event) =>
        loadingConcluirEntrada && event.preventDefault()
      }
      onInteractOutside={(event) =>
        loadingConcluirEntrada && event.preventDefault()
      }
    >
      <DialogClose asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fechar entrada"
          disabled={loadingConcluirEntrada}
          className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 size-12 rounded-xl text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-primary/10 hover:text-primary active:scale-95 motion-reduce:transform-none motion-reduce:transition-none sm:right-4 sm:top-4 sm:size-10"
        >
          <X aria-hidden="true" />
        </Button>
      </DialogClose>

      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <DialogHeader className="relative shrink-0 overflow-hidden border-b bg-card px-4 pb-4 pr-16 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-6 sm:py-5 sm:pr-16">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/10">
              <ArrowDownToLine className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <span className="inline-flex rounded-full bg-primary/[0.08] px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/10">
                Entrada múltipla
              </span>
              <DialogTitle className="mt-2 text-xl leading-tight tracking-tight sm:text-2xl">
                Criar entrada · {rotuloEstoque.nome}
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-sm leading-relaxed">
                Adicione vários itens do estoque selecionado e conclua tudo em
                uma única operação.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <FornecedorSelect
          OnSelect={(f) => {
            setFornecedorSelecionado(f);
            setOpenFornecedor(false);
          }}
          open={openFornecedor}
          setOpen={setOpenFornecedor}
        />

        {inventory === "produto" ? (
          <ProductSelect
            OnSelect={(produto) => {
              handleAdicionarItem(produto);
              setOpenProduto(false);
            }}
            open={openProduto}
            setOpen={setOpenProduto}
          />
        ) : null}

        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted/20 px-4 py-4 [-webkit-overflow-scrolling:touch] sm:space-y-5 sm:px-6 sm:py-6 [&_input]:min-h-12 [&_[data-slot=button]]:min-h-12 [&_[data-slot=select-trigger]]:min-h-12 sm:[&_input]:min-h-10 sm:[&_[data-slot=button]]:min-h-10 sm:[&_[data-slot=select-trigger]]:min-h-10">
          {/* Dados da entrada */}
          <section className="min-w-0 max-w-full rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading
              icon={ClipboardList}
              eyebrow="Dados da entrada"
              title="Defina a origem da movimentação"
              description="Escolha o tipo e, se necessário, vincule um fornecedor à entrada."
            />

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo da entrada</Label>
                <Select
                  value={tipoAtual}
                  onValueChange={setTipo}
                  disabled={loadingTipos && !tipos.length}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        loadingTipos && !tipos.length
                          ? "Carregando tipos..."
                          : "Selecione o tipo"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {tipos.map((opt) => (
                      <SelectItem
                        key={opt.codigo}
                        value={opt.codigo}
                        className="hover:cursor-pointer"
                      >
                        {opt.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!loadingTipos && !tipos.length ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum tipo de entrada ativo. Cadastre em Configurações &gt;
                    Tipos.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Fornecedor (opcional)</Label>

                {fornecedorSelecionado ? (
                  <div className="flex min-h-12 min-w-0 items-center gap-3 rounded-xl border border-primary/15 bg-primary/[0.04] p-2 pl-3">
                    <Building2
                      className="size-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Fornecedor #{fornecedorSelecionado.id}
                      </p>
                      <p className="truncate text-sm font-medium text-foreground">
                        {fornecedorSelecionado.nomerazaosocial}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setFornecedorSelecionado(undefined)}
                      className="size-12 shrink-0 rounded-xl text-destructive hover:cursor-pointer hover:bg-destructive/10 hover:text-destructive sm:size-10"
                      aria-label="Remover fornecedor"
                      title="Remover fornecedor"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOpenFornecedor(true)}
                      className="group w-full justify-start rounded-xl transition-[transform,background-color,border-color] duration-150 hover:cursor-pointer hover:border-primary/25 hover:bg-primary/[0.04] active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none"
                    >
                      <Search
                        className="size-4 text-primary"
                        aria-hidden="true"
                      />
                      Selecionar fornecedor
                    </Button>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Você pode concluir esta entrada sem informar um
                      fornecedor.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-3 border-t pt-4">
              <Label>{inventory === "produto" ? "Produtos" : "Itens"}</Label>

              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:items-center">
                {inventory === "produto" ? (
                  <Button
                    variant="secondary"
                    type="button"
                    className="min-h-12 min-w-0 rounded-xl transition-transform duration-150 hover:cursor-pointer active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-10"
                    onClick={() => setOpenProduto(true)}
                  >
                    <PackagePlus className="size-4" />
                    Adicionar produto
                  </Button>
                ) : (
                  <ItemSelectDialog
                    escopo={escopoEfetivo}
                    open={openProduto}
                    setOpen={setOpenProduto}
                    onSelect={handleAdicionarItem}
                  >
                    <Button
                      variant="secondary"
                      type="button"
                      className="min-h-12 min-w-0 rounded-xl transition-transform duration-150 hover:cursor-pointer active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-10"
                    >
                      <PackagePlus className="size-4" />
                      Adicionar {rotuloEstoque.item.toLocaleLowerCase("pt-BR")}
                    </Button>
                  </ItemSelectDialog>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-12 min-w-0 rounded-xl text-muted-foreground hover:cursor-pointer hover:bg-destructive/10 hover:text-destructive sm:min-h-10"
                  onClick={() => setItens([])}
                  disabled={itens.length === 0}
                >
                  Limpar lista
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <SummaryMetric label="Itens adicionados" value={itens.length} />
              <SummaryMetric
                label="Total da entrada"
                value={formatarEmReal(Number(totalGeral.toFixed(2)))}
                emphasized
              />
            </div>
          </section>

          {/* Lista de itens */}
          <section className="min-h-0 min-w-0 max-w-full overflow-hidden rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading
              icon={Boxes}
              eyebrow="Itens"
              title="Itens da entrada"
              description="Quantidade e custo ficam em destaque; os dados fiscais podem ser expandidos quando necessário."
            />

            <div className="mt-5 min-w-0 max-w-full space-y-4">
              {itens.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-primary/20 bg-primary/[0.025] px-4 py-10 text-center">
                  <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <PackagePlus className="size-6" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    Nenhum item adicionado
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Use o botão acima para selecionar um ou vários itens deste
                    estoque.
                  </p>
                </div>
              ) : (
                itens.map((item, index) => (
                  <div
                    key={item.itemId}
                    className="min-w-0 max-w-full space-y-4 overflow-hidden rounded-2xl border border-border/80 bg-background/70 p-3 shadow-xs sm:p-4"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold tabular-nums text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <div className="line-clamp-2 break-words text-sm font-semibold leading-relaxed sm:text-base">
                            {item.titulo ?? "Sem título"}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {inventory === "produto" ? "Produto" : "Item"} #
                            {item.itemId}
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-12 shrink-0 rounded-xl text-destructive hover:cursor-pointer hover:bg-destructive/10 hover:text-destructive sm:size-10"
                        onClick={() => handleRemove(index)}
                        aria-label={`Remover ${item.titulo ?? "item"}`}
                        title="Remover item"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>

                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {(
                        [
                          ["Ref.", item.referencia],
                          ["Un.", item.unidade],
                          ["NCM", item.ncm],
                          ["CFOP", item.cfop],
                        ] as const
                      ).map(([label, value]) => (
                        <span
                          key={label}
                          className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted/60 px-2 py-1 text-xs text-muted-foreground"
                        >
                          <strong className="font-medium text-foreground">
                            {label}
                          </strong>
                          <span className="truncate">{value ?? "-"}</span>
                        </span>
                      ))}
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-primary/10 bg-primary/[0.035] p-3 md:grid-cols-3 [&>*]:min-w-0">
                      <div className="space-y-1.5">
                        <Label>Quantidade</Label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={item.quantidade}
                          onChange={(e) =>
                            updateItem(
                              index,
                              "quantidade",
                              numero(e.target.value),
                            )
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Valor unitário de compra</Label>
                        <ValueInput
                          value={item.valorUnitarioCompra}
                          onValueChange={(value) =>
                            updateItem(index, "valorUnitarioCompra", value)
                          }
                        />
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Salvo como o último custo de compra do item.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Total do item</Label>
                        <Input
                          className="bg-background font-semibold tabular-nums"
                          value={formatarEmReal(
                            Number(
                              (
                                numero(item.quantidade) *
                                numero(item.valorUnitarioCompra)
                              ).toFixed(2),
                            ),
                          )}
                          readOnly
                        />
                      </div>
                    </div>

                    <Accordion
                      type="single"
                      collapsible
                      className="motion-reduce:[&_[data-slot=accordion-content]]:animate-none"
                    >
                      <AccordionItem
                        value="dados-fiscais"
                        className="overflow-hidden rounded-xl border bg-muted/[0.18] px-3"
                      >
                        <AccordionTrigger className="min-h-12 py-3 hover:no-underline motion-reduce:transition-none motion-reduce:[&_svg]:transition-none">
                          <div className="pr-2 text-left">
                            <p className="font-medium text-foreground">
                              Dados fiscais e cadastrais
                            </p>
                            <p className="mt-0.5 text-xs font-normal leading-relaxed text-muted-foreground">
                              Título, referência, unidade e tributação do item
                            </p>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 pb-3 pt-1">
                          <div className="space-y-1.5">
                            <Label>Título</Label>
                            <Input
                              value={item.titulo ?? ""}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  "titulo",
                                  e.target.value || null,
                                )
                              }
                            />
                          </div>
                          <Separator />
                          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5 [&>*]:min-w-0">
                            <div className="space-y-1.5">
                              <Label>Referência</Label>
                              <Input
                                value={item.referencia ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "referencia",
                                    e.target.value || null,
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>Unidade</Label>
                              <Input
                                value={item.unidade ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "unidade",
                                    e.target.value || null,
                                  )
                                }
                                placeholder="UN, CX..."
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>NCM</Label>
                              <Input
                                value={item.ncm ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "ncm",
                                    e.target.value || null,
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>CEST</Label>
                              <Input
                                value={item.cest ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "cest",
                                    e.target.value || null,
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>CSOSN</Label>
                              <Input
                                value={item.csosn ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "csosn",
                                    e.target.value || null,
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>CFOP</Label>
                              <Input
                                value={item.cfop ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "cfop",
                                    e.target.value || null,
                                  )
                                }
                                maxLength={4}
                                inputMode="numeric"
                                placeholder="5102"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>CST</Label>
                              <Input
                                value={item.cst ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "cst",
                                    e.target.value || null,
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>Alíquota ICMS</Label>
                              <Input
                                type="number"
                                step={0.01}
                                value={item.aliquotaicms ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "aliquotaicms",
                                    e.target.value === ""
                                      ? null
                                      : numero(e.target.value),
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>CST PIS</Label>
                              <Input
                                value={item.cstPis ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "cstPis",
                                    e.target.value || null,
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>Alíquota PIS</Label>
                              <Input
                                type="number"
                                step={0.01}
                                value={item.aliquotaPis ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "aliquotaPis",
                                    e.target.value === ""
                                      ? null
                                      : numero(e.target.value),
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>CST COFINS</Label>
                              <Input
                                value={item.cstCofins ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "cstCofins",
                                    e.target.value || null,
                                  )
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label>Alíquota COFINS</Label>
                              <Input
                                type="number"
                                step={0.01}
                                value={item.aliquotaCofins ?? ""}
                                onChange={(e) =>
                                  updateItem(
                                    index,
                                    "aliquotaCofins",
                                    e.target.value === ""
                                      ? null
                                      : numero(e.target.value),
                                  )
                                }
                              />
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="min-w-0 max-w-full space-y-5 overflow-hidden rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading
              icon={CircleDollarSign}
              eyebrow="Financeiro"
              title="Lançamento financeiro"
              description="Opcional. Registre a despesa agora ou programe parcelas futuras."
              action={
                <Label
                  htmlFor="lancar-financeiro"
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2 sm:min-h-10"
                >
                  <span className="text-sm font-medium">
                    {lancarFinanceiro ? "Ativado" : "Desativado"}
                  </span>
                  <Switch
                    id="lancar-financeiro"
                    checked={lancarFinanceiro}
                    onCheckedChange={(checked) => {
                      setLancarFinanceiro(checked);
                      if (checked && parcelas.length === 0) {
                        setParcelas([
                          {
                            id: Date.now(),
                            valor: totalGeral,
                            dataVencimento: undefined,
                          },
                        ]);
                      }
                    }}
                    disabled={loadingConcluirEntrada}
                    aria-label="Lançar movimentação no financeiro"
                  />
                </Label>
              }
            />

            {lancarFinanceiro ? (
              <div className="animate-in space-y-5 border-t pt-5 duration-200 fade-in-0 slide-in-from-top-1 motion-reduce:animate-none motion-reduce:duration-0">
                <div className="grid min-w-0 gap-2 sm:max-w-md">
                  <Label>Forma do lançamento</Label>
                  <Select
                    value={pagamentoFuturo ? "FUTURO" : "IMEDIATO"}
                    onValueChange={(value) => {
                      const futuro = value === "FUTURO";
                      setPagamentoFuturo(futuro);
                      if (futuro && parcelas.length === 0) {
                        setParcelas([
                          {
                            id: Date.now(),
                            valor: totalGeral,
                            dataVencimento: undefined,
                          },
                        ]);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FUTURO">Parcelas futuras</SelectItem>
                      <SelectItem value="IMEDIATO">
                        Pagamento imediato
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {pagamentoFuturo ? (
                  <div className="space-y-4">
                    {parcelas.map((parcela, index) => (
                      <div
                        key={parcela.id}
                        className="min-w-0 overflow-hidden rounded-xl border bg-muted/20 p-3 sm:p-4"
                      >
                        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                          <span className="inline-flex rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">
                            Parcela {index + 1}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-12 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive sm:size-10"
                            onClick={() => {
                              if (parcelas.length === 1) {
                                toast.error("Mantenha ao menos uma parcela.");
                                return;
                              }
                              setParcelas((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              );
                            }}
                            aria-label={`Remover parcela ${index + 1}`}
                          >
                            <Minus className="size-4" />
                          </Button>
                        </div>
                        <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                          <div className="space-y-1.5">
                            <Label>Vencimento</Label>
                            <DatePicker
                              value={parcela.dataVencimento ?? ""}
                              onChange={(value) =>
                                setParcelas((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          dataVencimento: value || undefined,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Valor</Label>
                            <ValueInput
                              value={parcela.valor}
                              onValueChange={(value) =>
                                setParcelas((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, valor: value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-2 gap-2">
                      <SummaryMetric
                        label="Total da entrada"
                        value={formatarEmReal(totalGeral)}
                      />
                      <SummaryMetric
                        label="Total das parcelas"
                        value={formatarEmReal(totalParcelas)}
                        emphasized
                      />
                    </div>
                    <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() =>
                          setParcelas((current) => [
                            ...current,
                            { id: Date.now(), valor: 0 },
                          ])
                        }
                      >
                        <Plus className="size-4" />
                        Adicionar parcela
                      </Button>
                      <p className="text-xs leading-relaxed text-muted-foreground sm:text-right">
                        A soma das parcelas deve corresponder ao total da
                        entrada.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2 sm:p-4 [&>*]:min-w-0">
                    <div className="space-y-1.5">
                      <Label>Banco</Label>
                      <Select
                        value={selectedBankId}
                        onValueChange={setSelectedBankId}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              loadingBanks
                                ? "Carregando..."
                                : "Selecione o banco"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {banks.map((bank) => (
                            <SelectItem key={bank.id} value={String(bank.id)}>
                              {bank.titulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Método de pagamento</Label>
                      <Select
                        value={selectedMetodo}
                        onValueChange={(value) =>
                          setSelectedMetodo(value as Metodo_pagamento)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o método" />
                        </SelectTrigger>
                        <SelectContent>
                          {metodosPagamento.map((method) => (
                            <SelectItem key={method.value} value={method.value}>
                              {method.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="space-y-3 border-t pt-5">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Classificação financeira
                    </h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      Organize o lançamento para relatórios e acompanhamento de
                      custos.
                    </p>
                  </div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
                    <div className="space-y-1.5">
                      <Label>Categoria</Label>
                      <Select
                        value={selectedCategoria}
                        onValueChange={setSelectedCategoria}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          {categorias.map((categoria) => (
                            <SelectItem
                              key={categoria.id}
                              value={categoria.nome}
                            >
                              {categoria.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Plano de conta</Label>
                      <PlanoContaCombobox
                        value={selectedPlanoId}
                        groups={gruposPlanosDeConta}
                        loading={loadingPlanos}
                        clearable
                        onClear={() => setSelectedPlanoId("")}
                        onValueChange={setSelectedPlanoId}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Centro de custo</Label>
                      <SearchCombobox
                        value={selectedCentroCustoId}
                        options={centrosCusto.map((centro) => ({
                          value: String(centro.id),
                          label: centro.nome,
                        }))}
                        loading={loadingCentrosCusto}
                        clearable
                        clearLabel="Sem centro de custo"
                        placeholder="Selecione o centro de custo"
                        onValueChange={setSelectedCentroCustoId}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <DialogFooter className="z-10 shrink-0 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.45)] backdrop-blur-md sm:px-6 sm:py-4">
          <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex min-w-0 items-center justify-between gap-3 sm:block"
              aria-live="polite"
            >
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Resumo da entrada
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  {itens.length} {itens.length === 1 ? "item" : "itens"}
                </p>
              </div>
              <span className="shrink-0 text-lg font-semibold tabular-nums text-primary sm:text-base">
                {formatarEmReal(Number(totalGeral.toFixed(2)))}
              </span>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={loadingConcluirEntrada}
                  className="min-h-12 w-full rounded-xl sm:min-h-10 sm:w-auto"
                >
                  Cancelar
                </Button>
              </DialogClose>

              <Button
                type="button"
                onClick={handleRegistrarEntrada}
                disabled={itens.length === 0 || loadingConcluirEntrada}
                className="min-h-12 w-full rounded-xl shadow-sm transition-transform duration-150 hover:cursor-pointer active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none sm:min-h-10 sm:w-auto sm:min-w-[180px]"
              >
                {loadingConcluirEntrada ? (
                  <div className="flex flex-row items-center gap-2">
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    <span>Registrando...</span>
                  </div>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Concluir entrada
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </div>
    </DialogContent>
  );
}
