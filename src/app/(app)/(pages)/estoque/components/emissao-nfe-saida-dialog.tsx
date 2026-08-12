"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Building2, FileCheck2, Loader2, ReceiptText } from "lucide-react";

import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import type { Fornecedor } from "@/app/(app)/(pages)/estoque/types";
import { GerarNotaDeOsDialog } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/gerarNotaDeOsDialog/gerarNotaDeOsDialog";
import {
  emptyEntrySupplier,
  NfeEntrySupplierEditor,
  validateEntrySupplier,
  type NFeEntrySupplierDraft,
} from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/gerarNotaDeOsDialog/nfe-entry-supplier-editor";
import { AutorizarNfeButton } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/autorizarNfe-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { normalizeFiscalRecipient } from "@/lib/nfe/recipientNormalization";
import { toast } from "@/lib/toast";

type SaidaItem = {
  id: number;
  produto_id: number;
  quantidade: number;
  produto?: { titulo?: string | null; referencia?: string | null } | null;
};

type EntradaCandidate = {
  id: number;
  entrada_id: number;
  produto_id: number;
  quantidade: number;
  entrada?: {
    id: number;
    notachave?: string | null;
    dataentrada?: string | null;
    fornecedor?: Fornecedor | null;
  } | null;
};

type Operation = {
  codigo: string;
  label: string;
  naturezaOperacao: string;
  finalidade: string;
  exigeDocumentoReferenciado: boolean;
};

type ContextItem = {
  saida_item_id: number;
  entrada_item_origem_id?: number | null;
  numero_item_referenciado?: number | null;
  percentual_devolucao?: number | null;
  valor_ipi_devolvido?: number | null;
};

type FiscalResponse = {
  ok: boolean;
  message?: string;
  saida: { id: number; itens: SaidaItem[] };
  contexto?: {
    operacao_fiscal_codigo: string;
    natureza_operacao: string;
    finalidade: string;
    documento_referenciado_obrigatorio: boolean;
    chave_acesso_referenciada?: string | null;
    observacoes_fiscais?: string | null;
    itens?: ContextItem[];
  } | null;
  destinatario?: (Partial<NFeEntrySupplierDraft> & { clienteId?: number | null }) | null;
  entradasCandidatas: EntradaCandidate[];
  operacoes: Operation[];
};

type DraftItem = {
  saidaItemId: number;
  entradaItemOrigemId: number | null;
  numeroItemReferenciado: number | null;
  percentualDevolucao: number;
  valorIpiDevolvido: number;
};

type NfeResumo = {
  id: number;
  numero: number;
  serie: number;
  status: string;
  chave_acesso?: string | null;
  total_nfe?: number | null;
  motivo_rejeicao?: string | null;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function recipientFromResponse(
  value: FiscalResponse["destinatario"],
): NFeEntrySupplierDraft {
  return {
    ...emptyEntrySupplier,
    ...(value ?? {}),
    fornecedorId: Number(value?.fornecedorId ?? 0) || null,
    tipoPessoa: value?.tipoPessoa ?? emptyEntrySupplier.tipoPessoa,
  };
}

function supplierToRecipient(fornecedor: Fornecedor): NFeEntrySupplierDraft {
  const documento = onlyDigits(fornecedor.cpfcnpj);
  return {
    ...emptyEntrySupplier,
    fornecedorId: Number(fornecedor.id),
    tipoPessoa: documento.length === 11 ? "FISICA" : "JURIDICA",
    cpfCnpj: documento,
    nomeRazaoSocial: fornecedor.nomerazaosocial || fornecedor.nomefantasia || "",
    telefone: fornecedor.contato || "",
    endereco: fornecedor.endereco || "",
    numero: fornecedor.endereconumero || "",
    complemento: fornecedor.enderecocomplemento || "",
    bairro: fornecedor.bairro || "",
    cidade: fornecedor.cidade || "",
    estado: String(fornecedor.estado || "").toUpperCase(),
    cep: onlyDigits(fornecedor.cep),
    codigoMunicipio: onlyDigits(fornecedor.codigomunicipio),
  };
}

function statusTone(status: string) {
  if (status === "AUTORIZADA") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "REJEITADA" || status === "DENEGADA") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

export function SaidaNfeActions({ saidaId }: { saidaId: number }) {
  const [contextOpen, setContextOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierSelectOpen, setSupplierSelectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FiscalResponse | null>(null);
  const [notes, setNotes] = useState<NfeResumo[]>([]);
  const [editingNfeId, setEditingNfeId] = useState<number | null>(null);
  const [operationCode, setOperationCode] = useState("DEVOLUCAO_COMPRA_COMERCIALIZACAO");
  const [nature, setNature] = useState("");
  const [purpose, setPurpose] = useState("NORMAL");
  const [requiresReference, setRequiresReference] = useState(false);
  const [referenceKey, setReferenceKey] = useState("");
  const [observations, setObservations] = useState("");
  const [recipient, setRecipient] = useState<NFeEntrySupplierDraft>(emptyEntrySupplier);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);

  const loadNotes = useCallback(async () => {
    const response = await fetch(`/api/nfe/por-saida/${saidaId}`, { cache: "no-store" });
    const json = await response.json().catch(() => null);
    if (response.ok && json?.ok) setNotes(json.nfes ?? []);
  }, [saidaId]);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/estoque/saidas/${saidaId}/fiscal`, { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as FiscalResponse | null;
      if (!response.ok || !json?.ok) throw new Error(json?.message || "Não foi possível preparar a emissão.");
      setData(json);
      const context = json.contexto;
      const code = context?.operacao_fiscal_codigo || "DEVOLUCAO_COMPRA_COMERCIALIZACAO";
      const operation = json.operacoes.find((item) => item.codigo === code);
      setOperationCode(code);
      setNature(context?.natureza_operacao || operation?.naturezaOperacao || "");
      setPurpose(context?.finalidade || operation?.finalidade || "NORMAL");
      setRequiresReference(
        context?.documento_referenciado_obrigatorio ?? operation?.exigeDocumentoReferenciado ?? false,
      );
      setReferenceKey(context?.chave_acesso_referenciada || "");
      setObservations(context?.observacoes_fiscais || "");
      setRecipient(recipientFromResponse(json.destinatario));
      const mapping = new Map((context?.itens ?? []).map((item) => [Number(item.saida_item_id), item]));
      setDraftItems(json.saida.itens.map((item) => {
        const existing = mapping.get(Number(item.id));
        return {
          saidaItemId: Number(item.id),
          entradaItemOrigemId: existing?.entrada_item_origem_id
            ? Number(existing.entrada_item_origem_id)
            : null,
          numeroItemReferenciado: existing?.numero_item_referenciado
            ? Number(existing.numero_item_referenciado)
            : null,
          percentualDevolucao: Number(existing?.percentual_devolucao ?? 100),
          valorIpiDevolvido: Number(existing?.valor_ipi_devolvido ?? 0),
        };
      }));
    } catch (requestError: any) {
      setError(requestError?.message || "Erro ao preparar a emissão.");
    } finally {
      setLoading(false);
    }
  }, [saidaId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (contextOpen) void loadContext();
  }, [contextOpen, loadContext]);

  const operation = useMemo(
    () => data?.operacoes.find((item) => item.codigo === operationCode) ?? null,
    [data?.operacoes, operationCode],
  );
  const isCustom = operationCode === "OUTRA";
  const isReturn = (isCustom ? purpose : operation?.finalidade) === "DEVOLUCAO";
  const effectiveReference = isCustom ? requiresReference || isReturn : Boolean(operation?.exigeDocumentoReferenciado);

  function chooseOperation(code: string) {
    setOperationCode(code);
    const next = data?.operacoes.find((item) => item.codigo === code);
    if (next && code !== "OUTRA") {
      setNature(next.naturezaOperacao);
      setPurpose(next.finalidade);
      setRequiresReference(next.exigeDocumentoReferenciado);
    }
  }

  function updateDraftItem(saidaItemId: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) =>
      item.saidaItemId === saidaItemId ? { ...item, ...patch } : item,
    ));
  }

  function chooseEntry(saidaItemId: number, candidateId: string) {
    const entradaItemOrigemId = candidateId === "NONE" ? null : Number(candidateId);
    const candidate = data?.entradasCandidatas.find((item) => Number(item.id) === entradaItemOrigemId);
    const entrada = relationOne(candidate?.entrada);
    const fornecedor = relationOne(entrada?.fornecedor);
    const saidaItem = data?.saida.itens.find((item) => Number(item.id) === Number(saidaItemId));
    const percentualDevolucao = candidate && saidaItem && Number(candidate.quantidade) > 0
      ? Math.min(100, Number(((Number(saidaItem.quantidade) / Number(candidate.quantidade)) * 100).toFixed(4)))
      : 100;
    updateDraftItem(saidaItemId, { entradaItemOrigemId, percentualDevolucao });
    if (entrada?.notachave) setReferenceKey(onlyDigits(entrada.notachave));
    if (isReturn && fornecedor?.id && Number(fornecedor.id) !== recipient.fornecedorId) {
      setRecipient(supplierToRecipient(fornecedor));
    }
  }

  async function saveContext() {
    const recipientErrors = validateEntrySupplier(recipient);
    if (recipientErrors.length) {
      setError(`Complete os dados fiscais do fornecedor/destinatário. ${recipientErrors.join(" ")}`);
      toast.error("Complete os dados fiscais do fornecedor/destinatário.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/estoque/saidas/${saidaId}/fiscal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operacaoFiscalCodigo: operationCode,
          naturezaOperacao: nature,
          finalidade: purpose,
          documentoReferenciadoObrigatorio: requiresReference,
          chaveAcessoReferenciada: referenceKey,
          observacoesFiscais: observations,
          destinatario: {
            ...normalizeFiscalRecipient(recipient),
            fornecedorId: recipient.fornecedorId,
            clienteId: null,
          },
          itens: draftItems,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.message || "Não foi possível salvar o contexto fiscal.");
      toast.success("Contexto fiscal da saída salvo.");
      setContextOpen(false);
      setAssistantOpen(true);
    } catch (requestError: any) {
      setError(requestError?.message || "Erro ao salvar o contexto fiscal.");
    } finally {
      setSaving(false);
    }
  }

  const activeNote = notes.find((note) => ["RASCUNHO", "REJEITADA"].includes(note.status));
  const transmittedNote = notes.find((note) =>
    ["ASSINADA", "ENVIADA", "AUTORIZADA", "PENDENTE_ENVIO", "CONTINGENCIA", "RESULTADO_INCERTO"].includes(note.status),
  );

  return (
    <>
      <div className="space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-semibold"><ReceiptText className="size-4" /> NF-e desta saída</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A natureza fiscal é escolhida aqui; o motivo do estoque não classifica a operação automaticamente.
            </p>
          </div>
          <Button
            type="button"
            disabled={Boolean(transmittedNote)}
            onClick={() => {
              setEditingNfeId(activeNote?.id ?? null);
              setContextOpen(true);
            }}
          >
            {activeNote ? "Revisar emissão" : transmittedNote ? "NF-e já transmitida" : "Preparar NF-e de saída"}
          </Button>
        </div>

        {notes.map((note) => (
          <div key={note.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">NF-e nº {note.numero}, série {note.serie}</span>
                <Badge variant="outline" className={statusTone(note.status)}>{note.status}</Badge>
              </div>
              {note.motivo_rejeicao ? <p className="mt-1 text-xs text-destructive">{note.motivo_rejeicao}</p> : null}
              {note.chave_acesso ? <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{note.chave_acesso}</p> : null}
            </div>
            <div className="flex gap-2">
              {note.status === "REJEITADA" ? (
                <Button type="button" variant="outline" onClick={() => {
                  setEditingNfeId(note.id);
                  setAssistantOpen(true);
                }}>
                  Corrigir
                </Button>
              ) : null}
              {note.status === "RASCUNHO" ? (
                <AutorizarNfeButton nfeId={note.id} onAfterAuthorize={() => void loadNotes()}>
                  Autorizar NF-e
                </AutorizarNfeButton>
              ) : null}
            </div>
          </div>
        ))}

        {!notes.length ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Nenhuma NF-e foi gerada para esta saída.
          </p>
        ) : null}
      </div>

      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Emitir NF-e da saída #{saidaId}</DialogTitle>
            <DialogDescription>
              Complete o fornecedor/destinatário, a natureza fiscal e o documento recebido antes de revisar a tributação.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando contexto fiscal...
            </div>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Não foi possível continuar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!loading && data ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Natureza fiscal da saída</Label>
                <Select value={operationCode} onValueChange={chooseOperation}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data.operacoes.map((item) => (
                      <SelectItem key={item.codigo} value={item.codigo}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  CFOPs são sugeridos conforme UF e devem ser conferidos com a contabilidade.
                </p>
              </div>

              {isCustom ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Natureza da operação</Label>
                    <Input value={nature} onChange={(event) => setNature(event.target.value)} maxLength={60} />
                  </div>
                  <div className="space-y-2">
                    <Label>Finalidade da NF-e</Label>
                    <Select value={purpose} onValueChange={setPurpose}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NORMAL">Normal</SelectItem>
                        <SelectItem value="COMPLEMENTAR">Complementar</SelectItem>
                        <SelectItem value="AJUSTE">Ajuste</SelectItem>
                        <SelectItem value="DEVOLUCAO">Devolução</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3 pt-6">
                    <Switch checked={requiresReference} onCheckedChange={setRequiresReference} />
                    <Label>Exige documento fiscal de origem</Label>
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <Building2 className="size-4" /> Fornecedor/destinatário
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {recipient.nomeRazaoSocial
                        ? `${recipient.nomeRazaoSocial}${recipient.cpfCnpj ? ` · ${recipient.cpfCnpj}` : ""}`
                        : "Selecione o fornecedor da devolução ou informe um destinatário avulso."}
                    </p>
                  </div>
                  <FornecedorSelect
                    open={supplierSelectOpen}
                    setOpen={setSupplierSelectOpen}
                    OnSelect={(fornecedor) => setRecipient(supplierToRecipient(fornecedor))}
                  >
                    <Button type="button" variant="outline">
                      {recipient.fornecedorId ? "Trocar fornecedor" : "Selecionar fornecedor"}
                    </Button>
                  </FornecedorSelect>
                </div>

                <NfeEntrySupplierEditor
                  value={recipient}
                  onChange={setRecipient}
                  title="Dados fiscais do destinatário"
                  description="O cadastro preenche o que estiver disponível. Complete aqui os dados faltantes usados nesta NF-e."
                  linkedLabel="Fornecedor selecionado"
                  unlinkedLabel="Destinatário avulso"
                />
              </div>

              {effectiveReference ? (
                <div className="space-y-2">
                  <Label>Chave de acesso referenciada</Label>
                  <Input
                    value={referenceKey}
                    onChange={(event) => setReferenceKey(onlyDigits(event.target.value).slice(0, 44))}
                    inputMode="numeric"
                    maxLength={44}
                    placeholder="44 dígitos"
                  />
                </div>
              ) : null}

              <div className="space-y-3">
                {data.saida.itens.map((saidaItem) => {
                  const draft = draftItems.find((item) => item.saidaItemId === Number(saidaItem.id));
                  const candidates = data.entradasCandidatas.filter(
                    (candidate) => Number(candidate.produto_id) === Number(saidaItem.produto_id),
                  );
                  return (
                    <div key={saidaItem.id} className="space-y-3 rounded-md border p-3">
                      <div>
                        <p className="font-medium">{saidaItem.produto?.titulo || `Produto #${saidaItem.produto_id}`}</p>
                        <p className="text-xs text-muted-foreground">Quantidade baixada: {saidaItem.quantidade}</p>
                      </div>
                      {effectiveReference ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2 sm:col-span-2">
                            <Label>Entrada fiscal de origem</Label>
                            <Select
                              value={draft?.entradaItemOrigemId ? String(draft.entradaItemOrigemId) : "NONE"}
                              onValueChange={(value) => chooseEntry(saidaItem.id, value)}
                            >
                              <SelectTrigger><SelectValue placeholder="Selecione a entrada" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">Selecione...</SelectItem>
                                {candidates.map((candidate) => {
                                  const entrada = relationOne(candidate.entrada);
                                  const fornecedor = relationOne(entrada?.fornecedor);
                                  return (
                                    <SelectItem key={candidate.id} value={String(candidate.id)}>
                                      Entrada #{candidate.entrada_id} · {fornecedor?.nomerazaosocial || "Fornecedor"}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Nº do item na NF-e recebida</Label>
                            <Input
                              type="number"
                              min={1}
                              max={990}
                              value={draft?.numeroItemReferenciado ?? ""}
                              onChange={(event) => updateDraftItem(saidaItem.id, {
                                numeroItemReferenciado: event.target.value ? Number(event.target.value) : null,
                              })}
                            />
                          </div>
                          {isReturn ? (
                            <>
                              <div className="space-y-2">
                                <Label>Percentual devolvido</Label>
                                <Input
                                  type="number"
                                  min={0.01}
                                  max={100}
                                  step="0.01"
                                  value={draft?.percentualDevolucao ?? 100}
                                  onChange={(event) => updateDraftItem(saidaItem.id, {
                                    percentualDevolucao: Number(event.target.value),
                                  })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>IPI devolvido (R$)</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={draft?.valorIpiDevolvido ?? 0}
                                  onChange={(event) => updateDraftItem(saidaItem.id, {
                                    valorIpiDevolvido: Number(event.target.value),
                                  })}
                                />
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <Label>Informações fiscais adicionais</Label>
                <Textarea value={observations} onChange={(event) => setObservations(event.target.value)} maxLength={500} />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setContextOpen(false)}>Cancelar</Button>
            <Button type="button" disabled={loading || saving || !data} onClick={() => void saveContext()}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileCheck2 className="mr-2 size-4" />}
              Continuar para tributação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GerarNotaDeOsDialog
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        saidaId={saidaId}
        nfeId={editingNfeId ?? (activeNote?.status === "REJEITADA" ? activeNote.id : null)}
        onAfterGenerate={() => {
          setEditingNfeId(null);
          void loadNotes();
        }}
      />
    </>
  );
}
