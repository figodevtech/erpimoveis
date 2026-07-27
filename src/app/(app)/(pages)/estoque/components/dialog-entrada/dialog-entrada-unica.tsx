import { useIsMobile } from "@/app/(app)/hooks/use-mobile";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Loader2, Minus, Plus, Search, X } from "lucide-react";
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
}

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
}: DialogEntradaProps) {
  const [newQtd, setNewQtd] = useState(0);
  const [value, setValue] = useState(0);
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openFornecedor, setOpenFornecedor] = useState(false);
  const [selectedFornecedor, setSelectedFornecedor] = useState<Fornecedor | undefined>(undefined);
  const [selectedType, setSelectedType] = useState<Entrada_tipo | undefined>(undefined)
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

  const ENTRADA_API = "/api/entradas";

  const onCloseReset = () => {
    setNewQtd(0);
    setValue(0);
    setSelectedFornecedor(undefined);
    setSelectedType(undefined);
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

  const handleCreateEntrada = async () => {
    setIsSubmitting(true);

    try {
      if (!productId) {
        toast.error("Produto inválido.");
        return;
      }

      if (!Number.isInteger(newQtd) || newQtd <= 0) {
        toast.error("Insira uma quantidade inteira maior que zero para realizar a entrada");
        return;
      }

      if(!selectedType){
        toast.error("Selecione um tipo para a entrada")
        return;
      }

      // valor_unitario em entradaitens é NOT NULL.
      // Se você quiser permitir custo 0, remova essa validação.
      const isRetorno = String(selectedType) === "DEVOLUCAO";
      if (!Number.isFinite(value) || value < 0 || (!isRetorno && value <= 0)) {
        toast.error(
          isRetorno
            ? "O valor unitário do retorno não pode ser negativo."
            : "Informe um valor unitário maior que zero.",
        );
        return;
      }

      const totalEntrada = newQtd * value;
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

      // Formato simples (compatível com a API ajustada):
      // cria 1 entrada (cabeçalho) + 1 entradaitens
      const payload = {
        fornecedorid: selectedFornecedor?.id ?? null,
        produtoid: productId,
        quantidade: newQtd,
        valor_unitario: value,
        tipo: selectedType,
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

      const response = await axios.post(ENTRADA_API, payload);

      if (response.status === 201) {
        toast.success("Sucesso!", {
          description: "Entrada realizada.",
          duration: 2000,
        });

        onCloseReset();
        setIsOpen?.(false);

        // Atualiza lista (se necessário)
        handleGetProducts?.(paginantion?.page, paginantion?.limit, search, status);
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

  const totalEntrada = newQtd * value;
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
              <DrawerTitle>Entrada de produto</DrawerTitle>
              <DrawerDescription className="flex flex-col gap-1 text-sm">
                <span>{productDescription}</span>
                <span>Em estoque: {currentQuantity}</span>
              </DrawerDescription>
            </DrawerHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 relative">
              <div className="space-y-2">
                <Label>Tipo:</Label>
                <Select
                  value={selectedType}
                  onValueChange={(v: Entrada_tipo) => {
                    setSelectedType(v);
                    if (String(v) === "DEVOLUCAO") setLancarFinanceiro(false);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione"></SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(Entrada_tipo).map((tipo)=>
                      <SelectItem key={tipo[1]} value={tipo[0]}>
                        {tipo[0] === "DEVOLUCAO" ? "DEVOLUÇÃO / RETORNO" : tipo[1]}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantidade:</Label>
                <Input className="w-24" type="numeric" value={newQtd} onChange={(e) => setNewQtd(Number(e.target.value))} />
              </div>

              <div className="space-y-2">
                <Label>Valor unitário:</Label>
                <ValueInput price={value} setPrice={setValue} />
                {String(selectedType) === "DEVOLUCAO" ? (
                  <p className="text-xs text-muted-foreground">O retorno pode ser registrado com valor zero.</p>
                ) : null}
              </div>

              {fornecedorField}
              {financeiroField}
            </div>

            <DrawerFooter className="flex flex-row gap-2 items-center justify-center">
              <Button onClick={handleCreateEntrada} className="hover:cursor-pointer" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" /> Registrando...
                  </>
                ) : (
                  "Registrar Entrada"
                )}
              </Button>
              <DrawerClose asChild>
                <Button
                  disabled={isSubmitting}
                  className="hover:cursor-pointer"
                  variant="outline"
                  onClick={onCloseReset}
                >
                  Cancelar
                </Button>
              </DrawerClose>
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
        className="h-[min(90dvh,760px)] w-[calc(100vw-2rem)] max-w-2xl overflow-hidden p-0"
        showCloseButton={!isSubmitting}
        onDoubleClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={(event) => isSubmitting && event.preventDefault()}
        onInteractOutside={(event) => isSubmitting && event.preventDefault()}
      >
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 px-6 py-4 border-b-1">
            <DialogTitle>Entrada de produto</DialogTitle>
            <DialogDescription className="flex min-w-0 flex-row items-center justify-between gap-3">
              <span className="min-w-0 truncate" title={productDescription}>{productDescription}</span>
              <span className="shrink-0">Em estoque: {currentQuantity}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 bg-muted px-6 py-10 space-y-2 relative">
            <div className="min-h-0 min-w-0 rounded-md px-4 py-8 space-y-4 bg-card">
              <div className="space-y-2">
                <Label>Tipo:</Label>
                <Select
                  value={selectedType}
                  onValueChange={(v: Entrada_tipo) => {
                    setSelectedType(v);
                    if (String(v) === "DEVOLUCAO") setLancarFinanceiro(false);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione"></SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(Entrada_tipo).map((tipo)=>
                      <SelectItem key={tipo[1]} value={tipo[0]}>
                        {tipo[0] === "DEVOLUCAO" ? "DEVOLUÇÃO / RETORNO" : tipo[1]}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantidade:</Label>
                <Input className="w-24" type="numeric" value={newQtd} onChange={(e) => setNewQtd(Number(e.target.value))} />
              </div>

              <div className="space-y-2">
                <Label>Valor unitário:</Label>
                <ValueInput price={value} setPrice={setValue} />
                {String(selectedType) === "DEVOLUCAO" ? (
                  <p className="text-xs text-muted-foreground">O retorno pode ser registrado com valor zero.</p>
                ) : null}
              </div>

              {fornecedorField}
              {financeiroField}
            </div>
          </div>

          <DialogFooter className="px-6 py-4">
            <div className="flex sm:flex-row gap-3 sm:gap-4">
              <Button onClick={handleCreateEntrada} className="hover:cursor-pointer" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" /> Registrando...
                  </>
                ) : (
                  "Registrar Entrada"
                )}
              </Button>

              <DialogClose asChild>
                <Button
                  disabled={isSubmitting}
                  className="hover:cursor-pointer"
                  variant="outline"
                  onClick={onCloseReset}
                >
                  Cancelar
                </Button>
              </DialogClose>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
