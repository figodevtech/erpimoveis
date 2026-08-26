"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  Building2,
  Calculator,
  Calendar,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  Plus,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { parcelasFechamTotalDocumento } from "@/lib/financeiro/entrada-fiscal";
import formatarEmReal from "@/utils/formatarEmReal";
import { Banco, Metodo_pagamento } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import { useCategoriasTransacao } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { usePlanosDeConta } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-planos-de-conta";
import { useCentrosCusto } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-centros-custo";
import { PlanoContaCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/plano-conta-combobox";
import { SearchCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/search-combobox";
import ValueInput from "@/components/ui/value-input";
import { rotuloDeEscopo, type UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";

type Parcela = { id: number; dataVencimento?: string; valor: number };

interface LancarFinanceiroEntradaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryId: number | null;
  inventory?: "produto" | "usoconsumo";
  /** Qual estoque simples, quando `inventory` e "usoconsumo". */
  escopo?: UsoConsumoEscopo;
  onSuccess?: () => void | Promise<void>;
}

export function LancarFinanceiroEntradaDialog({
  open,
  onOpenChange,
  entryId,
  inventory = "produto",
  escopo = "USOCONSUMO",
  onSuccess,
}: LancarFinanceiroEntradaDialogProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [entryData, setEntryData] = useState<any>(null);

  const [pagamentoFuturo, setPagamentoFuturo] = useState(true);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [loadingBancos, setLoadingBancos] = useState(false);
  const [bancoId, setBancoId] = useState("");
  const [metodo, setMetodo] = useState<Metodo_pagamento | "">("");
  const [categoria, setCategoria] = useState("Compra de mercadorias");
  const [planoId, setPlanoId] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");
  const [nomePagador, setNomePagador] = useState("");
  const [cpfCnpjPagador, setCpfCnpjPagador] = useState("");

  const { categorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto } = useCentrosCusto();

  const isUsoConsumo = inventory === "usoconsumo";
  const apiEndpoint = `/api/entradas/${entryId}/financeiro?inventory=${inventory}`;

  useEffect(() => {
    if (!open || !entryId) {
      setEntryData(null);
      setNomePagador("");
      setCpfCnpjPagador("");
      return;
    }

    setLoading(true);
    axios
      .get(apiEndpoint)
      .then((res) => {
        const data = res.data?.entrada ?? res.data?.data ?? res.data;
        setEntryData(data);

        const total = Number(data.valor_total ?? 0);
        const hoje = new Date().toISOString().split("T")[0];

        setParcelas([{ id: Date.now(), dataVencimento: hoje, valor: total }]);

        const forn = Array.isArray(data?.fornecedor) ? data.fornecedor[0] : data?.fornecedor;
        if (forn?.nomerazaosocial || forn?.nomefantasia) {
          setNomePagador(forn.nomerazaosocial || forn.nomefantasia || "");
        }
        if (forn?.cpfcnpj) {
          setCpfCnpjPagador(forn.cpfcnpj || "");
        }
      })
      .catch((err) => {
        toast.error("Erro ao carregar dados da entrada.", {
          description: err?.response?.data?.error ?? err.message,
        });
        onOpenChange(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, entryId, apiEndpoint, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    setLoadingBancos(true);
    axios
      .get("/api/banks")
      .then((res) => setBancos(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setBancos([]))
      .finally(() => setLoadingBancos(false));
  }, [open]);

  const valorTotalEntrada = Number(entryData?.valor_total ?? 0);
  const valorTotalProdutos = Number(entryData?.valor_total_produtos ?? 0);
  const valorTotalUsoConsumo = Number(entryData?.valor_total_usoconsumo ?? 0);
  const entradaMista = entryData?.mista === true;
  const somaParcelas = parcelas.reduce((acc, p) => acc + Number(p.valor || 0), 0);
  const diferenca = Number((valorTotalEntrada - somaParcelas).toFixed(2));
  const parcelasValidas = parcelasFechamTotalDocumento(
    valorTotalEntrada,
    parcelas.map((parcela) => parcela.valor),
  );

  const transacoesAtivas = (entryData?.transacoes ?? []).filter((t: any) => !t.is_deleted);
  const temLancamentoExistente = transacoesAtivas.length > 0;
  const valorTotalLancado = transacoesAtivas.reduce((acc: number, t: any) => acc + Number(t.valor || 0), 0);

  function handleDistribuirValores(novasParcelas: Parcela[]) {
    if (!novasParcelas.length || valorTotalEntrada <= 0) return novasParcelas;
    const valorBase = Math.floor((valorTotalEntrada / novasParcelas.length) * 100) / 100;
    const sobra = Number((valorTotalEntrada - valorBase * novasParcelas.length).toFixed(2));

    return novasParcelas.map((p, idx) => ({
      ...p,
      valor: idx === 0 ? Number((valorBase + sobra).toFixed(2)) : valorBase,
    }));
  }

  function handleAdicionarParcela() {
    const proximaData = new Date();
    proximaData.setMonth(proximaData.getMonth() + parcelas.length);
    const dataIso = proximaData.toISOString().split("T")[0];

    const nova: Parcela = { id: Date.now(), dataVencimento: dataIso, valor: 0 };
    const listaAtualizada = [...parcelas, nova];
    setParcelas(handleDistribuirValores(listaAtualizada));
  }

  function handleRemoverParcela(id: number) {
    if (parcelas.length <= 1) return;
    const filtradas = parcelas.filter((p) => p.id !== id);
    setParcelas(handleDistribuirValores(filtradas));
  }

  function handleAtualizarParcela(id: number, campo: "dataVencimento" | "valor", valor: any) {
    setParcelas((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)),
    );
  }

  function handleIgualarParcelas() {
    setParcelas((prev) => handleDistribuirValores(prev));
    toast.success("Valores distribuídos igualmente entre as parcelas.");
  }

  async function handleConfirmar() {
    if (!entryId) return;

    if (pagamentoFuturo && parcelas.length === 0) {
      return toast.error("Informe ao menos uma parcela para o lançamento futuro.");
    }

    if (!pagamentoFuturo && !bancoId) {
      return toast.error("Selecione a conta bancária para o pagamento à vista.");
    }

    if (pagamentoFuturo && !parcelasValidas) {
      return toast.error(
        `A soma das parcelas (${formatarEmReal(somaParcelas)}) difere do total da entrada (${formatarEmReal(valorTotalEntrada)}).`,
      );
    }

    const categoriaOpcao = categorias.find((c) => c.nome === categoria);
    const planoOpcao = gruposPlanosDeConta
      .flatMap((g) => g.planos)
      .find((p) => String(p.id) === planoId);
    const centroOpcao = centrosCusto.find((c) => String(c.id) === centroCustoId);

    const payload = {
      inventory,
      financeiro: {
        isPagamentoFuturo: pagamentoFuturo,
        bancoId: bancoId ? Number(bancoId) : null,
        metodoPagamento: metodo || null,
        categoria: categoria || "Compra de mercadorias",
        categoriaId: categoriaOpcao?.id ?? null,
        planoContaId: planoId ? Number(planoId) : null,
        planoConta: planoOpcao?.nome ?? null,
        centroCustoId: centroCustoId ? Number(centroCustoId) : null,
        centroCusto: centroOpcao?.nome ?? null,
        nomePagador: nomePagador.trim() || entryData?.fornecedor?.nomerazaosocial || "Fornecedor",
        cpfCnpjPagador: cpfCnpjPagador.trim() || entryData?.fornecedor?.cpfcnpj || "NÃO INFORMADO",
        descricaoTransacao: `Compra NF ${entryData?.numero_nota ?? entryData?.id}`,
        valorTotal: valorTotalEntrada,
        parcelas: parcelas.map((p) => ({
          valor: Number(p.valor),
          dataVencimento: p.dataVencimento,
        })),
      },
    };

    setSubmitting(true);
    try {
      await axios.post(`/api/entradas/${entryId}/financeiro`, payload);
      toast.success("Lançamento financeiro registrado com sucesso.");
      onOpenChange(false);
      if (onSuccess) await onSuccess();
    } catch (err: any) {
      toast.error("Não foi possível lançar no financeiro.", {
        description: err?.response?.data?.error ?? err.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col w-screen h-[100dvh] max-w-full inset-0 top-0 left-0 translate-x-0 translate-y-0 sm:top-[50%] sm:left-[50%] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:h-[85vh] sm:max-h-[850px] p-0 gap-0 rounded-none sm:rounded-2xl border-0 sm:border bg-card shadow-2xl overflow-hidden min-w-0">
        {/* Header Elegante (Fixo) */}
        <DialogHeader className="shrink-0 p-5 sm:p-6 pb-4 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-xs">
              <Wallet className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold tracking-tight">
                Lançar Entrada no Financeiro
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Vincule o pagamento desta compra ao módulo financeiro e fluxo de caixa.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 min-h-0 w-full flex-col items-center justify-center gap-3 text-muted-foreground p-6">
            <Loader2 className="size-8 animate-spin text-emerald-600" />
            <span className="text-xs font-medium">Carregando dados do documento fiscal...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-6 min-h-0 min-w-0 w-full">
            {/* Banner Resumo do Documento */}
            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] uppercase font-bold tracking-wide">
                      {isUsoConsumo ? rotuloDeEscopo(escopo).nome : "Estoque de Produtos"}
                    </Badge>
                    {entradaMista ? (
                      <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wide">
                        Nota mista
                      </Badge>
                    ) : null}
                    <span className="text-xs font-semibold text-foreground/80">
                      Entrada #{entryData?.id}
                    </span>
                  </div>
                  {entryData?.fornecedor?.nomerazaosocial ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                      <Building2 className="size-3.5 shrink-0 text-emerald-600" />
                      <span className="font-medium truncate max-w-sm">
                        {entryData.fornecedor.nomerazaosocial}
                      </span>
                    </div>
                  ) : null}
                  {entryData?.numero_nota ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                      <FileText className="size-3 shrink-0" />
                      <span>Nota Fiscal nº {entryData.numero_nota}</span>
                    </div>
                  ) : null}
                </div>

                <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-emerald-500/20">
                  <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-700 dark:text-emerald-400 block">
                    Valor Total do Documento
                  </span>
                  <span className="text-2xl font-extrabold tracking-tight text-foreground">
                    {formatarEmReal(valorTotalEntrada)}
                  </span>
                  {entradaMista ? (
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      Revenda {formatarEmReal(valorTotalProdutos)} + uso e consumo{" "}
                      {formatarEmReal(valorTotalUsoConsumo)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Aviso de Lançamento Existente (Âmbar) */}
            {temLancamentoExistente ? (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200 space-y-2 shadow-2xs">
                <div className="flex items-center gap-2 font-semibold text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>Aviso: Entrada já possui lançamento no financeiro</span>
                </div>
                <p className="text-xs leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                  Identificamos {transacoesAtivas.length} lançamento(s) financeiro(s) ativo(s) vinculado(s) a esta entrada
                  {valorTotalLancado > 0 ? ` no valor total de ${formatarEmReal(valorTotalLancado)}.` : "."}
                </p>
                <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium pt-1 border-t border-amber-500/20">
                  ⚠️ Importante: Para evitar duplicidade no contas a pagar/caixa, novos lançamentos para esta entrada estão bloqueados.
                </div>
              </div>
            ) : null}

            {/* Modalidade de Pagamento: Cards de Seleção Alternativos ao Switch Simples */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Modalidade do Lançamento</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPagamentoFuturo(true)}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all hover:cursor-pointer ${
                    pagamentoFuturo
                      ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                      : "border-border/60 bg-card hover:bg-muted/30"
                  }`}
                >
                  <div className={`p-2 rounded-lg ${pagamentoFuturo ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                    <CalendarClock className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <span>Lançamento Futuro (Contas a Pagar)</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Gera títulos pendentes no financeiro com agendamento de parcelas.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPagamentoFuturo(false)}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all hover:cursor-pointer ${
                    !pagamentoFuturo
                      ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                      : "border-border/60 bg-card hover:bg-muted/30"
                  }`}
                >
                  <div className={`p-2 rounded-lg ${!pagamentoFuturo ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                    <Banknote className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">
                      Pagamento À Vista
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Registra a saída concluída diretamente em conta bancária.
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Seção: Dados do Pagador / Favorecido */}
            <div className="rounded-2xl border border-border/60 bg-muted/10 p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground border-b border-border/40 pb-2">
                <UserRound className="size-4 text-emerald-600" />
                <span>Dados do Pagador / Favorecido</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Nome / Razão Social</Label>
                  <Input
                    type="text"
                    className="h-9 text-xs rounded-lg bg-card"
                    value={nomePagador}
                    onChange={(e) => setNomePagador(e.target.value)}
                    placeholder="Nome ou Razão Social do Favorecido"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">CPF / CNPJ</Label>
                  <Input
                    type="text"
                    className="h-9 text-xs rounded-lg bg-card"
                    value={cpfCnpjPagador}
                    onChange={(e) => setCpfCnpjPagador(e.target.value)}
                    placeholder="CPF ou CNPJ do Favorecido"
                  />
                </div>
              </div>
            </div>

            {/* Form de Parâmetros Financeiros */}
            <div className="rounded-2xl border border-border/60 bg-muted/10 p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground border-b border-border/40 pb-2">
                <CreditCard className="size-4 text-emerald-600" />
                <span>Classificação & Dados do Pagamento</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Forma / Método de Pagamento</Label>
                  <Select value={metodo} onValueChange={(v) => setMetodo(v as Metodo_pagamento)}>
                    <SelectTrigger className="h-9 text-xs rounded-lg">
                      <SelectValue placeholder="Selecione a forma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BOLETO">Boleto Bancário</SelectItem>
                      <SelectItem value="PIX">PIX</SelectItem>
                      <SelectItem value="CREDITO">Cartão de Crédito</SelectItem>
                      <SelectItem value="DEBITO">Cartão de Débito</SelectItem>
                      <SelectItem value="DINHEIRO">Dinheiro Espécie</SelectItem>
                      <SelectItem value="TRANSFERENCIA">Transferência / TED / DOC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Conta Bancária / Caixa {pagamentoFuturo ? "(Opcional)" : "(Obrigatório à vista)"}
                  </Label>
                  <Select value={bancoId} onValueChange={setBancoId}>
                    <SelectTrigger className="h-9 text-xs rounded-lg">
                      <SelectValue placeholder={loadingBancos ? "Carregando contas..." : "Selecione o banco / caixa"} />
                    </SelectTrigger>
                    <SelectContent>
                      {bancos.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.titulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Categoria Financeira</Label>
                  <SearchCombobox
                    options={categorias.map((c) => ({ value: c.nome, label: c.nome }))}
                    value={categoria}
                    onValueChange={setCategoria}
                    placeholder="Selecione a categoria"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Plano de Contas</Label>
                  <PlanoContaCombobox
                    groups={gruposPlanosDeConta}
                    value={planoId}
                    onValueChange={(val) => setPlanoId(val)}
                    disabled={loadingPlanos}
                  />
                </div>

                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Centro de Custo</Label>
                  <SearchCombobox
                    options={centrosCusto.map((cc) => ({ value: String(cc.id), label: cc.nome }))}
                    value={centroCustoId}
                    onValueChange={setCentroCustoId}
                    placeholder="Selecione o centro de custo"
                  />
                </div>
              </div>
            </div>

            {/* Seção de Parcelamento se Futuro */}
            {pagamentoFuturo ? (
              <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground shrink-0">
                    <Calendar className="size-4 text-emerald-600 shrink-0" />
                    <span>Cronograma de Parcelas ({parcelas.length})</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
                    {parcelas.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleIgualarParcelas}
                        className="h-7 px-2 text-[11px] gap-1 hover:cursor-pointer text-muted-foreground hover:text-foreground shrink-0"
                        title="Divide o valor total em valores iguais nas parcelas"
                      >
                        <Calculator className="size-3.5 shrink-0" />
                        <span>Dividir valores</span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAdicionarParcela}
                      className="h-7 px-2 sm:px-2.5 text-xs gap-1 hover:cursor-pointer bg-card hover:bg-muted shrink-0"
                    >
                      <Plus className="size-3.5 shrink-0" />
                      <span>Adicionar Parcela</span>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {parcelas.map((p, idx) => (
                    <div key={p.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-xl border border-border/50 bg-card p-2 shadow-2xs w-full min-w-0">
                      <span className="text-xs font-bold text-muted-foreground w-10 text-center shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="flex-1 min-w-[120px]">
                        <Input
                          type="date"
                          className="h-8 text-xs rounded-lg"
                          value={p.dataVencimento ?? ""}
                          onChange={(e) => handleAtualizarParcela(p.id, "dataVencimento", e.target.value)}
                        />
                      </div>
                      <div className="w-28 sm:w-32 shrink-0">
                        <ValueInput
                          className="h-8 text-xs text-right font-medium rounded-lg"
                          price={p.valor}
                          setPrice={(val) => handleAtualizarParcela(p.id, "valor", val)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:cursor-pointer"
                        disabled={parcelas.length <= 1}
                        onClick={() => handleRemoverParcela(p.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Validador de Saldo / Total de Parcelas */}
                <div className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs ${
                  parcelasValidas
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                }`}>
                  <div className="flex items-center gap-2 font-medium">
                    {parcelasValidas ? (
                      <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="size-4 text-amber-600 shrink-0" />
                    )}
                    <span>
                      {parcelasValidas
                        ? "Soma das parcelas é igual ao valor total do documento."
                        : `Diferença de ${formatarEmReal(Math.abs(diferenca))} no parcelamento.`}
                    </span>
                  </div>
                  <span className="font-bold">
                    Soma: {formatarEmReal(somaParcelas)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Footer com Ações (Sempre Visível) */}
        <DialogFooter className="shrink-0 p-4 border-t border-border/60 bg-muted/20 gap-2 flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="hover:cursor-pointer">
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={loading || submitting || (pagamentoFuturo && !parcelasValidas) || temLancamentoExistente}
            className={`hover:cursor-pointer font-semibold shadow-xs gap-2 ${
              temLancamentoExistente
                ? "bg-amber-600/80 hover:bg-amber-600 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            }`}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : temLancamentoExistente ? (
              <AlertTriangle className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {temLancamentoExistente ? "Já Lançado no Financeiro" : "Confirmar Lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
