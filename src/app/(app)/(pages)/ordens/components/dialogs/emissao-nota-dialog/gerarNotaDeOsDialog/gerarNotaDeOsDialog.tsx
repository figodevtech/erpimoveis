"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronsUpDown,
  Hash,
  Info,
  Loader2,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  Receipt,
} from "lucide-react";

import { DialogProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/dialog-produto";
import { CustomerDialog } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/customerDialog";
import type { Customer } from "@/app/(app)/(pages)/clientes/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarraAcaoFiscal,
  CabecalhoFiscal,
  EsqueletoFiscal,
  FISCAL_DIALOG_CONTENT_CLASS,
  type EtapaFiscal,
} from "../components/fiscal-dialog-chrome";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import ValueInput from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";
import { resolveCfopForEmission } from "@/lib/nfe/cfopOperation";
import {
  blocosDeObservacao,
  concatenarBloco,
  type AlvoFiscal,
} from "@/lib/fiscal/blocosDeObservacao";
import {
  NFE_FREIGHT_OPTIONS,
  NFE_PAYMENT_OPTIONS,
  NFE_PRESENCE_OPTIONS,
} from "@/lib/nfe/originFiscalDefaults";
import { isValidCnpj, isValidCpf, normalizeFiscalRecipient } from "@/lib/nfe/recipientNormalization";
import { normalizarIndIEDest, sugerirIndIEDest } from "@/lib/nfe/indIEDest";
import {
  indFinalDoDestino,
  normalizarDestinoMercadoria,
  type DestinoMercadoria,
} from "@/lib/nfe/destinoMercadoria";
import { DestinoMercadoriaField } from "@/components/fiscal/destino-mercadoria-field";
import { distribuirDinheiro } from "@/lib/nfe/descontoOrigem";
import { freteNaBaseIcms } from "@/lib/nfe/icms";
import {
  aplicarAlteracoesComCienciaFiscal,
  classificarIssuesFiscais,
} from "@/lib/nfe/issuesFiscais";
import { MODELO_NFE, MODELO_NFCE, rotuloModelo } from "@/lib/nfe/modeloDocumento";
import { PB_NFCE_PISO_IDENTIFICACAO } from "@/lib/nfe/fiscalRules";
import type { ModeloDocumentoFiscal } from "@/lib/nfe/types";
import { NFE_XNOME_MAX_LENGTH, sanitizeString } from "@/lib/nfe/xmlUtils";
import { ConfirmarIndicadorIe } from "@/components/fiscal/confirmar-indicador-ie";
import { normalizeCpfOrCnpj } from "@/lib/fiscal-identifiers";

import {
  aplicarCamposFiscais,
  aplicarSugestaoDifal,
  createAssistedItem,
  type AssistedFiscalItem,
  type AssistedItemIssue,
  type DifalContexto,
  type FiscalSetup,
  type SourceProduct,
  ratearDescontoGeralNosItens,
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
import {
  NfeSaidaOrigemEditor,
  relacaoUnica,
  validarOrigemFiscalSaida,
  type EntradaCandidata,
  type OperacaoFiscalSaidaOption,
  type SaidaOrigemDraft,
} from "./nfe-saida-origem-editor";

/** Contexto fiscal da saída, carregado junto dos itens quando origin = SAIDA. */
type SaidaFiscalResponse = {
  ok: boolean;
  message?: string;
  contexto?: {
    operacao_fiscal_codigo?: string | null;
    natureza_operacao?: string | null;
    finalidade?: string | null;
    documento_referenciado_obrigatorio?: boolean | null;
    chave_acesso_referenciada?: string | null;
    itens?: Array<{
      saida_item_id: number;
      entrada_item_origem_id?: number | null;
      numero_item_referenciado?: number | null;
      percentual_devolucao?: number | null;
      valor_ipi_devolvido?: number | null;
    }> | null;
  } | null;
  entradasCandidatas?: EntradaCandidata[];
  operacoes?: OperacaoFiscalSaidaOption[];
};

/**
 * Fornecedor da entrada como destinatário da devolução.
 *
 * Numa devolução a mercadoria volta para quem vendeu, e o servidor recusa a
 * gravação se o documento do destinatário não bater com o fornecedor da entrada
 * escolhida. Preencher aqui poupa o operador de redigitar o cadastro inteiro só
 * para satisfazer essa conferência.
 */
function fornecedorParaDestinatario(fornecedor: any): NFeEntrySupplierDraft {
  const documento = normalizeCpfOrCnpj(fornecedor?.cpfcnpj);
  return {
    ...emptyEntrySupplier,
    fornecedorId: Number(fornecedor?.id ?? 0) || null,
    tipoPessoa: documento.length === 11 ? "FISICA" : "JURIDICA",
    cpfCnpj: documento,
    nomeRazaoSocial: fornecedor?.nomerazaosocial || fornecedor?.nomefantasia || "",
    telefone: onlyDigits(fornecedor?.contato),
    endereco: fornecedor?.endereco || "",
    numero: fornecedor?.endereconumero || "",
    complemento: fornecedor?.enderecocomplemento || "",
    bairro: fornecedor?.bairro || "",
    cidade: fornecedor?.cidade || "",
    estado: String(fornecedor?.estado || "").toUpperCase(),
    cep: onlyDigits(fornecedor?.cep),
    codigoMunicipio: onlyDigits(fornecedor?.codigomunicipio),
  };
}

const emptySaidaOrigem: SaidaOrigemDraft = {
  operacaoFiscalCodigo: "",
  naturezaOperacao: "",
  finalidade: "NORMAL",
  documentoReferenciadoObrigatorio: false,
  chaveAcessoReferenciada: "",
  itens: [],
};

/** Limite do infCpl que o servidor também aplica ao montar o rascunho. */
const LIMITE_OBSERVACOES = 500;

type SourceResponse = {
  ok: boolean;
  message?: string;
  observacoes_fiscais?: string | null;
  cliente?: FiscalCustomer | null;
  fornecedor?: { id: number | null; nome: string | null; uf?: string | null } | null;
  parceiro_erros?: string[];
  tipo_operacao?: "SAIDA" | "ENTRADA";
  natureza_operacao?: string;
  destinatario?: NFeEntrySupplierDraft;
  configuracao_fiscal?: Partial<AssistedFiscalConfig>;
  /** Parcela do desconto geral da origem que cabe aos produtos desta nota. */
  desconto_geral?: number | null;
  /** Alvo do reparo da OS. Ausente nas origens que não têm alvo (venda, saída). */
  alvo?: AlvoFiscal | null;
  /**
   * Decomposição do desconto da origem, para a tela explicar por que o campo
   * mostra menos que o desconto da OS. Numa venda `servicos` vem zerado.
   */
  desconto_origem?: {
    total: number;
    produtos: number;
    servicos: number;
    baseProdutos: number;
    baseServicos: number;
  } | null;
  itens: SourceProduct[];
};

type SaidaRelacionadaResponse = {
  ok: boolean;
  message?: string;
  candidatos?: Array<{
    saidaId: number;
    saidaItemId: number;
    sourceItemId: string;
    entradaItemOrigemId: number | null;
    numeroItemReferenciado: number | null;
    confianca: "VINCULO_EXISTENTE" | "PRODUTO_UNICO" | "AMBIGUA";
    selecionavel: boolean;
    motivoIndisponivel: string | null;
    entradaCandidata: EntradaCandidata | null;
    item: SourceProduct;
  }>;
};

type AssistedFiscalConfig = {
  /** Obrigatório na NF-e de saída; sai daqui o indFinal. Começa em branco. */
  destinoMercadoria: DestinoMercadoria | "";
  /** Só usado quando o destino é "OUTRO". */
  consumidorFinal: boolean | null;
  /**
   * O frete cobrado integra a base do ICMS próprio? Só é perguntado quando a
   * lei não responde sozinha (frete com modalidade diferente de 0 e 3).
   */
  freteIntegraBaseIcms: boolean | null;
  indicadorPresenca: string;
  pagamentos: Array<{ meio: string; valor: number }>;
  modFrete: string;
  /** Frete da nota inteira (vai para vFrete, rateado nos itens pelo servidor). */
  valorFrete: number;
  transportadora: {
    documento: string;
    nome: string;
    inscricaoEstadual: string;
    endereco: string;
    municipio: string;
    uf: string;
  };
};

const defaultFiscalConfig: AssistedFiscalConfig = {
  destinoMercadoria: "",
  consumidorFinal: null,
  freteIntegraBaseIcms: null,
  indicadorPresenca: "1",
  pagamentos: [],
  modFrete: "9",
  valorFrete: 0,
  transportadora: {
    documento: "",
    nome: "",
    inscricaoEstadual: "",
    endereco: "",
    municipio: "",
    uf: "",
  },
};

type FiscalCustomer = {
  id: number;
  nome: string;
  uf?: string | null;
  tipopessoa?: string | null;
  cpfcnpj?: string | null;
  nomerazaosocial?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  endereconumero?: string | null;
  enderecocomplemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  inscricaoestadual?: string | null;
  /** indIEDest gravado no cadastro. `null` = ainda não classificado. */
  ind_ie_dest?: number | null;
  inscricaomunicipal?: string | null;
  codigomunicipio?: string | null;
};

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Indicador usado apenas na PRÉVIA (contexto do DIFAL e sugestão de tributação).
 *
 * Cliente ainda não classificado cai na sugestão para a tela não ficar vazia —
 * a emissão de verdade é barrada por `validarInscricaoEstadualDestinatario`
 * até o usuário confirmar a situação fiscal e ela ir para o cadastro.
 */
function indicadorDoCliente(
  cliente?: { ind_ie_dest?: number | null; inscricaoestadual?: string | null } | null,
) {
  return (
    normalizarIndIEDest(cliente?.ind_ie_dest) ??
    sugerirIndIEDest(cliente?.inscricaoestadual)
  );
}

function validateFiscalCustomer(cliente?: FiscalCustomer | null) {
  if (!cliente) return ["Cliente não encontrado na origem."];
  const errors: string[] = [];
  const document = normalizeCpfOrCnpj(cliente.cpfcnpj);
  if (!(document.length === 11 ? isValidCpf(document) : isValidCnpj(document))) {
    errors.push("CPF/CNPJ inválido ou ausente.");
  }
  if (!String(cliente.nomerazaosocial ?? cliente.nome ?? "").trim()) errors.push("Nome ou razão social ausente.");
  if (!String(cliente.endereco ?? "").trim()) errors.push("Endereço ausente.");
  if (!String(cliente.bairro ?? "").trim()) errors.push("Bairro ausente.");
  if (!String(cliente.cidade ?? "").trim()) errors.push("Cidade ausente.");
  if (String(cliente.estado ?? "").trim().length !== 2) errors.push("UF ausente ou inválida.");
  if (onlyDigits(cliente.cep).length !== 8) errors.push("CEP ausente ou inválido.");
  if (onlyDigits(cliente.codigomunicipio).length !== 7) errors.push("Código IBGE do município ausente ou inválido.");
  return errors;
}

function customerToFiscalCustomer(customer: Customer): FiscalCustomer {
  return {
    ...customer,
    nome: customer.nomerazaosocial,
    uf: customer.estado,
  };
}

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
    code?: string;
    severidade?: string;
    requerCiencia?: boolean;
  }>;
};

function fmtMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function ratearPagamentosParaTotal(
  pagamentos: Array<{ meio: string; valor: number }>,
  total: number,
) {
  if (pagamentos.length === 0) return [];
  const totalCentavos = Math.max(0, Math.round(total * 100));
  const pesos = pagamentos.map((pagamento) => Math.max(0, Number(pagamento.valor) || 0));
  const somaPesos = pesos.reduce((soma, peso) => soma + peso, 0);
  let alocado = 0;
  return pagamentos.map((pagamento, index) => {
    const centavos = index === pagamentos.length - 1
      ? totalCentavos - alocado
      : somaPesos > 0
        ? Math.floor(totalCentavos * pesos[index] / somaPesos)
        : Math.floor(totalCentavos / pagamentos.length);
    alocado += centavos;
    return { meio: pagamento.meio, valor: centavos / 100 };
  });
}

/**
 * Consumidor da NFC-e: identificação é opcional, documento inválido não.
 *
 * A mesma regra roda no servidor (`validarNfce` + `fiscalRules/PB`) — aqui ela
 * existe só para o operador descobrir antes de clicar em emitir, e não pela
 * rejeição 750 da SEFAZ com o cliente esperando no balcão.
 */
function validarConsumidorNfce(
  documento: string,
  totalDaNota: number,
  ufEmitente: string | null | undefined,
): string[] {
  const erros: string[] = [];
  const digitos = normalizeCpfOrCnpj(documento);

  if (digitos) {
    const valido = digitos.length === 14 ? isValidCnpj(digitos) : isValidCpf(digitos);
    if (!valido) erros.push("CPF ou CNPJ do consumidor é inválido.");
  }

  const uf = String(ufEmitente ?? "").trim().toUpperCase();
  if (uf === "PB" && totalDaNota >= PB_NFCE_PISO_IDENTIFICACAO && !digitos) {
    erros.push(
      `Na Paraíba, NFC-e de ${fmtMoney(PB_NFCE_PISO_IDENTIFICACAO)} ou mais exige CPF ou CNPJ do consumidor.`,
    );
  }

  return erros;
}

export interface GerarNotaDeOsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  osId?: number | null;
  vendaId?: number | null;
  entradaId?: number | null;
  saidaId?: number | null;
  /**
   * 55 = NF-e (padrão), 65 = NFC-e.
   *
   * O mesmo assistente serve os dois modelos: muda o que é perguntado, não o
   * motor. Na NFC-e caem transporte, DIFAL e destinatário obrigatório; entra a
   * identificação opcional do consumidor.
   */
  modelo?: ModeloDocumentoFiscal;
  /**
   * Rascunho existente a corrigir (nota rejeitada). Preenchido, o assistente
   * atualiza essa nota em vez de criar outra — o número e a chave já alocados
   * são reaproveitados.
   */
  nfeId?: number | null;
  onAfterGenerate?: (nfeId: number | null) => void;
}

export function GerarNotaDeOsDialog({
  open,
  onOpenChange,
  osId,
  vendaId,
  entradaId,
  saidaId,
  modelo = MODELO_NFE,
  nfeId = null,
  onAfterGenerate,
}: GerarNotaDeOsDialogProps) {
  const corrigindoRejeitada = Boolean(nfeId);
  const isNfce = modelo === MODELO_NFCE;
  const rotulo = rotuloModelo(modelo);
  /** CPF/CNPJ do consumidor na NFC-e. Vazio = consumidor não identificado. */
  const [consumidorDoc, setConsumidorDoc] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<FiscalSetup | null>(null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [items, setItems] = useState<AssistedFiscalItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorTom, setServerErrorTom] = useState<"BLOQUEIO" | "AVISO">("BLOQUEIO");
  const [includeObservations, setIncludeObservations] = useState(false);
  const [observations, setObservations] = useState("");
  // Desconto geral da nota. Chega da origem já rateado nos itens; redigitar aqui
  // refaz o rateio proporcional sobre os itens selecionados.
  const [descontoGeral, setDescontoGeral] = useState(0);
  const [entrySupplier, setEntrySupplier] = useState<NFeEntrySupplierDraft>(emptyEntrySupplier);
  const [fiscalConfig, setFiscalConfig] = useState<AssistedFiscalConfig>(defaultFiscalConfig);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [paymentMethodsOpen, setPaymentMethodsOpen] = useState(false);
  // Origem fiscal da saída: natureza, chave referenciada e vínculo item↔entrada.
  // Vive aqui porque é decidido no mesmo diálogo e viaja no mesmo POST.
  const [saidaOrigem, setSaidaOrigem] = useState<SaidaOrigemDraft>(emptySaidaOrigem);
  const [saidaOperacoes, setSaidaOperacoes] = useState<OperacaoFiscalSaidaOption[]>([]);
  const [entradasCandidatas, setEntradasCandidatas] = useState<EntradaCandidata[]>([]);
  const [espelhando, setEspelhando] = useState(false);
  const [buscandoRelacionadas, setBuscandoRelacionadas] = useState(false);
  const [resumoRelacionadas, setResumoRelacionadas] = useState<{
    encontradas: number;
    indisponiveis: number;
  } | null>(null);

  // Consumidor final e a IE do destinatário mudam a exigência do DIFAL. Reavalia
  // na hora, preservando o que já foi digitado nos campos.
  //
  // NFC-e nunca entra aqui: é operação interna por definição, e a UF do cliente
  // não pode transformá-la em interestadual.
  // indFinal escolhido na emissão. `null` enquanto o destino não foi escolhido.
  const indFinalEscolhido = isNfce
    ? 1
    : indFinalDoDestino(fiscalConfig.destinoMercadoria, fiscalConfig.consumidorFinal);
  const difalContexto = useMemo(() => {
    const parceiro = source?.fornecedor ?? source?.cliente;
    const indIEDest = indicadorDoCliente(source?.cliente);
    return {
      ufEmitente: setup?.empresa?.uf ?? null,
      ufDestinatario: isNfce ? (setup?.empresa?.uf ?? null) : parceiro?.uf ?? null,
      tipoOperacao: source?.tipo_operacao ?? "SAIDA",
      // Só a sugestão de DIFAL usa isto. Sem destino escolhido, vale a única
      // regra estrutural: não contribuinte é sempre consumidor final.
      indFinal: indFinalEscolhido ?? (String(indIEDest) === "9" ? 1 : 0),
      indIEDest,
    } satisfies DifalContexto;
  }, [
    isNfce,
    setup?.empresa?.uf,
    source?.fornecedor,
    source?.cliente,
    source?.tipo_operacao,
    indFinalEscolhido,
  ]);

  useEffect(() => {
    setItems((current) => {
      if (!current.length) return current;
      const proximos = current.map((item) => aplicarSugestaoDifal(item, difalContexto));
      return proximos.some((item, index) => item !== current[index]) ? proximos : current;
    });
  }, [difalContexto]);

  const difalAtivo = items.some((item) => item.difalHabilitado);

  const origin = osId ? "OS" : vendaId ? "VENDA" : entradaId ? "ENTRADA" : saidaId ? "SAIDA" : null;
  const originId = osId ?? vendaId ?? entradaId ?? saidaId ?? null;
  const usesEditableRecipient = origin === "ENTRADA" || origin === "SAIDA";
  const productsEndpoint = useMemo(() => {
    if (!origin || !originId) return null;
    // O modelo vai na query porque o padrão fiscal dos itens é por modelo: sem
    // ele, a NFC-e abriria com o perfil tributário cadastrado para a NF-e.
    // Entrada não tem modelo a escolher — é sempre 55.
    if (origin === "OS") return `/api/ordens/${originId}/produtos-para-nfe?modelo=${modelo}`;
    if (origin === "VENDA") return `/api/venda/${originId}/produtos-para-nfe?modelo=${modelo}`;
    if (origin === "ENTRADA") return `/api/entradas/${originId}/produtos-para-nfe`;
    return `/api/estoque/saidas/${originId}/produtos-para-nfe`;
  }, [origin, originId, modelo]);
  const generateEndpoint = useMemo(() => {
    if (!origin || !originId) return null;
    // NFC-e tem rotas próprias: elas fixam o modelo 65 no servidor, para o
    // modelo nunca depender de um campo vindo da tela.
    if (isNfce) {
      if (origin === "OS") return `/api/nfce/de-os/${originId}/gerar-rascunho`;
      if (origin === "VENDA") return `/api/nfce/de-venda/${originId}/gerar-rascunho`;
      return null;
    }
    if (origin === "OS") return `/api/nfe/de-os/${originId}/gerar-rascunho`;
    if (origin === "VENDA") return `/api/nfe/de-venda/${originId}/gerar-rascunho`;
    if (origin === "ENTRADA") return `/api/nfe/de-entrada/${originId}/gerar-rascunho`;
    return `/api/nfe/de-saida/${originId}/gerar-rascunho`;
  }, [origin, originId, isNfce]);

  async function load(signal?: AbortSignal) {
    if (!productsEndpoint) return;
    setLoading(true);
    setLoadError(null);
    setServerError(null);
    try {
      const [productsResponse, setupResponse, saidaFiscalResponse] = await Promise.all([
        fetch(productsEndpoint, { cache: "no-store", signal }),
        // O modelo vai na query: sem ele o setup responde sempre a NF-e, e a
        // tela da NFC-e mostraria a série, o número e o ambiente do modelo 55.
        fetch(`/api/nfe/emissao-assistida/setup?modelo=${modelo}`, {
          cache: "no-store",
          signal,
        }),
        // Natureza fiscal, entradas candidatas e o contexto já gravado da saída.
        // Vem no mesmo carregamento para a origem fiscal ser decidida aqui, sem
        // a tela anterior que existia só para gravá-la antes.
        origin === "SAIDA"
          ? fetch(`/api/estoque/saidas/${originId}/fiscal`, { cache: "no-store", signal })
          : null,
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
      const parceiroUfCfop = modelo === MODELO_NFCE ? fiscalSetup.empresa?.uf : parceiro?.uf;
      const indIEDest = indicadorDoCliente(productsJson.cliente);
      const mapped = productsJson.itens.map((item) =>
        createAssistedItem(item, fiscalSetup, {
          tipoOperacao: productsJson.tipo_operacao ?? "SAIDA",
          parceiroUf: parceiroUfCfop,
          indFinal: modelo === MODELO_NFCE || String(indIEDest) === "9" ? 1 : 0,
          indIEDest,
          modelo,
        }),
      );
      setSetup(fiscalSetup);
      setSource(productsJson);
      setItems(mapped);
      setSelectedIds(mapped.map((item) => item.sourceItemId));
      setEntrySupplier(productsJson.destinatario ?? emptyEntrySupplier);
      const valorFreteOrigem = Math.max(0, Number(productsJson.configuracao_fiscal?.valorFrete ?? 0));
      const totalFiscalSugerido = mapped.reduce(
        (total, item) => total + Math.max(0, item.quantidade * item.valorUnitario - item.valorDesconto),
        valorFreteOrigem,
      );
      setFiscalConfig({
        ...defaultFiscalConfig,
        ...productsJson.configuracao_fiscal,
        // A origem não sugere destino: ele é decisão de quem emite.
        destinoMercadoria: normalizarDestinoMercadoria(productsJson.configuracao_fiscal?.destinoMercadoria) ?? "",
        consumidorFinal: null,
        freteIntegraBaseIcms: null,
        pagamentos: ratearPagamentosParaTotal(
          productsJson.configuracao_fiscal?.pagamentos ?? [],
          totalFiscalSugerido,
        ),
        // Frete cobrado na venda ou na OS. O valor integral é sugerido na NF-e
        // e continua editável antes da emissão.
        valorFrete: valorFreteOrigem,
        transportadora: {
          ...defaultFiscalConfig.transportadora,
          ...productsJson.configuracao_fiscal?.transportadora,
        },
      });
      if (origin === "SAIDA") {
        const saidaJson = (await saidaFiscalResponse?.json().catch(() => null)) as
          | SaidaFiscalResponse
          | null;
        if (!saidaFiscalResponse?.ok || !saidaJson?.ok) {
          throw new Error(
            saidaJson?.message || "Não foi possível carregar a origem fiscal da saída.",
          );
        }
        const operacoes = saidaJson?.operacoes ?? [];
        const contexto = saidaJson?.contexto ?? null;
        const gravadoPorItem = new Map(
          (contexto?.itens ?? []).map((item) => [Number(item.saida_item_id), item]),
        );
        // Sem contexto gravado a natureza abre em branco de propósito: escolher
        // a operação é uma decisão fiscal, não um default a ser herdado.
        const operacaoGravada = operacoes.find(
          (operacao) => operacao.codigo === contexto?.operacao_fiscal_codigo,
        );

        setSaidaOperacoes(operacoes);
        setEntradasCandidatas(saidaJson?.entradasCandidatas ?? []);
        const origemCarregada: SaidaOrigemDraft = {
          operacaoFiscalCodigo: operacaoGravada?.codigo ?? "",
          naturezaOperacao: contexto?.natureza_operacao ?? operacaoGravada?.naturezaOperacao ?? "",
          finalidade: contexto?.finalidade ?? operacaoGravada?.finalidade ?? "NORMAL",
          documentoReferenciadoObrigatorio: Boolean(
            contexto?.documento_referenciado_obrigatorio ??
              operacaoGravada?.exigeDocumentoReferenciado,
          ),
          chaveAcessoReferenciada: contexto?.chave_acesso_referenciada ?? "",
          itens: mapped.map((item) => {
            // `sourceItemId` é "saida:{saidaId}:{itemId}" — o último segmento é
            // a linha da saída, que é a chave do contexto fiscal.
            const saidaItemId = Number(item.sourceItemId.split(":").at(-1));
            const gravado = gravadoPorItem.get(saidaItemId);
            return {
              sourceItemId: item.sourceItemId,
              saidaId: Number(saidaId),
              saidaItemId,
              produtoId: item.produtoId,
              titulo: item.titulo,
              quantidade: item.quantidade,
              entradaItemOrigemId: gravado?.entrada_item_origem_id
                ? Number(gravado.entrada_item_origem_id)
                : null,
              numeroItemReferenciado: gravado?.numero_item_referenciado
                ? Number(gravado.numero_item_referenciado)
                : null,
              percentualDevolucao: Number(gravado?.percentual_devolucao ?? 100),
              valorIpiDevolvido: Number(gravado?.valor_ipi_devolvido ?? 0),
              aviso: null,
            };
          }),
        };
        setSaidaOrigem(origemCarregada);

        // Um contexto já salvo precisa ter o mesmo comportamento de uma entrada
        // escolhida agora: procura as outras baixas físicas daquela NF-e assim
        // que o diálogo abre. Elas continuam desmarcadas para decisão humana.
        const itemComOrigem = origemCarregada.itens.find(
          (item) => item.entradaItemOrigemId && item.saidaId === Number(originId),
        );
        if (itemComOrigem) {
          await buscarSaidasRelacionadas(origemCarregada, itemComOrigem.saidaItemId, {
            fiscalSetup,
            destinatario: productsJson.destinatario ?? emptyEntrySupplier,
            entradas: saidaJson.entradasCandidatas ?? [],
            signal,
          });
        }
      }

      setDescontoGeral(Math.max(0, Number(productsJson.desconto_geral ?? 0)));
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
      setDescontoGeral(0);
      setResumoRelacionadas(null);
      setEntrySupplier(emptyEntrySupplier);
      setFiscalConfig(defaultFiscalConfig);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !productsEndpoint) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // `modelo` entra nas dependências porque o setup é por modelo: trocar de
    // NF-e para NFC-e precisa recarregar série, número e ambiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productsEndpoint, modelo]);

  // Frete da nota rateado nos itens selecionados — mesmo rateio do servidor
  // (`salvarNFeDeOrigem`) — e a decisão sobre ele entrar na base do ICMS
  // próprio. A prévia de cada item usa esses números.
  const temFreteNaNota = !isNfce && (origin === "OS" || origin === "VENDA");
  const fretePorItem = useMemo(() => {
    const porItem = new Map<string, number>();
    if (!temFreteNaNota) return porItem;
    const selecionados = items.filter((item) => selectedIds.includes(item.sourceItemId));
    const rateio = distribuirDinheiro(
      Math.max(0, fiscalConfig.valorFrete),
      selecionados.map((item) =>
        Math.max(0, item.quantidade * item.valorUnitario - Math.max(0, item.valorDesconto)),
      ),
    );
    selecionados.forEach((item, index) => porItem.set(item.sourceItemId, rateio[index] ?? 0));
    return porItem;
  }, [fiscalConfig.valorFrete, items, selectedIds, temFreteNaNota]);
  const freteNaBase = useMemo(
    () =>
      freteNaBaseIcms({
        modFrete: temFreteNaNota ? fiscalConfig.modFrete : "9",
        valorFrete: temFreteNaNota ? Math.max(0, fiscalConfig.valorFrete) : 0,
        decisaoUsuario: fiscalConfig.freteIntegraBaseIcms,
      }),
    [fiscalConfig.freteIntegraBaseIcms, fiscalConfig.modFrete, fiscalConfig.valorFrete, temFreteNaNota],
  );
  // Enquanto a decisão está pendente, a prévia mostra o frete fora da base e a
  // nota não é gerada (ver `freteBaseErrors`).
  const contextoBaseDoItem = useCallback(
    (sourceItemId: string) => ({
      modFrete: fiscalConfig.modFrete,
      indFinal: indFinalEscolhido,
      valorFrete: fretePorItem.get(sourceItemId) ?? 0,
      freteIntegraBaseIcms: freteNaBase.integra ?? false,
      ufEmitente: setup?.empresa?.uf ?? undefined,
      ufDestino:
        (usesEditableRecipient ? entrySupplier.estado : (source?.fornecedor ?? source?.cliente)?.uf) ?? undefined,
      // Mesmos dados que o servidor usa para decidir e calcular o ICMSUFDest; a
      // base do IBS/CBS desconta o DIFAL, então a prévia precisa dele.
      difal:
        isNfce || source?.tipo_operacao === "ENTRADA"
          ? null
          : {
              indIEDest: usesEditableRecipient
                ? entrySupplier.indicadorIe || "9"
                : String(indicadorDoCliente(source?.cliente) ?? "9"),
              tpNF: 1 as const,
              finNFe:
                origin === "SAIDA"
                  ? ({ NORMAL: 1, COMPLEMENTAR: 2, AJUSTE: 3, DEVOLUCAO: 4 } as Record<string, number>)[
                      saidaOrigem.finalidade
                    ] ?? 1
                  : 1,
              ufEntrega: null,
            },
    }),
    [
      fretePorItem,
      freteNaBase.integra,
      fiscalConfig.modFrete,
      indFinalEscolhido,
      setup?.empresa?.uf,
      usesEditableRecipient,
      entrySupplier.estado,
      entrySupplier.indicadorIe,
      source,
      isNfce,
      origin,
      saidaOrigem.finalidade,
    ],
  );

  const issuesByItem = useMemo(() => {
    const map = new Map<string, AssistedItemIssue[]>();
    if (!setup) return map;
    const parceiroUf = usesEditableRecipient
      ? entrySupplier.estado
      : (source?.fornecedor ?? source?.cliente)?.uf;
    const parceiroUfCfop = isNfce ? setup.empresa?.uf : parceiroUf;
    for (const item of items) {
      map.set(
        item.sourceItemId,
        validateAssistedItem(item, setup, {
          tipoOperacao: source?.tipo_operacao ?? "SAIDA",
          parceiroUf: parceiroUfCfop,
          modelo,
          ...contextoBaseDoItem(item.sourceItemId),
        }),
      );
    }
    return map;
  }, [contextoBaseDoItem, entrySupplier.estado, isNfce, items, modelo, setup, source, usesEditableRecipient]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSet.has(item.sourceItemId)),
    [items, selectedSet],
  );
  const selectedIssues = useMemo(
    () =>
      selectedItems.flatMap((item) =>
        (issuesByItem.get(item.sourceItemId) ?? []).map((issue) => ({ ...issue, item })),
      ),
    [issuesByItem, selectedItems],
  );
  const selectedIssuesClassificadas = useMemo(
    () => classificarIssuesFiscais(selectedIssues),
    [selectedIssues],
  );
  const selectedCfopWarnings = useMemo(
    () => selectedItems.filter((item) => Boolean(item.cfopResolution?.warning)),
    [selectedItems],
  );
  const statusDosItens = useMemo(
    () => items.map((item) => classificarIssuesFiscais(issuesByItem.get(item.sourceItemId) ?? [])),
    [issuesByItem, items],
  );
  const readyCount = statusDosItens.filter((status) => status.pronto).length;
  const itemsComBloqueios = statusDosItens.filter((status) => status.bloqueios.length > 0).length;
  const itemsComAvisos = statusDosItens.filter((status) => status.avisos.length > 0).length;
  const freteDaNota = Math.max(0, fiscalConfig.valorFrete);
  const totalItensSelecionados = selectedItems.reduce(
    (total, item) => total + Math.max(0, item.quantidade * item.valorUnitario - item.valorDesconto),
    0,
  );
  // Total já líquido do desconto e com o frete: é o que vai virar vNF e o que os
  // pagamentos precisam fechar.
  const selectedTotal = totalItensSelecionados + freteDaNota;
  const selectedBruto = selectedItems.reduce(
    (total, item) => total + item.quantidade * item.valorUnitario,
    0,
  );
  // O que realmente vai para o ICMSTot/vDesc: soma dos vDesc dos itens da nota,
  // inclusive os ajustados à mão depois do rateio.
  const descontoTotalDaNota = selectedItems.reduce(
    (total, item) => total + Math.max(0, item.valorDesconto),
    0,
  );
  // Numa OS com serviços o campo mostra menos que o desconto da ordem, porque a
  // mão de obra leva a sua parte na NFS-e. Sem os números do rateio à vista, a
  // diferença parece erro de cálculo.
  const descontoOrigem = source?.desconto_origem ?? null;
  const descontoForaDaNota = Math.max(0, Number(descontoOrigem?.servicos ?? 0));
  // O vDesc somado também diverge do campo quando itens ficam fora da nota (o
  // rateio não é refeito ao desmarcar) ou quando alguém edita o desconto de um
  // item na tributação.
  const descontoDivergeDoRateio = Math.abs(descontoTotalDaNota - descontoGeral) >= 0.01;

  // Botões do texto livre. O cliente sai do mesmo `source` que alimenta o
  // destinatário da nota, então o texto casa com quem está sendo emitido — e
  // acompanha a edição feita pelo dialog do cliente.
  const blocosDoTextoLivre = useMemo(
    () => blocosDeObservacao(source?.alvo, source?.cliente),
    [source?.alvo, source?.cliente],
  );

  function adicionarBlocoNasObservacoes(bloco: string) {
    const { texto, truncado } = concatenarBloco(observations, bloco, LIMITE_OBSERVACOES);
    setObservations(texto);
    if (truncado) {
      toast.warning(
        `O texto ultrapassou o limite de ${LIMITE_OBSERVACOES} caracteres. Reduza-o antes de emitir.`,
      );
    }
  }
  const motivoDaDivergencia = selectedIds.length < items.length
    ? "itens fora da nota não levam a parte deles"
    : "algum item teve o desconto ajustado à mão na tributação";

  function aplicarDescontoGeral(valor: number) {
    const limite = Number(selectedBruto.toFixed(2));
    const desconto = Math.max(0, Math.min(valor, limite));
    setDescontoGeral(desconto);
    setItems((current) =>
      ratearDescontoGeralNosItens(current, desconto, (item) => selectedSet.has(item.sourceItemId)),
    );
  }

  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const partiallySelected = selectedIds.length > 0 && selectedIds.length < items.length;
  const editingItem = items.find((item) => item.sourceItemId === editingId) ?? null;
  const editingIssues = editingItem ? issuesByItem.get(editingItem.sourceItemId) ?? [] : [];

  const verbo = corrigindoRejeitada ? "Corrigir" : "Gerar";
  const title = origin === "VENDA"
    ? `${verbo} ${rotulo} da Venda #${originId ?? ""}`
    : origin === "ENTRADA"
      ? `${verbo} ${rotulo} da Entrada #${originId ?? ""}`
      : origin === "SAIDA"
        ? `${verbo} ${rotulo} da Saída #${originId ?? ""}`
      : `${verbo} ${rotulo} da OS #${originId ?? ""}`;
  const parceiro = usesEditableRecipient
    ? { nome: entrySupplier.nomeRazaoSocial, uf: entrySupplier.estado }
    : source?.fornecedor ?? source?.cliente;
  const parceiroLabel = origin === "ENTRADA" ? "Fornecedor" : origin === "SAIDA" ? "Destinatário" : "Cliente";
  const entrySupplierErrors = useMemo(
    () => usesEditableRecipient ? validateEntrySupplier(entrySupplier) : [],
    [entrySupplier, usesEditableRecipient],
  );
  const customerErrors = useMemo(() => {
    if (!(origin === "OS" || origin === "VENDA")) return [];
    // Na NFC-e o consumidor é opcional: o cadastro do cliente não precisa estar
    // fiscalmente completo. O que vale é o documento digitado (se houver) e a
    // regra de valor da UF.
    if (isNfce) return validarConsumidorNfce(consumidorDoc, selectedTotal, setup?.empresa?.uf);
    return validateFiscalCustomer(source?.cliente);
  }, [origin, source?.cliente, isNfce, consumidorDoc, selectedTotal, setup?.empresa?.uf]);
  const customerNameWillTruncate =
    !isNfce &&
    (origin === "OS" || origin === "VENDA") &&
    sanitizeString(source?.cliente?.nomerazaosocial ?? source?.cliente?.nome).length >
      NFE_XNOME_MAX_LENGTH;
  const transportErrors = useMemo(() => {
    // NFC-e sai sempre sem ocorrência de transporte.
    if (isNfce) return [];
    if (!(origin === "OS" || origin === "VENDA") || !["0", "1", "2"].includes(fiscalConfig.modFrete)) {
      return [];
    }
    const errors: string[] = [];
    const document = normalizeCpfOrCnpj(fiscalConfig.transportadora.documento);
    if (!(document.length === 11 ? isValidCpf(document) : isValidCnpj(document))) {
      errors.push("Informe um CPF/CNPJ válido da transportadora.");
    }
    if (!fiscalConfig.transportadora.nome.trim()) errors.push("Informe o nome da transportadora.");
    if (fiscalConfig.transportadora.uf.trim().length !== 2) errors.push("Informe a UF da transportadora.");
    return errors;
  }, [fiscalConfig.modFrete, fiscalConfig.transportadora, origin, isNfce]);
  const paymentErrors = useMemo(() => {
    if (!(origin === "OS" || origin === "VENDA")) return [];
    if (fiscalConfig.pagamentos.length === 0) return ["Selecione pelo menos um método de pagamento."];
    if (fiscalConfig.pagamentos.length === 1) return [];

    const errors: string[] = [];
    if (fiscalConfig.pagamentos.some((pagamento) => pagamento.valor <= 0)) {
      errors.push("Informe um valor maior que zero para cada método.");
    }
    const totalPagamentos = fiscalConfig.pagamentos.reduce((total, pagamento) => total + pagamento.valor, 0);
    if (Math.abs(totalPagamentos - selectedTotal) > 0.01) {
      errors.push(`A soma dos pagamentos deve ser ${fmtMoney(selectedTotal)}.`);
    }
    return errors;
  }, [fiscalConfig.pagamentos, origin, selectedTotal]);

  const freteBaseErrors = useMemo(
    () => (freteNaBase.integra === null ? [freteNaBase.motivo] : []),
    [freteNaBase],
  );

  // NF-e de saída sem destino escolhido não tem indFinal: a nota não é gerada.
  // A entrada própria documenta a compra da empresa e não pergunta destino.
  const destinoErrors = useMemo(() => {
    if (isNfce || origin === "ENTRADA") return [];
    return indFinalEscolhido === null
      ? ["Escolha o destino da mercadoria: é dele que sai o indicador de consumidor final da NF-e."]
      : [];
  }, [indFinalEscolhido, isNfce, origin]);

  // Indicador informativo: mostra o que já está resolvido. Não bloqueia nenhuma
  // seção — todas seguem visíveis e editáveis em qualquer ordem.
  const etapasEmissao = useMemo<EtapaFiscal[]>(
    () => [
      { rotulo: "Emitente", concluida: (setup?.empresaErros.length ?? 0) === 0 },
      {
        rotulo: origin === "ENTRADA" ? "Fornecedor" : isNfce ? "Consumidor" : "Destinatário",
        concluida:
          destinoErrors.length === 0 &&
          (usesEditableRecipient ? entrySupplierErrors.length === 0 : customerErrors.length === 0),
      },
      { rotulo: "Produtos", concluida: selectedItems.length > 0 && selectedIssuesClassificadas.pronto },
      { rotulo: "Pagamento", concluida: paymentErrors.length === 0 },
      // NFC-e não tem etapa de transporte.
      ...(isNfce
        ? []
        : [{ rotulo: "Transporte", concluida: transportErrors.length === 0 && freteBaseErrors.length === 0 }]),
    ],
    [
      setup?.empresaErros.length,
      origin,
      usesEditableRecipient,
      isNfce,
      entrySupplierErrors.length,
      customerErrors.length,
      destinoErrors.length,
      selectedItems.length,
      selectedIssuesClassificadas.pronto,
      paymentErrors.length,
      transportErrors.length,
      freteBaseErrors.length,
    ],
  );

  const paymentMethodsLabel = fiscalConfig.pagamentos.length === 0
    ? "Selecione os métodos"
    : fiscalConfig.pagamentos
        .map((pagamento) => NFE_PAYMENT_OPTIONS.find((option) => option.value === pagamento.meio)?.label ?? pagamento.meio)
        .join(", ");
  const operationLabel =
    setup?.empresa?.uf && parceiro?.uf
      ? setup.empresa.uf === parceiro.uf
        ? `${origin === "ENTRADA" ? "Entrada" : origin === "SAIDA" ? "Saída" : "Venda"} interna · ${setup.empresa.uf}`
        : origin === "ENTRADA"
          ? `Entrada interestadual · ${parceiro.uf} → ${setup.empresa.uf}`
          : `${origin === "SAIDA" ? "Saída" : "Venda"} interestadual · ${setup.empresa.uf} → ${parceiro.uf}`
      : origin === "ENTRADA" ? "Operação de entrada" : "Operação de saída";

  function toggleItem(sourceItemId: string, checked: boolean) {
    const itemDaSaidaPrincipal = origin === "SAIDA" &&
      sourceItemId.startsWith(`saida:${originId}:`);
    if (itemDaSaidaPrincipal && !checked) return;
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
        item.sourceItemId === editingId
          ? aplicarAlteracoesComCienciaFiscal(item, patch)
          : item,
      ),
    );
    setServerError(null);
  }

  function resolveItemCfopForPartner(
    item: AssistedFiscalItem,
    parceiroUf: string | null | undefined,
    tipoOperacao: "SAIDA" | "ENTRADA",
  ): AssistedFiscalItem {
    if (!setup) return item;
    const resolution = resolveCfopForEmission({
      candidates: item.cfopResolution?.attempts.length
        ? item.cfopResolution.attempts.map((attempt) => ({
            value: attempt.originalCfop,
            origin: attempt.origin,
          }))
        : [{ value: item.cfop, origin: "PRODUTO" }],
      modelo,
      operation: tipoOperacao,
      emitterUf: setup.empresa?.uf,
      partnerUf: isNfce ? setup.empresa?.uf : parceiroUf,
    });
    return aplicarAlteracoesComCienciaFiscal(item, {
      cfop: resolution.cfop,
      cfopResolution: resolution,
    });
  }

  function updateEntrySupplier(next: NFeEntrySupplierDraft) {
    if (setup && next.estado !== entrySupplier.estado) {
      setItems((current) =>
        current.map((item) =>
          resolveItemCfopForPartner(
            item,
            next.estado,
            origin === "ENTRADA" ? "ENTRADA" : "SAIDA",
          ),
        ),
      );
    }
    setEntrySupplier(next);
    setServerError(null);
  }

  /**
   * Aponta o destinatário para o fornecedor da entrada escolhida.
   *
   * Só em devolução, e só quando o documento ainda não bate: fora disso a
   * mercadoria não está voltando para quem vendeu, e sobrescrever o que o
   * operador digitou seria errado. O cadastro do fornecedor costuma vir
   * incompleto para fins fiscais, então os campos seguem editáveis abaixo.
   */
  function vincularFornecedorDaEntrada(next: SaidaOrigemDraft, saidaItemId: number) {
    if (next.finalidade !== "DEVOLUCAO") return;
    const alvo = next.itens.find((item) => item.saidaItemId === saidaItemId);
    const candidato = entradasCandidatas.find(
      (item) => Number(item.id) === Number(alvo?.entradaItemOrigemId),
    );
    const entrada = relacaoUnica<any>(candidato?.entrada);
    const fornecedor = relacaoUnica<any>(entrada?.fornecedor);
    if (!fornecedor?.id) return;
    if (normalizeCpfOrCnpj(fornecedor.cpfcnpj) === normalizeCpfOrCnpj(entrySupplier.cpfCnpj)) return;

    updateEntrySupplier({
      // Mantém o que já foi completado à mão (IE, indicador, e-mail) quando o
      // cadastro do fornecedor não traz esses campos.
      ...fornecedorParaDestinatario(fornecedor),
      indicadorIe: entrySupplier.indicadorIe,
      inscricaoEstadual: entrySupplier.inscricaoEstadual,
      email: entrySupplier.email,
    });
  }

  /**
   * Depois que a entrada da saída principal é confirmada, procura outras baixas
   * físicas dos produtos daquela mesma NF-e. As linhas entram desmarcadas: o
   * reconhecimento ajuda, mas a decisão de documentá-las continua humana.
   */
  async function buscarSaidasRelacionadas(
    next: SaidaOrigemDraft,
    saidaItemId: number,
    opcoes?: {
      fiscalSetup?: FiscalSetup;
      destinatario?: NFeEntrySupplierDraft;
      entradas?: EntradaCandidata[];
      signal?: AbortSignal;
    },
  ) {
    const setupAtual = opcoes?.fiscalSetup ?? setup;
    const destinatarioAtual = opcoes?.destinatario ?? entrySupplier;
    const entradasAtuais = opcoes?.entradas ?? entradasCandidatas;
    const alvoInicial = next.itens.find((item) => item.saidaItemId === saidaItemId);
    const entradaCanonica = entradasAtuais.find(
      (item) => Number(item.id) === Number(alvoInicial?.entradaItemOrigemId),
    );
    const numeroCanonico = Number(entradaCanonica?.numero_item_fiscal ?? 0);
    const nextCanonico = Number.isInteger(numeroCanonico) && numeroCanonico >= 1 && numeroCanonico <= 990
      ? {
          ...next,
          itens: next.itens.map((item) =>
            item.saidaItemId === saidaItemId
              ? { ...item, numeroItemReferenciado: numeroCanonico }
              : item,
          ),
        }
      : next;
    const alvo = nextCanonico.itens.find((item) => item.saidaItemId === saidaItemId);
    if (!setupAtual || !originId || !alvo?.entradaItemOrigemId || alvo.saidaId !== Number(originId)) {
      return next;
    }

    setBuscandoRelacionadas(true);
    try {
      const response = await fetch(`/api/estoque/saidas/${originId}/relacionadas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: opcoes?.signal,
        body: JSON.stringify({
          saidaItemId,
          entradaItemOrigemId: alvo.entradaItemOrigemId,
          operacaoFiscalCodigo: nextCanonico.operacaoFiscalCodigo,
          ufDestinatario: destinatarioAtual.estado || null,
        }),
      });
      const json = (await response.json().catch(() => null)) as SaidaRelacionadaResponse | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || "Não foi possível procurar outras saídas desta nota.");
      }

      const candidatos = json.candidatos ?? [];
      const selecionaveis = candidatos.filter((candidato) => candidato.selecionavel);
      const novosItens = selecionaveis.map((candidato) =>
        createAssistedItem(candidato.item, setupAtual, {
          tipoOperacao: "SAIDA",
          parceiroUf: modelo === MODELO_NFCE ? setupAtual.empresa?.uf : destinatarioAtual.estado,
          indFinal: indFinalEscolhido ?? (destinatarioAtual.indicadorIe === "9" ? 1 : 0),
          indIEDest: destinatarioAtual.indicadorIe,
          modelo,
        }),
      );
      const itensPrincipais = nextCanonico.itens.filter((item) => item.saidaId === Number(originId));
      const itensRelacionados = selecionaveis.map((candidato) => {
        const quantidadeEntrada = Number(candidato.entradaCandidata?.quantidade ?? 0);
        return {
          sourceItemId: candidato.sourceItemId,
          saidaId: candidato.saidaId,
          saidaItemId: candidato.saidaItemId,
          produtoId: candidato.item.produtoId,
          titulo: candidato.item.titulo,
          quantidade: candidato.item.quantidade,
          entradaItemOrigemId: candidato.entradaItemOrigemId,
          numeroItemReferenciado: candidato.numeroItemReferenciado,
          percentualDevolucao: quantidadeEntrada > 0
            ? Math.min(100, Number(((candidato.item.quantidade / quantidadeEntrada) * 100).toFixed(4)))
            : 100,
          valorIpiDevolvido: 0,
          aviso: candidato.confianca === "PRODUTO_UNICO"
            ? "Vínculo sugerido pelo produto; confirme a linha da NF-e de origem."
            : null,
        };
      });
      const nextCompleto = { ...nextCanonico, itens: [...itensPrincipais, ...itensRelacionados] };

      setItems((current) => [
        ...current.filter((item) => item.sourceItemId.startsWith(`saida:${originId}:`)),
        ...novosItens,
      ]);
      // A saída que abriu o diálogo permanece como estava; sugestões novas não
      // são marcadas automaticamente.
      setSelectedIds((current) =>
        current.filter((sourceItemId) => sourceItemId.startsWith(`saida:${originId}:`)),
      );
      setSaidaOrigem(nextCompleto);
      setEntradasCandidatas((current) => {
        const byId = new Map(current.map((item) => [Number(item.id), item]));
        candidatos.forEach((candidato) => {
          if (candidato.entradaCandidata) {
            byId.set(Number(candidato.entradaCandidata.id), candidato.entradaCandidata);
          }
        });
        return Array.from(byId.values());
      });
      setResumoRelacionadas({
        encontradas: selecionaveis.length,
        indisponiveis: candidatos.length - selecionaveis.length,
      });

      await Promise.all([
        aplicarEspelhoFiscal(nextCompleto, saidaItemId, destinatarioAtual.estado),
        ...itensRelacionados
          .filter((item) => item.numeroItemReferenciado)
          .map((item) => aplicarEspelhoFiscal(
            nextCompleto,
            item.saidaItemId,
            destinatarioAtual.estado,
          )),
      ]);
      return nextCompleto;
    } catch (error: any) {
      if (error?.name === "AbortError") return nextCanonico;
      setResumoRelacionadas(null);
      toast.warning(error?.message || "Não foi possível procurar outras saídas desta nota.");
      await aplicarEspelhoFiscal(nextCanonico, saidaItemId, destinatarioAtual.estado);
      return nextCanonico;
    } finally {
      setBuscandoRelacionadas(false);
    }
  }

  /**
   * Busca o perfil tributário da NF-e que trouxe a mercadoria e aplica no item.
   *
   * A devolução tem de espelhar a compra, então o que vem do XML de origem
   * sobrepõe o que o cadastro do produto sugeriu — inclusive o CFOP, já
   * convertido para saída, que é o que decide entre 5202 e 5411. Quando a nota
   * de entrada não está guardada no sistema, o servidor devolve um aviso e os
   * campos continuam com o que veio do cadastro.
   */
  async function aplicarEspelhoFiscal(
    next: SaidaOrigemDraft,
    saidaItemId: number,
    ufDestinatario = entrySupplier.estado,
  ) {
    const alvo = next.itens.find((item) => item.saidaItemId === saidaItemId);
    if (!originId || !alvo?.entradaItemOrigemId) return;

    setEspelhando(true);
    try {
      const response = await fetch(`/api/estoque/saidas/${alvo.saidaId}/espelho-fiscal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ufDestinatario: ufDestinatario || null,
          // A natureza decide o destino da compra e, com a presença de ST no
          // documento de origem, a linha da tabela de CFOP de devolução.
          operacaoFiscalCodigo: next.operacaoFiscalCodigo,
          itens: [{
            saidaItemId,
            entradaItemOrigemId: alvo.entradaItemOrigemId,
            numeroItemReferenciado: alvo.numeroItemReferenciado,
          }],
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.message || "Não foi possível ler a NF-e de origem.");
      }

      const espelho = (json.itens ?? [])[0];
      if (!espelho) return;

      setSaidaOrigem((current) => ({
        ...current,
        itens: current.itens.map((item) =>
          item.saidaItemId === saidaItemId ? { ...item, aviso: espelho.aviso ?? null } : item,
        ),
      }));
      setItems((current) =>
        current.map((item) =>
          item.sourceItemId === alvo.sourceItemId
            ? aplicarCamposFiscais(item, espelho)
            : item,
        ),
      );
    } catch (error: any) {
      setSaidaOrigem((current) => ({
        ...current,
        itens: current.itens.map((item) =>
          item.saidaItemId === saidaItemId
            ? { ...item, aviso: error?.message || "Erro ao ler a NF-e de origem." }
            : item,
        ),
      }));
    } finally {
      setEspelhando(false);
    }
  }

  function togglePaymentMethod(meio: string) {
    setFiscalConfig((current) => ({
      ...current,
      pagamentos: current.pagamentos.some((pagamento) => pagamento.meio === meio)
        ? current.pagamentos.filter((pagamento) => pagamento.meio !== meio)
        : [...current.pagamentos, { meio, valor: 0 }],
    }));
    setServerError(null);
  }

  function updatePaymentAmount(meio: string, valor: number) {
    setFiscalConfig((current) => ({
      ...current,
      pagamentos: current.pagamentos.map((pagamento) =>
        pagamento.meio === meio ? { ...pagamento, valor } : pagamento,
      ),
    }));
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
        parceiroUf: modelo === MODELO_NFCE ? setup.empresa?.uf : parceiro?.uf,
        indFinal: indFinalEscolhido ?? (String(indicadorDoCliente(json.cliente)) === "9" ? 1 : 0),
        indIEDest: indicadorDoCliente(json.cliente),
        modelo,
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
    const first =
      selectedIssuesClassificadas.bloqueios[0]?.item ??
      selectedIssuesClassificadas.avisos[0]?.item;
    if (first) setEditingId(first.sourceItemId);
  }

  async function generateDraft() {
    if (!generateEndpoint || selectedItems.length === 0) {
      toast.error("Selecione pelo menos um produto.");
      return;
    }
    if (includeObservations && observations.trim().length > LIMITE_OBSERVACOES) {
      toast.error(
        `As observações fiscais devem possuir no máximo ${LIMITE_OBSERVACOES} caracteres.`,
        { description: "Reduza o texto antes de gerar a nota." },
      );
      return;
    }
    if (!selectedIssuesClassificadas.pronto) {
      openFirstPending();
      if (selectedIssuesClassificadas.bloqueios.length > 0) {
        toast.error("Corrija as pendências fiscais dos produtos selecionados.");
      } else {
        toast.warning("Confirme os avisos fiscais dos produtos selecionados.");
      }
      return;
    }
    if (setup?.empresaErros.length) {
      toast.error("Corrija o cadastro fiscal da empresa antes de emitir.");
      return;
    }
    if (entrySupplierErrors.length) {
      toast.error(`Preencha os dados fiscais do ${origin === "ENTRADA" ? "fornecedor" : "destinatário"} antes de emitir.`);
      return;
    }
    if (customerErrors.length) {
      toast.error("Complete os dados fiscais do cliente antes de emitir.");
      setCustomerDialogOpen(true);
      return;
    }
    if (transportErrors.length) {
      toast.error("Complete os dados da transportadora antes de emitir.");
      return;
    }
    if (paymentErrors.length) {
      toast.error(paymentErrors[0]);
      return;
    }
    if (destinoErrors.length) {
      toast.error(destinoErrors[0]);
      return;
    }
    if (freteBaseErrors.length) {
      toast.error("Informe se o frete integra a base do ICMS.", { description: freteBaseErrors[0] });
      return;
    }
    if (origin === "SAIDA") {
      const origemErros = validarOrigemFiscalSaida({
        ...saidaOrigem,
        itens: saidaOrigem.itens.filter((item) => selectedSet.has(item.sourceItemId)),
      });
      if (origemErros.length) {
        toast.error("Complete a origem fiscal da saída.", { description: origemErros[0] });
        return;
      }
    }

    setSaving(true);
    setServerError(null);
    try {
      const response = await fetch(generateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Corrigindo uma rejeitada: o servidor atualiza este rascunho em vez
          // de criar outro, preservando número e chave já alocados.
          ...(nfeId ? { nfeId } : {}),
          itens: selectedItems.map((item) => toApiItem(item, setup ?? undefined)),
          observacoesFiscais:
            includeObservations && observations.trim()
              ? observations.trim()
              : null,
          ...(usesEditableRecipient
            ? {
                destinatario: {
                  ...normalizeFiscalRecipient(entrySupplier),
                  clienteId: null,
                },
              }
            : {}),
          // A origem fiscal da saída viaja no mesmo POST: o servidor grava o
          // contexto e monta a nota numa chamada só, em vez de depender de um
          // PUT anterior feito por outra tela.
          ...(origin === "SAIDA"
            ? {
                destinoMercadoria: fiscalConfig.destinoMercadoria || null,
                consumidorFinal: fiscalConfig.consumidorFinal,
                contextoFiscal: {
                  operacaoFiscalCodigo: saidaOrigem.operacaoFiscalCodigo,
                  naturezaOperacao: saidaOrigem.naturezaOperacao,
                  finalidade: saidaOrigem.finalidade,
                  documentoReferenciadoObrigatorio:
                    saidaOrigem.documentoReferenciadoObrigatorio,
                  chaveAcessoReferenciada: saidaOrigem.chaveAcessoReferenciada,
                  itens: saidaOrigem.itens
                    .filter((item) => selectedSet.has(item.sourceItemId))
                    .map((item) => ({
                    saidaId: item.saidaId,
                    saidaItemId: item.saidaItemId,
                    entradaItemOrigemId: item.entradaItemOrigemId,
                    numeroItemReferenciado: item.numeroItemReferenciado,
                    percentualDevolucao: item.percentualDevolucao,
                    valorIpiDevolvido: item.valorIpiDevolvido,
                  })),
                },
              }
            : {}),
          // NFC-e: só o documento do consumidor viaja. Vazio = consumidor não
          // identificado, que é o caso normal do balcão. O restante do cadastro
          // do cliente não entra no XML do modelo 65.
          ...(isNfce
            ? {
                destinatario: {
                  clienteId: source?.cliente?.id ?? null,
                  cpfCnpj: normalizeCpfOrCnpj(consumidorDoc) || null,
                  nomeRazaoSocial: normalizeCpfOrCnpj(consumidorDoc)
                    ? source?.cliente?.nomerazaosocial ?? source?.cliente?.nome ?? null
                    : null,
                },
              }
            : {}),
          ...(origin === "OS" || origin === "VENDA"
            ? {
                descontoGeral,
                configuracaoFiscal: {
                  destinoMercadoria: isNfce ? null : fiscalConfig.destinoMercadoria || null,
                  ...(isNfce
                    ? { consumidorFinal: true }
                    : fiscalConfig.consumidorFinal === null
                      ? {}
                      : { consumidorFinal: fiscalConfig.consumidorFinal }),
                  indicadorPresenca: fiscalConfig.indicadorPresenca,
                  pagamentos: fiscalConfig.pagamentos.map((pagamento) => ({
                    meio: pagamento.meio,
                    valor: fiscalConfig.pagamentos.length === 1 ? selectedTotal : pagamento.valor,
                    tipoIntegracao: "2",
                  })),
                  // Transporte não existe na NFC-e; o servidor força modFrete 9
                  // de qualquer forma, mas não faz sentido mandar o bloco.
                  ...(isNfce
                    ? {}
                    : {
                        transporte: {
                          modFrete: fiscalConfig.modFrete,
                          valorFrete: freteDaNota,
                          transportadora: fiscalConfig.transportadora,
                          // Só é lido quando a lei não decide sozinha.
                          freteIntegraBaseIcms: fiscalConfig.freteIntegraBaseIcms,
                        },
                      }),
                },
              }
            : {}),
        }),
      });
      const json = (await response.json().catch(() => null)) as GenerateResponse | null;
      if (!response.ok || !json?.ok) {
        const classificadas = classificarIssuesFiscais(json?.errors ?? []);
        const message =
          json?.errors?.[0]?.message || json?.detalhe || json?.message || "Falha ao gerar o rascunho.";
        setServerError(message);
        setServerErrorTom(
          classificadas.bloqueios.length === 0 && classificadas.avisos.length > 0
            ? "AVISO"
            : "BLOQUEIO",
        );
        const firstIndex = json?.errors?.find((error) => error.itemIndex != null)?.itemIndex;
        if (firstIndex != null && selectedItems[firstIndex]) {
          setEditingId(selectedItems[firstIndex].sourceItemId);
        }
        if (classificadas.bloqueios.length === 0 && classificadas.avisos.length > 0) {
          toast.warning(message);
        } else {
          toast.error(message);
        }
        return;
      }

      toast.success("Rascunho de NF-e gerado com sucesso.");
      onAfterGenerate?.(json.nfeId ?? null);
      onOpenChange(false);
    } catch (error: any) {
      const message = error?.message || "Erro ao gerar o rascunho da NF-e.";
      setServerError(message);
      setServerErrorTom("BLOQUEIO");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={FISCAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Os dados da origem, do {parceiroLabel.toLowerCase()} e dos produtos já estão
              preenchidos. Ajuste somente as pendências fiscais.
            </DialogDescription>
          </DialogHeader>

          <CabecalhoFiscal
            icone={<Receipt aria-hidden="true" className="size-6" />}
            eyebrow="Documento fiscal de mercadoria"
            titulo={title}
            descricao={`Os dados da origem, do ${parceiroLabel.toLowerCase()} e dos produtos já estão preenchidos. Ajuste somente as pendências fiscais.`}
            badge={
              originId ? (
                <Badge variant="outline" className="rounded-sm">
                  {origin === "OS" ? "OS" : origin === "VENDA" ? "Venda" : origin === "ENTRADA" ? "Entrada" : "Saída"} #{originId}
                </Badge>
              ) : null
            }
            etapas={etapasEmissao}
          />

          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-4 sm:px-5 sm:pb-5">
            {loading ? <EsqueletoFiscal /> : null}

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
                <section className="flex min-w-0 flex-row gap-2 border border-l-4 border-l-border bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
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

                <Alert>
                  <Hash className="h-4 w-4" />
                  <AlertTitle>
                    Esta nota será a de número {setup.config?.proximoNumero ?? "—"}, série{" "}
                    {setup.config?.serie ?? "—"}
                  </AlertTitle>
                  <AlertDescription>
                    O número é atribuído no envio para a SEFAZ, e não ao gerar o rascunho:
                    enquanto a nota não for autorizada, ele continua livre. Se outra nota for
                    transmitida antes desta, o número desta será o seguinte.
                  </AlertDescription>
                </Alert>

                {origin === "SAIDA" ? (
                  <NfeSaidaOrigemEditor
                    value={saidaOrigem}
                    onChange={setSaidaOrigem}
                    operacoes={saidaOperacoes}
                    entradasCandidatas={entradasCandidatas}
                    selectedSourceIds={selectedIds}
                    espelhando={espelhando || buscandoRelacionadas}
                    onEscolherEntrada={(next, saidaItemId) => {
                      vincularFornecedorDaEntrada(next, saidaItemId);
                      const alvo = next.itens.find((item) => item.saidaItemId === saidaItemId);
                      if (alvo?.saidaId === Number(originId)) {
                        void buscarSaidasRelacionadas(next, saidaItemId);
                      } else {
                        void aplicarEspelhoFiscal(next, saidaItemId);
                      }
                    }}
                  />
                ) : null}

                {origin === "SAIDA" && !isNfce ? (
                  <section className="min-w-0 space-y-3 border border-l-4 border-l-border bg-card p-3 sm:p-4">
                    <div>
                      <p className="font-medium">Destino da mercadoria</p>
                      <p className="text-xs text-muted-foreground">
                        Devolução, remessa ou garantia: diga o que o destinatário fará com a mercadoria.
                        Ser contribuinte do ICMS não responde isso.
                      </p>
                    </div>
                    <DestinoMercadoriaField
                      destino={fiscalConfig.destinoMercadoria}
                      consumidorFinal={fiscalConfig.consumidorFinal}
                      naoContribuinte={entrySupplier.indicadorIe === "9"}
                      onChange={({ destino, consumidorFinal }) =>
                        setFiscalConfig((current) => ({ ...current, destinoMercadoria: destino, consumidorFinal }))
                      }
                    />
                  </section>
                ) : null}

                {origin === "SAIDA" && resumoRelacionadas ? (
                  <Alert>
                    <PackageSearch className="h-4 w-4" />
                    <AlertTitle>
                      {resumoRelacionadas.encontradas > 0
                        ? `${resumoRelacionadas.encontradas} outra(s) saída(s) disponível(is)`
                        : "Nenhuma outra saída disponível"}
                    </AlertTitle>
                    <AlertDescription>
                      {resumoRelacionadas.encontradas > 0
                        ? "Elas aparecem desmarcadas em Produtos da emissão. Marque somente as baixas que deseja reunir nesta NF-e."
                        : "A emissão continua normalmente apenas com a saída que abriu o diálogo."}
                      {resumoRelacionadas.indisponiveis > 0
                        ? ` ${resumoRelacionadas.indisponiveis} baixa(s) foi(ram) ignorada(s) por ambiguidade, quantidade ou NF-e já existente.`
                        : ""}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {usesEditableRecipient ? (
                  <NfeEntrySupplierEditor
                    value={entrySupplier}
                    onChange={updateEntrySupplier}
                    {...(origin === "SAIDA"
                      ? {
                          title: "Destinatário da NF-e de saída",
                          description: "Estes dados serão usados somente nesta nota e não alteram a saída de estoque.",
                          linkedLabel: "Origem fiscal vinculada",
                          unlinkedLabel: "Destinatário informado",
                        }
                      : {})}
                  />
                ) : null}

                {/* NFC-e: identificação do consumidor é opcional. Nada de exigir
                    cadastro fiscal completo de quem comprou no balcão. */}
                {isNfce && (origin === "OS" || origin === "VENDA") ? (
                  <section className="min-w-0 space-y-3 border border-l-4 border-l-border bg-card p-3 sm:p-4">
                    <div className="space-y-1">
                      <p className="font-medium">Consumidor</p>
                      <p className="text-xs text-muted-foreground">
                        Opcional. Deixe em branco para emitir sem identificar o consumidor.
                      </p>
                    </div>

                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1.5">
                        <Label htmlFor="nfce-consumidor-doc">CPF ou CNPJ</Label>
                        <Input
                          id="nfce-consumidor-doc"
                          inputMode="text"
                          onChange={(event) => setConsumidorDoc(event.target.value)}
                          placeholder="CPF ou CNPJ"
                          value={consumidorDoc}
                        />
                      </div>
                      {source.cliente?.cpfcnpj ? (
                        <div className="flex items-end">
                          <Button
                            onClick={() => setConsumidorDoc(normalizeCpfOrCnpj(source.cliente?.cpfcnpj))}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Usar o do cliente ({source.cliente.nome})
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {customerErrors.length > 0 ? (
                      <ul className="space-y-1 text-xs text-destructive">
                        {customerErrors.map((erro) => (
                          <li key={erro}>{erro}</li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}

                {!isNfce && (origin === "OS" || origin === "VENDA") && source.cliente ? (
                  <section className="min-w-0 space-y-3 border border-l-4 border-l-border bg-card p-3 sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">Dados fiscais do cliente</p>
                          {customerErrors.length === 0 ? (
                            <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                              <CheckCircle2 className="h-3 w-3" /> Cadastro completo
                            </Badge>
                          ) : (
                            <Badge variant="destructive">{customerErrors.length} pendência(s)</Badge>
                          )}
                        </div>
                        <p className="break-words text-sm">{source.cliente.nomerazaosocial || source.cliente.nome}</p>
                        {customerNameWillTruncate ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            O nome será reduzido para {NFE_XNOME_MAX_LENGTH} caracteres no XML da NF-e.
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {source.cliente.endereco
                            ? `${source.cliente.endereco}, ${source.cliente.endereconumero || "S/N"} · ${source.cliente.cidade || "Cidade pendente"}/${source.cliente.estado || "UF"}`
                            : "Endereço não informado"}
                        </p>
                      </div>
                      <Button type="button" variant={customerErrors.length ? "default" : "outline"} onClick={() => setCustomerDialogOpen(true)}>
                        <Pencil className="mr-2 h-4 w-4" /> Editar cliente
                      </Button>
                    </div>
                    {customerErrors.length ? (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Complete o cadastro para emitir a NF-e</AlertTitle>
                        <AlertDescription>
                          <ul className="list-disc space-y-0.5 pl-4">
                            {customerErrors.map((error) => <li key={error}>{error}</li>)}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    <ConfirmarIndicadorIe
                      clienteId={source.cliente.id}
                      nomeCliente={source.cliente.nomerazaosocial || source.cliente.nome}
                      inscricaoEstadual={source.cliente.inscricaoestadual}
                      indIeDest={source.cliente.ind_ie_dest}
                      onConfirmado={(indicador) =>
                        setSource((atual) =>
                          atual?.cliente
                            ? { ...atual, cliente: { ...atual.cliente, ind_ie_dest: indicador } }
                            : atual,
                        )
                      }
                    />
                  </section>
                ) : null}

                {origin === "OS" || origin === "VENDA" ? (
                  <section className="min-w-0 space-y-4 border border-l-4 border-l-border bg-card p-3 sm:p-4">
                    <div>
                      <p className="font-medium">Dados da operação</p>
                      <p className="text-xs text-muted-foreground">
                        Revise os dados trazidos da {origin === "OS" ? "ordem de serviço" : "venda"} antes de gerar a {rotulo}.
                      </p>
                    </div>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-2">
                      {/* NFC-e é sempre a consumidor final: não há escolha. */}
                      {isNfce ? null : (
                        <DestinoMercadoriaField
                          destino={fiscalConfig.destinoMercadoria}
                          consumidorFinal={fiscalConfig.consumidorFinal}
                          naoContribuinte={String(indicadorDoCliente(source?.cliente)) === "9"}
                          alertaDifal={difalAtivo}
                          onChange={({ destino, consumidorFinal }) =>
                            setFiscalConfig((current) => ({ ...current, destinoMercadoria: destino, consumidorFinal }))
                          }
                        />
                      )}
                      <div className="min-w-0 space-y-1.5">
                        <Label>Indicador de presença</Label>
                        <Select
                          value={fiscalConfig.indicadorPresenca}
                          onValueChange={(value) => setFiscalConfig((current) => ({ ...current, indicadorPresenca: value }))}
                        >
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {NFE_PRESENCE_OPTIONS
                              // "0" (não se aplica) nunca serve numa saída; "9"
                              // (outros) não descreve venda ao consumidor e a
                              // NFC-e o rejeita.
                              .filter((option) => option.value !== "0" && !(isNfce && option.value === "9"))
                              .map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.value} - {option.label}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label>Métodos de pagamento</Label>
                        <Popover open={paymentMethodsOpen} onOpenChange={setPaymentMethodsOpen} modal>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              aria-expanded={paymentMethodsOpen}
                              className="w-full min-w-0 justify-between px-3 font-normal"
                            >
                              <span className="truncate text-left">{paymentMethodsLabel}</span>
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
                            <Command>
                              <CommandList
                                className="max-h-72 overscroll-contain"
                                onWheel={(event) => event.stopPropagation()}
                              >
                                <CommandGroup>
                                  {NFE_PAYMENT_OPTIONS.filter((option) => option.value !== "90").map((option) => {
                                    const checked = fiscalConfig.pagamentos.some(
                                      (pagamento) => pagamento.meio === option.value,
                                    );
                                    return (
                                      <CommandItem
                                        key={option.value}
                                        value={`${option.value} ${option.label}`}
                                        onSelect={() => togglePaymentMethod(option.value)}
                                        className="gap-2"
                                      >
                                        <Checkbox
                                          checked={checked}
                                          aria-label={`Selecionar ${option.label}`}
                                          className="pointer-events-none"
                                        />
                                        <span className="min-w-0 truncate">
                                          {option.value} - {option.label}
                                        </span>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        {fiscalConfig.pagamentos.length === 1 ? (
                          <p className="text-xs text-muted-foreground">
                            O total da {rotulo} será atribuído a este método.
                          </p>
                        ) : null}
                      </div>
                      {/* Frete e transportadora não existem na NFC-e: venda ao
                          consumidor sai sem ocorrência de transporte. */}
                      <div className={`min-w-0 space-y-1.5 ${isNfce ? "hidden" : ""}`}>
                        <Label>Modalidade do frete</Label>
                        <Select
                          value={fiscalConfig.modFrete}
                          onValueChange={(value) => setFiscalConfig((current) => ({ ...current, modFrete: value }))}
                        >
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {NFE_FREIGHT_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.value} - {option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className={`min-w-0 space-y-1.5 ${isNfce ? "hidden" : ""}`}>
                        <Label>Valor do frete</Label>
                        <ValueInput
                          price={fiscalConfig.valorFrete}
                          setPrice={(valor) => setFiscalConfig((current) => ({
                            ...current,
                            valorFrete: Math.max(0, valor),
                          }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          {origin === "VENDA"
                            ? "Veio da venda e entra no total da NF-e (vFrete), rateado entre os produtos."
                            : "Entra no total da NF-e (vFrete), rateado entre os produtos."}
                        </p>
                        {freteDaNota > 0 && fiscalConfig.modFrete === "9" ? (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">
                            Com frete na nota, escolha a modalidade de quem paga — &quot;sem
                            ocorrência de transporte&quot; não descreve esta operação.
                          </p>
                        ) : null}
                        {freteNaBase.fonte === "LEI" ? (
                          <p className="text-[11px] text-muted-foreground">
                            Transporte do remetente: o frete entra na base do ICMS próprio (LC 87/96,
                            art. 13, §1º, II, &quot;b&quot;) e na base da ST.
                          </p>
                        ) : null}
                      </div>
                      {freteNaBase.fonte === "INCONSISTENTE" ? <p role="alert" className="text-sm text-destructive">{freteNaBase.motivo}</p> : null}
                      {!isNfce && (freteNaBase.fonte === "PENDENTE" || freteNaBase.fonte === "USUARIO") ? (
                        <div className="min-w-0 space-y-1.5 sm:col-span-2">
                          <Label>
                            O frete integra a base do ICMS próprio? <span className="text-destructive">*</span>
                          </Label>
                          <Select
                            value={
                              fiscalConfig.freteIntegraBaseIcms === null
                                ? undefined
                                : fiscalConfig.freteIntegraBaseIcms
                                  ? "SIM"
                                  : "NAO"
                            }
                            onValueChange={(value) =>
                              setFiscalConfig((current) => ({ ...current, freteIntegraBaseIcms: value === "SIM" }))
                            }
                          >
                            <SelectTrigger className="w-full" aria-invalid={fiscalConfig.freteIntegraBaseIcms === null}>
                              <SelectValue placeholder="Escolha conforme a operação" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SIM">Sim, o frete integra a base do ICMS próprio</SelectItem>
                              <SelectItem value="NAO">Não, o frete fica fora da base do ICMS próprio</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            {freteNaBase.fonte === "PENDENTE"
                              ? freteNaBase.motivo
                              : "Fora da hipótese automática da LC 87/96. A escolha fica registrada na nota. Na ST, o frete cobrado entra na base de qualquer forma."}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {fiscalConfig.pagamentos.length > 1 ? (
                      <div className="min-w-0 space-y-3 rounded-md border bg-muted/20 p-3">
                        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium">Distribuição do pagamento</p>
                            <p className="text-xs text-muted-foreground">
                              Informe quanto foi pago em cada método selecionado.
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-medium">Total da NF-e: {fmtMoney(selectedTotal)}</p>
                        </div>
                        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                          {fiscalConfig.pagamentos.map((pagamento) => {
                            const option = NFE_PAYMENT_OPTIONS.find((item) => item.value === pagamento.meio);
                            return (
                              <div key={pagamento.meio} className="min-w-0 space-y-1.5">
                                <Label className="block truncate" title={option?.label}>
                                  {pagamento.meio} - {option?.label ?? "Método de pagamento"}
                                </Label>
                                <ValueInput
                                  price={pagamento.valor}
                                  setPrice={(valor) => updatePaymentAmount(pagamento.meio, valor)}
                                />
                              </div>
                            );
                          })}
                        </div>
                        {paymentErrors.length ? (
                          <p className="text-xs text-destructive">{paymentErrors.join(" ")}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Soma informada: {fmtMoney(fiscalConfig.pagamentos.reduce(
                              (total, pagamento) => total + pagamento.valor,
                              0,
                            ))}
                          </p>
                        )}
                      </div>
                    ) : paymentErrors.length ? (
                      <p className="text-xs text-destructive">{paymentErrors.join(" ")}</p>
                    ) : null}

                    {!isNfce && ["0", "1", "2"].includes(fiscalConfig.modFrete) ? (
                      <div className="space-y-3 border-t pt-3">
                        <p className="text-sm font-medium">Transportadora contratada</p>
                        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <div className="min-w-0 space-y-1.5">
                            <Label>CPF/CNPJ *</Label>
                            <Input
                              value={fiscalConfig.transportadora.documento}
                              inputMode="text"
                              onChange={(event) => setFiscalConfig((current) => ({
                                ...current,
                                transportadora: {
                                  ...current.transportadora,
                                  documento: normalizeCpfOrCnpj(event.target.value).slice(0, 14),
                                },
                              }))}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5 lg:col-span-2">
                            <Label>Nome/Razão social *</Label>
                            <Input
                              value={fiscalConfig.transportadora.nome}
                              onChange={(event) => setFiscalConfig((current) => ({
                                ...current,
                                transportadora: { ...current.transportadora, nome: event.target.value },
                              }))}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label>Inscrição estadual</Label>
                            <Input
                              value={fiscalConfig.transportadora.inscricaoEstadual}
                              onChange={(event) => setFiscalConfig((current) => ({
                                ...current,
                                transportadora: { ...current.transportadora, inscricaoEstadual: event.target.value },
                              }))}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label>Município</Label>
                            <Input
                              value={fiscalConfig.transportadora.municipio}
                              onChange={(event) => setFiscalConfig((current) => ({
                                ...current,
                                transportadora: { ...current.transportadora, municipio: event.target.value },
                              }))}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label>UF *</Label>
                            <Input
                              value={fiscalConfig.transportadora.uf}
                              maxLength={2}
                              onChange={(event) => setFiscalConfig((current) => ({
                                ...current,
                                transportadora: { ...current.transportadora, uf: event.target.value.toUpperCase().slice(0, 2) },
                              }))}
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-3">
                            <Label>Endereço</Label>
                            <Input
                              value={fiscalConfig.transportadora.endereco}
                              onChange={(event) => setFiscalConfig((current) => ({
                                ...current,
                                transportadora: { ...current.transportadora, endereco: event.target.value },
                              }))}
                            />
                          </div>
                        </div>
                        {transportErrors.length ? (
                          <p className="text-xs text-destructive">{transportErrors.join(" ")}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
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
                    <AlertTitle>Complete os dados do {origin === "ENTRADA" ? "fornecedor" : "destinatário"} da nota</AlertTitle>
                    <AlertDescription className="min-w-0 [overflow-wrap:anywhere]">
                      {entrySupplierErrors.join(" ")}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {serverError ? (
                  <Alert
                    variant={serverErrorTom === "BLOQUEIO" ? "destructive" : "default"}
                    className={
                      serverErrorTom === "AVISO"
                        ? "min-w-0 overflow-hidden border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
                        : "min-w-0 overflow-hidden"
                    }
                  >
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>
                      {serverErrorTom === "AVISO"
                        ? "A validação do servidor encontrou um aviso fiscal"
                        : "A validação do servidor encontrou uma pendência"}
                    </AlertTitle>
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
                  <section className="min-w-0 space-y-3 border border-l-4 border-l-border bg-card p-3 sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex flex-wrap items-center gap-2">
                        <Package className="h-4 w-4 shrink-0 text-primary" />
                        <span className="text-sm font-medium">Produtos da emissão</span>
                        <Badge variant="outline">{readyCount} de {items.length} prontos</Badge>
                        {itemsComBloqueios > 0 ? (
                          <Badge variant="destructive">
                            {itemsComBloqueios} {itemsComBloqueios === 1 ? "com pendência" : "com pendências"}
                          </Badge>
                        ) : null}
                        {itemsComAvisos > 0 ? (
                          <Badge
                            variant="outline"
                            className="border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            {itemsComAvisos} {itemsComAvisos === 1 ? "com aviso a confirmar" : "com avisos a confirmar"}
                          </Badge>
                        ) : null}
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={allSelected ? true : partiallySelected ? "indeterminate" : false}
                          onCheckedChange={(checked) =>
                            setSelectedIds(
                              checked
                                ? items.map((item) => item.sourceItemId)
                                : origin === "SAIDA"
                                  ? items
                                      .filter((item) => item.sourceItemId.startsWith(`saida:${originId}:`))
                                      .map((item) => item.sourceItemId)
                                  : [],
                            )
                          }
                        />
                        Selecionar todos
                      </label>
                    </div>
                    <Separator />

                    <div className="min-w-0 space-y-2 rounded-md border bg-muted/20 p-3">
                      {origin !== "SAIDA" ? (
                        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-start">
                        <div className="min-w-0 space-y-1.5">
                          <Label>Desconto geral da nota</Label>
                          <ValueInput price={descontoGeral} setPrice={aplicarDescontoGeral} />
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground sm:pt-7">
                          Veio da {origin === "VENDA" ? "venda" : "OS"} e já foi rateado nos produtos
                          proporcionalmente ao valor de cada um, com a sobra de centavos no último item.
                          Alterar aqui refaz o rateio sobre os itens selecionados; depois disso cada item
                          ainda pode ser ajustado à mão na tributação.
                        </p>
                        </div>
                      ) : null}

                      {/* Só aparece quando o desconto da origem foi partido entre
                          produtos e serviços: é a conta que explica o valor do campo. */}
                      {descontoOrigem && descontoForaDaNota > 0 ? (
                        <div className="min-w-0 space-y-1.5 rounded-md border border-dashed p-2.5">
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            A {origin === "VENDA" ? "venda" : "OS"} deu{" "}
                            <b className="text-foreground">{fmtMoney(descontoOrigem.total)}</b> de desconto
                            sobre {fmtMoney(descontoOrigem.baseProdutos + descontoOrigem.baseServicos)} em
                            produtos e serviços. O desconto é rateado proporcionalmente, e esta NF-e leva
                            só a parte dos produtos:
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                            <span>
                              Produtos ({fmtMoney(descontoOrigem.baseProdutos)}):{" "}
                              <b className="text-foreground">- {fmtMoney(descontoOrigem.produtos)}</b> nesta
                              NF-e
                            </span>
                            <span>
                              Serviços ({fmtMoney(descontoOrigem.baseServicos)}):{" "}
                              <b className="text-foreground">- {fmtMoney(descontoForaDaNota)}</b> na NFS-e
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Produtos: <b>{fmtMoney(selectedBruto)}</b></span>
                        <span>Desconto (vDesc): <b>- {fmtMoney(descontoTotalDaNota)}</b></span>
                        {freteDaNota > 0 ? (
                          <span>Frete (vFrete): <b>+ {fmtMoney(freteDaNota)}</b></span>
                        ) : null}
                        <span>Total da NF-e: <b>{fmtMoney(selectedTotal)}</b></span>
                      </div>
                      {origin !== "SAIDA" && descontoDivergeDoRateio ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          O vDesc somado ({fmtMoney(descontoTotalDaNota)}) não bate com o desconto geral
                          acima ({fmtMoney(descontoGeral)}): {motivoDaDivergencia}. Vale a nota o vDesc dos
                          itens.
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2 grid lg:grid-cols-2 gap-2">
                      {items.map((item) => {
                        const issues = issuesByItem.get(item.sourceItemId) ?? [];
                        const issuesClassificadas = classificarIssuesFiscais(issues);
                        const selected = selectedSet.has(item.sourceItemId);
                        const itemSaidaId = item.sourceItemId.startsWith("saida:")
                          ? Number(item.sourceItemId.split(":")[1])
                          : null;
                        const itemDaSaidaPrincipal = origin === "SAIDA" && itemSaidaId === Number(originId);
                        return (
                          <article
                            key={item.sourceItemId}
                            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                          >
                            <Checkbox
                              checked={selected}
                              disabled={itemDaSaidaPrincipal}
                              className="mt-1"
                              onCheckedChange={(checked) => toggleItem(item.sourceItemId, Boolean(checked))}
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                                  {item.titulo}
                                </span>
                                {itemSaidaId ? (
                                  <Badge variant={itemDaSaidaPrincipal ? "default" : "secondary"}>
                                    Saída #{itemSaidaId}{itemDaSaidaPrincipal ? " · obrigatória" : ""}
                                  </Badge>
                                ) : null}
                                {issuesClassificadas.pronto ? (
                                  <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                                    <CheckCircle2 className="h-3 w-3" /> Pronto
                                  </Badge>
                                ) : null}
                                {issuesClassificadas.bloqueios.length > 0 ? (
                                  <Badge variant="destructive" className="gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    {issuesClassificadas.bloqueios.length}{" "}
                                    {issuesClassificadas.bloqueios.length === 1 ? "pendência" : "pendências"}
                                  </Badge>
                                ) : null}
                                {issuesClassificadas.avisos.length > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                  >
                                    <AlertCircle className="h-3 w-3" />
                                    {issuesClassificadas.avisos.length}{" "}
                                    {issuesClassificadas.avisos.length === 1 ? "aviso fiscal" : "avisos fiscais"}
                                  </Badge>
                                ) : null}
                                {issuesClassificadas.informativos.length > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-sky-400 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                                  >
                                    <Info className="h-3 w-3" />
                                    {issuesClassificadas.informativos.length}{" "}
                                    {issuesClassificadas.informativos.length === 1 ? "informação" : "informações"}
                                  </Badge>
                                ) : null}
                                {item.ncm ? <Badge variant="outline">NCM {item.ncm}</Badge> : null}
                                {item.cfop ? <Badge variant="outline">CFOP {item.cfop}</Badge> : null}
                                {item.csosn ? <Badge variant="outline">CSOSN {item.csosn}</Badge> : null}
                                {item.cst ? <Badge variant="outline">CST {item.cst}</Badge> : null}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>Quantidade: <b>{item.quantidade}</b></span>
                                <span>Unitário: <b>{fmtMoney(item.valorUnitario)}</b></span>
                                {item.valorDesconto > 0 ? (
                                  <span>Desconto: <b>- {fmtMoney(item.valorDesconto)}</b></span>
                                ) : null}
                                <span>
                                  Total: <b>{fmtMoney(Math.max(0, item.quantidade * item.valorUnitario - item.valorDesconto))}</b>
                                </span>
                              </div>
                              {issuesClassificadas.bloqueios.length > 0 ? (
                                <ul className="min-w-0 list-disc space-y-0.5 pl-4 text-xs text-destructive [overflow-wrap:anywhere]">
                                  {issuesClassificadas.bloqueios.slice(0, 3).map((issue, index) => (
                                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                                  ))}
                                  {issuesClassificadas.bloqueios.length > 3 ? (
                                    <li>
                                      Mais {issuesClassificadas.bloqueios.length - 3}{" "}
                                      {issuesClassificadas.bloqueios.length - 3 === 1 ? "pendência" : "pendências"}
                                    </li>
                                  ) : null}
                                </ul>
                              ) : null}
                              {issuesClassificadas.avisos.length > 0 ? (
                                <ul className="min-w-0 list-disc space-y-0.5 pl-4 text-xs text-amber-700 dark:text-amber-400 [overflow-wrap:anywhere]">
                                  {issuesClassificadas.avisos.slice(0, 3).map((issue, index) => (
                                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                                  ))}
                                  {issuesClassificadas.avisos.length > 3 ? (
                                    <li>
                                      Mais {issuesClassificadas.avisos.length - 3}{" "}
                                      {issuesClassificadas.avisos.length - 3 === 1 ? "aviso fiscal" : "avisos fiscais"}
                                    </li>
                                  ) : null}
                                </ul>
                              ) : null}
                              {issuesClassificadas.informativos.length > 0 ? (
                                <ul className="min-w-0 list-disc space-y-0.5 pl-4 text-xs text-sky-700 dark:text-sky-400 [overflow-wrap:anywhere]">
                                  {issuesClassificadas.informativos.slice(0, 3).map((issue, index) => (
                                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                                  ))}
                                </ul>
                              ) : null}
                              {item.cfopResolution?.warning ? (
                                <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400 [overflow-wrap:anywhere]">
                                  {item.cfopResolution.warning}
                                </p>
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
                                variant={issuesClassificadas.pronto ? "ghost" : "outline"}
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

                <section className="min-w-0 space-y-3 border border-l-4 border-l-border bg-card p-3 sm:p-4">
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
                    <>
                      {blocosDoTextoLivre.length > 0 ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          {blocosDoTextoLivre.map((bloco) => (
                            <Button
                              key={bloco.rotulo}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-sm text-xs"
                              onClick={() => adicionarBlocoNasObservacoes(bloco.texto)}
                            >
                              <Plus aria-hidden="true" className="mr-1 size-3.5" />
                              {bloco.rotulo}
                            </Button>
                          ))}
                          <span className="text-[11px] text-muted-foreground">
                            Acrescenta ao texto atual — apague o que não quiser levar.
                          </span>
                        </div>
                      ) : null}
                      <Textarea
                        id="nfe-origin-observations-text"
                        value={observations}
                        className="min-h-20 resize-none"
                        onChange={(event) => setObservations(event.target.value)}
                      />
                      <p
                        className={`text-right text-xs tabular-nums ${
                          observations.length > LIMITE_OBSERVACOES
                            ? "font-medium text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {observations.length}/{LIMITE_OBSERVACOES}
                      </p>
                    </>
                  ) : null}
                </section>

              </>
            ) : null}
          </div>

          {!loading && setup ? (
            <BarraAcaoFiscal
              resumo={
                <>
                  <p>
                    <b>{selectedItems.length}</b> produto(s) selecionado(s) ·{" "}
                    <b>{fmtMoney(selectedTotal)}</b>
                  </p>
                  {selectedIssuesClassificadas.bloqueios.length > 0 ? (
                    <p className="text-xs text-destructive">
                      Existem {selectedIssuesClassificadas.bloqueios.length}{" "}
                      {selectedIssuesClassificadas.bloqueios.length === 1 ? "pendência" : "pendências"}{" "}
                      nos itens selecionados.
                    </p>
                  ) : null}
                  {selectedIssuesClassificadas.avisos.length > 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Existem {selectedIssuesClassificadas.avisos.length}{" "}
                      {selectedIssuesClassificadas.avisos.length === 1
                        ? "aviso fiscal a confirmar"
                        : "avisos fiscais a confirmar"}.
                    </p>
                  ) : null}
                  {selectedIssuesClassificadas.pronto ? (
                    <p className="text-xs text-muted-foreground">
                      Todos os itens selecionados passaram pela validação fiscal.
                    </p>
                  ) : null}
                  {selectedCfopWarnings.length > 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {selectedCfopWarnings.length} item(ns) tiveram o CFOP substituído por uma opção válida.
                    </p>
                  ) : null}
                </>
              }
              acoes={
                <>
                  {!selectedIssuesClassificadas.pronto ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full rounded-sm sm:w-auto"
                      onClick={openFirstPending}
                    >
                      {selectedIssuesClassificadas.bloqueios.length > 0
                        ? selectedIssuesClassificadas.avisos.length > 0
                          ? "Revisar pendências e avisos"
                          : "Corrigir pendências"
                        : "Revisar avisos fiscais"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    className="min-h-11 w-full whitespace-normal rounded-sm text-center sm:w-auto"
                    disabled={
                      saving ||
                      selectedItems.length === 0 ||
                      !selectedIssuesClassificadas.pronto ||
                      setup.empresaErros.length > 0 ||
                      entrySupplierErrors.length > 0 ||
                      customerErrors.length > 0 ||
                      transportErrors.length > 0 ||
                      paymentErrors.length > 0
                    }
                    onClick={() => void generateDraft()}
                  >
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Gerar rascunho de NF-e
                  </Button>
                </>
              }
            />
          ) : null}
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
          contextoBase={editingItem ? contextoBaseDoItem(editingItem.sourceItemId) : undefined}
          modelo={modelo}
          tipoOperacao={source?.tipo_operacao ?? "SAIDA"}
          parceiroUf={
            isNfce
              ? setup.empresa?.uf
              : usesEditableRecipient
                ? entrySupplier.estado
                : (source?.fornecedor ?? source?.cliente)?.uf
          }
          onChange={updateEditingItem}
        />
      ) : null}
      {source?.cliente ? (
        <CustomerDialog
          customerId={source.cliente.id}
          isOpen={customerDialogOpen}
          setIsOpen={setCustomerDialogOpen}
          onUpdate={(customer) => {
            const updated = customerToFiscalCustomer(customer);
            setSource((current) => current ? { ...current, cliente: updated } : current);
            if (setup && updated.uf !== source.cliente?.uf) {
              setItems((current) =>
                current.map((item) => resolveItemCfopForPartner(item, updated.uf, "SAIDA")),
              );
            }
            setCustomerDialogOpen(false);
            setServerError(null);
          }}
        >
          <span className="hidden" />
        </CustomerDialog>
      ) : null}
    </>
  );
}
