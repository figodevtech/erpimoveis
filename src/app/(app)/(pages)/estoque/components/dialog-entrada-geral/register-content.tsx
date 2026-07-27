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
export const TIPOS_ENTRADA = [
  { value: "COMPRA_FORNECEDOR", label: "Compra fornecedor" },
  { value: "COMPRA_PF", label: "Compra PF" },
  { value: "DEVOLUCAO", label: "Devolução / retorno" },
] as const;

export type EntradaTipo = (typeof TIPOS_ENTRADA)[number]["value"];

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

  tipo: EntradaTipo;
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
  const [tipo, setTipo] = useState<EntradaTipo>("COMPRA_FORNECEDOR");
  const [itens, setItens] = useState<EntradaItemForm[]>([]);

  const [fornecedorSelecionado, setFornecedorSelecionado] = useState<
    Fornecedor | undefined
  >(undefined);
  const [openFornecedor, setOpenFornecedor] = useState(false);
  const [openProduto, setOpenProduto] = useState(false);
  const [loadingConcluirEntrada, setLoadingConcluirEntrada] = useState(false);
  const [lancarFinanceiro, setLancarFinanceiro] = useState(false);
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
    setLancarFinanceiro(false);
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

      tipo,
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
      className="h-svh min-w-screen p-0 overflow-hidden sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0"
      showCloseButton={!loadingConcluirEntrada}
      onEscapeKeyDown={(event) => loadingConcluirEntrada && event.preventDefault()}
      onInteractOutside={(event) => loadingConcluirEntrada && event.preventDefault()}
    >
      <div className="flex h-full min-h-0 flex-col">
        <DialogHeader className="shrink-0 px-6 py-4 border-b">
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

        <div className="h-full min-h-0 overflow-auto px-6 py-6 space-y-4">
          {/* Dados da entrada */}
          <div className="border rounded-xl p-4 space-y-4 bg-card">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Tipo da entrada</Label>
                <Select
                  value={tipo}
                  onValueChange={(v) => setTipo(v as EntradaTipo)}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent className="text-xs">
                    {TIPOS_ENTRADA.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        className="text-xs hover:cursor-pointer"
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Fornecedor (opcional)</Label>

              {fornecedorSelecionado ? (
                <div className="flex flex-row items-center gap-2">
                  <div className="px-2 py-1 rounded-xl bg-muted text-xs">
                    <span className="font-medium text-muted-foreground">
                      #{fornecedorSelecionado.id}
                    </span>{" "}
                    <span className="text-primary">
                      {fornecedorSelecionado?.nomerazaosocial}
                    </span>
                  </div>
                  <div
                    onClick={() => setFornecedorSelecionado(undefined)}
                    className="rounded-full p-1.5 bg-muted hover:cursor-pointer"
                    title="Remover fornecedor"
                  >
                    <X className="text-red-500 w-3 h-3" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
                  <span>Nenhum fornecedor selecionado</span>
                  <div
                    onClick={() => setOpenFornecedor(true)}
                    className="group p-1.5 rounded-full bg-muted/50 hover:bg-muted transition-all hover:cursor-pointer"
                    title="Selecionar fornecedor"
                  >
                    <Search className="w-3 h-3 text-primary/80 group-hover:text-primary transition-all" />
                  </div>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Produtos</Label>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  type="button"
                  size="sm"
                  className="gap-2 text-xs hover:cursor-pointer"
                  onClick={() => setOpenProduto(true)}
                >
                  <Search className="h-3 w-3" />
                  Adicionar produto
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2 text-xs hover:cursor-pointer"
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
          <div className="border rounded-xl p-4 min-h-0 bg-card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold">Itens da entrada</h3>
                <p className="text-xs text-muted-foreground">
                  Edite os campos do item e remova quando quiser.
                </p>
              </div>
            </div>

            <div className="space-y-4 ">
              {itens.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nenhum produto adicionado ainda.
                </div>
              ) : (
                itens.map((item, index) => (
                  <div
                    key={`${item.produto_id}-${index}`}
                    className="rounded-xl border p-4 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          Produto #{item.produto_id} —{" "}
                          {item.titulo ?? "Sem título"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          Ref: {item.referencia ?? "-"} • NCM: {item.ncm ?? "-"}{" "}
                          • CFOP: {item.cfop ?? "-"} • CSOSN:{" "}
                          {item.csosn ?? "-"} • Unidade: {item.unidade ?? "-"}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        className="text-destructive hover:text-destructive gap-2 hover:cursor-pointer"
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
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

          <div className="space-y-4 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
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
                <div className="flex flex-wrap items-center gap-3">
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
                      <div key={parcela.id} className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
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
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setParcelas((current) => [...current, { id: Date.now(), valor: 0 }])}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar parcela
                      </Button>
                      <span>
                        Total da entrada: {formatarEmReal(totalGeral)} · Parcelas: {formatarEmReal(parcelas.reduce((sum, parcela) => sum + parcela.valor, 0))}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
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
                          {Object.values(Metodo_pagamento).map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
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

        <DialogFooter className="px-6 py-4 border-t">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between w-full">
            <div className="text-sm">
              <span className="text-muted-foreground">Total da entrada: </span>
              <span className="font-semibold">
                {formatarEmReal(Number(totalGeral.toFixed(2)))}
              </span>
            </div>

            <div className="flex gap-3 justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={loadingConcluirEntrada}>
                  Cancelar
                </Button>
              </DialogClose>

              <Button
                type="button"
                onClick={handleRegistrarEntrada}
                disabled={itens.length === 0 || loadingConcluirEntrada}
                className="min-w-[170px] hover:cursor-pointer"
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
