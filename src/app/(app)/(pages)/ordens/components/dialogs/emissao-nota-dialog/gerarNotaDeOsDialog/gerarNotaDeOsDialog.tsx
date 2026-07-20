"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  Package,
  PackageSearch,
  Pencil,
  Receipt,
  X,
} from "lucide-react";

import { DialogProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/dialog-produto";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { normalizeCfopForOperation } from "@/lib/nfe/cfopOperation";
import { normalizeFiscalRecipient } from "@/lib/nfe/recipientNormalization";

import {
  createAssistedItem,
  type AssistedFiscalItem,
  type AssistedItemIssue,
  type FiscalSetup,
  type SourceProduct,
  toApiItem,
  validateAssistedItem,
} from "./emissao-assistida-model";
import { NfeItemFiscalEditor } from "./nfe-item-fiscal-editor";
import {
  emptyEntrySupplier,
  NfeEntrySupplierEditor,
  type NFeEntrySupplierDraft,
  validateEntrySupplier,
} from "./nfe-entry-supplier-editor";

type SourceResponse = {
  ok: boolean;
  message?: string;
  observacoes_fiscais?: string | null;
  cliente?: { id: number; nome: string; uf?: string | null } | null;
  fornecedor?: { id: number | null; nome: string | null; uf?: string | null } | null;
  parceiro_erros?: string[];
  tipo_operacao?: "SAIDA" | "ENTRADA";
  natureza_operacao?: string;
  destinatario?: NFeEntrySupplierDraft;
  itens: SourceProduct[];
};

type GenerateResponse = {
  ok: boolean;
  message?: string;
  detalhe?: string;
  nfeId?: number;
  errors?: Array<{
    step: string;
    itemIndex?: number;
    field?: string;
    message: string;
  }>;
};

function fmtMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export interface GerarNotaDeOsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  osId?: number | null;
  vendaId?: number | null;
  entradaId?: number | null;
  onAfterGenerate?: (nfeId: number | null) => void;
}

export function GerarNotaDeOsDialog({
  open,
  onOpenChange,
  osId,
  vendaId,
  entradaId,
  onAfterGenerate,
}: GerarNotaDeOsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<FiscalSetup | null>(null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [items, setItems] = useState<AssistedFiscalItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [includeObservations, setIncludeObservations] = useState(false);
  const [observations, setObservations] = useState("");
  const [entrySupplier, setEntrySupplier] = useState<NFeEntrySupplierDraft>(emptyEntrySupplier);

  const origin = osId ? "OS" : vendaId ? "VENDA" : entradaId ? "ENTRADA" : null;
  const originId = osId ?? vendaId ?? entradaId ?? null;
  const productsEndpoint = useMemo(() => {
    if (!origin || !originId) return null;
    if (origin === "OS") return `/api/ordens/${originId}/produtos-para-nfe`;
    if (origin === "VENDA") return `/api/venda/${originId}/produtos-para-nfe`;
    return `/api/entradas/${originId}/produtos-para-nfe`;
  }, [origin, originId]);
  const generateEndpoint = useMemo(() => {
    if (!origin || !originId) return null;
    if (origin === "OS") return `/api/nfe/de-os/${originId}/gerar-rascunho`;
    if (origin === "VENDA") return `/api/nfe/de-venda/${originId}/gerar-rascunho`;
    return `/api/nfe/de-entrada/${originId}/gerar-rascunho`;
  }, [origin, originId]);

  async function load(signal?: AbortSignal) {
    if (!productsEndpoint) return;
    setLoading(true);
    setLoadError(null);
    setServerError(null);
    try {
      const [productsResponse, setupResponse] = await Promise.all([
        fetch(productsEndpoint, { cache: "no-store", signal }),
        fetch("/api/nfe/emissao-assistida/setup", { cache: "no-store", signal }),
      ]);
      const productsJson = (await productsResponse.json().catch(() => null)) as SourceResponse | null;
      const setupJson = (await setupResponse.json().catch(() => null)) as
        | FiscalSetup
        | { error?: string; detail?: string }
        | null;

      if (!productsResponse.ok || !productsJson?.ok) {
        throw new Error(productsJson?.message || "Não foi possível carregar os produtos da origem.");
      }
      if (!setupResponse.ok || !setupJson || !("regrasFiscais" in setupJson)) {
        throw new Error(
          (setupJson && "error" in setupJson && (setupJson.detail || setupJson.error)) ||
            "Não foi possível carregar as regras fiscais.",
        );
      }

      const fiscalSetup = setupJson as FiscalSetup;
      const parceiro = productsJson.fornecedor ?? productsJson.cliente;
      const mapped = productsJson.itens.map((item) =>
        createAssistedItem(item, fiscalSetup, {
          tipoOperacao: productsJson.tipo_operacao ?? "SAIDA",
          parceiroUf: parceiro?.uf,
        }),
      );
      setSetup(fiscalSetup);
      setSource(productsJson);
      setItems(mapped);
      setSelectedIds(mapped.map((item) => item.sourceItemId));
      setEntrySupplier(productsJson.destinatario ?? emptyEntrySupplier);
      const existingObservations = productsJson.observacoes_fiscais ?? "";
      setObservations(existingObservations);
      setIncludeObservations(Boolean(existingObservations));
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      setLoadError(error?.message || "Erro ao preparar a emissão.");
      setSetup(null);
      setSource(null);
      setItems([]);
      setSelectedIds([]);
      setEntrySupplier(emptyEntrySupplier);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !productsEndpoint) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productsEndpoint]);

  const issuesByItem = useMemo(() => {
    const map = new Map<string, AssistedItemIssue[]>();
    if (!setup) return map;
    const parceiroUf = origin === "ENTRADA"
      ? entrySupplier.estado
      : (source?.fornecedor ?? source?.cliente)?.uf;
    for (const item of items) {
      map.set(
        item.sourceItemId,
        validateAssistedItem(item, setup, {
          tipoOperacao: source?.tipo_operacao ?? "SAIDA",
          parceiroUf,
        }),
      );
    }
    return map;
  }, [entrySupplier.estado, items, origin, setup, source]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSet.has(item.sourceItemId)),
    [items, selectedSet],
  );
  const selectedIssues = useMemo(
    () =>
      selectedItems.flatMap((item) =>
        (issuesByItem.get(item.sourceItemId) ?? []).map((issue) => ({ item, issue })),
      ),
    [issuesByItem, selectedItems],
  );
  const readyCount = items.filter((item) => (issuesByItem.get(item.sourceItemId) ?? []).length === 0).length;
  const selectedTotal = selectedItems.reduce(
    (total, item) => total + item.quantidade * item.valorUnitario,
    0,
  );
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const partiallySelected = selectedIds.length > 0 && selectedIds.length < items.length;
  const editingItem = items.find((item) => item.sourceItemId === editingId) ?? null;
  const editingIssues = editingItem ? issuesByItem.get(editingItem.sourceItemId) ?? [] : [];

  const title = origin === "VENDA"
    ? `Gerar NF-e da Venda #${originId ?? ""}`
    : origin === "ENTRADA"
      ? `Gerar NF-e da Entrada #${originId ?? ""}`
      : `Gerar NF-e da OS #${originId ?? ""}`;
  const parceiro = origin === "ENTRADA"
    ? { nome: entrySupplier.nomeRazaoSocial, uf: entrySupplier.estado }
    : source?.fornecedor ?? source?.cliente;
  const parceiroLabel = origin === "ENTRADA" ? "Fornecedor" : "Cliente";
  const entrySupplierErrors = useMemo(
    () => origin === "ENTRADA" ? validateEntrySupplier(entrySupplier) : [],
    [entrySupplier, origin],
  );
  const operationLabel =
    setup?.empresa?.uf && parceiro?.uf
      ? setup.empresa.uf === parceiro.uf
        ? `${origin === "ENTRADA" ? "Entrada" : "Venda"} interna · ${setup.empresa.uf}`
        : origin === "ENTRADA"
          ? `Entrada interestadual · ${parceiro.uf} → ${setup.empresa.uf}`
          : `Venda interestadual · ${setup.empresa.uf} → ${parceiro.uf}`
      : origin === "ENTRADA" ? "Operação de entrada" : "Operação de saída";

  function toggleItem(sourceItemId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(sourceItemId);
      else next.delete(sourceItemId);
      return Array.from(next);
    });
  }

  function updateEditingItem(patch: Partial<AssistedFiscalItem>) {
    if (!editingId) return;
    setItems((current) =>
      current.map((item) =>
        item.sourceItemId === editingId ? { ...item, ...patch } : item,
      ),
    );
    setServerError(null);
  }

  function updateEntrySupplier(next: NFeEntrySupplierDraft) {
    if (setup && next.estado !== entrySupplier.estado) {
      setItems((current) =>
        current.map((item) => ({
          ...item,
          cfop: normalizeCfopForOperation(
            item.cfop,
            "ENTRADA",
            setup.empresa?.uf,
            next.estado,
          ),
        })),
      );
    }
    setEntrySupplier(next);
    setServerError(null);
  }

  async function refreshItemDefaults(sourceItemId: string) {
    if (!productsEndpoint || !setup) return;
    try {
      const response = await fetch(productsEndpoint, { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as SourceResponse | null;
      if (!response.ok || !json?.ok) throw new Error(json?.message || "Falha ao atualizar o produto.");
      const updatedSource = json.itens.find((item) => item.sourceItemId === sourceItemId);
      if (!updatedSource) throw new Error("A linha do produto não foi encontrada na origem.");
      const parceiro = json.fornecedor ?? json.cliente;
      const updatedItem = createAssistedItem(updatedSource, setup, {
        tipoOperacao: json.tipo_operacao ?? "SAIDA",
        parceiroUf: parceiro?.uf,
      });
      setSource(json);
      setItems((current) =>
        current.map((item) => (item.sourceItemId === sourceItemId ? updatedItem : item)),
      );
      toast.success("Padrões fiscais do produto recarregados.");
    } catch (error: any) {
      toast.error(error?.message || "Erro ao recarregar os padrões do produto.");
    }
  }

  function openFirstPending() {
    const first = selectedIssues[0]?.item;
    if (first) setEditingId(first.sourceItemId);
  }

  async function generateDraft() {
    if (!generateEndpoint || selectedItems.length === 0) {
      toast.error("Selecione pelo menos um produto.");
      return;
    }
    if (selectedIssues.length > 0) {
      openFirstPending();
      toast.error("Corrija as pendências fiscais dos produtos selecionados.");
      return;
    }
    if (setup?.empresaErros.length) {
      toast.error("Corrija o cadastro fiscal da empresa antes de emitir.");
      return;
    }
    if (entrySupplierErrors.length) {
      toast.error("Preencha os dados fiscais do fornecedor antes de emitir.");
      return;
    }

    setSaving(true);
    setServerError(null);
    try {
      const response = await fetch(generateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: selectedItems.map(toApiItem),
          observacoesFiscais:
            includeObservations && observations.trim()
              ? observations.trim().slice(0, 500)
              : null,
          ...(origin === "ENTRADA"
            ? {
                destinatario: {
                  ...normalizeFiscalRecipient(entrySupplier),
                  clienteId: null,
                },
              }
            : {}),
        }),
      });
      const json = (await response.json().catch(() => null)) as GenerateResponse | null;
      if (!response.ok || !json?.ok) {
        const message =
          json?.errors?.[0]?.message || json?.detalhe || json?.message || "Falha ao gerar o rascunho.";
        setServerError(message);
        const firstIndex = json?.errors?.find((error) => error.itemIndex != null)?.itemIndex;
        if (firstIndex != null && selectedItems[firstIndex]) {
          setEditingId(selectedItems[firstIndex].sourceItemId);
        }
        toast.error(message);
        return;
      }

      toast.success("Rascunho de NF-e gerado com sucesso.");
      onAfterGenerate?.(json.nfeId ?? null);
      onOpenChange(false);
    } catch (error: any) {
      const message = error?.message || "Erro ao gerar o rascunho da NF-e.";
      setServerError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-5xl min-w-0 overflow-x-hidden overflow-y-auto p-0 sm:w-[96vw]"
        >
          <div className="relative min-w-0 border-b bg-background/95">
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="absolute right-2 top-2" aria-label="Fechar">
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
            <DialogHeader className="min-w-0 px-4 pb-4 pt-5 pr-12 sm:px-5 sm:pr-12">
              <DialogTitle className="flex min-w-0 items-start gap-2 leading-snug">
                <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 break-words">{title}</span>
              </DialogTitle>
              <DialogDescription className="break-words">
                Os dados da origem, do {parceiroLabel.toLowerCase()} e dos produtos já estão preenchidos. Ajuste somente as pendências fiscais.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="min-w-0 space-y-4 px-3 pb-4 pt-4 sm:px-5 sm:pb-5">
            {loading ? (
              <div className="grid min-h-40 place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : null}

            {loadError ? (
              <Alert variant="destructive" className="min-w-0 overflow-hidden">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Não foi possível preparar a emissão</AlertTitle>
                <AlertDescription className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
                  <p>{loadError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                    Tentar novamente
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {!loading && setup && source ? (
              <>
                <section className="flex min-w-0 flex-row gap-2 rounded-lg border bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{operationLabel}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {parceiroLabel}: {parceiro?.nome || "não identificado"} · CRT {setup.empresa?.crt || "não informado"} · Série {setup.config?.serie || "—"}
                    </p>
                  </div>
                    {/* <Badge variant="outline" className="max-w-full self-start overflow-hidden text-ellipsis sm:shrink-0">
                      {setup.versaoRegraFiscal}
                    </Badge> */}
                </section>

                {origin === "ENTRADA" ? (
                  <NfeEntrySupplierEditor
                    value={entrySupplier}
                    onChange={updateEntrySupplier}
                  />
                ) : null}

                {setup.empresaErros.length > 0 ? (
                  <Alert variant="destructive" className="min-w-0 overflow-hidden">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Cadastro da empresa incompleto</AlertTitle>
                    <AlertDescription className="min-w-0 [overflow-wrap:anywhere]">
                      {setup.empresaErros.join(" ")}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {entrySupplierErrors.length ? (
                  <Alert variant="destructive" className="min-w-0 overflow-hidden">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Complete os dados do fornecedor da nota</AlertTitle>
                    <AlertDescription className="min-w-0 [overflow-wrap:anywhere]">
                      {entrySupplierErrors.join(" ")}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {serverError ? (
                  <Alert variant="destructive" className="min-w-0 overflow-hidden">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>A validação do servidor encontrou uma pendência</AlertTitle>
                    <AlertDescription className="min-w-0 [overflow-wrap:anywhere]">{serverError}</AlertDescription>
                  </Alert>
                ) : null}

                {items.length === 0 ? (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Nenhum produto encontrado</AlertTitle>
                    <AlertDescription>Adicione produtos à origem antes de gerar a NF-e.</AlertDescription>
                  </Alert>
                ) : (
                  <section className="min-w-0 space-y-3 rounded-lg border p-3 bg-card sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex flex-wrap items-center gap-2">
                        <Package className="h-4 w-4 shrink-0 text-primary" />
                        <span className="text-sm font-medium">Produtos da emissão</span>
                        <Badge variant="outline">{readyCount} de {items.length} prontos</Badge>
                        {items.length - readyCount > 0 ? (
                          <Badge variant="destructive">{items.length - readyCount} com pendências</Badge>
                        ) : null}
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={allSelected ? true : partiallySelected ? "indeterminate" : false}
                          onCheckedChange={(checked) =>
                            setSelectedIds(checked ? items.map((item) => item.sourceItemId) : [])
                          }
                        />
                        Selecionar todos
                      </label>
                    </div>
                    <Separator />

                    <div className="space-y-2">
                      {items.map((item) => {
                        const issues = issuesByItem.get(item.sourceItemId) ?? [];
                        const selected = selectedSet.has(item.sourceItemId);
                        return (
                          <article
                            key={item.sourceItemId}
                            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                          >
                            <Checkbox
                              checked={selected}
                              className="mt-1"
                              onCheckedChange={(checked) => toggleItem(item.sourceItemId, Boolean(checked))}
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                                  {item.titulo}
                                </span>
                                {issues.length === 0 ? (
                                  <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                                    <CheckCircle2 className="h-3 w-3" /> Pronto
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive" className="gap-1">
                                    <AlertCircle className="h-3 w-3" /> {issues.length} pendência(s)
                                  </Badge>
                                )}
                                {item.ncm ? <Badge variant="outline">NCM {item.ncm}</Badge> : null}
                                {item.cfop ? <Badge variant="outline">CFOP {item.cfop}</Badge> : null}
                                {item.csosn ? <Badge variant="outline">CSOSN {item.csosn}</Badge> : null}
                                {item.cst ? <Badge variant="outline">CST {item.cst}</Badge> : null}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>Quantidade: <b>{item.quantidade}</b></span>
                                <span>Unitário: <b>{fmtMoney(item.valorUnitario)}</b></span>
                                <span>Total: <b>{fmtMoney(item.quantidade * item.valorUnitario)}</b></span>
                              </div>
                              {issues.length > 0 ? (
                                <ul className="min-w-0 list-disc space-y-0.5 pl-4 text-xs text-destructive [overflow-wrap:anywhere]">
                                  {issues.slice(0, 3).map((issue, index) => (
                                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                                  ))}
                                  {issues.length > 3 ? <li>Mais {issues.length - 3} pendência(s)</li> : null}
                                </ul>
                              ) : null}
                            </div>
                            <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-1 sm:col-span-1 sm:flex-nowrap">
                              <DialogProduto
                                productId={item.produtoId}
                                onAfterSaveProduct={() => void refreshItemDefaults(item.sourceItemId)}
                              >
                                <Button type="button" variant="ghost" size="icon" title="Editar padrão no cadastro do produto">
                                  <PackageSearch className="h-4 w-4" />
                                </Button>
                              </DialogProduto>
                              <Button
                                type="button"
                                variant={issues.length > 0 ? "outline" : "ghost"}
                                size="sm"
                                className="max-w-full gap-1"
                                onClick={() => setEditingId(item.sourceItemId)}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Ajustar
                              </Button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="min-w-0 space-y-3 bg-card rounded-lg border p-3 sm:p-4">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label htmlFor="nfe-origin-observations">Incluir observações fiscais</Label>
                      <p className="break-words text-xs text-muted-foreground">Use somente quando houver informação adicional para esta NF-e.</p>
                    </div>
                    <Switch
                      id="nfe-origin-observations"
                      className="shrink-0"
                      checked={includeObservations}
                      onCheckedChange={setIncludeObservations}
                    />
                  </div>
                  {includeObservations ? (
                    <Textarea
                      value={observations}
                      maxLength={500}
                      className="min-h-20 resize-none"
                      onChange={(event) => setObservations(event.target.value.slice(0, 500))}
                    />
                  ) : null}
                </section>

                <section className="min-w-0 bg-card  gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                  <div className="min-w-0 text-sm">
                    <p className=""><b>{selectedItems.length}</b> produto(s) selecionado(s) · <b>{fmtMoney(selectedTotal)}</b></p>
                    {selectedIssues.length > 0 ? (
                      <p className="text-xs text-destructive">Existem {selectedIssues.length} pendência(s) nos itens selecionados.</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Todos os itens selecionados passaram pela validação fiscal.</p>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col mt-2 gap-2 sm:shrink-0 sm:flex-row">
                    {selectedIssues.length > 0 ? (
                      <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={openFirstPending}>
                        Corrigir pendências
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="h-auto min-h-9 w-full whitespace-normal text-center sm:w-auto"
                      disabled={
                        saving ||
                        selectedItems.length === 0 ||
                        setup.empresaErros.length > 0 ||
                        entrySupplierErrors.length > 0
                      }
                      onClick={() => void generateDraft()}
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Gerar rascunho de NF-e
                    </Button>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {setup ? (
        <NfeItemFiscalEditor
          open={Boolean(editingItem)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditingId(null);
          }}
          item={editingItem}
          setup={setup}
          issues={editingIssues}
          onChange={updateEditingItem}
        />
      ) : null}
    </>
  );
}
