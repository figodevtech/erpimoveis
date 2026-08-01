"use client";

import { useIsMobile } from "@/app/(app)/hooks/use-mobile";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Loader2, Minus, PackagePlus, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import ValueInput from "../dialog-produto/entrada-valor";
import { toast } from "@/lib/toast";
import axios, { isAxiosError } from "axios";
import { Entrada_tipo, Estoque_status, Fornecedor, Pagination } from "../../types";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Banco, Metodo_pagamento } from "../../../(financeiro)/fluxodecaixa/types";
import { useCategoriasTransacao } from "../../../(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { usePlanosDeConta } from "../../../(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { useCentrosCusto } from "../../../(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { PlanoContaCombobox } from "../../../(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "../../../(financeiro)/fluxodecaixa/components/search-combobox";

type Parcela = { id: number; dataVencimento?: string; valor: number };

interface DialogEntradaProps {
  children?: React.ReactNode;
  isOpen?: boolean;
  setIsOpen?: (value: boolean) => void;
  productId?: number;
  productDescription: string;
  currentQuantity: number;
  search?: string;
  handleGetProducts?: (pageNumber?: number, limit?: number, search?: string, status?: Estoque_status) => void;
  paginantion?: Pagination;
  status?: Estoque_status;
  inventory?: "produto" | "usoconsumo";
  onSuccess?: () => void | Promise<void>;
}

const MAX_OBSERVACAO = 500;

export default function DialogEntrada({
  children,
  isOpen,
  setIsOpen,
  productId,
  currentQuantity,
  productDescription,
  handleGetProducts,
  paginantion,
  search,
  status,
  inventory = "produto",
  onSuccess,
}: DialogEntradaProps) {
  const [newQtd, setNewQtd] = useState(0);
  const [value, setValue] = useState(0);
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openFornecedor, setOpenFornecedor] = useState(false);
  const [selectedFornecedor, setSelectedFornecedor] = useState<Fornecedor | undefined>(undefined);
  const [selectedType, setSelectedType] = useState<Entrada_tipo | undefined>(undefined);
  const [observacao, setObservacao] = useState("");
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

  const ENTRADA_API = inventory === "usoconsumo" ? "/api/usoconsumo/entradas" : "/api/entradas";

  const onCloseReset = () => {
    setNewQtd(0);
    setValue(0);
    setSelectedFornecedor(undefined);
    setSelectedType(undefined);
    setObservacao("");
    setOpenFornecedor(false);
    setLancarFinanceiro(false);
    setPagamentoFuturo(true);
    setParcelas([]);
    setSelectedBankId("");
    setSelectedMetodo("");
    setSelectedCategoria("");
    setSelectedPlanoId("");
    setSelectedCentroCustoId("");
  };

  useEffect(() => {
    if (!lancarFinanceiro) return;
    let cancelled = false;
    setLoadingBanks(true);
    axios.get("/api/banks")
      .then((response) => {
        if (!cancelled) setBanks(Array.isArray(response.data?.data) ? response.data.data : []);
      })
      .catch(() => {
        if (!cancelled) toast.error("Não foi possível carregar os bancos.");
      })
      .finally(() => {
        if (!cancelled) setLoadingBanks(false);
      });
    return () => { cancelled = true; };
  }, [lancarFinanceiro]);

  const isRetorno = String(selectedType) === "DEVOLUCAO";
  const totalEntrada = newQtd * value;
  const saldoResultante = currentQuantity + newQtd;
  const quantidadeValida = Number.isInteger(newQtd) && newQtd > 0;
  const valorValido = Number.isFinite(value) && value >= 0 && (isRetorno || value > 0);
  const entradaValida = quantidadeValida && valorValido && Boolean(selectedType);

  const handleCreateEntrada = async () => {
    setIsSubmitting(true);

    try {
      if (!productId) {
        toast.error(inventory === "usoconsumo" ? "Item inválido." : "Produto inválido.");
        return;
      }

      if (!quantidadeValida) {
        toast.error("Insira uma quantidade inteira maior que zero para realizar a entrada");
        return;
      }

      if (!selectedType) {
        toast.error("Selecione um tipo para a entrada");
        return;
      }

      // valor_unitario em entradaitens é NOT NULL.
      if (!valorValido) {
        toast.error(
          isRetorno
            ? "O valor unitário do retorno não pode ser negativo."
            : "Informe um valor unitário maior que zero.",
        );
        return;
      }

      if (lancarFinanceiro) {
        if (!selectedCategoria) {
          toast.error("Selecione a categoria do lançamento financeiro.");
          return;
        }
        if (pagamentoFuturo) {
          if (!parcelas.length || parcelas.some((parcela) => !parcela.dataVencimento || parcela.valor <= 0)) {
            toast.error("Informe vencimento e valor positivo em todas as parcelas.");
            return;
          }
          const soma = parcelas.reduce((total, parcela) => total + parcela.valor, 0);
          if (Math.abs(soma - totalEntrada) > 0.01) {
            toast.error("A soma das parcelas deve ser igual ao total da entrada.");
            return;
          }
        } else if (!selectedBankId || !selectedMetodo) {
          toast.error("Selecione o banco e o método de pagamento.");
          return;
        }
      }

      const observacaoLimpa = observacao.trim() || null;

      const produtoPayload = {
        fornecedorid: selectedFornecedor?.id ?? null,
        produtoid: productId,
        quantidade: newQtd,
        valor_unitario: value,
        tipo: selectedType,
        observacao: observacaoLimpa,
        financeiro: {
          lancar: lancarFinanceiro,
          pagamentoFuturo,
          parcelas: pagamentoFuturo
            ? parcelas.map((parcela) => ({ valor: parcela.valor, dataVencimento: parcela.dataVencimento }))
            : [],
          bancoId: selectedBankId ? Number(selectedBankId) : null,
          metodoPagamento: selectedMetodo || null,
          categoria: selectedCategoria || null,
          categoriaId: categorias.find((categoria) => categoria.nome === selectedCategoria)?.id ?? null,
          planoContaId: selectedPlanoId ? Number(selectedPlanoId) : null,
          centroCustoId: selectedCentroCustoId ? Number(selectedCentroCustoId) : null,
          nomePagador: selectedFornecedor?.nomerazaosocial || "Fornecedor não informado",
          cpfCnpjPagador: selectedFornecedor?.cpfcnpj || "",
          descricao: "Compra de mercadorias",
        },
      };

      const now = new Date().toISOString();
      const transacoes = !lancarFinanceiro ? [] : pagamentoFuturo
        ? parcelas.map((parcela) => ({
            descricao: "Compra de material de uso e consumo",
            valor: Number(parcela.valor.toFixed(2)),
            data: now,
            vencimento_em: `${parcela.dataVencimento}T12:00:00`,
            metodopagamento: null,
            categoria: selectedCategoria,
            categoria_id: categorias.find((categoria) => categoria.nome === selectedCategoria)?.id ?? null,
            banco_id: null,
            nomepagador: selectedFornecedor?.nomerazaosocial || "Fornecedor não informado",
            cpfcnpjpagador: selectedFornecedor?.cpfcnpj || "NAO INFORMADO",
            pendente: true,
            plano_de_conta_id: selectedPlanoId ? Number(selectedPlanoId) : null,
            plano_de_conta: null,
            centro_custo_id: selectedCentroCustoId ? Number(selectedCentroCustoId) : null,
            centro_custo: null,
          }))
        : [{
            descricao: "Compra de material de uso e consumo",
            valor: Number(totalEntrada.toFixed(2)),
            data: now,
            vencimento_em: now,
            metodopagamento: selectedMetodo,
            categoria: selectedCategoria,
            categoria_id: categorias.find((categoria) => categoria.nome === selectedCategoria)?.id ?? null,
            banco_id: Number(selectedBankId),
            nomepagador: selectedFornecedor?.nomerazaosocial || "Fornecedor não informado",
            cpfcnpjpagador: selectedFornecedor?.cpfcnpj || "NAO INFORMADO",
            pendente: false,
            plano_de_conta_id: selectedPlanoId ? Number(selectedPlanoId) : null,
            plano_de_conta: null,
            centro_custo_id: selectedCentroCustoId ? Number(selectedCentroCustoId) : null,
            centro_custo: null,
          }];
      const usoConsumoPayload = {
        fornecedor_id: selectedFornecedor?.id,
        fiscal: false,
        origem: "AJUSTE_RAPIDO",
        tipo: String(selectedType),
        observacao: observacaoLimpa ?? undefined,
        itens: [{ item_id: productId, quantidade: newQtd, valor_unitario_compra: value }],
        transacoes,
      };

      const response = await axios.post(ENTRADA_API, inventory === "usoconsumo" ? usoConsumoPayload : produtoPayload);

      if (response.status === 201) {
        toast.success("Sucesso!", {
          description: inventory === "usoconsumo" ? "Entrada do item realizada." : "Entrada realizada.",
          duration: 2000,
        });

        onCloseReset();
        setIsOpen?.(false);

        handleGetProducts?.(paginantion?.page, paginantion?.limit, search, status);
        await onSuccess?.();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Falha ao registrar entrada.",
          duration: 2000,
        });
      } else {
        toast.error("Erro inesperado ao registrar entrada.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Painel de saldo, no mesmo formato do diálogo de saída.
  const saldoPanel = (
    <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
      <div>
        <p className="text-muted-foreground">Estoque atual</p>
        <p className="text-lg font-semibold">{currentQuantity}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Após a entrada</p>
        <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{saldoResultante}</p>
      </div>
    </div>
  );

  const tipoField = (
    <div className="space-y-2">
      <Label>Tipo</Label>
      <Select
        value={selectedType}
        onValueChange={(v: Entrada_tipo) => {
          setSelectedType(v);
          if (String(v) === "DEVOLUCAO") setLancarFinanceiro(false);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione o tipo da entrada" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(Entrada_tipo).map(([codigo, rotulo]) => (
            <SelectItem key={rotulo} value={codigo}>
              {codigo === "DEVOLUCAO" ? "DEVOLUÇÃO / RETORNO" : rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const quantidadeField = (
    <div className="space-y-2">
      <Label htmlFor="entrada-quantidade">Quantidade</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="sm:hidden shrink-0"
          onClick={() => setNewQtd((atual) => Math.max(0, (Number.isFinite(atual) ? atual : 0) - 1))}
          disabled={newQtd <= 0}
          aria-label="Diminuir quantidade"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          id="entrada-quantidade"
          type="number"
          min={1}
          step={1}
          value={newQtd || ""}
          onChange={(event) => setNewQtd(Number(event.target.value))}
          placeholder="0"
          className="text-center sm:text-left"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="sm:hidden shrink-0"
          onClick={() => setNewQtd((atual) => (Number.isFinite(atual) ? atual : 0) + 1)}
          aria-label="Aumentar quantidade"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {newQtd > 0 && !Number.isInteger(newQtd) ? (
        <p className="text-xs text-destructive">A quantidade precisa ser um número inteiro.</p>
      ) : null}
    </div>
  );

  const valorField = (
    <div className="space-y-2">
      <Label>Valor unitário</Label>
      <ValueInput price={value} setPrice={setValue} />
      {isRetorno ? (
        <p className="text-xs text-muted-foreground">O retorno pode ser registrado com valor zero.</p>
      ) : null}
      {totalEntrada > 0 ? (
        <p className="text-xs text-muted-foreground">
          Total da entrada: {totalEntrada.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </p>
      ) : null}
    </div>
  );

  const fornecedorField = (
    <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
      <Label>Fornecedor (opcional)</Label>
      <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-10 min-w-0 max-w-full flex-1 overflow-hidden justify-start px-3 py-2 text-left font-normal"
          onClick={() => setOpenFornecedor(true)}
        >
          {selectedFornecedor ? (
            <>
              <Building2 className="mr-2 h-4 w-4 shrink-0 text-primary" />
              <span className="w-0 min-w-0 flex-1 overflow-hidden">
                <span className="block truncate text-sm font-medium">
                  {selectedFornecedor.nomerazaosocial}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  #{selectedFornecedor.id}
                  {selectedFornecedor.cpfcnpj ? ` · ${selectedFornecedor.cpfcnpj}` : ""}
                </span>
              </span>
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Selecionar fornecedor</span>
            </>
          )}
        </Button>

        {selectedFornecedor ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setSelectedFornecedor(undefined)}
            aria-label="Remover fornecedor selecionado"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );

  const observacaoField = (
    <div className="space-y-2">
      <Label htmlFor="entrada-observacao">Observação (opcional)</Label>
      <Textarea
        id="entrada-observacao"
        value={observacao}
        onChange={(event) => setObservacao(event.target.value)}
        placeholder="Detalhes sobre a entrada no estoque"
        maxLength={MAX_OBSERVACAO}
        rows={3}
      />
    </div>
  );

  const financeiroField = (
    <div className="min-w-0 max-w-full space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label>Lançar no financeiro</Label>
          <p className="text-xs text-muted-foreground">Opcional</p>
        </div>
        <Switch
          checked={lancarFinanceiro}
          onCheckedChange={(checked) => {
            setLancarFinanceiro(checked);
            if (checked && parcelas.length === 0) setParcelas([{ id: Date.now(), valor: totalEntrada }]);
          }}
          disabled={isSubmitting}
        />
      </div>

      {lancarFinanceiro ? (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1.5">
            <Label>Forma do lançamento</Label>
            <Select
              value={pagamentoFuturo ? "FUTURO" : "IMEDIATO"}
              onValueChange={(option) => {
                const futuro = option === "FUTURO";
                setPagamentoFuturo(futuro);
                if (futuro && parcelas.length === 0) setParcelas([{ id: Date.now(), valor: totalEntrada }]);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FUTURO">Parcelas futuras</SelectItem>
                <SelectItem value="IMEDIATO">Pagamento imediato</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {pagamentoFuturo ? (
            <div className="space-y-2">
              {parcelas.map((parcela, index) => (
                <div key={parcela.id} className="grid min-w-0 gap-2 rounded-md border p-2 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => {
                      if (parcelas.length === 1) return toast.error("Mantenha ao menos uma parcela.");
                      setParcelas((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 space-y-1">
                    <Label>Vencimento</Label>
                    <DatePicker
                      value={parcela.dataVencimento ?? ""}
                      onChange={(date) => setParcelas((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, dataVencimento: date || undefined } : item))}
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <Label>Valor</Label>
                    <ValueInput
                      price={parcela.valor}
                      setPrice={(amount) => setParcelas((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, valor: amount } : item))}
                    />
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setParcelas((current) => [...current, { id: Date.now(), valor: 0 }])}>
                  <Plus className="mr-2 h-4 w-4" />Adicionar parcela
                </Button>
                <span className="text-xs text-muted-foreground">
                  Total: {totalEntrada.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · Parcelas: {parcelas.reduce((sum, parcela) => sum + parcela.valor, 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
            </div>
          ) : (
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <div className="min-w-0 space-y-1"><Label>Banco</Label><Select value={selectedBankId} onValueChange={setSelectedBankId}><SelectTrigger><SelectValue placeholder={loadingBanks ? "Carregando..." : "Selecione"} /></SelectTrigger><SelectContent>{banks.map((bank) => <SelectItem key={bank.id} value={String(bank.id)}>{bank.titulo}</SelectItem>)}</SelectContent></Select></div>
              <div className="min-w-0 space-y-1"><Label>Método</Label><Select value={selectedMetodo} onValueChange={(method) => setSelectedMetodo(method as Metodo_pagamento)}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{Object.values(Metodo_pagamento).map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent></Select></div>
            </div>
          )}

          <div className="min-w-0 space-y-1"><Label>Categoria</Label><Select value={selectedCategoria} onValueChange={setSelectedCategoria}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{categorias.map((categoria) => <SelectItem key={categoria.id} value={categoria.nome}>{categoria.nome}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0 space-y-1"><Label>Plano de conta</Label><PlanoContaCombobox value={selectedPlanoId} groups={gruposPlanosDeConta} loading={loadingPlanos} clearable onClear={() => setSelectedPlanoId("")} onValueChange={setSelectedPlanoId} /></div>
            <div className="min-w-0 space-y-1"><Label>Centro de custo</Label><SearchCombobox value={selectedCentroCustoId} options={centrosCusto.map((centro) => ({ value: String(centro.id), label: centro.nome }))} loading={loadingCentrosCusto} clearable onValueChange={setSelectedCentroCustoId} /></div>
          </div>
        </div>
      ) : null}
    </div>
  );

  const corpo = (
    <div className="space-y-5 rounded-2xl border bg-card p-4">
      {saldoPanel}
      {tipoField}
      {quantidadeField}
      {valorField}
      {fornecedorField}
      {observacaoField}
      {financeiroField}
    </div>
  );

  const botaoRegistrar = (
    <Button
      onClick={handleCreateEntrada}
      className="hover:cursor-pointer"
      disabled={isSubmitting || !entradaValida}
    >
      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}
      Registrar entrada
    </Button>
  );

  const titulo = `Entrada de ${inventory === "usoconsumo" ? "uso/consumo" : "estoque"}`;

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(nextOpen) => {
          if (isSubmitting) return;
          setIsOpen?.(nextOpen);
          if (!nextOpen) onCloseReset();
        }}
      >
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <FornecedorSelect
          OnSelect={(fornecedor) => {
            setSelectedFornecedor(fornecedor);
            setOpenFornecedor(false);
          }}
          open={openFornecedor}
          setOpen={setOpenFornecedor}
        />
        <DrawerContent className="h-[95dvh] max-h-[95dvh] overflow-hidden" onDoubleClick={(e) => e.stopPropagation()}>
          <div className="mx-auto flex h-full min-h-0 w-full max-w-sm flex-col overflow-hidden">
            <DrawerHeader className="border-b px-4 py-3">
              <DrawerTitle className="flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-emerald-600" />
                {titulo}
              </DrawerTitle>
              <DrawerDescription>{productDescription}</DrawerDescription>
            </DrawerHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">{corpo}</div>

            <DrawerFooter className="flex flex-row items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsOpen?.(false)}
                disabled={isSubmitting}
                className="hover:cursor-pointer"
              >
                Cancelar
              </Button>
              {botaoRegistrar}
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (isSubmitting) return;
        setIsOpen?.(nextOpen);
        if (!nextOpen) onCloseReset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <FornecedorSelect
        OnSelect={(fornecedor) => {
          setSelectedFornecedor(fornecedor);
          setOpenFornecedor(false);
        }}
        open={openFornecedor}
        setOpen={setOpenFornecedor}
      />
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-[520px]"
        showCloseButton={!isSubmitting}
        onDoubleClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={(event) => isSubmitting && event.preventDefault()}
        onInteractOutside={(event) => isSubmitting && event.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-emerald-600" />
            {titulo}
          </DialogTitle>
          <DialogDescription className="truncate" title={productDescription}>
            {productDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">{corpo}</div>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => setIsOpen?.(false)}
            disabled={isSubmitting}
            className="hover:cursor-pointer"
          >
            Cancelar
          </Button>
          {botaoRegistrar}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
