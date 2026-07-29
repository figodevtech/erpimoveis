"use client";

import axios, { isAxiosError } from "axios";
import { addMonths, format } from "date-fns";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Eye, FileWarning, Loader2, Minus, PackagePlus, Pencil, Plus, Search, TriangleAlert, UserRoundPlus, X } from "lucide-react";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import type { UsoConsumoGrupo, UsoConsumoItem } from "@/types/usoconsumo";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";
import FornecedorDialog from "../../configuracoes/tipos/components/fornecedorDialog";
import { Metodo_pagamento } from "../../(financeiro)/fluxodecaixa/types";
import ValueInput from "../../estoque/components/dialog-produto/entrada-valor";
import BotaoNf from "../../estoque/components/dialog-entrada/botao-nota-fiscal";
import type { NF } from "../../estoque/components/dialog-entrada/types";
import type { Fornecedor } from "../../estoque/types";
import { ItemDialog } from "./item-dialog";
import { ItemSelectDialog, type UsoConsumoItemOption } from "./item-select-dialog";

type Option = {
  id: number;
  nome?: string;
  titulo?: string;
  codigo?: string;
  nomerazaosocial?: string;
  nomefantasia?: string;
  cpfcnpj?: string;
};

type FiscalLine = NF["itens"][number] & {
  itemReferenciaId?: number;
  itemReferencia?: UsoConsumoItemOption;
};

type ParsedNfe = Omit<NF, "itens"> & { itens: FiscalLine[] };
type Parcela = { id: number; dataVencimento?: string; valor: number };
type DuplicateEntry = {
  id: number;
  created_at: string;
  itens: Array<{ item_id: number; numero_item_fiscal?: number | null; quantidade: number }>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: { fornecedores: Option[]; bancos: Option[]; categorias: Option[]; planos: Option[]; centros: Option[] };
  onSaved: () => Promise<void>;
};

function errorText(error: unknown) {
  return isAxiosError(error)
    ? error.response?.data?.details ?? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
    : "Erro inesperado.";
}

function totalLine(item: FiscalLine) {
  return Number(item.quantidade) * Number(item.valorUnitario)
    - Number(item.valorDesconto ?? 0)
    + Number(item.valorFrete ?? 0)
    + Number(item.valorSeguro ?? 0)
    + Number(item.outrasDespesas ?? 0)
    + Number(item.valorIpi ?? 0);
}

function normalizedUnit(value: unknown) {
  const unit = String(value ?? "").toUpperCase();
  return ["UN", "JGO", "KIT", "PAR", "CX", "PCT"].includes(unit) ? unit : "UN";
}

function normalizedDocument(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function FiscalEntryDialog({ open, onOpenChange, options, onSaved }: Props) {
  const { data: session } = useSession();
  const permissions = (session?.user as { permissoes?: unknown })?.permissoes;
  const canCreateItem = permissionSetHas(permissions, PERMS.USOCONSUMO_CRIAR);
  const canEditItem = permissionSetHas(permissions, PERMS.USOCONSUMO_EDITAR);

  const [parsed, setParsed] = useState<ParsedNfe | null>(null);
  const [file, setFile] = useState<File>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingSupplier, setLoadingSupplier] = useState(false);
  const [loadingAppropriations, setLoadingAppropriations] = useState(false);
  const [linkingItems, setLinkingItems] = useState(false);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [supplierSelectOpen, setSupplierSelectOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateEntry[]>([]);
  const [groups, setGroups] = useState<UsoConsumoGrupo[]>([]);

  const [selectOpen, setSelectOpen] = useState(false);
  const [selectIndex, setSelectIndex] = useState<number | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemDialogIndex, setItemDialogIndex] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<UsoConsumoItem | null>(null);
  const [itemInitialValues, setItemInitialValues] = useState<Record<string, string | number | null>>();

  const [futurePayment, setFuturePayment] = useState(false);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [bankId, setBankId] = useState("");
  const [method, setMethod] = useState<Metodo_pagamento | "">("");
  const [category, setCategory] = useState("");
  const [planId, setPlanId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const parsedItemsRef = useRef<FiscalLine[]>([]);

  const selectedLines = useMemo(
    () => parsed?.itens.filter((item) => !item.destinoApropriado) ?? [],
    [parsed],
  );
  const total = useMemo(
    () => Number(selectedLines.reduce((sum, item) => sum + totalLine(item), 0).toFixed(2)),
    [selectedLines],
  );

  useEffect(() => {
    parsedItemsRef.current = parsed?.itens ?? [];
  }, [parsed?.itens]);

  const loadGroups = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/usoconsumo/grupos");
      setGroups(data.data ?? []);
    } catch (error) {
      toast.error("Não foi possível carregar os grupos de uso/consumo.", { description: errorText(error) });
    }
  }, []);

  function reset() {
    setParsed(null);
    setFile(undefined);
    setSubmitting(false);
    setDuplicates([]);
    setSelectIndex(null);
    setSelectOpen(false);
    setItemDialogIndex(null);
    setItemDialogOpen(false);
    setEditingItem(null);
    setItemInitialValues(undefined);
    setSupplierDialogOpen(false);
    setSupplierSelectOpen(false);
    setFuturePayment(false);
    setParcelas([]);
    setBankId("");
    setMethod("");
    setCategory("");
    setPlanId("");
    setCostCenterId("");
  }

  useEffect(() => {
    if (open) void loadGroups();
    else reset();
  }, [open, loadGroups]);

  const receiveParsed = useCallback((note: NF | null) => {
    if (!note) {
      setParsed(null);
      setDuplicates([]);
      return;
    }
    setParsed({
      ...note,
      fornecedorReferente: undefined,
      fornecedorReferenteId: undefined,
      itens: note.itens.map((item) => ({ ...item })),
    });
  }, []);

  const findSupplier = useCallback(async () => {
    const cnpj = normalizedDocument(parsed?.emitente?.cnpj);
    if (!cnpj) return;
    setLoadingSupplier(true);
    try {
      const { data } = await axios.get(`/api/tipos/fornecedores/${cnpj}?by=cpfcnpj`);
      setParsed((current) => current ? { ...current, fornecedorReferente: data.item, fornecedorReferenteId: Number(data.item.id) } : current);
    } catch (error) {
      setParsed((current) => current ? { ...current, fornecedorReferente: undefined, fornecedorReferenteId: undefined } : current);
      if (!isAxiosError(error) || error.response?.status !== 404) {
        toast.error("Não foi possível identificar o fornecedor.", { description: errorText(error) });
      }
    } finally {
      setLoadingSupplier(false);
    }
  }, [parsed?.emitente?.cnpj]);

  function selectSupplier(supplier: Fornecedor) {
    if (normalizedDocument(supplier.cpfcnpj) !== normalizedDocument(parsed?.emitente?.cnpj)) {
      toast.error("O fornecedor selecionado não corresponde ao CNPJ da NF-e.");
      return;
    }
    setParsed((current) => current ? {
      ...current,
      fornecedorReferenteId: supplier.id,
      fornecedorReferente: supplier,
    } : current);
    setSupplierSelectOpen(false);
  }

  useEffect(() => {
    if (parsed?.emitente?.cnpj && !parsed.fornecedorReferenteId) void findSupplier();
  }, [findSupplier, parsed?.emitente?.cnpj, parsed?.fornecedorReferenteId]);

  useEffect(() => {
    const documentId = parsed?.documentoFiscalRecebidoId;
    if (!documentId) return;
    let cancelled = false;
    setLoadingAppropriations(true);
    void axios.get("/api/usoconsumo/entradas/apropriacoes", { params: { documentoId: documentId } })
      .then((response) => {
        if (cancelled) return;
        const map = new Map<number, "PRODUTO" | "USOCONSUMO">(
          (response.data.data ?? []).map((entry: { numero_item: number; destino: "PRODUTO" | "USOCONSUMO" }) => [Number(entry.numero_item), entry.destino]),
        );
        setParsed((current) => current ? {
          ...current,
          itens: current.itens.map((item) => {
            const destination = map.get(Number(item.numeroItem));
            return { ...item, destinoApropriado: destination };
          }),
        } : current);
      })
      .catch((error) => toast.error("Não foi possível verificar os itens já destinados.", { description: errorText(error) }))
      .finally(() => { if (!cancelled) setLoadingAppropriations(false); });
    return () => { cancelled = true; };
  }, [parsed?.documentoFiscalRecebidoId]);

  useEffect(() => {
    const key = String(parsed?.chaveAcesso ?? "").replace(/\D/g, "");
    if (key.length !== 44) return;
    let cancelled = false;
    void axios.get("/api/usoconsumo/entradas/duplicidades", { params: { chaveNfe: key } })
      .then((response) => { if (!cancelled) setDuplicates(response.data.data ?? []); })
      .catch((error) => { if (!cancelled) toast.error("Não foi possível verificar entradas duplicadas.", { description: errorText(error) }); });
    return () => { cancelled = true; };
  }, [parsed?.chaveAcesso]);

  useEffect(() => {
    const supplierId = parsed?.fornecedorReferenteId;
    const documentId = parsed?.documentoFiscalRecebidoId;
    if (!supplierId || !parsedItemsRef.current.length) return;
    let cancelled = false;
    const snapshot = parsedItemsRef.current;
    setLinkingItems(true);
    void Promise.all(snapshot.map(async (line) => {
      if (line.destinoApropriado || line.itemReferenciaId) return null;
      const ean = String(line.ean ?? "");
      const search = ean && ean !== "SEM GTIN" ? ean : String(line.codigo || line.descricao || "");
      const { data } = await axios.get("/api/usoconsumo/itens/select", {
        params: { search, fornecedorId: supplierId, codigoFornecedor: line.codigo },
      });
      let selected = (data.data ?? []).find((item: UsoConsumoItemOption) => data.suggestedId && item.id === Number(data.suggestedId));
      selected ??= (data.data ?? []).find((item: UsoConsumoItemOption) => ean && ean !== "SEM GTIN" && String(item.codigobarras ?? "") === ean);
      if (!selected && data.suggestedId) {
        const detail = await axios.get(`/api/usoconsumo/itens/${data.suggestedId}`);
        selected = detail.data.data;
      }
      return selected ? { numeroItem: Number(line.numeroItem), selected } : null;
    }))
      .then((matches) => {
        if (cancelled) return;
        const map = new Map(matches.filter(Boolean).map((match) => [match!.numeroItem, match!.selected]));
        setParsed((current) => current && current.documentoFiscalRecebidoId === documentId ? {
          ...current,
          itens: current.itens.map((line) => {
            const selected = map.get(Number(line.numeroItem));
            return selected ? { ...line, itemReferenciaId: selected.id, itemReferencia: selected } : line;
          }),
        } : current);
      })
      .catch((error) => { if (!cancelled) toast.error("Não foi possível identificar os itens pelo fornecedor.", { description: errorText(error) }); })
      .finally(() => { if (!cancelled) setLinkingItems(false); });
    return () => { cancelled = true; };
  }, [parsed?.documentoFiscalRecebidoId, parsed?.fornecedorReferenteId]);

  function updateLine(index: number, change: Partial<FiscalLine>) {
    setParsed((current) => current ? { ...current, itens: current.itens.map((line, currentIndex) => currentIndex === index ? { ...line, ...change } : line) } : current);
  }

  async function selectItemById(index: number, id: number) {
    try {
      const { data } = await axios.get(`/api/usoconsumo/itens/${id}`);
      updateLine(index, { itemReferenciaId: id, itemReferencia: data.data });
    } catch (error) {
      toast.error("Não foi possível carregar o item selecionado.", { description: errorText(error) });
    }
  }

  function openCreateItem(index: number) {
    if (!parsed?.fornecedorReferenteId) return toast.error("Cadastre ou selecione o fornecedor antes de criar o item.");
    const line = parsed.itens[index];
    setEditingItem(null);
    setItemDialogIndex(index);
    setItemInitialValues({
      titulo: String(line.descricao || `Item ${line.codigo || "NF-e"}`),
      referencia: String(line.codigo || ""),
      codigobarras: String(line.ean && String(line.ean) !== "SEM GTIN" ? line.ean : ""),
      unidade: normalizedUnit(line.unidade),
      estoqueInicial: 0,
      estoqueminimo: 0,
      precocompra: Number(line.valorUnitario || 0),
      ncm: String(line.ncm ?? ""),
      cfop_entrada: String(line.cfop ?? ""),
    });
    setItemDialogOpen(true);
  }

  async function openEditItem(index: number) {
    const id = parsed?.itens[index]?.itemReferenciaId;
    if (!id) return;
    try {
      const { data } = await axios.get(`/api/usoconsumo/itens/${id}`);
      setEditingItem(data.data);
      setItemDialogIndex(index);
      setItemInitialValues(undefined);
      setItemDialogOpen(true);
    } catch (error) {
      toast.error("Não foi possível abrir o item para edição.", { description: errorText(error) });
    }
  }

  function buildTransactions() {
    if (!futurePayment) return [];
    const supplier = parsed?.fornecedorReferente;
    const categoryOption = options.categorias.find((item) => item.nome === category);
    const plan = options.planos.find((item) => String(item.id) === planId);
    const center = options.centros.find((item) => String(item.id) === costCenterId);
    const now = new Date().toISOString();
    return parcelas.map((parcela, index) => ({
      descricao: `Compra de uso e consumo NF ${parsed?.numeroNota ?? ""}${parcelas.length > 1 ? ` - Parcela ${index + 1}/${parcelas.length}` : ""}`,
      valor: parcela.valor,
      data: now,
      vencimento_em: parcela.dataVencimento ? `${parcela.dataVencimento}T12:00:00` : null,
      metodopagamento: method || null,
      categoria: category,
      categoria_id: categoryOption?.id ?? null,
      banco_id: bankId ? Number(bankId) : null,
      nomepagador: supplier?.nomerazaosocial || parsed?.emitente.nome || "Fornecedor",
      cpfcnpjpagador: String(supplier?.cpfcnpj || parsed?.emitente.cnpj || "NAO INFORMADO"),
      pendente: true,
      plano_de_conta_id: planId ? Number(planId) : null,
      plano_de_conta: plan?.nome ?? null,
      centro_custo_id: costCenterId ? Number(costCenterId) : null,
      centro_custo: center?.nome ?? null,
    }));
  }

  async function save() {
    if (!parsed) return toast.error("Nenhuma nota fiscal processada.");
    if (duplicates.length) return toast.error("Esta NF-e já possui uma entrada confirmada no estoque de uso/consumo.");
    if (!parsed.fornecedorReferenteId) return toast.error("A nota deve estar vinculada a um fornecedor do sistema.");
    if (!selectedLines.length) return toast.error("Não há itens disponíveis para destinar ao uso/consumo.");
    if (selectedLines.some((line) => !line.itemReferenciaId)) return toast.error("Vincule todos os itens da nota a itens de uso/consumo.");
    if (futurePayment) {
      if (!category) return toast.error("Selecione a categoria do lançamento financeiro.");
      if (!parcelas.length || parcelas.some((parcela) => !parcela.dataVencimento || parcela.valor <= 0)) return toast.error("Informe vencimento e valor positivo em todas as parcelas.");
      const sum = parcelas.reduce((value, parcela) => value + parcela.valor, 0);
      if (Math.abs(sum - total) > 0.01) return toast.error("A soma das parcelas deve ser igual ao valor destinado ao estoque.");
    }

    setSubmitting(true);
    try {
      await axios.post("/api/usoconsumo/entradas/fiscal", {
        fornecedor_id: parsed.fornecedorReferenteId,
        chave_nfe: parsed.chaveAcesso,
        numero_nota: String(parsed.numeroNota ?? ""),
        serie_nota: String(parsed.serie ?? ""),
        data_emissao: parsed.dataEmissao,
        documento_fiscal_recebido_id: parsed.documentoFiscalRecebidoId,
        itens: selectedLines.map((line) => ({
          item_id: line.itemReferenciaId,
          numero_item_fiscal: Number(line.numeroItem),
          codigo_fornecedor: String(line.codigo ?? ""),
          quantidade: Number(line.quantidade),
          valor_unitario_compra: Number(line.valorUnitario),
          valor_desconto: Number(line.valorDesconto ?? 0),
          valor_frete: Number(line.valorFrete ?? 0),
          outras_despesas: Number(line.valorSeguro ?? 0) + Number(line.outrasDespesas ?? 0) + Number(line.valorIpi ?? 0),
          unidade: normalizedUnit(line.unidade),
          ncm: String(line.ncm ?? ""),
          cfop: String(line.cfop ?? ""),
          titulo: String(line.descricao ?? ""),
          referencia: String(line.codigo ?? ""),
        })),
        transacoes: buildTransactions(),
      });
      toast.success("Entrada fiscal de uso/consumo registrada.");
      reset();
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error("Entrada fiscal não registrada.", { description: errorText(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const loading = loadingSupplier || loadingAppropriations || linkingItems;

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (submitting) return;
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}>
        <DialogContent className="h-[600px] overflow-hidden p-0" onDoubleClick={(event) => event.stopPropagation()}>
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-6 py-4">
              <DialogTitle>Entrada de Item de Uso/Consumo</DialogTitle>
              <DialogDescription className="flex flex-row items-center justify-between" />
            </DialogHeader>

            {!parsed ? (
              <div className="relative h-full min-h-0 space-y-2 overflow-auto bg-muted px-6 py-10 dark:bg-muted-foreground/5">
                <BotaoNf file={file} setFile={setFile} setParsed={receiveParsed} />
              </div>
            ) : (
              <div className="relative h-full min-h-0 space-y-2 overflow-auto bg-muted/60 px-6 py-10">
                <div className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1"><span className="text-xs text-muted-foreground">1 nota selecionada</span><X className="h-4 w-4 cursor-pointer text-red-400" onClick={() => { setFile(undefined); receiveParsed(null); }} /></div>

                <Card className="mt-2 w-full max-w-full">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span>Dados da NF-e</span>
                      <div className="flex items-center gap-2">
                        {parsed.documentoFiscalRecebidoId ? <Button type="button" variant="outline" size="sm" className="h-7 text-xs hover:cursor-pointer" onClick={() => window.open(`/nfe/${parsed.documentoFiscalRecebidoId}/danfe?origem=terceiros`, "_blank", "noopener,noreferrer")}><Eye className="h-3.5 w-3.5" />Ver DANFE</Button> : null}
                        <Badge variant="outline">NF nº {parsed.numeroNota || "—"}</Badge>
                      </div>
                    </CardTitle>
                    <CardDescription className="text-xs">Informações identificadas a partir do XML enviado.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-col space-y-1">
                        <p className="text-xs text-muted-foreground">Fornecedor:</p>
                        <span className="max-w-[250px] text-wrap text-xs">{parsed.emitente.nome || "Fornecedor não identificado"}</span>
                        <span className="text-[12px] text-muted-foreground">{parsed.emitente.nomeFantasia}</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>CNPJ: {String(parsed.emitente.cnpj || "Não informado")}</span>
                          {parsed.emitente.ie ? <span>IE: {parsed.emitente.ie}</span> : null}
                        </div>
                        <div className="flex min-w-0 flex-row items-center gap-2">
                          {parsed.fornecedorReferenteId ? (
                            <FornecedorSelect open={supplierSelectOpen} setOpen={setSupplierSelectOpen} OnSelect={selectSupplier}>
                              <Button type="button" variant="ghost" className="h-auto min-w-0 max-w-[250px] justify-start gap-2 bg-muted px-2 py-1 text-left text-xs font-normal text-muted-foreground hover:bg-muted">
                                <Building2 className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 truncate">
                                  Fornecedor vinculado: {parsed.fornecedorReferente?.nomefantasia || parsed.fornecedorReferente?.nomerazaosocial}
                                </span>
                              </Button>
                            </FornecedorSelect>
                          ) : (
                            <div className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1">
                              <span className="text-xs text-red-400">
                                {loadingSupplier ? "Buscando fornecedor..." : "Fornecedor não cadastrado no sistema"}
                              </span>
                            </div>
                          )}
                          {!parsed.fornecedorReferenteId && !loadingSupplier ? <FornecedorDialog dialogOpen={supplierDialogOpen} setDialogOpen={setSupplierDialogOpen} handleGetFornecedor={findSupplier} dadosNovoFornecedor={{ cpfcnpj: String(parsed.emitente.cnpj ?? ""), nomerazaosocial: String(parsed.emitente.nome ?? ""), nomefantasia: String(parsed.emitente.nomeFantasia ?? ""), endereco: String(parsed.emitente.endereco?.logradouro ?? ""), endereconumero: String(parsed.emitente.endereco?.numero ?? ""), cidade: String(parsed.emitente.endereco?.municipio ?? ""), bairro: String(parsed.emitente.endereco?.bairro ?? ""), codigomunicipio: String(parsed.emitente.endereco?.codigoMunicipio ?? ""), estado: String(parsed.emitente.endereco?.uf ?? ""), cep: String(parsed.emitente.endereco?.cep ?? ""), contato: "", ativo: true }}><div className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted" title="Cadastrar fornecedor"><UserRoundPlus className="h-4 w-4" /></div></FornecedorDialog> : null}
                        </div>
                      </div>
                      <div className="min-w-0 shrink-0 space-y-1 text-right text-xs text-muted-foreground">
                        <div className="flex flex-col"><span>Emissão:</span><span>{parsed.dataEmissao ? formatDate(parsed.dataEmissao) : "—"}</span></div>
                        <p>Valor da NF-e: <span className="font-semibold">{formatarEmReal(Number(parsed.totais.valorNota ?? 0))}</span></p>
                        <p>Destinado ao uso/consumo: <span className="font-semibold">{formatarEmReal(total)}</span></p>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>Itens na nota: <span className="font-semibold">{parsed.itens.length}</span></span>
                      <span>Série: <span className="font-semibold">{parsed.serie}</span></span>
                    </div>
                    {duplicates.length ? <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300"><FileWarning className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">NF-e já registrada em uso/consumo</p>{duplicates.map((entry) => <p key={entry.id}>Entrada #{entry.id}, registrada em {formatDate(entry.created_at)}.</p>)}</div></div> : null}
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  {parsed.itens.map((line, index) => {
                    const duplicate = duplicates.some((entry) => entry.itens.some((item) => Number(item.numero_item_fiscal) === Number(line.numeroItem) || (line.itemReferenciaId && item.item_id === line.itemReferenciaId)));
                    return <div key={`${line.numeroItem}-${line.codigo}`} className={`rounded-lg border p-4 text-xs not-dark:bg-white ${line.destinoApropriado ? "opacity-60" : ""}`}>
                      <div className="space-y-2">
                        <div className="border-b pb-2">
                          <div className="mb-2 flex flex-row items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2"><p className="font-semibold uppercase text-muted-foreground">Item {line.numeroItem}</p>{line.destinoApropriado ? <Badge variant="secondary">Já destinado a {line.destinoApropriado === "PRODUTO" ? "produtos" : "uso/consumo"}</Badge> : null}</div>
                            <p className="shrink-0 font-bold">Total: {formatarEmReal(totalLine(line))}</p>
                          </div>
                          <p className="font-semibold text-muted-foreground">{line.descricao}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-2 text-xs md:grid-cols-3 lg:grid-cols-4"><p><span className="font-medium text-muted-foreground">Código:</span> <span className="font-mono font-semibold">{line.codigo || "—"}</span></p><p><span className="font-medium text-muted-foreground">EAN:</span> <span className="font-mono font-semibold">{String(line.ean || "—")}</span></p><p><span className="font-medium text-muted-foreground">Unidade:</span> <span className="font-semibold">{line.unidade}</span></p><p><span className="font-medium text-muted-foreground">Qtd:</span> <span className="font-semibold">{Number(line.quantidade).toLocaleString("pt-BR")}</span></p><p><span className="font-medium text-muted-foreground">V. Unitário:</span> <span className="font-mono font-semibold">{formatarEmReal(Number(line.valorUnitario))}</span></p><p><span className="font-medium text-muted-foreground">NCM:</span> <span className="font-mono font-semibold">{line.ncm}</span></p><p><span className="font-medium text-muted-foreground">CFOP:</span> <span className="font-mono font-semibold">{line.cfop}</span></p></div>
                        <Separator />
                        <div className={`flex min-w-0 flex-row items-center gap-2 ${line.destinoApropriado ? "pointer-events-none opacity-50" : ""}`}>
                          <div className={`relative inline-flex min-w-0 max-w-[300px] items-center gap-2 rounded-md bg-muted px-2 py-1 pr-6 text-xs text-muted-foreground ${linkingItems ? "text-primary" : !line.itemReferenciaId ? "text-red-400" : ""}`}><span className="min-w-0 truncate">{linkingItems ? "Buscando item vinculado..." : line.itemReferenciaId ? `Item vinculado: ${line.itemReferencia?.titulo || `#${line.itemReferenciaId}`}` : "Item não vinculado ao estoque de uso/consumo"}</span>{line.itemReferenciaId && !line.destinoApropriado ? <X className="absolute right-1 h-4 w-4 cursor-pointer text-red-200 hover:text-red-400" onClick={() => updateLine(index, { itemReferenciaId: undefined, itemReferencia: undefined })} /> : null}</div>
                          {!line.destinoApropriado ? <ItemSelectDialog open={selectOpen && selectIndex === index} setOpen={(nextOpen) => { setSelectOpen(nextOpen); setSelectIndex(nextOpen ? index : null); }} onSelect={(item) => updateLine(index, { itemReferenciaId: item.id, itemReferencia: item })}><div className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted" title="Selecionar vínculo"><Search className="h-4 w-4" /></div></ItemSelectDialog> : null}
                          {!line.destinoApropriado && !line.itemReferenciaId && canCreateItem ? <button type="button" className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted" title="Criar item" onClick={() => openCreateItem(index)}><PackagePlus className="h-4 w-4" /></button> : null}
                          {!line.destinoApropriado && line.itemReferenciaId && canEditItem ? <button type="button" className="rounded-full bg-primary/20 p-1.5 transition-all hover:cursor-pointer hover:bg-muted" title="Editar item vinculado" onClick={() => void openEditItem(index)}><Pencil className="h-4 w-4" /></button> : null}
                        </div>
                        {duplicate ? <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700"><TriangleAlert className="h-3.5 w-3.5" />Este item já aparece em uma entrada confirmada desta mesma NF-e.</div> : null}
                      </div>
                    </div>;
                  })}
                </div>

                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${futurePayment ? "text-accent-foreground" : "text-muted-foreground"}`}>
                      Lançar parcelas futuras no financeiro (opcional)
                    </span>
                    <Switch checked={futurePayment} onCheckedChange={(checked) => {
                      setFuturePayment(checked);
                      if (checked) {
                        setParcelas((current) => current.length ? current : [{ id: Date.now(), valor: 0 }]);
                      } else {
                        setParcelas([]);
                        setBankId("");
                        setMethod("");
                        setCategory("");
                        setPlanId("");
                        setCostCenterId("");
                      }
                    }} />
                  </div>

                  {futurePayment ? <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      {parcelas.map((parcela, index) => <div key={parcela.id} className="relative grid gap-2 rounded-xl bg-muted-foreground/5 px-3 py-6 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
                        <span className="absolute left-3 top-1 text-xs text-muted-foreground">{index + 1}ª parcela</span>
                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => parcelas.length === 1 ? toast.error("É necessário ao menos uma parcela.") : setParcelas((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Minus className="h-4 w-4" /></Button>
                        <div className="space-y-1"><Label>Data de vencimento</Label><DatePicker value={parcela.dataVencimento || ""} onChange={(value) => setParcelas((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, dataVencimento: value || undefined } : entry))} /></div>
                        <div className="space-y-1"><Label>Valor</Label><ValueInput price={parcela.valor} setPrice={(value) => setParcelas((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, valor: value } : entry))} /></div>
                      </div>)}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setParcelas((current) => [...current, { id: Date.now(), valor: 0, dataVencimento: format(addMonths(new Date(), current.length), "yyyy-MM-dd") }])}><Plus className="mr-2 h-4 w-4" />Adicionar parcela</Button>
                        <span className="text-xs text-muted-foreground">Parcelas: {formatarEmReal(parcelas.reduce((sum, parcela) => sum + parcela.valor, 0))} de {formatarEmReal(total)}</span>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1"><Label>Banco</Label><Select value={bankId} onValueChange={setBankId}><SelectTrigger><SelectValue placeholder="Não informado" /></SelectTrigger><SelectContent>{options.bancos.map((bank) => <SelectItem key={bank.id} value={String(bank.id)}>{bank.titulo}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>Método</Label><Select value={method} onValueChange={(value) => setMethod(value as Metodo_pagamento)}><SelectTrigger><SelectValue placeholder="Não informado" /></SelectTrigger><SelectContent>{Object.values(Metodo_pagamento).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1"><Label>Categoria</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{options.categorias.map((entry) => <SelectItem key={entry.id} value={entry.nome || String(entry.id)}>{entry.nome}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>Plano de conta</Label><Select value={planId || "none"} onValueChange={(value) => setPlanId(value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Não informado</SelectItem>{options.planos.map((entry) => <SelectItem key={entry.id} value={String(entry.id)}>{entry.codigo ? `${entry.codigo} · ` : ""}{entry.nome}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>Centro de custo</Label><Select value={costCenterId || "none"} onValueChange={(value) => setCostCenterId(value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Não informado</SelectItem>{options.centros.map((entry) => <SelectItem key={entry.id} value={String(entry.id)}>{entry.nome}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                  </div> : null}
                </div>
              </div>
            )}

            <DialogFooter className="shrink-0 px-6 py-4">
              <div className="flex gap-3 sm:flex-row sm:gap-4">
                <Button className="hover:cursor-pointer" onClick={() => void save()} disabled={!parsed || loading || submitting || !selectedLines.length || duplicates.length > 0}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Registrar</Button>
                <DialogClose asChild><Button className="hover:cursor-pointer" variant="outline" disabled={submitting}>Cancelar</Button></DialogClose>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ItemDialog
        open={itemDialogOpen}
        item={editingItem}
        grupos={groups}
        initialValues={itemInitialValues}
        onOpenChange={(nextOpen) => { setItemDialogOpen(nextOpen); if (!nextOpen) { setEditingItem(null); setItemInitialValues(undefined); } }}
        onGroupsChanged={loadGroups}
        onSaved={async () => { if (itemDialogIndex !== null && editingItem?.id) await selectItemById(itemDialogIndex, editingItem.id); }}
        onSelectedItemId={(id) => { if (itemDialogIndex !== null) void selectItemById(itemDialogIndex, id); }}
      />
    </>
  );
}
