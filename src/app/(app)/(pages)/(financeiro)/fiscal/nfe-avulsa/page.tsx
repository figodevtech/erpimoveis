"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import axios, { isAxiosError } from "axios";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Download,
  Loader2,
  Plus,
  Printer,
  Save,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { NFE_HOMOLOGACAO_DESTINATARIO_NOME } from "@/lib/nfe/constants";
import { DanfeView, type DanfeViewData } from "@/components/danfe/danfe-view";
import ValueInput from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";

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
    endereco?: string | null;
    numero?: string | null;
    bairro?: string | null;
    complemento?: string | null;
    cep?: string | null;
    telefone?: string | null;
    inscricaoestadual?: string | null;
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

type DraftTransporte = {
  modFrete: "0" | "1" | "2" | "3" | "4" | "9";
  transportadora: {
    documento: string;
    nome: string;
    inscricaoEstadual: string;
    endereco: string;
    municipio: string;
    uf: string;
  };
  veiculo: {
    placa: string;
    uf: string;
    rntc: string;
  };
  volume: {
    quantidade: string;
    especie: string;
    marca: string;
    numeracao: string;
    pesoLiquido: string;
    pesoBruto: string;
  };
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
  pagamento: {
    meio: string;
    tipoIntegracao: "1" | "2";
    cnpjCredenciadora: string;
    bandeira: string;
    autorizacao: string;
  };
  transporte: DraftTransporte;
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

type NFeDocumentState = {
  status: string | null;
  chave: string | null;
  protocolo: string | null;
  numero: number | null;
  serie: number | null;
  dataAutorizacao: string | null;
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

const paymentOptions = [
  { value: "01", label: "Dinheiro" },
  { value: "02", label: "Cheque" },
  { value: "03", label: "Cartão de crédito" },
  { value: "04", label: "Cartão de débito" },
  { value: "15", label: "Boleto bancário" },
  { value: "16", label: "Depósito bancário" },
  { value: "17", label: "PIX" },
  { value: "18", label: "Transferência bancária" },
  { value: "90", label: "Sem pagamento" },
  { value: "99", label: "Outros" },
];

const freightOptions = [
  { value: "0", label: "Contratação por conta do remetente (CIF)" },
  { value: "1", label: "Contratação por conta do destinatário (FOB)" },
  { value: "2", label: "Contratação por conta de terceiros" },
  { value: "3", label: "Transporte próprio por conta do remetente" },
  { value: "4", label: "Transporte próprio por conta do destinatário" },
  { value: "9", label: "Sem ocorrência de transporte" },
] as const;

const cardBrandOptions = [
  { value: "01", label: "Visa" },
  { value: "02", label: "Mastercard" },
  { value: "03", label: "American Express" },
  { value: "04", label: "Sorocred" },
  { value: "05", label: "Diners Club" },
  { value: "06", label: "Elo" },
  { value: "07", label: "Hipercard" },
  { value: "08", label: "Aura" },
  { value: "09", label: "Cabal" },
  { value: "99", label: "Outros" },
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
  pagamento: {
    meio: "01",
    tipoIntegracao: "2",
    cnpjCredenciadora: "",
    bandeira: "",
    autorizacao: "",
  },
  transporte: {
    modFrete: "9",
    transportadora: {
      documento: "",
      nome: "",
      inscricaoEstadual: "",
      endereco: "",
      municipio: "",
      uf: "",
    },
    veiculo: {
      placa: "",
      uf: "",
      rntc: "",
    },
    volume: {
      quantidade: "",
      especie: "",
      marca: "",
      numeracao: "",
      pesoLiquido: "",
      pesoBruto: "",
    },
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
  itens: [],
};

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function parseCurrency(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const sanitized = raw.replace(/[^\d,.-]/g, "");
  const normalized = sanitized.includes(",")
    ? sanitized.replace(/\./g, "").replace(",", ".")
    : sanitized;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumberInput(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCpfCnpj(value?: string | null) {
  const digits = onlyDigits(String(value ?? ""));
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value || "-";
}

function formatChaveAcesso(value?: string | null) {
  const digits = onlyDigits(String(value ?? ""));
  if (!digits) return "-";
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function formatAmbiente(value?: string | null) {
  if (value === "PRODUCAO") return "Produção";
  if (value === "HOMOLOGACAO") return "Homologação";
  return value || "-";
}

function getPaymentLabel(value?: string | null) {
  return paymentOptions.find((option) => option.value === value)?.label ?? value ?? "-";
}

function getFreightLabel(value?: string | null) {
  return freightOptions.find((option) => option.value === value)?.label ?? value ?? "-";
}

function normalizePagamento(value: unknown): DraftPayload["pagamento"] {
  const pagamento = value && typeof value === "object" ? (value as Partial<DraftPayload["pagamento"]>) : {};
  const meio = onlyDigits(String(pagamento.meio ?? ""));
  const tipoIntegracao = pagamento.tipoIntegracao === "1" ? "1" : "2";

  return {
    ...initialDraft.pagamento,
    ...pagamento,
    meio: meio ? meio.padStart(2, "0").slice(0, 2) : initialDraft.pagamento.meio,
    tipoIntegracao,
    cnpjCredenciadora: onlyDigits(String(pagamento.cnpjCredenciadora ?? "")),
    bandeira: onlyDigits(String(pagamento.bandeira ?? "")),
    autorizacao: String(pagamento.autorizacao ?? ""),
  };
}

function normalizeTransporte(value: unknown): DraftTransporte {
  const transporte = value && typeof value === "object" ? (value as Partial<DraftTransporte>) : {};
  const modFrete = ["0", "1", "2", "3", "4", "9"].includes(String(transporte.modFrete))
    ? String(transporte.modFrete) as DraftTransporte["modFrete"]
    : "9";

  return {
    modFrete,
    transportadora: {
      ...initialDraft.transporte.transportadora,
      ...(transporte.transportadora ?? {}),
      documento: onlyDigits(String(transporte.transportadora?.documento ?? "")),
      inscricaoEstadual: onlyDigits(String(transporte.transportadora?.inscricaoEstadual ?? "")),
      uf: String(transporte.transportadora?.uf ?? "").toUpperCase().slice(0, 2),
    },
    veiculo: {
      ...initialDraft.transporte.veiculo,
      ...(transporte.veiculo ?? {}),
      placa: String(transporte.veiculo?.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7),
      uf: String(transporte.veiculo?.uf ?? "").toUpperCase().slice(0, 2),
    },
    volume: {
      ...initialDraft.transporte.volume,
      ...(transporte.volume ?? {}),
    },
  };
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
    pagamento: normalizePagamento(draft.pagamento),
    transporte: normalizeTransporte(draft.transporte),
    destinatario: {
      ...initialDraft.destinatario,
      ...draft.destinatario,
    },
    itens: draft.itens.map((item) => ({ ...emptyItem, ...item })),
  };
}

function stringifyNumber(value: unknown, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function mapServerDraftToPayload(value: any): { draft: DraftPayload; document: NFeDocumentState } {
  const nfe = value?.nfe ?? {};
  const dadosAvulsos = nfe.dados_avulsos ?? {};
  const snapshot = nfe.destinatario_snapshot ?? {};
  const destinatarioOriginal = dadosAvulsos.destinatario ?? {};
  const operacaoOriginal = dadosAvulsos.operacao ?? {};
  const pagamentoOriginal = dadosAvulsos.pagamento ?? {};
  const transporteOriginal = dadosAvulsos.transporte ?? {};
  const itens = Array.isArray(value?.itens) ? value.itens : [];

  return {
    draft: {
      ...initialDraft,
      nfeId: Number(nfe.id) || null,
      currentStep: 0,
      operacao: {
        ...initialDraft.operacao,
        ...operacaoOriginal,
      },
      pagamento: normalizePagamento(pagamentoOriginal),
      transporte: normalizeTransporte(transporteOriginal),
      destinatario: {
        ...initialDraft.destinatario,
        ...destinatarioOriginal,
        clienteId: dadosAvulsos.clienteSelecionadoId ?? destinatarioOriginal.clienteId ?? null,
        cpfCnpj: destinatarioOriginal.cpfCnpj ?? snapshot.cnpj ?? snapshot.cpf ?? "",
        nomeRazaoSocial: destinatarioOriginal.nomeRazaoSocial ?? snapshot.razaoSocial ?? "",
        indicadorIe: destinatarioOriginal.indicadorIe ?? snapshot.indIEDest ?? "9",
        inscricaoEstadual: destinatarioOriginal.inscricaoEstadual ?? snapshot.inscricaoEstadual ?? "",
        endereco: destinatarioOriginal.endereco ?? snapshot.endereco?.logradouro ?? "",
        numero: destinatarioOriginal.numero ?? snapshot.endereco?.numero ?? "",
        complemento: destinatarioOriginal.complemento ?? snapshot.endereco?.complemento ?? "",
        bairro: destinatarioOriginal.bairro ?? snapshot.endereco?.bairro ?? "",
        cidade: destinatarioOriginal.cidade ?? snapshot.endereco?.nomeMunicipio ?? "",
        estado: destinatarioOriginal.estado ?? snapshot.endereco?.uf ?? "",
        cep: destinatarioOriginal.cep ?? snapshot.endereco?.cep ?? "",
        codigoMunicipio: destinatarioOriginal.codigoMunicipio ?? snapshot.endereco?.codigoMunicipio ?? "",
        codigoPais: destinatarioOriginal.codigoPais ?? snapshot.endereco?.codigoPais ?? "1058",
        nomePais: destinatarioOriginal.nomePais ?? snapshot.endereco?.nomePais ?? "BRASIL",
      },
      itens: itens.length
        ? itens.map((item: any) => ({
            ...emptyItem,
            produtoId: item.produtoid == null ? null : Number(item.produtoid),
            codigo: stringifyNumber(item.produtoid ?? item.n_item),
            descricao: String(item.descricao ?? ""),
            ncm: String(item.ncm ?? ""),
            cfop: String(item.cfop ?? ""),
            unidade: String(item.unidade ?? "UN"),
            quantidade: stringifyNumber(item.quantidade, "1"),
            valorUnitario: stringifyNumber(item.valor_unitario, "0"),
            csosn: String(item.csosn ?? ""),
            cst: String(item.cst ?? ""),
            aliquotaIcms: stringifyNumber(item.aliquotaicms),
            cstPis: String(item.cst_pis ?? ""),
            aliquotaPis: stringifyNumber(item.aliquota_pis),
            cstCofins: String(item.cst_cofins ?? ""),
            aliquotaCofins: stringifyNumber(item.aliquota_cofins),
            cest: String(item.cest ?? ""),
          }))
        : [],
    },
    document: {
      status: nfe.status ?? null,
      chave: nfe.chave_acesso ?? null,
      protocolo: nfe.protocolo ?? null,
      numero: nfe.numero == null ? null : Number(nfe.numero),
      serie: nfe.serie == null ? null : Number(nfe.serie),
      dataAutorizacao: nfe.dataautorizacao ?? null,
    },
  };
}

export default function NFeAvulsaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("id");
  const [setup, setSetup] = React.useState<SetupResponse | null>(null);
  const [draft, setDraft] = React.useState<DraftPayload>(initialDraft);
  const [documentState, setDocumentState] = React.useState<NFeDocumentState>({
    status: null,
    chave: null,
    protocolo: null,
    numero: null,
    serie: null,
    dataAutorizacao: null,
  });
  const [errors, setErrors] = React.useState<ValidationError[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [authorizing, setAuthorizing] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [openCustomerSelect, setOpenCustomerSelect] = React.useState(false);
  const [openProductSelect, setOpenProductSelect] = React.useState(false);
  const [confirmAuthorizeOpen, setConfirmAuthorizeOpen] = React.useState(false);

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
  const isHomologacao = Boolean(setup) && (setup?.empresa?.ambiente || setup?.config?.ambiente) !== "PRODUCAO";
  const isEditingPersistedDraft = Boolean(draft.nfeId);
  const isAutorizada = String(documentState.status ?? "").toUpperCase() === "AUTORIZADA";
  const isSemPagamentoObrigatorio =
    draft.operacao.finalidade === "AJUSTE" || draft.operacao.finalidade === "DEVOLUCAO";
  const meioPagamentoAtual = isSemPagamentoObrigatorio ? "90" : draft.pagamento.meio;
  const isPagamentoCartao = meioPagamentoAtual === "03" || meioPagamentoAtual === "04";
  const isSemTransporte = draft.transporte.modFrete === "9";
  const isFreteContratado = ["0", "1", "2"].includes(draft.transporte.modFrete);
  const isTransporteProprio = ["3", "4"].includes(draft.transporte.modFrete);
  const crtEmitente = String(setup?.empresa?.regimetributario ?? "");
  const isSimplesOuMei = crtEmitente === "1" || crtEmitente === "4";
  const isRegimeNormal = crtEmitente === "3";
  const isSublimite = crtEmitente === "2";
  const isDestinatarioExterior = draft.destinatario.tipoPessoa === "ESTRANGEIRO";

  React.useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      try {
        if (!draftIdParam) {
          const stored = window.localStorage.getItem(storageKey);
          if (stored) {
            try {
              const parsed = normalizePersistedDraft(JSON.parse(stored));
              if (parsed && !cancelled) setDraft(parsed);
            } catch {
              window.localStorage.removeItem(storageKey);
            }
          }
        }

        const response = await axios.get<SetupResponse>("/api/fiscal/nfe-avulsa/setup");
        if (!cancelled) setSetup(response.data);

        if (draftIdParam) {
          const draftResponse = await axios.get(`/api/fiscal/nfe-avulsa/drafts/${draftIdParam}`);
          const mapped = mapServerDraftToPayload(draftResponse.data);
          if (!cancelled) {
            setDraft(mapped.draft);
            setDocumentState(mapped.document);
            setDirty(false);
          }
        }
      } catch (error) {
        const description = isAxiosError(error)
          ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
          : "Erro ao carregar dados fiscais.";
        toast.error("Erro ao abrir emissão avulsa", { description });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [draftIdParam]);

  React.useEffect(() => {
    if (draftIdParam) return;
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, draftIdParam]);

  React.useEffect(() => {
    if (!isHomologacao || draft.destinatario.nomeRazaoSocial === NFE_HOMOLOGACAO_DESTINATARIO_NOME) return;

    setDraft((current) => ({
      ...current,
      destinatario: {
        ...current.destinatario,
        nomeRazaoSocial: NFE_HOMOLOGACAO_DESTINATARIO_NOME,
      },
    }));
  }, [draft.destinatario.nomeRazaoSocial, isHomologacao]);

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
            descricao: produto.titulo || produto.descricao || String(produto.id ?? ""),
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
      itens: current.itens.filter((_, itemIndex) => itemIndex !== index),
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
        nomeRazaoSocial: isHomologacao ? NFE_HOMOLOGACAO_DESTINATARIO_NOME : cliente.nomerazaosocial ?? "",
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

  async function salvarRascunho(options?: { goNext?: boolean; silent?: boolean; replaceUrl?: boolean }) {
    const goNext = options?.goNext ?? false;
    const wasEditing = Boolean(draft.nfeId);
    setSaving(true);
    setErrors([]);
    try {
      const response = draft.nfeId
        ? await axios.patch(`/api/fiscal/nfe-avulsa/drafts/${draft.nfeId}`, draft)
        : await axios.post("/api/fiscal/nfe-avulsa/drafts", draft);

      const nfeId = Number(response.data?.nfeId);
      const finalNfeId = Number.isFinite(nfeId) ? nfeId : draft.nfeId;
      setDraft((current) => ({
        ...current,
        nfeId: finalNfeId ?? current.nfeId,
        currentStep: goNext ? Math.min(current.currentStep + 1, steps.length - 1) : current.currentStep,
      }));
      setDocumentState((current) => ({
        ...current,
        status: current.status ?? "RASCUNHO",
        chave: response.data?.chave ?? current.chave,
        numero: response.data?.numero == null ? current.numero : Number(response.data.numero),
        serie: response.data?.serie == null ? current.serie : Number(response.data.serie),
      }));
      setDirty(false);
      if (!options?.silent) {
        toast.success(wasEditing ? "Edição salva" : "Rascunho salvo", {
          description: response.data?.chave ? `Chave gerada: ${response.data.chave}` : undefined,
        });
      }
      if (!wasEditing && finalNfeId && options?.replaceUrl !== false) {
        window.localStorage.removeItem(storageKey);
        router.replace(`/fiscal/nfe-avulsa?id=${finalNfeId}`);
      }
      return finalNfeId ?? null;
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
      return null;
    } finally {
      setSaving(false);
    }
  }

  function irParaProximoPasso() {
    updateDraft((current) => ({
      ...current,
      currentStep: Math.min(current.currentStep + 1, steps.length - 1),
    }));
  }

  async function autorizar() {
    setConfirmAuthorizeOpen(false);
    setAuthorizing(true);
    const toastId = toast.loading("Transmitindo NF-e para a SEFAZ...");
    try {
      const nfeId = draft.nfeId ?? (await salvarRascunho({ silent: true, replaceUrl: false }));
      if (!nfeId) {
        toast.error("Falha na autorização", {
          id: toastId,
          description: "Salve a NF-e como rascunho antes de autorizar.",
        });
        return;
      }
      const response = await axios.post(
        `/api/fiscal/nfe-avulsa/drafts/${nfeId}/authorize`,
        {},
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      const protocolo = response.data?.sefaz?.protocolo;
      const lote = response.data?.sefaz?.lote;
      const statusDb = String(response.data?.nfeDb?.status ?? "").toUpperCase();
      const motivo =
        protocolo?.xMotivo ??
        lote?.xMotivo ??
        response.data?.mensagem ??
        "Retorno recebido da SEFAZ sem motivo interpretado.";
      const detalhes = [
        protocolo?.cStat ? `Protocolo ${protocolo.cStat}` : null,
        lote?.cStat ? `Lote ${lote.cStat}` : null,
      ].filter(Boolean).join(" / ");
      const description = detalhes ? `${motivo} (${detalhes})` : motivo;

      if (statusDb === "AUTORIZADA") {
        toast.success("NF-e autorizada", { id: toastId, description });
        window.localStorage.removeItem(storageKey);
        setDocumentState((current) => ({
          ...current,
          status: "AUTORIZADA",
          chave: response.data?.chave ?? current.chave,
          protocolo: response.data?.nfeDb?.protocolo ?? response.data?.sefaz?.protocolo?.nProt ?? current.protocolo,
          dataAutorizacao: new Date().toISOString(),
        }));
      } else if (statusDb === "REJEITADA" || statusDb === "DENEGADA") {
        toast.error(statusDb === "DENEGADA" ? "NF-e denegada" : "NF-e rejeitada", { id: toastId, description });
        setDocumentState((current) => ({ ...current, status: statusDb, chave: response.data?.chave ?? current.chave }));
      } else {
        toast.warning("NF-e enviada para processamento", { id: toastId, description });
        setDocumentState((current) => ({ ...current, status: statusDb || current.status, chave: response.data?.chave ?? current.chave }));
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

  if (isAutorizada) {
    return (
      <NFeAutorizadaView
        draft={draft}
        documentState={documentState}
        setup={setup}
        totalProdutos={totalProdutos}
      />
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
            <p className="mt-3 text-xs text-muted-foreground">
              Campos com <span className="font-semibold text-destructive">*</span> sao obrigatorios para emissao da NF-e.
            </p>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {currentStep === 0 && (
              <section className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo de operação" required>
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
                <Field label="Finalidade" required>
                  <Select
                    value={draft.operacao.finalidade}
                    onValueChange={(value: DraftPayload["operacao"]["finalidade"]) =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, finalidade: value },
                        pagamento:
                          value === "AJUSTE" || value === "DEVOLUCAO"
                            ? { ...current.pagamento, meio: "90" }
                            : current.pagamento,
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
                <Field label="Natureza da operação" required>
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
                <Field label="Indicador de presença" required>
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
                <Field label="Consumidor final" required>
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
                <Info label="Empresa" value={setup?.empresa?.razaosocial} required />
                <Info label="CNPJ" value={formatCpfCnpj(setup?.empresa?.cnpj)} required />
                <Info label="Série" value={setup?.config?.serie} required />
                <Info label="UF" value={setup?.empresa?.uf} required />
                <Info label="CRT" value={setup?.empresa?.regimetributario} required />
                <Info label="Certificado" value={setup?.certificadoStatus} className="md:col-span-2" required />
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
                  <Button className="w-min" type="button" variant="outline" onClick={() => setOpenCustomerSelect(true)}>
                    + Selecionar cliente
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
                  <Field label="Tipo de pessoa" required>
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
                  <Field label="CPF/CNPJ" required={!isDestinatarioExterior}>
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
                  <Field label="Nome/Razão social" required>
                    <Input
                      value={isHomologacao ? NFE_HOMOLOGACAO_DESTINATARIO_NOME : draft.destinatario.nomeRazaoSocial}
                      disabled={isHomologacao}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, nomeRazaoSocial: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Indicador IE" required>
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
                  <Field label="Inscrição estadual" required={draft.destinatario.indicadorIe === "1"}>
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
                  <Field label="Endereço" required>
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
                  <Field label="Bairro" required>
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
                  <Field label="Cidade" required>
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
                  <Field label="UF" required>
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
                  <Field label="CEP" required={!isDestinatarioExterior}>
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
                  <Field label="Código IBGE do município" required={!isDestinatarioExterior}>
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
                  {draft.itens.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="flex min-h-40 items-center justify-center p-6">
                        <p className="text-center text-sm font-medium text-muted-foreground">
                          Insira produtos para continuar
                        </p>
                      </CardContent>
                    </Card>
                  ) : null}

                  {draft.itens.map((item, index) => (
                    <Card key={index} className="border-dashed">
                      <CardContent className="grid gap-3 pt-4 md:grid-cols-12">
                        <div className="md:col-span-5">
                          <Label className="inline-flex items-center gap-1">Descrição <RequiredMark /></Label>
                          <Input value={item.descricao} onChange={(event) => updateItem(index, { descricao: event.target.value })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="inline-flex items-center gap-1">NCM <RequiredMark /></Label>
                          <Input value={item.ncm} onChange={(event) => updateItem(index, { ncm: onlyDigits(event.target.value) })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="inline-flex items-center gap-1">CFOP <RequiredMark /></Label>
                          <Input value={item.cfop} onChange={(event) => updateItem(index, { cfop: onlyDigits(event.target.value) })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="inline-flex items-center gap-1">Unidade <RequiredMark /></Label>
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
                          <Label className="inline-flex items-center gap-1">Quantidade <RequiredMark /></Label>
                          <Input value={item.quantidade} onChange={(event) => updateItem(index, { quantidade: event.target.value })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="inline-flex items-center gap-1">Valor unitário <RequiredMark /></Label>
                          <ValueInput
                            price={parseCurrency(item.valorUnitario)}
                            setPrice={(value) => updateItem(index, { valorUnitario: value.toFixed(2) })}
                          />
                        </div>
                        <div className="md:col-span-3">
                          <Label className="inline-flex items-center gap-1">
                            CEST
                            {["201", "202", "203"].includes(item.csosn) || ["10", "30", "70"].includes(item.cst) ? <RequiredMark /> : null}
                          </Label>
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
                        <Field label="CSOSN" required={isSimplesOuMei || isSublimite}>
                          <Input value={item.csosn} onChange={(event) => updateItem(index, { csosn: event.target.value })} />
                        </Field>
                        <Field label="CST ICMS" required={isRegimeNormal || isSublimite}>
                          <Input value={item.cst} onChange={(event) => updateItem(index, { cst: event.target.value })} />
                        </Field>
                        <Field label="% ICMS">
                          <Input value={item.aliquotaIcms} onChange={(event) => updateItem(index, { aliquotaIcms: event.target.value })} />
                        </Field>
                        <Field label="CST PIS" required>
                          <Input value={item.cstPis} onChange={(event) => updateItem(index, { cstPis: event.target.value })} />
                        </Field>
                        <Field label="% PIS">
                          <Input value={item.aliquotaPis} onChange={(event) => updateItem(index, { aliquotaPis: event.target.value })} />
                        </Field>
                        <Field label="CST COFINS" required>
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
              <TransporteStep
                draft={draft}
                updateDraft={updateDraft}
                isSemTransporte={isSemTransporte}
                isFreteContratado={isFreteContratado}
                isTransporteProprio={isTransporteProprio}
              />
            )}
            {false && (
              <ReadOnlyStep
                title="Transporte"
                description="Esta primeira versão emite a NF-e avulsa com modalidade sem frete. Dados de transportadora e volumes ficam bloqueados até a parametrização fiscal específica."
              />
            )}

            {currentStep === 5 && (
              <section className="grid gap-4 md:grid-cols-2">
                <Field label="Método de pagamento" required>
                  <Select
                    value={meioPagamentoAtual}
                    disabled={isSemPagamentoObrigatorio}
                    onValueChange={(value) =>
                      updateDraft((current) => ({
                        ...current,
                        pagamento: {
                          ...current.pagamento,
                          meio: value,
                          bandeira:
                            (value === "03" || value === "04") && !current.pagamento.bandeira
                              ? "99"
                              : current.pagamento.bandeira,
                        },
                      }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {paymentOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.value} - {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Info
                  label="Valor informado no pagamento"
                  value={meioPagamentoAtual === "90" ? formatarEmReal(0) : formatarEmReal(totalProdutos)}
                />

                {isSemPagamentoObrigatorio && (
                  <Alert className="md:col-span-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Pagamento definido pela finalidade</AlertTitle>
                    <AlertDescription>
                      NF-e de ajuste ou devolução deve ser emitida com 90 - Sem pagamento.
                    </AlertDescription>
                  </Alert>
                )}

                {isPagamentoCartao && (
                  <>
                    <Field label="Integração do cartão" required>
                      <Select
                        value={draft.pagamento.tipoIntegracao}
                        onValueChange={(value: "1" | "2") =>
                          updateDraft((current) => ({
                            ...current,
                            pagamento: { ...current.pagamento, tipoIntegracao: value },
                          }))
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">Não integrado</SelectItem>
                          <SelectItem value="1">Integrado ao sistema</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Bandeira" required>
                      <Select
                        value={draft.pagamento.bandeira || "99"}
                        onValueChange={(value) =>
                          updateDraft((current) => ({
                            ...current,
                            pagamento: { ...current.pagamento, bandeira: value },
                          }))
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {cardBrandOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.value} - {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {draft.pagamento.tipoIntegracao === "1" && (
                      <>
                        <Field label="CNPJ da credenciadora" required>
                          <Input
                            value={draft.pagamento.cnpjCredenciadora}
                            onChange={(event) =>
                              updateDraft((current) => ({
                                ...current,
                                pagamento: {
                                  ...current.pagamento,
                                  cnpjCredenciadora: onlyDigits(event.target.value),
                                },
                              }))
                            }
                          />
                        </Field>
                        <Field label="Código de autorização" required>
                          <Input
                            value={draft.pagamento.autorizacao}
                            onChange={(event) =>
                              updateDraft((current) => ({
                                ...current,
                                pagamento: { ...current.pagamento, autorizacao: event.target.value },
                              }))
                            }
                          />
                        </Field>
                      </>
                    )}
                  </>
                )}
              </section>
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
                <div className="grid gap-3 md:grid-cols-5">
                  <Info label="Operação" value={draft.operacao.naturezaOperacao} />
                  <Info label="Destinatário" value={draft.destinatario.nomeRazaoSocial || "Pendente"} />
                  <Info label="Total" value={formatarEmReal(totalProdutos)} />
                  <Info label="Pagamento" value={`${meioPagamentoAtual} - ${getPaymentLabel(meioPagamentoAtual)}`} />
                  <Info label="Frete" value={`${draft.transporte.modFrete} - ${getFreightLabel(draft.transporte.modFrete)}`} />
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
                {currentStep < steps.length - 1 ? (
                  <Button className="w-full" onClick={irParaProximoPasso}>Próximo</Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => salvarRascunho()} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {isEditingPersistedDraft ? "Salvar edição" : "Salvar como rascunho"}
                    </Button>
                    <Button
                      onClick={() => setConfirmAuthorizeOpen(true)}
                      disabled={authorizing || saving || (setup?.empresaErros?.length ?? 0) > 0}
                    >
                      {authorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Autorizar SEFAZ
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit hidden lg:block">
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
            <Info label="Pagamento" value={`${meioPagamentoAtual} - ${getPaymentLabel(meioPagamentoAtual)}`} />
            <Info label="Status do documento" value={draft.nfeId ? `Rascunho #${draft.nfeId}` : "Não salvo"} />
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmAuthorizeOpen} onOpenChange={setConfirmAuthorizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transmitir NF-e para a SEFAZ?</AlertDialogTitle>
            <AlertDialogDescription>
              A nota será salva, assinada e enviada para autorização. Se a SEFAZ autorizar,
              a NF-e não poderá mais ser editada; qualquer correção fiscal deverá seguir os
              eventos permitidos, como cancelamento ou carta de correção quando aplicável.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{draft.destinatario.nomeRazaoSocial || "Destinatário pendente"}</p>
            <p className="mt-1 text-muted-foreground">
              Total da NF-e: {formatarEmReal(totalProdutos)} - Ambiente: {ambienteLabel}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={authorizing}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={authorizing}
              onClick={(event) => {
                event.preventDefault();
                void autorizar();
              }}
            >
              {authorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Confirmar envio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RequiredMark() {
  return <span className="text-destructive">*</span>;
}

function Field({
  label,
  children,
  required = false,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="inline-flex items-center gap-1">
        {label}
        {required && <RequiredMark />}
      </Label>
      {children}
    </div>
  );
}

function NFeAutorizadaView({
  draft,
  documentState,
  setup,
  totalProdutos,
}: {
  draft: DraftPayload;
  documentState: NFeDocumentState;
  setup: SetupResponse | null;
  totalProdutos: number;
}) {
  async function baixarXml() {
    if (!draft.nfeId) return;

    const toastId = toast.loading("Preparando XML...");
    try {
      const response = await fetch(`/api/fiscal/notas-emitidas/${draft.nfeId}/xml`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("XML indisponível", {
          id: toastId,
          description: body?.detail ?? body?.error ?? "Não foi possível baixar o XML.",
        });
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] ?? `nfe-${draft.nfeId}.xml`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("XML baixado", { id: toastId });
    } catch (error) {
      const description = error instanceof Error ? error.message : "Erro ao baixar XML.";
      toast.error("Falha no download", { id: toastId, description });
    }
  }

  const itensDisplay = draft.itens.map((item, index) => {
    const quantidade = parseNumberInput(item.quantidade);
    const valorUnitario = parseNumberInput(item.valorUnitario);
    const valorTotal = Number((quantidade * valorUnitario).toFixed(2));
    const aliquotaIcms = parseNumberInput(item.aliquotaIcms);
    const aliquotaPis = parseNumberInput(item.aliquotaPis);
    const aliquotaCofins = parseNumberInput(item.aliquotaCofins);

    return {
      id: `${item.produtoId ?? item.codigo ?? "item"}-${index}`,
      n_item: index + 1,
      produtoid: (item.produtoId ?? item.codigo) || null,
      descricao: item.descricao,
      ncm: item.ncm || null,
      cfop: item.cfop,
      csosn: item.csosn || item.cst || null,
      unidade: item.unidade,
      quantidade,
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
      valor_bc_icms: aliquotaIcms > 0 ? valorTotal : 0,
      aliquotaicms: aliquotaIcms,
      valor_icms: Number((valorTotal * (aliquotaIcms / 100)).toFixed(2)),
      cst_pis: item.cstPis || null,
      valor_pis: Number((valorTotal * (aliquotaPis / 100)).toFixed(2)),
      cst_cofins: item.cstCofins || null,
      valor_cofins: Number((valorTotal * (aliquotaCofins / 100)).toFixed(2)),
    };
  });
  const totalBcIcms = itensDisplay.reduce((sum, item) => sum + item.valor_bc_icms, 0);
  const totalIcms = itensDisplay.reduce((sum, item) => sum + item.valor_icms, 0);
  const emitenteEndereco = [
    setup?.empresa?.endereco,
    setup?.empresa?.numero && `, ${setup.empresa.numero}`,
    setup?.empresa?.bairro && ` - ${setup.empresa.bairro}`,
    setup?.empresa?.cep && ` - CEP ${setup.empresa.cep}`,
    setup?.empresa?.uf && ` - ${setup.empresa.uf}`,
  ].filter(Boolean).join("") || "-";
  const destinatarioEndereco = [
    draft.destinatario.endereco,
    draft.destinatario.numero && `, ${draft.destinatario.numero}`,
    draft.destinatario.bairro && ` - ${draft.destinatario.bairro}`,
    draft.destinatario.cep && ` - CEP ${draft.destinatario.cep}`,
    draft.destinatario.cidade && draft.destinatario.estado && ` - ${draft.destinatario.cidade}/${draft.destinatario.estado}`,
  ].filter(Boolean).join("");
  const danfeData: DanfeViewData = {
    nfe: {
      numero: documentState.numero ?? draft.nfeId ?? 0,
      serie: documentState.serie ?? setup?.config?.serie ?? 0,
      ordemservicoid: null,
      protocolo: documentState.protocolo,
      dataautorizacao: documentState.dataAutorizacao,
      total_servicos: 0,
    },
    emitenteNome: setup?.empresa?.razaosocial || "-",
    emitenteEndereco,
    emitenteCnpj: setup?.empresa?.cnpj || "",
    emitenteIe: setup?.empresa?.inscricaoestadual ?? null,
    emitenteTelefone: setup?.empresa?.telefone ?? null,
    destinatarioNome: draft.destinatario.nomeRazaoSocial || "-",
    destinatarioDoc: draft.destinatario.cpfCnpj,
    destinatarioEndereco: destinatarioEndereco || "-",
    destinatarioCidadeUf:
      draft.destinatario.cidade && draft.destinatario.estado
        ? `${draft.destinatario.cidade}/${draft.destinatario.estado}`
        : "-",
    destinatarioCep: draft.destinatario.cep || "-",
    dataEmissaoDanfe: documentState.dataAutorizacao,
    tipoOperacao: draft.operacao.tipoOperacao === "ENTRADA" ? "ENTRADA" : "SAÍDA",
    statusUpper: "AUTORIZADA",
    statusLabel: "Autorizada",
    chaveFormatada: formatChaveAcesso(documentState.chave),
    isAutorizada: true,
    xmlError: null,
    xmlBaseAvailable: true,
    itensDisplay,
    totalBcIcms,
    totalIcms,
    totalProdutos,
    totalNota: totalProdutos,
    infCpl: draft.operacao.observacoesFiscais || null,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <h1 className="text-2xl font-semibold tracking-tight">Nota fiscal autorizada</h1>
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">AUTORIZADA</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            A NF-e foi autorizada pela SEFAZ e não pode mais ser editada.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/fiscal">Sair</Link>
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          <Button onClick={baixarXml}>
            <Download className="h-4 w-4" />
            Baixar XML
          </Button>
        </div>
      </div>

      <Alert className="print:hidden">
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Nota fiscal autorizada!</AlertTitle>
        <AlertDescription>
          Protocolo {documentState.protocolo || "-"} - Chave {documentState.chave || "-"}
        </AlertDescription>
      </Alert>

      <DanfeView data={danfeData} showActions={false} />
    </div>
  );
}

function Info({
  label,
  value,
  className,
  required = false,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`rounded-md border bg-muted/20 p-3 ${className ?? ""}`}>
      <p className="flex gap-1 text-xs text-muted-foreground">
        {label}
        {required && <RequiredMark />}
      </p>
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

function TransporteStep({
  draft,
  updateDraft,
  isSemTransporte,
  isFreteContratado,
  isTransporteProprio,
}: {
  draft: DraftPayload;
  updateDraft: (updater: (current: DraftPayload) => DraftPayload) => void;
  isSemTransporte: boolean;
  isFreteContratado: boolean;
  isTransporteProprio: boolean;
}) {
  const updateTransporte = (patch: Partial<DraftTransporte>) => {
    updateDraft((current) => ({
      ...current,
      transporte: {
        ...current.transporte,
        ...patch,
      },
    }));
  };

  const updateTransportadora = (patch: Partial<DraftTransporte["transportadora"]>) => {
    updateDraft((current) => ({
      ...current,
      transporte: {
        ...current.transporte,
        transportadora: {
          ...current.transporte.transportadora,
          ...patch,
        },
      },
    }));
  };

  const updateVeiculo = (patch: Partial<DraftTransporte["veiculo"]>) => {
    updateDraft((current) => ({
      ...current,
      transporte: {
        ...current.transporte,
        veiculo: {
          ...current.transporte.veiculo,
          ...patch,
        },
      },
    }));
  };

  const updateVolume = (patch: Partial<DraftTransporte["volume"]>) => {
    updateDraft((current) => ({
      ...current,
      transporte: {
        ...current.transporte,
        volume: {
          ...current.transporte.volume,
          ...patch,
        },
      },
    }));
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Modalidade do frete" required>
          <Select
            value={draft.transporte.modFrete}
            onValueChange={(value) => {
              const modFrete = value as DraftTransporte["modFrete"];
              updateTransporte({
                modFrete,
                transportadora: modFrete === "9" ? { ...initialDraft.transporte.transportadora } : draft.transporte.transportadora,
                veiculo: modFrete === "9" ? { ...initialDraft.transporte.veiculo } : draft.transporte.veiculo,
                volume: modFrete === "9" ? { ...initialDraft.transporte.volume } : draft.transporte.volume,
              });
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {freightOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.value} - {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Info label="Tag enviada no XML" value={`modFrete ${draft.transporte.modFrete}`} />
      </div>

      {isSemTransporte && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sem ocorrencia de transporte</AlertTitle>
          <AlertDescription>
            Com modFrete 9, a NF-e envia apenas a modalidade do frete e nao preenche transportadora, veiculo ou volumes.
          </AlertDescription>
        </Alert>
      )}

      {!isSemTransporte && (
        <>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {isFreteContratado ? "Frete contratado" : "Transporte proprio"}
            </AlertTitle>
            <AlertDescription>
              {isFreteContratado
                ? "Informe a transportadora responsavel pelo frete. CPF/CNPJ, nome e UF sao validados antes de emitir."
                : "No transporte proprio, o XML usa os dados do responsavel pela modalidade selecionada e aceita veiculo e volumes quando informados."}
            </AlertDescription>
          </Alert>

          {isFreteContratado && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Transportadora</p>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="CPF/CNPJ" required>
                  <Input
                    value={draft.transporte.transportadora.documento}
                    onChange={(event) => updateTransportadora({ documento: onlyDigits(event.target.value) })}
                    maxLength={14}
                  />
                </Field>
                <Field label="Nome/Razao social" required>
                  <Input
                    value={draft.transporte.transportadora.nome}
                    onChange={(event) => updateTransportadora({ nome: event.target.value })}
                  />
                </Field>
                <Field label="Inscricao estadual">
                  <Input
                    value={draft.transporte.transportadora.inscricaoEstadual}
                    onChange={(event) => updateTransportadora({ inscricaoEstadual: onlyDigits(event.target.value) })}
                  />
                </Field>
                <Field label="Endereco">
                  <Input
                    value={draft.transporte.transportadora.endereco}
                    onChange={(event) => updateTransportadora({ endereco: event.target.value })}
                  />
                </Field>
                <Field label="Municipio">
                  <Input
                    value={draft.transporte.transportadora.municipio}
                    onChange={(event) => updateTransportadora({ municipio: event.target.value })}
                  />
                </Field>
                <Field label="UF" required>
                  <Input
                    value={draft.transporte.transportadora.uf}
                    onChange={(event) => updateTransportadora({ uf: event.target.value.toUpperCase().slice(0, 2) })}
                    maxLength={2}
                  />
                </Field>
              </div>
            </div>
          )}

          {isTransporteProprio && (
            <Info
              label="Transportador no XML"
              value={draft.transporte.modFrete === "3" ? "Emitente da NF-e" : "Destinatario da NF-e"}
            />
          )}

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Veiculo</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Placa">
                <Input
                  value={draft.transporte.veiculo.placa}
                  onChange={(event) =>
                    updateVeiculo({ placa: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7) })
                  }
                  maxLength={7}
                />
              </Field>
              <Field label="UF" required={Boolean(draft.transporte.veiculo.placa)}>
                <Input
                  value={draft.transporte.veiculo.uf}
                  onChange={(event) => updateVeiculo({ uf: event.target.value.toUpperCase().slice(0, 2) })}
                  maxLength={2}
                />
              </Field>
              <Field label="RNTC/ANTT">
                <Input
                  value={draft.transporte.veiculo.rntc}
                  onChange={(event) => updateVeiculo({ rntc: event.target.value })}
                />
              </Field>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Volumes</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Quantidade">
                <Input
                  value={draft.transporte.volume.quantidade}
                  onChange={(event) => updateVolume({ quantidade: event.target.value })}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Especie">
                <Input
                  value={draft.transporte.volume.especie}
                  onChange={(event) => updateVolume({ especie: event.target.value })}
                />
              </Field>
              <Field label="Marca">
                <Input
                  value={draft.transporte.volume.marca}
                  onChange={(event) => updateVolume({ marca: event.target.value })}
                />
              </Field>
              <Field label="Numeracao">
                <Input
                  value={draft.transporte.volume.numeracao}
                  onChange={(event) => updateVolume({ numeracao: event.target.value })}
                />
              </Field>
              <Field label="Peso liquido">
                <Input
                  value={draft.transporte.volume.pesoLiquido}
                  onChange={(event) => updateVolume({ pesoLiquido: event.target.value })}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Peso bruto">
                <Input
                  value={draft.transporte.volume.pesoBruto}
                  onChange={(event) => updateVolume({ pesoBruto: event.target.value })}
                  inputMode="decimal"
                />
              </Field>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
