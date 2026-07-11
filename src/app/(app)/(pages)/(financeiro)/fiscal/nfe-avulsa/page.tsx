"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios, { isAxiosError } from "axios";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import formatarEmReal from "@/utils/formatarEmReal";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import ProductSelect from "@/app/(app)/components/productSelect";
import type { Customer } from "@/app/(app)/(pages)/clientes/types";
import type { Produto } from "@/app/(app)/(pages)/estoque/types";

type ClienteSetup = {
  id: number;
  nomerazaosocial: string;
  cpfcnpj: string;
  cidade?: string | null;
  estado?: string | null;
};

type ProdutoSetup = {
  id: number;
  titulo: string;
  descricao?: string | null;
  precovenda: number;
  ncm?: string | null;
  cfop?: string | null;
  unidade?: string | null;
  csosn?: string | null;
  cst?: string | null;
  aliquotaicms?: number | null;
  cst_pis?: string | null;
  aliquota_pis?: number | null;
  cst_cofins?: string | null;
  aliquota_cofins?: number | null;
  cest?: string | null;
};

type SetupResponse = {
  empresa: {
    id: number;
    razaosocial: string;
    nomefantasia?: string | null;
    cnpj: string;
    ambiente?: string | null;
    uf?: string | null;
    codigomunicipio?: string | null;
    regimetributario?: string | number | null;
  } | null;
  config: {
    id: number;
    serie: number;
    ultimo_numero: number;
    ambiente: string;
  } | null;
  empresaErros: string[];
  certificadoStatus: string;
  clientes: ClienteSetup[];
  produtos: ProdutoSetup[];
  unidades: string[];
};

type DraftItem = {
  produtoId: number | null;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  csosn: string;
  cst: string;
  aliquotaIcms: string;
  cstPis: string;
  aliquotaPis: string;
  cstCofins: string;
  aliquotaCofins: string;
  cest: string;
};

type DraftPayload = {
  nfeId: number | null;
  currentStep: number;
  operacao: {
    tipoOperacao: "SAIDA" | "ENTRADA";
    naturezaOperacao: string;
    finalidade: "NORMAL" | "COMPLEMENTAR" | "AJUSTE" | "DEVOLUCAO";
    consumidorFinal: boolean;
    indicadorPresenca: string;
    observacaoInterna: string;
    observacoesFiscais: string;
  };
  destinatario: {
    clienteId: number | null;
    tipoPessoa: "FISICA" | "JURIDICA" | "ESTRANGEIRO";
    cpfCnpj: string;
    nomeRazaoSocial: string;
    indicadorIe: string;
    inscricaoEstadual: string;
    inscricaoMunicipal: string;
    email: string;
    telefone: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
    codigoMunicipio: string;
    codigoPais: string;
    nomePais: string;
  };
  itens: DraftItem[];
};

type ValidationError = {
  step: string;
  field?: string;
  itemIndex?: number;
  message: string;
};

const storageKey = "fiscal:nfe-avulsa:draft";

const steps = [
  "Operação",
  "Emitente",
  "Destinatário",
  "Produtos e tributação",
  "Transporte",
  "Pagamento",
  "Informações",
  "Revisão",
  "Autorização",
];

const emptyItem: DraftItem = {
  produtoId: null,
  codigo: "",
  descricao: "",
  ncm: "",
  cfop: "5102",
  unidade: "UN",
  quantidade: "1",
  valorUnitario: "0",
  csosn: "102",
  cst: "",
  aliquotaIcms: "",
  cstPis: "07",
  aliquotaPis: "0",
  cstCofins: "07",
  aliquotaCofins: "0",
  cest: "",
};

const initialDraft: DraftPayload = {
  nfeId: null,
  currentStep: 0,
  operacao: {
    tipoOperacao: "SAIDA",
    naturezaOperacao: "VENDA DE MERCADORIA",
    finalidade: "NORMAL",
    consumidorFinal: true,
    indicadorPresenca: "1",
    observacaoInterna: "",
    observacoesFiscais: "",
  },
  destinatario: {
    clienteId: null,
    tipoPessoa: "JURIDICA",
    cpfCnpj: "",
    nomeRazaoSocial: "",
    indicadorIe: "9",
    inscricaoEstadual: "",
    inscricaoMunicipal: "",
    email: "",
    telefone: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    cep: "",
    codigoMunicipio: "",
    codigoPais: "1058",
    nomePais: "BRASIL",
  },
  itens: [{ ...emptyItem }],
};

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function parseCurrency(value: string) {
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCpfCnpj(value?: string | null) {
  const digits = onlyDigits(String(value ?? ""));
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value || "-";
}

function formatAmbiente(value?: string | null) {
  if (value === "PRODUCAO") return "Produção";
  if (value === "HOMOLOGACAO") return "Homologação";
  return value || "-";
}

function normalizePersistedDraft(value: unknown): DraftPayload | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<DraftPayload>;
  if (!draft.operacao || !draft.destinatario || !Array.isArray(draft.itens)) return null;
  return {
    ...initialDraft,
    ...draft,
    nfeId: draft.nfeId ?? null,
    currentStep: Number(draft.currentStep ?? 0),
    operacao: {
      ...initialDraft.operacao,
      ...draft.operacao,
    },
    destinatario: {
      ...initialDraft.destinatario,
      ...draft.destinatario,
    },
    itens: draft.itens.length > 0 ? draft.itens.map((item) => ({ ...emptyItem, ...item })) : [{ ...emptyItem }],
  };
}

export default function NFeAvulsaPage() {
  const router = useRouter();
  const [setup, setSetup] = React.useState<SetupResponse | null>(null);
  const [draft, setDraft] = React.useState<DraftPayload>(initialDraft);
  const [errors, setErrors] = React.useState<ValidationError[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [authorizing, setAuthorizing] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [openCustomerSelect, setOpenCustomerSelect] = React.useState(false);
  const [openProductSelect, setOpenProductSelect] = React.useState(false);

  const totalProdutos = React.useMemo(
    () =>
      draft.itens.reduce(
        (sum, item) => sum + parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario),
        0,
      ),
    [draft.itens],
  );

  const selectedClienteLabel = draft.destinatario.clienteId
    ? `${draft.destinatario.nomeRazaoSocial || "Cliente selecionado"} - ${formatCpfCnpj(draft.destinatario.cpfCnpj)}`
    : null;
  const ambienteLabel = formatAmbiente(setup?.empresa?.ambiente || setup?.config?.ambiente);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = normalizePersistedDraft(JSON.parse(stored));
        if (parsed) setDraft(parsed);
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }

    async function loadSetup() {
      setLoading(true);
      try {
        const response = await axios.get<SetupResponse>("/api/fiscal/nfe-avulsa/setup");
        setSetup(response.data);
      } catch (error) {
        const description = isAxiosError(error)
          ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
          : "Erro ao carregar dados fiscais.";
        toast.error("Erro ao abrir emissão avulsa", { description });
      } finally {
        setLoading(false);
      }
    }

    void loadSetup();
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft]);

  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function updateDraft(updater: (current: DraftPayload) => DraftPayload) {
    setDraft((current) => updater(current));
    setDirty(true);
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    updateDraft((current) => ({
      ...current,
      itens: current.itens.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  }

  function addItemAvulso() {
    updateDraft((current) => ({ ...current, itens: [...current.itens, { ...emptyItem }] }));
  }

  function addItemFromProduct(produto: Produto) {
    updateDraft((current) => ({
      ...current,
      itens: [
        ...current.itens,
        {
          ...emptyItem,
          produtoId: produto.id ?? null,
          codigo: String(produto.referencia ?? produto.codigobarras ?? produto.id ?? ""),
          descricao: produto.descricao || produto.titulo || String(produto.id ?? ""),
          ncm: onlyDigits(produto.ncm ?? ""),
          cfop: onlyDigits(produto.cfop ?? "") || "5102",
          unidade: produto.unidade || "UN",
          valorUnitario: String(produto.precovenda ?? 0),
          csosn: produto.csosn || "102",
          cst: produto.cst || "",
          aliquotaIcms: produto.aliquotaicms == null ? "" : String(produto.aliquotaicms),
          cstPis: produto.cst_pis || "07",
          aliquotaPis: produto.aliquota_pis == null ? "0" : String(produto.aliquota_pis),
          cstCofins: produto.cst_cofins || "07",
          aliquotaCofins: produto.aliquota_cofins == null ? "0" : String(produto.aliquota_cofins),
          cest: produto.cest || "",
        },
      ],
    }));
    toast.success("Produto adicionado à NF-e");
  }

  function removeItem(index: number) {
    updateDraft((current) => ({
      ...current,
      itens: current.itens.length === 1 ? [{ ...emptyItem }] : current.itens.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function preencherDestinatarioComCliente(cliente: Customer) {
    updateDraft((current) => ({
      ...current,
      destinatario: {
        ...current.destinatario,
        clienteId: cliente.id,
        tipoPessoa: cliente.tipopessoa === "FISICA" ? "FISICA" : "JURIDICA",
        cpfCnpj: cliente.cpfcnpj ?? "",
        nomeRazaoSocial: cliente.nomerazaosocial ?? "",
        indicadorIe: cliente.inscricaoestadual ? "1" : "9",
        inscricaoEstadual: cliente.inscricaoestadual ?? "",
        inscricaoMunicipal: cliente.inscricaomunicipal ?? "",
        email: cliente.email ?? "",
        telefone: cliente.telefone ?? "",
        endereco: cliente.endereco ?? "",
        numero: cliente.endereconumero ?? "",
        complemento: cliente.enderecocomplemento ?? "",
        bairro: cliente.bairro ?? "",
        cidade: cliente.cidade ?? "",
        estado: cliente.estado ?? "",
        cep: cliente.cep ?? "",
        codigoMunicipio: cliente.codigomunicipio ?? "",
        codigoPais: "1058",
        nomePais: "BRASIL",
      },
    }));
  }

  function tornarDestinatarioAvulso() {
    updateDraft((current) => ({
      ...current,
      destinatario: {
        ...current.destinatario,
        clienteId: null,
      },
    }));
  }

  async function salvarRascunho(goNext = false) {
    setSaving(true);
    setErrors([]);
    try {
      const response = draft.nfeId
        ? await axios.patch(`/api/fiscal/nfe-avulsa/drafts/${draft.nfeId}`, draft)
        : await axios.post("/api/fiscal/nfe-avulsa/drafts", draft);

      const nfeId = Number(response.data?.nfeId);
      setDraft((current) => ({
        ...current,
        nfeId: Number.isFinite(nfeId) ? nfeId : current.nfeId,
        currentStep: goNext ? Math.min(current.currentStep + 1, steps.length - 1) : current.currentStep,
      }));
      setDirty(false);
      toast.success("Rascunho salvo", {
        description: response.data?.chave ? `Chave gerada: ${response.data.chave}` : undefined,
      });
    } catch (error) {
      if (isAxiosError(error) && Array.isArray(error.response?.data?.errors)) {
        setErrors(error.response.data.errors);
        toast.error("Existem campos pendentes para salvar o rascunho.");
      } else {
        const description = isAxiosError(error)
          ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
          : "Erro ao salvar rascunho.";
        toast.error("Falha ao salvar rascunho", { description });
      }
    } finally {
      setSaving(false);
    }
  }

  async function salvarEContinuar() {
    const hasDestinatario =
      draft.destinatario.nomeRazaoSocial.trim() &&
      onlyDigits(draft.destinatario.cpfCnpj).length >= 11 &&
      draft.destinatario.endereco.trim() &&
      draft.destinatario.cidade.trim() &&
      draft.destinatario.estado.trim();
    const hasValidItem = draft.itens.some(
      (item) =>
        item.descricao.trim() &&
        onlyDigits(item.ncm).length === 8 &&
        onlyDigits(item.cfop).length === 4 &&
        parseCurrency(item.quantidade) > 0 &&
        parseCurrency(item.valorUnitario) > 0,
    );

    if (!draft.nfeId && (!hasDestinatario || !hasValidItem) && currentStep < 8) {
      updateDraft((current) => ({
        ...current,
        currentStep: Math.min(current.currentStep + 1, steps.length - 1),
      }));
      toast.success("Rascunho local salvo", {
        description: "O registro fiscal será gravado no banco quando cliente e item estiverem completos.",
      });
      return;
    }

    await salvarRascunho(true);
  }

  async function descartarRascunho() {
    if (!window.confirm("Descartar este rascunho de NF-e?")) return;

    try {
      if (draft.nfeId) {
        await axios.delete(`/api/fiscal/nfe-avulsa/drafts/${draft.nfeId}`);
      }
      window.localStorage.removeItem(storageKey);
      setDraft(initialDraft);
      setDirty(false);
      toast.success("Rascunho descartado");
      router.push("/fiscal");
    } catch (error) {
      const description = isAxiosError(error)
        ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
        : "Erro ao descartar rascunho.";
      toast.error("Falha ao descartar", { description });
    }
  }

  async function autorizar() {
    if (!draft.nfeId) {
      await salvarRascunho(false);
      return;
    }
    if (!window.confirm("Transmitir esta NF-e para a SEFAZ?")) return;

    setAuthorizing(true);
    const toastId = toast.loading("Transmitindo NF-e para a SEFAZ...");
    try {
      await salvarRascunho(false);
      const response = await axios.post(
        `/api/fiscal/nfe-avulsa/drafts/${draft.nfeId}/authorize`,
        {},
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      const protocolo = response.data?.sefaz?.protocolo;
      const motivo = protocolo?.xMotivo ?? response.data?.mensagem ?? "Retorno recebido da SEFAZ.";
      toast.success("Transmissão concluída", { id: toastId, description: motivo });
      if (response.data?.nfeDb?.status === "AUTORIZADA") {
        window.localStorage.removeItem(storageKey);
      }
    } catch (error) {
      const description = isAxiosError(error)
        ? error.response?.data?.detalhe ??
          error.response?.data?.detail ??
          error.response?.data?.mensagem ??
          error.response?.data?.error ??
          error.message
        : "Erro ao transmitir NF-e.";
      toast.error("Falha na autorização", { id: toastId, description });
    } finally {
      setAuthorizing(false);
    }
  }

  const currentStep = Math.min(Math.max(draft.currentStep, 0), steps.length - 1);

  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando emissão avulsa...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            <h1 className="text-2xl font-semibold tracking-tight">Emitir NF-e Avulsa</h1>
            <Badge variant="outline">Ambiente: {ambienteLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            NF-e modelo 55 criada manualmente, sem vínculo obrigatório com venda ou OS.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/fiscal">Sair</Link>
          </Button>
          <Button variant="outline" onClick={descartarRascunho}>
            <Trash2 className="h-4 w-4" />
            Descartar rascunho
          </Button>
          <Button variant="outline" onClick={() => salvarRascunho(false)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar rascunho
          </Button>
        </div>
      </div>

      {setup?.empresaErros && setup.empresaErros.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Pré-validação da empresa incompleta</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {setup.empresaErros.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Validações pendentes</AlertTitle>
          <AlertDescription>{errors.map((error) => error.message).join(" ")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap gap-2">
              {steps.map((step, index) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => updateDraft((current) => ({ ...current, currentStep: index }))}
                  className={`h-8 rounded-md border px-3 text-xs transition ${
                    index === currentStep
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {index + 1}. {step}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {currentStep === 0 && (
              <section className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo de operação">
                  <Select
                    value={draft.operacao.tipoOperacao}
                    onValueChange={(value: "SAIDA" | "ENTRADA") =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, tipoOperacao: value },
                      }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SAIDA">Saída</SelectItem>
                      <SelectItem value="ENTRADA">Entrada</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Finalidade">
                  <Select
                    value={draft.operacao.finalidade}
                    onValueChange={(value: DraftPayload["operacao"]["finalidade"]) =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, finalidade: value },
                      }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="COMPLEMENTAR">Complementar</SelectItem>
                      <SelectItem value="AJUSTE">Ajuste</SelectItem>
                      <SelectItem value="DEVOLUCAO">Devolução ou retorno</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Natureza da operação">
                  <Input
                    value={draft.operacao.naturezaOperacao}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, naturezaOperacao: event.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Indicador de presença">
                  <Select
                    value={draft.operacao.indicadorPresenca}
                    onValueChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, indicadorPresenca: value },
                      }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Operação presencial</SelectItem>
                      <SelectItem value="2">Internet</SelectItem>
                      <SelectItem value="3">Teleatendimento</SelectItem>
                      <SelectItem value="4">NFC-e entrega em domicílio</SelectItem>
                      <SelectItem value="9">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Consumidor final">
                  <Select
                    value={draft.operacao.consumidorFinal ? "SIM" : "NAO"}
                    onValueChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, consumidorFinal: value === "SIM" },
                      }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SIM">Sim</SelectItem>
                      <SelectItem value="NAO">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Observação interna">
                  <Input
                    value={draft.operacao.observacaoInterna}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, observacaoInterna: event.target.value },
                      }))
                    }
                  />
                </Field>
              </section>
            )}

            {currentStep === 1 && (
              <section className="grid gap-3 md:grid-cols-2">
                <Info label="Empresa" value={setup?.empresa?.razaosocial} />
                <Info label="CNPJ" value={formatCpfCnpj(setup?.empresa?.cnpj)} />
                <Info label="Série" value={setup?.config?.serie} />
                <Info label="UF" value={setup?.empresa?.uf} />
                <Info label="CRT" value={setup?.empresa?.regimetributario} />
                <Info label="Certificado" value={setup?.certificadoStatus} className="md:col-span-2" />
              </section>
            )}

            {currentStep === 2 && (
              <section className="space-y-4">
                <CustomerSelect
                  open={openCustomerSelect}
                  setOpen={setOpenCustomerSelect}
                  OnSelect={preencherDestinatarioComCliente}
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button type="button" variant="outline" onClick={() => setOpenCustomerSelect(true)}>
                    Selecionar cliente
                  </Button>
                  {selectedClienteLabel ? (
                    <Badge variant="secondary" className="w-fit">
                      {selectedClienteLabel}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="w-fit">
                      Destinatário avulso
                    </Badge>
                  )}
                  {draft.destinatario.clienteId && (
                    <Button type="button" variant="ghost" onClick={tornarDestinatarioAvulso}>
                      Usar como avulso
                    </Button>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Tipo de pessoa">
                    <Select
                      value={draft.destinatario.tipoPessoa}
                      onValueChange={(value: DraftPayload["destinatario"]["tipoPessoa"]) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, tipoPessoa: value },
                        }))
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="JURIDICA">Pessoa jurídica</SelectItem>
                        <SelectItem value="FISICA">Pessoa física</SelectItem>
                        <SelectItem value="ESTRANGEIRO">Estrangeiro</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="CPF/CNPJ">
                    <Input
                      value={draft.destinatario.cpfCnpj}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, cpfCnpj: onlyDigits(event.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Nome/Razão social">
                    <Input
                      value={draft.destinatario.nomeRazaoSocial}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, nomeRazaoSocial: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Indicador IE">
                    <Select
                      value={draft.destinatario.indicadorIe}
                      onValueChange={(value) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, indicadorIe: value },
                        }))
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Contribuinte ICMS</SelectItem>
                        <SelectItem value="2">Contribuinte isento</SelectItem>
                        <SelectItem value="9">Não contribuinte</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Inscrição estadual">
                    <Input
                      value={draft.destinatario.inscricaoEstadual}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, inscricaoEstadual: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      value={draft.destinatario.email}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, email: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Telefone">
                    <Input
                      value={draft.destinatario.telefone}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, telefone: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Endereço">
                    <Input
                      value={draft.destinatario.endereco}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, endereco: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Número">
                    <Input
                      value={draft.destinatario.numero}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, numero: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Complemento">
                    <Input
                      value={draft.destinatario.complemento}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, complemento: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Bairro">
                    <Input
                      value={draft.destinatario.bairro}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, bairro: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Cidade">
                    <Input
                      value={draft.destinatario.cidade}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, cidade: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="UF">
                    <Input
                      value={draft.destinatario.estado}
                      maxLength={2}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, estado: event.target.value.toUpperCase() },
                        }))
                      }
                    />
                  </Field>
                  <Field label="CEP">
                    <Input
                      value={draft.destinatario.cep}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, cep: onlyDigits(event.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Código IBGE do município">
                    <Input
                      value={draft.destinatario.codigoMunicipio}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, codigoMunicipio: onlyDigits(event.target.value) },
                        }))
                      }
                    />
                  </Field>
                </div>
              </section>
            )}

            {currentStep === 3 && (
              <section className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <ProductSelect
                    open={openProductSelect}
                    setOpen={setOpenProductSelect}
                    OnSelect={addItemFromProduct}
                  >
                    <Button type="button">
                      <Plus className="h-4 w-4" />
                      Produto cadastrado
                    </Button>
                  </ProductSelect>
                  <Button type="button" variant="outline" onClick={addItemAvulso}>
                    <Plus className="h-4 w-4" />
                    Produto avulso
                  </Button>
                </div>

                <div className="space-y-3">
                  {draft.itens.map((item, index) => (
                    <Card key={index} className="border-dashed">
                      <CardContent className="grid gap-3 pt-4 md:grid-cols-12">
                        <div className="md:col-span-5">
                          <Label>Descrição</Label>
                          <Input value={item.descricao} onChange={(event) => updateItem(index, { descricao: event.target.value })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>NCM</Label>
                          <Input value={item.ncm} onChange={(event) => updateItem(index, { ncm: onlyDigits(event.target.value) })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>CFOP</Label>
                          <Input value={item.cfop} onChange={(event) => updateItem(index, { cfop: onlyDigits(event.target.value) })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>Unidade</Label>
                          <Select value={item.unidade} onValueChange={(value) => updateItem(index, { unidade: value })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(setup?.unidades ?? ["UN"]).map((unidade) => (
                                <SelectItem key={unidade} value={unidade}>{unidade}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-end md:col-span-1">
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="md:col-span-2">
                          <Label>Quantidade</Label>
                          <Input value={item.quantidade} onChange={(event) => updateItem(index, { quantidade: event.target.value })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>Valor unitário</Label>
                          <Input value={item.valorUnitario} onChange={(event) => updateItem(index, { valorUnitario: event.target.value })} />
                        </div>
                        <div className="md:col-span-3">
                          <Label>CEST</Label>
                          <Input value={item.cest} onChange={(event) => updateItem(index, { cest: onlyDigits(event.target.value) })} />
                        </div>
                        <Info
                          label="Total do item"
                          value={formatarEmReal(parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario))}
                          className="md:col-span-5"
                        />
                        <div className="md:col-span-12">
                          <Separator />
                        </div>
                        <p className="text-sm font-medium md:col-span-12">Tributação do item</p>
                        <Field label="CSOSN">
                          <Input value={item.csosn} onChange={(event) => updateItem(index, { csosn: event.target.value })} />
                        </Field>
                        <Field label="CST ICMS">
                          <Input value={item.cst} onChange={(event) => updateItem(index, { cst: event.target.value })} />
                        </Field>
                        <Field label="% ICMS">
                          <Input value={item.aliquotaIcms} onChange={(event) => updateItem(index, { aliquotaIcms: event.target.value })} />
                        </Field>
                        <Field label="CST PIS">
                          <Input value={item.cstPis} onChange={(event) => updateItem(index, { cstPis: event.target.value })} />
                        </Field>
                        <Field label="% PIS">
                          <Input value={item.aliquotaPis} onChange={(event) => updateItem(index, { aliquotaPis: event.target.value })} />
                        </Field>
                        <Field label="CST COFINS">
                          <Input value={item.cstCofins} onChange={(event) => updateItem(index, { cstCofins: event.target.value })} />
                        </Field>
                        <Field label="% COFINS">
                          <Input value={item.aliquotaCofins} onChange={(event) => updateItem(index, { aliquotaCofins: event.target.value })} />
                        </Field>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {currentStep === 4 && (
              <ReadOnlyStep
                title="Transporte"
                description="Esta primeira versão emite a NF-e avulsa com modalidade sem frete. Dados de transportadora e volumes ficam bloqueados até a parametrização fiscal específica."
              />
            )}

            {currentStep === 5 && (
              <ReadOnlyStep
                title="Pagamento"
                description="O XML atual usa pagamento em dinheiro pelo total da nota, reaproveitando o emissor existente. Formas múltiplas de pagamento serão parametrizadas em etapa posterior."
              />
            )}

            {currentStep === 6 && (
              <Field label="Informações complementares">
                <Textarea
                  value={draft.operacao.observacoesFiscais}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      operacao: { ...current.operacao, observacoesFiscais: event.target.value },
                    }))
                  }
                  rows={6}
                />
              </Field>
            )}

            {currentStep === 7 && (
              <section className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Info label="Operação" value={draft.operacao.naturezaOperacao} />
                  <Info label="Destinatário" value={draft.destinatario.nomeRazaoSocial || "Pendente"} />
                  <Info label="Total" value={formatarEmReal(totalProdutos)} />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>NCM</TableHead>
                      <TableHead>CFOP</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.itens.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell>{item.descricao || "-"}</TableCell>
                        <TableCell>{item.ncm || "-"}</TableCell>
                        <TableCell>{item.cfop || "-"}</TableCell>
                        <TableCell className="text-right">
                          {formatarEmReal(parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            {currentStep === 8 && (
              <section className="space-y-4">
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Pronto para autorização</AlertTitle>
                  <AlertDescription>
                    Salve o rascunho para gerar o XML de preview. Depois transmita para a SEFAZ usando o certificado A1 configurado.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-wrap gap-2">
                  {draft.nfeId && (
                    <>
                      <Button variant="outline" asChild>
                        <Link href={`/nfe/${draft.nfeId}/editor`} target="_blank">Visualizar XML</Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href={`/nfe/${draft.nfeId}/danfe`} target="_blank">Pré-visualizar DANFE</Link>
                      </Button>
                    </>
                  )}
                  <Button onClick={autorizar} disabled={authorizing || saving || (setup?.empresaErros?.length ?? 0) > 0}>
                    {authorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Transmitir para a SEFAZ
                  </Button>
                </div>
              </section>
            )}

            <Separator />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                onClick={() => updateDraft((current) => ({ ...current, currentStep: Math.max(current.currentStep - 1, 0) }))}
                disabled={currentStep === 0}
              >
                Voltar
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => salvarRascunho(false)} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar rascunho
                </Button>
                <Button onClick={salvarEContinuar} disabled={saving || currentStep === steps.length - 1}>
                  Salvar e continuar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Resumo da NF-e</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Modelo 55</Badge>
              <Badge variant="outline">Ambiente: {ambienteLabel}</Badge>
              <Badge variant="outline">Série {setup?.config?.serie ?? "-"}</Badge>
              {dirty && <Badge variant="secondary">Alterações não salvas</Badge>}
            </div>
            <Info label="Empresa" value={setup?.empresa?.nomefantasia || setup?.empresa?.razaosocial} />
            <Info label="Certificado" value={setup?.certificadoStatus} />
            <Info label="Destinatário" value={draft.destinatario.nomeRazaoSocial || "Pendente"} />
            <Info label="Itens" value={draft.itens.length} />
            <Info label="Total dos produtos" value={formatarEmReal(totalProdutos)} />
            <Info label="Status do documento" value={draft.nfeId ? `Rascunho #${draft.nfeId}` : "Não salvo"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Info({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border bg-muted/20 p-3 ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

function ReadOnlyStep({ title, description }: { title: string; description: string }) {
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
