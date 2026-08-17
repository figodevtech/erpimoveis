"use client";
import { useCallback, useEffect, useState, useMemo } from "react";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { Fornecedor, Produto, Unidade_medida } from "../../types";
import { toast } from "@/lib/toast";
import ProductSelect from "@/app/(app)/components/productSelect";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Minus, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import formatarEmReal from "@/utils/formatarEmReal";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Banco, Metodo_pagamento } from "../../../(financeiro)/fluxodecaixa/types";
import { useCategoriasTransacao } from "../../../(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { usePlanosDeConta } from "../../../(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../../(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { PlanoContaCombobox } from "../../../(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "../../../(financeiro)/fluxodecaixa/components/search-combobox";
import { useTiposEntrada } from "../../hooks/use-tipos-entrada";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
// ======== NOVO MODELO DO ITEM (alinhado com entradaitens) ========
type EntradaItemForm = {
  produto_id: number;

  titulo: string | null;
  referencia: string | null;

  ncm: string | null;
  csosn: string | null;
  cfop: string | null;
  cest: string | null;
  unidade: Unidade_medida | null;

  cClassTrib: string | null;
  cstIbs: string | null;
  cstCbs: string | null;

  cst: string | null;
  aliquotaicms: number | null;

  cst_pis: string | null;
  aliquota_pis: number | null;

  cst_cofins: string | null;
  aliquota_cofins: number | null;

  quantidade: number;
  precovenda: number;
};

type EntradaItemInsert = {
  produto_id: number;
  quantidade: number;
  precovenda: number;

  unidade: Unidade_medida | null;

  ncm: string | null;
  cest: string | null;
  csosn: string | null;
  referencia: string | null;
  titulo: string | null;

  cClassTrib: string | null;
  cstIbs: string | null;
  cstCbs: string | null;

  cst: string | null;
  aliquotaicms: number | null;
  cfop: string | null;

  cst_pis: string | null;
  aliquota_pis: number | null;

  cst_cofins: string | null;
  aliquota_cofins: number | null;
};

type EntradaCreatePayload = {
  fornecedorid: number | null;

  // fixos por requisito
  fiscal: false;
  notachave: null;

  /** Código de um tipo cadastrado em Configurações &gt; Tipos. */
  tipo: string;
  itens: EntradaItemInsert[];
  financeiro?: {
    lancar: boolean;
    pagamentoFuturo: boolean;
    parcelas: Array<{ valor: number; dataVencimento: string }>;
    bancoId: number | null;
    metodoPagamento: Metodo_pagamento | null;
    categoria: string | null;
    categoriaId: number | null;
    planoContaId: number | null;
    centroCustoId: number | null;
    nomePagador: string;
    cpfCnpjPagador: string;
    descricao: string;
  };
};

type Parcela = {
  id: number;
  dataVencimento?: string;
  valor: number;
};

function n(v: unknown, fallback = 0) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function toNullableText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function criarItemDeProduto(produto: Produto): EntradaItemForm {
  return {
    produto_id: produto.id ?? 0,

    titulo:
      toNullableText((produto as any).titulo) ??
      toNullableText((produto as any).descricao) ??
      null,
    referencia: toNullableText((produto as any).referencia),

    ncm: toNullableText((produto as any).ncm),
    csosn: toNullableText((produto as any).csosn),
    cfop: toNullableText((produto as any).cfop),
    cest: toNullableText((produto as any).cest),
    unidade: ((produto as any).unidade ?? null) as Unidade_medida | null,

    cClassTrib: toNullableText((produto as any).cClassTrib),
    cstIbs: toNullableText((produto as any).cstIbs),
    cstCbs: toNullableText((produto as any).cstCbs),

    cst: toNullableText((produto as any).cst),
    aliquotaicms:
      (produto as any).aliquotaicms == null
        ? null
        : n((produto as any).aliquotaicms),

    cst_pis: toNullableText((produto as any).cst_pis),
    aliquota_pis:
      (produto as any).aliquota_pis == null
        ? null
        : n((produto as any).aliquota_pis),

    cst_cofins: toNullableText((produto as any).cst_cofins),
    aliquota_cofins:
      (produto as any).aliquota_cofins == null
        ? null
        : n((produto as any).aliquota_cofins),

    quantidade: 1,
    precovenda: n(
      (produto as any).ultimovalordecompra ?? (produto as any).precocompra,
      0,
    ),
  };
}

function mapFormToInsert(item: EntradaItemForm): EntradaItemInsert {
  return {
    produto_id: item.produto_id,
    quantidade: n(item.quantidade),
    precovenda: n(item.precovenda),

    unidade: item.unidade,

    ncm: item.ncm,
    cest: item.cest,
    csosn: item.csosn,
    referencia: item.referencia,
    titulo: item.titulo,

    cClassTrib: item.cClassTrib,
    cstIbs: item.cstIbs,
    cstCbs: item.cstCbs,

    cst: item.cst,
    aliquotaicms: item.aliquotaicms,
    cfop: item.cfop,

    cst_pis: item.cst_pis,
    aliquota_pis: item.aliquota_pis,

    cst_cofins: item.cst_cofins,
    aliquota_cofins: item.aliquota_cofins,
  };
}

interface RegisterContentProps {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export default function RegisterContent({
  open,
  onOpenChange,
}: RegisterContentProps) {
  const [tipo, setTipo] = useState<string>("COMPRA_FORNECEDOR");
  const { options: metodosPagamento } = usePaymentMethodOptions();
  const [itens, setItens] = useState<EntradaItemForm[]>([]);
  const { tipos, loadingTipos } = useTiposEntrada(open !== false);
  // Se o tipo selecionado nao estiver na lista ativa (desativado no cadastro),
  // cai no primeiro disponivel. Derivado na leitura, sem setState em efeito.
  const tipoAtual = tipos.some((item) => item.codigo === tipo) ? tipo : tipos[0]?.codigo ?? tipo;

  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<
    Fornecedor | undefined
  >(undefined);
  const [openFornecedor, setOpenFornecedor] = useState(false);
  const [openProduto, setOpenProduto] = useState(false);
  const [loadingConcluirEntrada, setLoadingConcluirEntrada] = useState(false);
  const [lancarFinanceiro, setLancarFinanceiro] = useState(true);
  const [pagamentoFuturo, setPagamentoFuturo] = useState(true);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [banks, setBanks] = useState<Banco[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [selectedMetodo, setSelectedMetodo] = useState<Metodo_pagamento | "">("");
  const [selectedCategoria, setSelectedCategoria] = useState("");
  const [selectedPlanoId, setSelectedPlanoId] = useState("");
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState("");
  const { categorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto } = useCentrosCusto();

  const totalGeral = useMemo(() => {
    return itens.reduce(
      (acc, it) => acc + n(it.quantidade) * n(it.precovenda),
      0,
    );
  }, [itens]);

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
    if (!lancarFinanceiro) return;
    let cancelled = false;
    setLoadingBanks(true);
    fetch("/api/banks")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Falha ao carregar bancos");
        if (!cancelled) setBanks(Array.isArray(payload?.data) ? payload.data : []);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error?.message || "Não foi possível carregar os bancos");
      })
      .finally(() => {
        if (!cancelled) setLoadingBanks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lancarFinanceiro]);

  const handleAdicionarProduto = (produto: Produto) => {
    setItens((prev) => {
      const idx = prev.findIndex((i) => i.produto_id === (produto.id ?? 0));
      if (idx >= 0) {
        const copy = [...prev];
        const item = { ...copy[idx] };
        item.quantidade = n(item.quantidade) + 1;
        copy[idx] = item;
        return copy;
      }
      return [...prev, criarItemDeProduto(produto)];
    });
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
    if (itens.length === 0) {
      toast.error("Adicione ao menos um produto.");
      return;
    }

    const itemInvalido = itens.findIndex(
      (item) => !Number.isInteger(item.quantidade) || item.quantidade <= 0 || !Number.isFinite(item.precovenda) || item.precovenda < 0,
    );
    if (itemInvalido >= 0) {
      toast.error(`Revise a quantidade e o valor do produto ${itemInvalido + 1}. A quantidade deve ser um inteiro maior que zero.`);
      return;
    }

    if (lancarFinanceiro) {
      if (totalGeral <= 0) {
        toast.error("O total da entrada deve ser maior que zero para gerar um lançamento financeiro.");
        return;
      }
      if (!selectedCategoria) {
        toast.error("Selecione a categoria do lançamento financeiro.");
        return;
      }
      if (pagamentoFuturo) {
        if (!parcelas.length || parcelas.some((parcela) => !parcela.dataVencimento || parcela.valor <= 0)) {
          toast.error("Informe uma data de vencimento e um valor positivo em todas as parcelas.");
          return;
        }
        const soma = parcelas.reduce((total, parcela) => total + parcela.valor, 0);
        if (Math.abs(soma - totalGeral) > 0.01) {
          toast.error("A soma das parcelas deve ser igual ao total da entrada.");
          return;
        }
      } else if (!selectedBankId || !selectedMetodo) {
        toast.error("Selecione o banco e o método de pagamento para o lançamento imediato.");
        return;
      }
    }

    const payload: EntradaCreatePayload = {
      fornecedorid: fornecedorSelecionado?.id ?? null,

      // fixos por requisito
      fiscal: false,
      notachave: null,

      tipo: tipoAtual,
      itens: itens.map(mapFormToInsert),
      financeiro: {
        lancar: lancarFinanceiro,
        pagamentoFuturo,
        parcelas: pagamentoFuturo
          ? parcelas.map((parcela) => ({ valor: parcela.valor, dataVencimento: parcela.dataVencimento! }))
          : [],
        bancoId: selectedBankId ? Number(selectedBankId) : null,
        metodoPagamento: selectedMetodo || null,
        categoria: selectedCategoria || null,
        categoriaId: categorias.find((categoria) => categoria.nome === selectedCategoria)?.id ?? null,
        planoContaId: selectedPlanoId ? Number(selectedPlanoId) : null,
        centroCustoId: selectedCentroCustoId ? Number(selectedCentroCustoId) : null,
        nomePagador: fornecedorSelecionado?.nomerazaosocial || "Fornecedor não informado",
        cpfCnpjPagador: fornecedorSelecionado?.cpfcnpj || "",
        descricao: "Compra de mercadorias",
      },
    };

    setLoadingConcluirEntrada(true);
    try {
      const res = await fetch("/api/entradas/geral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Não foi possível registrar a entrada.");

      toast.success("Entrada registrada com sucesso!");
      resetForm();
      onOpenChange?.(false);
    } catch (error: any) {
      toast.error("Erro ao registrar entrada", {
        description: error?.message || "Verifique sua conexão e tente novamente.",
      });
    } finally {
      setLoadingConcluirEntrada(false);
    }
  };

  return (
    <DialogContent
      showCloseButton={false}
      className="left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none motion-reduce:animate-none motion-reduce:duration-0 sm:left-1/2 sm:top-1/2 sm:h-[min(850px,calc(100dvh-2rem))] sm:w-[95vw] sm:max-w-[1100px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:shadow-lg"
      onEscapeKeyDown={(event) => loadingConcluirEntrada && event.preventDefault()}
      onInteractOutside={(event) => loadingConcluirEntrada && event.preventDefault()}
    >
      <DialogClose asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fechar entrada"
          disabled={loadingConcluirEntrada}
          className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 size-12 sm:right-4 sm:top-4 sm:size-9"
        >
          <X aria-hidden="true" />
        </Button>
      </DialogClose>

      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <DialogHeader className="shrink-0 border-b bg-background px-4 pb-4 pr-16 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-6 sm:py-4 sm:pr-14">
          <DialogTitle>Criar entrada</DialogTitle>
          <DialogDescription>
            Monte a entrada com fornecedor e itens. Depois, conclua.
          </DialogDescription>
        </DialogHeader>

        <FornecedorSelect
          OnSelect={(f) => {
            setFornecedorSelecionado(f);
            setOpenFornecedor(false);
          }}
          open={openFornecedor}
          setOpen={setOpenFornecedor}
        />

        <ProductSelect
          OnSelect={(p) => {
            handleAdicionarProduto(p);
            setOpenProduto(false);
          }}
          open={openProduto}
          setOpen={setOpenProduto}
        />

        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted/20 px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-6 [&_input]:min-h-12 [&_[data-slot=button]]:min-h-12 [&_[data-slot=select-trigger]]:min-h-12 sm:[&_input]:min-h-9 sm:[&_[data-slot=button]]:min-h-9 sm:[&_[data-slot=select-trigger]]:min-h-9">
          {/* Dados da entrada */}
          <div className="min-w-0 max-w-full space-y-4 rounded-xl border bg-card p-3 sm:p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Tipo da entrada</Label>
                <Select
                  value={tipoAtual}
                  onValueChange={setTipo}
                  disabled={loadingTipos && !tipos.length}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue
                      placeholder={loadingTipos && !tipos.length ? "Carregando tipos..." : "Selecione o tipo"}
                    />
                  </SelectTrigger>
                  <SelectContent className="text-xs">
                    {tipos.map((opt) => (
                      <SelectItem
                        key={opt.codigo}
                        value={opt.codigo}
                        className="text-xs hover:cursor-pointer"
                      >
                        {opt.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!loadingTipos && !tipos.length ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum tipo de entrada ativo. Cadastre em Configurações &gt; Tipos.
                  </p>
                ) : null}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Fornecedor (opcional)</Label>

              {fornecedorSelecionado ? (
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2 text-xs">
                    <span className="font-medium text-muted-foreground">
                      #{fornecedorSelecionado.id}
                    </span>{" "}
                    <span className="break-words text-primary">
                      {fornecedorSelecionado?.nomerazaosocial}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setFornecedorSelecionado(undefined)}
                    className="size-12 shrink-0 rounded-full bg-muted text-destructive hover:cursor-pointer hover:text-destructive sm:size-9"
                    aria-label="Remover fornecedor"
                    title="Remover fornecedor"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <div className="flex min-w-0 items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span className="min-w-0">Nenhum fornecedor selecionado</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setOpenFornecedor(true)}
                    className="group size-12 shrink-0 rounded-full bg-muted/50 transition-all hover:cursor-pointer hover:bg-muted sm:size-9"
                    aria-label="Selecionar fornecedor"
                    title="Selecionar fornecedor"
                  >
                    <Search className="h-4 w-4 text-primary/80 transition-all group-hover:text-primary" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Produtos</Label>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <Button
                  variant="outline"
                  type="button"
                  size="sm"
                  className="min-h-12 min-w-0 gap-2 text-xs hover:cursor-pointer sm:min-h-9"
                  onClick={() => setOpenProduto(true)}
                >
                  <Search className="h-3 w-3" />
                  Adicionar produto
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-12 min-w-0 gap-2 text-xs hover:cursor-pointer sm:min-h-9"
                  size="sm"
                  onClick={() => setItens([])}
                  disabled={itens.length === 0}
                >
                  Limpar lista
                </Button>
              </div>
            </div>

            <Separator />

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Itens</span>
                <span className="font-medium">{itens.length}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold">
                  {formatarEmReal(Number(totalGeral.toFixed(2)))}
                </span>
              </div>
            </div>
          </div>

          {/* Lista de itens */}
          <div className="min-h-0 min-w-0 max-w-full overflow-hidden rounded-xl border bg-card p-3 sm:p-4">
            <div className="mb-3 flex min-w-0 items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Itens da entrada</h3>
                <p className="text-xs text-muted-foreground">
                  Edite os campos do item e remova quando quiser.
                </p>
              </div>
            </div>

            <div className="min-w-0 max-w-full space-y-4">
              {itens.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nenhum produto adicionado ainda.
                </div>
              ) : (
                itens.map((item, index) => (
                  <div
                    key={`${item.produto_id}-${index}`}
                    className="min-w-0 max-w-full space-y-4 overflow-hidden rounded-xl border p-3 sm:p-4"
                  >
                    <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="line-clamp-2 break-words text-sm font-semibold">
                          Produto #{item.produto_id} —{" "}
                          {item.titulo ?? "Sem título"}
                        </div>
                        <div className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                          Ref: {item.referencia ?? "-"} • NCM: {item.ncm ?? "-"}{" "}
                          • CFOP: {item.cfop ?? "-"} • CSOSN:{" "}
                          {item.csosn ?? "-"} • Unidade: {item.unidade ?? "-"}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-12 w-full gap-2 text-destructive hover:cursor-pointer hover:text-destructive sm:min-h-9 sm:w-auto"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>

                    <Separator />

                    <div className="space-y-1.5">
                      <Label>Título</Label>
                      <Input
                        value={item.titulo ?? ""}
                        onChange={(e) =>
                          updateItem(index, "titulo", e.target.value || null)
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
                              (e.target.value || null) as Unidade_medida | null,
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
                            updateItem(index, "ncm", e.target.value || null)
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>CEST</Label>
                        <Input
                          value={item.cest ?? ""}
                          onChange={(e) =>
                            updateItem(index, "cest", e.target.value || null)
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>CSOSN</Label>
                        <Input
                          value={item.csosn ?? ""}
                          onChange={(e) =>
                            updateItem(index, "csosn", e.target.value || null)
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>CFOP</Label>
                        <Input
                          value={item.cfop ?? ""}
                          onChange={(e) =>
                            updateItem(index, "cfop", e.target.value || null)
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
                            updateItem(index, "cst", e.target.value || null)
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
                              e.target.value === "" ? null : n(e.target.value),
                            )
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>CST PIS</Label>
                        <Input
                          value={item.cst_pis ?? ""}
                          onChange={(e) =>
                            updateItem(index, "cst_pis", e.target.value || null)
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Alíquota PIS</Label>
                        <Input
                          type="number"
                          step={0.01}
                          value={item.aliquota_pis ?? ""}
                          onChange={(e) =>
                            updateItem(
                              index,
                              "aliquota_pis",
                              e.target.value === "" ? null : n(e.target.value),
                            )
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>CST COFINS</Label>
                        <Input
                          value={item.cst_cofins ?? ""}
                          onChange={(e) =>
                            updateItem(
                              index,
                              "cst_cofins",
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
                          value={item.aliquota_cofins ?? ""}
                          onChange={(e) =>
                            updateItem(
                              index,
                              "aliquota_cofins",
                              e.target.value === "" ? null : n(e.target.value),
                            )
                          }
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3 [&>*]:min-w-0">
                      <div className="space-y-1.5">
                        <Label>Quantidade</Label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={item.quantidade}
                          onChange={(e) =>
                            updateItem(index, "quantidade", n(e.target.value))
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Valor unitário de compra</Label>
                        <ValueInput
                          value={item.precovenda}
                          onValueChange={(value) => updateItem(index, "precovenda", value)}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Este valor será salvo como o último valor de compra do produto.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Total do item</Label>
                        <Input
                          value={formatarEmReal(
                            Number(
                              (n(item.quantidade) * n(item.precovenda)).toFixed(
                                2,
                              ),
                            ),
                          )}
                          readOnly
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="min-w-0 max-w-full space-y-4 overflow-hidden rounded-xl border bg-card p-3 sm:p-4">
            <div className="flex min-w-0 items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Lançamento financeiro</h3>
                <p className="text-xs text-muted-foreground">
                  Opcional. Registre a despesa agora ou como parcelas futuras.
                </p>
              </div>
              <Switch
                checked={lancarFinanceiro}
                onCheckedChange={(checked) => {
                  setLancarFinanceiro(checked);
                  if (checked && parcelas.length === 0) {
                    setParcelas([{ id: Date.now(), valor: totalGeral, dataVencimento: undefined }]);
                  }
                }}
                disabled={loadingConcluirEntrada}
              />
            </div>

            {lancarFinanceiro ? (
              <div className="space-y-4 border-t pt-4">
                <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                  <Label>Forma do lançamento</Label>
                  <Select
                    value={pagamentoFuturo ? "FUTURO" : "IMEDIATO"}
                    onValueChange={(value) => {
                      const futuro = value === "FUTURO";
                      setPagamentoFuturo(futuro);
                      if (futuro && parcelas.length === 0) {
                        setParcelas([{ id: Date.now(), valor: totalGeral, dataVencimento: undefined }]);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-[260px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FUTURO">Parcelas futuras</SelectItem>
                      <SelectItem value="IMEDIATO">Pagamento imediato</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {pagamentoFuturo ? (
                  <div className="space-y-3">
                    {parcelas.map((parcela, index) => (
                      <div key={parcela.id} className="grid min-w-0 gap-3 overflow-hidden rounded-lg border bg-muted/20 p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end [&>*]:min-w-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => {
                            if (parcelas.length === 1) {
                              toast.error("Mantenha ao menos uma parcela.");
                              return;
                            }
                            setParcelas((current) => current.filter((_, itemIndex) => itemIndex !== index));
                          }}
                          aria-label={`Remover parcela ${index + 1}`}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <div className="space-y-1.5">
                          <Label>Vencimento da parcela {index + 1}</Label>
                          <DatePicker
                            value={parcela.dataVencimento ?? ""}
                            onChange={(value) =>
                              setParcelas((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, dataVencimento: value || undefined } : item,
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
                                current.map((item, itemIndex) => itemIndex === index ? { ...item, valor: value } : item),
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                    <div className="flex min-w-0 flex-col items-stretch gap-3 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setParcelas((current) => [...current, { id: Date.now(), valor: 0 }])}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar parcela
                      </Button>
                      <span className="break-words leading-relaxed sm:text-right">
                        Total da entrada: {formatarEmReal(totalGeral)} · Parcelas: {formatarEmReal(parcelas.reduce((sum, parcela) => sum + parcela.valor, 0))}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                    <div className="space-y-1.5">
                      <Label>Banco</Label>
                      <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                        <SelectTrigger><SelectValue placeholder={loadingBanks ? "Carregando..." : "Selecione o banco"} /></SelectTrigger>
                        <SelectContent>
                          {banks.map((bank) => <SelectItem key={bank.id} value={String(bank.id)}>{bank.titulo}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Método de pagamento</Label>
                      <Select value={selectedMetodo} onValueChange={(value) => setSelectedMetodo(value as Metodo_pagamento)}>
                        <SelectTrigger><SelectValue placeholder="Selecione o método" /></SelectTrigger>
                        <SelectContent>
                          {metodosPagamento.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="grid min-w-0 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
                  <div className="space-y-1.5">
                    <Label>Categoria</Label>
                    <Select value={selectedCategoria} onValueChange={setSelectedCategoria}>
                      <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                      <SelectContent>
                        {categorias.map((categoria) => <SelectItem key={categoria.id} value={categoria.nome}>{categoria.nome}</SelectItem>)}
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
                      options={centrosCusto.map((centro) => ({ value: String(centro.id), label: centro.nome }))}
                      loading={loadingCentrosCusto}
                      clearable
                      clearLabel="Sem centro de custo"
                      placeholder="Selecione o centro de custo"
                      onValueChange={setSelectedCentroCustoId}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center justify-between gap-3 text-sm sm:block">
              <span className="text-muted-foreground">Total da entrada: </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatarEmReal(Number(totalGeral.toFixed(2)))}
              </span>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={loadingConcluirEntrada} className="min-h-12 w-full sm:min-h-9 sm:w-auto">
                  Cancelar
                </Button>
              </DialogClose>

              <Button
                type="button"
                onClick={handleRegistrarEntrada}
                disabled={itens.length === 0 || loadingConcluirEntrada}
                className="min-h-12 w-full hover:cursor-pointer sm:min-h-9 sm:w-auto sm:min-w-[170px]"
              >
                {loadingConcluirEntrada ? (
                  <div className="flex flex-row items-center gap-1">
                    <Loader2 className=" animate-spin w-3 h-3" />{" "}
                    <span>Registrando...</span>
                  </div>
                ) : (
                  "Concluir entrada"
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </div>
    </DialogContent>
  );
}
