"use client";

import { baseRtcParaEdicao, valorRtcParaEdicao } from "@/lib/nfe/baseIbsCbs";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import axios, { isAxiosError } from "axios";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronsUpDown,
  Eraser,
  FileText,
  Download,
  Hash,
  Loader2,
  Plus,
  Printer,
  Save,
  Search,
  Send,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import formatarEmReal from "@/utils/formatarEmReal";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import ProductSelect from "@/app/(app)/components/productSelect";
import {
  ItemSelectDialog,
  type UsoConsumoItemOption,
} from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";
import {
  ehEstoqueSimples,
  escopoDaOrigemNfe as escopoDaOrigem,
  ESCOPO_PADRAO,
  PREFIXO_ORIGEM_NFE as PREFIXO_ORIGEM,
  rotuloDeEscopo,
} from "@/lib/usoconsumo/escopo";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import type { Customer } from "@/app/(app)/(pages)/clientes/types";
import type { Fornecedor, Produto } from "@/app/(app)/(pages)/estoque/types";
import { NFE_HOMOLOGACAO_DESTINATARIO_NOME } from "@/lib/nfe/constants";
import { isValidCnpj } from "@/lib/nfe/recipientNormalization";
import {
  formatCnpj,
  formatCpf,
  normalizeCnpj,
  normalizeForeignFiscalId,
  normalizeCpf,
  normalizeCpfOrCnpj,
} from "@/lib/fiscal-identifiers";
import { NFE_XNOME_MAX_LENGTH, sanitizeString } from "@/lib/nfe/xmlUtils";
import { chaveAcessoValida } from "@/lib/nfe/chaveAcesso";
import { normalizarIndIEDest, sugerirIndIEDest } from "@/lib/nfe/indIEDest";
import { normalizeCfopForOperation } from "@/lib/nfe/cfopOperation";
import { getRequiredPisCofinsMode, PIS_COFINS_CST_OPTIONS } from "@/lib/nfe/taxRules";
import {
  resolverPadraoFiscalItem,
  type PadraoFiscalItem,
} from "@/lib/nfe/padraoFiscalItem";
import { aplicarSugestaoDifal } from "@/lib/nfe/difal-sugestao";
import { descontoPorItem } from "@/lib/nfe/descontoOrigem";
import { DanfeView, type DanfeViewData } from "@/components/danfe/danfe-view";
import { CfopCombobox } from "@/components/fiscal/cfop-combobox";
import { NcmCombobox } from "@/components/fiscal/ncm-combobox";
import { DestinoMercadoriaField } from "@/components/fiscal/destino-mercadoria-field";
import { FiscalInformationBadge } from "@/components/fiscal/fiscal-information-badge";
import { indFinalDoDestino, type DestinoMercadoria } from "@/lib/nfe/destinoMercadoria";
import { MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import { freteNaBaseIcms, type IcmsCanonico } from "@/lib/nfe/icms";
import {
  alternarCienciaFiscal,
  aplicarAlteracoesComCienciaFiscal,
  avisoFiscalConfirmado,
  classificarIssuesFiscais,
} from "@/lib/nfe/issuesFiscais";
import type { FonteIssueFiscal } from "@/lib/nfe/icms";
import { FontesDoAvisoFiscal } from "@/components/fiscal/fontes-do-aviso-fiscal";
import {
  aplicarResolucaoDifal,
  assinaturaDifalDe,
  resolverDifalDosItens,
  calcularIcmsDoItem,
  toNFeItem,
  icmsInputDoItem,
  tratamentoIcmsDoItem,
  marcarDifalManual,
  overrideDifalDaTela,
  type AssistedFiscalItem,
  type DifalCampoManual,
  type FiscalSetup,
  type ResolucaoDifalTela,
} from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/gerarNotaDeOsDialog/emissao-assistida-model";
import { NfeItemIcmsSection } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/gerarNotaDeOsDialog/nfe-item-icms-section";
import ValueInput from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";
import { dataCivilDeHoje } from "@/lib/fiscal-date";

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
  origem_mercadoria?: string | null;
  unidade?: string | null;
  csosn?: string | null;
  cst?: string | null;
  aliquotaicms?: number | null;
  cst_pis?: string | null;
  aliquota_pis?: number | null;
  modo_pis?: DraftItem["modoPis"] | null;
  aliquota_por_unidade_pis?: number | null;
  cst_cofins?: string | null;
  aliquota_cofins?: number | null;
  modo_cofins?: DraftItem["modoCofins"] | null;
  aliquota_por_unidade_cofins?: number | null;
  cest?: string | null;
  rtc_habilitado?: boolean | null;
  cst_ibscbs?: string | null;
  cclass_trib?: string | null;
  aliquota_ibs_uf?: number | null;
  aliquota_ibs_municipio?: number | null;
  aliquota_cbs?: number | null;
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
  /** Número previsto para a próxima emissão; o definitivo sai na transmissão. */
  proximoNumero?: number | null;
  empresaErros: string[];
  certificadoStatus: string;
  clientes: ClienteSetup[];
  produtos: ProdutoSetup[];
  /**
   * Padrão fiscal de saída cadastrado em Configurações › Fiscal & Pagamentos.
   * Preenche o item onde o produto está em branco — produto preenchido vence.
   */
  padraoFiscalItem: PadraoFiscalItem | null;
  /** Regime do emitente: decide se o item sai com CSOSN ou com CST de ICMS. */
  crt: number | null;
  unidades: string[];
  versaoRegraFiscal: string;
  regrasFiscais: {
    icms: { csosn: string; cst: string; csosnPermitidos: string[]; cstPermitidos: string[] };
    rtc: { status: string; obrigatorioAPartirDe?: string };
  } | null;
  classificacoesRtc: Array<{
    codigo: string;
    cst: string;
    nome: string;
    descricao?: string | null;
    percentualReducaoIbs?: number | null;
    percentualReducaoCbs?: number | null;
    versaoFonte: string;
  }>;
};

type DraftItem = {
  produtoId: number | null;
  /**
   * De onde o item veio, quando não é um produto de venda: `usoconsumo:{id}` ou
   * `geral:{id}`. `nfe_item.produtoid` tem FK para `produto(id)` e não comporta o
   * id de um item de estoque simples — são tabelas separadas e os ids colidem. O
   * rastro fica aqui e é gravado dentro de `tributacao_snapshot`.
   *
   * O prefixo `usoconsumo:` é o histórico e continua valendo: notas gravadas
   * antes do estoque geral são todas de uso e consumo.
   */
  sourceItemId: string | null;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  /**
   * Desconto incondicional do item (vDesc). Nas notas geradas a partir de OS e
   * venda chega preenchido com o desconto do item mais o rateio do desconto
   * geral; aqui é sempre editável.
   */
  valorDesconto: string;
  /**
   * Frete do item (vFrete). Nas notas geradas a partir de uma venda chega com o
   * frete da origem já rateado; soma ao total da NF-e e continua editável.
   */
  valorFrete: string;
  orig: string;
  csosn: string;
  cst: string;
  /** Alíquota da classificação: só vira ICMS próprio se o CST/CSOSN tiver. */
  aliquotaIcms: string;
  /** Blocos de ICMS da emissão, os mesmos da emissão assistida (`NfeItemIcmsSection`). */
  icmsDestacarProprio: boolean;
  pRedBC: string;
  pFCP: string;
  pDif: string;
  icmsReterSt: boolean;
  modBCST: string;
  pMVAST: string;
  pRedBCST: string;
  vBCST: string;
  pICMSST: string;
  vICMSST: string;
  pFCPST: string;
  vBCSTRet: string;
  pST: string;
  vICMSSubstituto: string;
  vICMSSTRet: string;
  vBCFCPSTRet: string;
  pFCPSTRet: string;
  vFCPSTRet: string;
  vICMSDeson: string;
  motDesICMS: string;
  pCredSN: string;
  avisosFiscaisConfirmados: string[];
  cstPis: string;
  aliquotaPis: string;
  cstCofins: string;
  aliquotaCofins: string;
  cest: string;
  modoPis: "" | "PERCENTUAL" | "QUANTIDADE" | "NAO_TRIBUTADO";
  basePis: string;
  quantidadePis: string;
  aliquotaPorUnidadePis: string;
  valorPis: string;
  modoCofins: "" | "PERCENTUAL" | "QUANTIDADE" | "NAO_TRIBUTADO";
  baseCofins: string;
  quantidadeCofins: string;
  aliquotaPorUnidadeCofins: string;
  valorCofins: string;
  rtcHabilitado: boolean;
  cstIbsCbs: string;
  cClassTrib: string;
  baseRtc: string;
  aliquotaIbsUf: string;
  valorIbsUf: string;
  aliquotaIbsMunicipio: string;
  valorIbsMunicipio: string;
  aliquotaCbs: string;
  valorCbs: string;
  /**
   * DIFAL (ICMSUFDest). Sugerido quando a operação exige, mas editável: a
   * alíquota interna do destino muda por lei estadual, NCM e benefício fiscal.
   */
  difalHabilitado: boolean;
  difalAliquotaInterna: string;
  difalAliquotaInterestadual: string;
  difalAliquotaFcp: string;
  difalPercentualPartilha: string;
  difalBaseFcp: string;
  /**
   * Campos editados por cima da resolução automática. São preservados nas
   * próximas consultas e enviados como manuais ao gravar a nota.
   */
  difalCamposManuais: DifalCampoManual[];
  difalResolucao: ResolucaoDifalTela | null;
};

type DraftTransporte = {
  modFrete: "0" | "1" | "2" | "3" | "4" | "9";
  /**
   * O frete cobrado integra a base do ICMS próprio? Só é perguntado quando a
   * lei não responde sozinha (frete com modalidade diferente de 0 e 3).
   */
  freteIntegraBaseIcms: boolean | null;
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

/**
 * Local de entrega/retirada, quando diferente do endereço do destinatário.
 * A pessoa indicada aqui é quem recebe ou retira a mercadoria fisicamente —
 * nunca substitui o destinatário fiscal (grupo `<dest>`), que continua vindo
 * de `DraftPayload["destinatario"]`.
 */
type DraftEntrega = {
  habilitado: boolean;
  tipoPessoa: "FISICA" | "JURIDICA";
  cpfCnpj: string;
  nome: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  codigoMunicipio: string;
};

type DraftPayload = {
  nfeId: number | null;
  currentStep: number;
  operacao: {
    tipoOperacao: "SAIDA" | "ENTRADA";
    naturezaOperacao: string;
    finalidade: "NORMAL" | "COMPLEMENTAR" | "AJUSTE" | "DEVOLUCAO";
    /** Obrigatório na saída: é dele que sai o indFinal. Começa em branco. */
    destinoMercadoria: DestinoMercadoria | "";
    /** Lido na entrada e quando o destino é "OUTRO". */
    consumidorFinal: boolean | null;
    indicadorPresenca: string;
    observacaoInterna: string;
    observacoesFiscais: string;
  };
  pagamento: DraftPayment;
  pagamentos: DraftPayment[];
  /**
   * Desconto geral da nota. Não vai para o XML por si: é rateado nos itens e
   * some dentro do vDesc de cada um, porque o leiaute 4.00 não tem desconto de
   * nota. Fica guardado no rascunho só para a tela reabrir com o mesmo número.
   */
  descontoGeral: string;
  transporte: DraftTransporte;
  entrega: DraftEntrega;
  /**
   * NF-e citadas no grupo <NFref> do <ide>. Devolução (finNFe=4) exige pelo
   * menos uma: sem ela a SEFAZ devolve rejeição 321. Guardamos a chave como
   * digitada; o serviço limpa a máscara antes de montar o XML.
   */
  documentosReferenciados: { chaveAcesso: string }[];
  destinatario: {
    clienteId: number | null;
    fornecedorId: number | null;
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

type DraftPayment = {
  meio: string;
  valor: number;
  tipoIntegracao: "1" | "2";
  cnpjCredenciadora: string;
  bandeira: string;
  autorizacao: string;
  descricao: string;
};

type ValidationError = {
  step: string;
  field?: string;
  itemIndex?: number;
  message: string;
  code?: string;
  severidade?: string;
  requerCiencia?: boolean;
  /** Situação que o servidor analisou; a ciência registra `code@fingerprint`. */
  fingerprint?: string;
  fontes?: FonteIssueFiscal[];
};

type NFeDocumentState = {
  status: string | null;
  chave: string | null;
  protocolo: string | null;
  numero: number | null;
  serie: number | null;
  dataAutorizacao: string | null;
  /** OS, venda ou entrada que originou a nota. Editar aqui não desfaz o vínculo. */
  origemLabel: string | null;
};

const storageKey = "fiscal:nfe-avulsa:draft";

const steps = [
  "Operação",
  "Emitente",
  "Destinatário",
  "Produtos e tributação",
  "Transporte / Entrega",
  "Pagamento",
  "Informações",
  "Revisão",
  "Autorização",
];

const validationStepIndexes: Record<string, number> = {
  operation: 0,
  emitter: 1,
  recipient: 2,
  products: 3,
  transport: 4,
  delivery: 4,
  payment: 5,
  information: 6,
  review: 7,
  authorization: 8,
};

function formatValidationError(error: ValidationError) {
  const stepIndex = validationStepIndexes[error.step];
  const stepLabel = stepIndex === undefined ? "Cadastro" : steps[stepIndex];
  const location = error.itemIndex === undefined
    ? stepLabel
    : `${stepLabel} · Produto ${error.itemIndex + 1}`;

  return `${location}: ${error.message}`;
}

function StatusFiscalDoItemAvulso({ issues }: { issues: ValidationError[] }) {
  const classificadas = classificarIssuesFiscais(issues);
  if (issues.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 md:col-span-12">
      {classificadas.bloqueios.length > 0 ? (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {classificadas.bloqueios.length}{" "}
          {classificadas.bloqueios.length === 1 ? "pendência" : "pendências"}
        </Badge>
      ) : null}
      {classificadas.avisos.length > 0 ? (
        <Badge
          variant="outline"
          className="gap-1 border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <AlertTriangle className="h-3 w-3" />
          {classificadas.avisos.length}{" "}
          {classificadas.avisos.length === 1 ? "aviso fiscal" : "avisos fiscais"}
        </Badge>
      ) : null}
      <FiscalInformationBadge
        messages={classificadas.informativos.map((issue) => issue.message)}
      />
    </div>
  );
}

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

function formatPisCofinsCst(value: string) {
  const option = PIS_COFINS_CST_OPTIONS.find((item) => item.value === value);
  return option ? `${option.value} - ${option.description}` : value;
}

function inferPisCofinsMode(cst: unknown, rate?: unknown): DraftItem["modoPis"] {
  const requiredMode = getRequiredPisCofinsMode(cst);
  if (requiredMode) return requiredMode;
  if (String(cst ?? "").trim() && rate !== null && rate !== undefined && rate !== "") return "PERCENTUAL";
  return "";
}

function getPisCofinsModeOptions(cst: string) {
  const options = [
    { value: "PERCENTUAL", label: "Percentual" },
    { value: "QUANTIDADE", label: "Por quantidade" },
    { value: "NAO_TRIBUTADO", label: "Não tributado" },
  ] as const;
  const requiredMode = getRequiredPisCofinsMode(cst);
  return requiredMode
    ? options.filter((option) => option.value === requiredMode)
    : options.filter((option) => option.value !== "NAO_TRIBUTADO");
}

const emptyItem: DraftItem = {
  produtoId: null,
  sourceItemId: null,
  codigo: "",
  descricao: "",
  ncm: "",
  cfop: "5102",
  unidade: "UN",
  quantidade: "1",
  valorUnitario: "0",
  valorDesconto: "0",
  valorFrete: "0",
  orig: "",
  csosn: "",
  cst: "",
  aliquotaIcms: "",
  icmsDestacarProprio: false,
  pRedBC: "",
  pFCP: "",
  pDif: "",
  icmsReterSt: false,
  modBCST: "",
  pMVAST: "",
  pRedBCST: "",
  vBCST: "",
  pICMSST: "",
  vICMSST: "",
  pFCPST: "",
  vBCSTRet: "",
  pST: "",
  vICMSSubstituto: "",
  vICMSSTRet: "",
  vBCFCPSTRet: "",
  pFCPSTRet: "",
  vFCPSTRet: "",
  vICMSDeson: "",
  motDesICMS: "",
  pCredSN: "",
  avisosFiscaisConfirmados: [],
  cstPis: "",
  aliquotaPis: "",
  cstCofins: "",
  aliquotaCofins: "",
  cest: "",
  modoPis: "",
  basePis: "",
  quantidadePis: "",
  aliquotaPorUnidadePis: "",
  valorPis: "",
  modoCofins: "",
  baseCofins: "",
  quantidadeCofins: "",
  aliquotaPorUnidadeCofins: "",
  valorCofins: "",
  rtcHabilitado: false,
  cstIbsCbs: "",
  cClassTrib: "",
  baseRtc: "",
  aliquotaIbsUf: "",
  valorIbsUf: "",
  aliquotaIbsMunicipio: "",
  valorIbsMunicipio: "",
  aliquotaCbs: "",
  valorCbs: "",
  difalHabilitado: false,
  difalAliquotaInterna: "",
  difalAliquotaInterestadual: "",
  difalAliquotaFcp: "",
  difalPercentualPartilha: "",
  difalBaseFcp: "",
  difalCamposManuais: [],
  difalResolucao: null,
};

const initialDraft: DraftPayload = {
  nfeId: null,
  currentStep: 0,
  operacao: {
    tipoOperacao: "SAIDA",
    naturezaOperacao: "VENDA DE MERCADORIA",
    finalidade: "NORMAL",
    destinoMercadoria: "",
    consumidorFinal: null,
    indicadorPresenca: "1",
    observacaoInterna: "",
    observacoesFiscais: "",
  },
  pagamento: {
    meio: "01",
    valor: 0,
    tipoIntegracao: "2",
    cnpjCredenciadora: "",
    bandeira: "",
    autorizacao: "",
    descricao: "",
  },
  pagamentos: [{
    meio: "01",
    valor: 0,
    tipoIntegracao: "2",
    cnpjCredenciadora: "",
    bandeira: "",
    autorizacao: "",
    descricao: "",
  }],
  descontoGeral: "0",
  transporte: {
    modFrete: "9",
    freteIntegraBaseIcms: null,
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
  entrega: {
    habilitado: false,
    tipoPessoa: "FISICA",
    cpfCnpj: "",
    nome: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    cep: "",
    codigoMunicipio: "",
  },
  documentosReferenciados: [],
  destinatario: {
    clienteId: null,
    fornecedorId: null,
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

/**
 * Aceita `unknown` de propósito: a consulta pública de CNPJ devolve campos
 * numéricos (`cidade.ibge_id`) e omite outros (estabelecimento sem inscrição
 * estadual). Tipar como `string` só escondia isso do compilador — o retorno da
 * API chega como `any` — e estourava "value.replace is not a function" no meio
 * do preenchimento do destinatário.
 */
function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
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
  const document = normalizeCpfOrCnpj(value);
  if (document.length === 11 && /^\d+$/.test(document)) return formatCpf(document);
  if (document.length === 14) return formatCnpj(document);
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
    valor: Math.max(0, parseNumberInput(pagamento.valor)),
    tipoIntegracao,
    cnpjCredenciadora: normalizeCnpj(pagamento.cnpjCredenciadora),
    bandeira: onlyDigits(String(pagamento.bandeira ?? "")),
    autorizacao: String(pagamento.autorizacao ?? ""),
    descricao: String(pagamento.descricao ?? ""),
  };
}

function normalizePagamentos(value: unknown, legacyPayment?: unknown): DraftPayment[] {
  const pagamentos = Array.isArray(value)
    ? value.map(normalizePagamento)
    : legacyPayment
      ? [normalizePagamento(legacyPayment)]
      : initialDraft.pagamentos.map((pagamento) => ({ ...pagamento }));

  const unique = pagamentos.filter(
    (pagamento, index) => pagamentos.findIndex((item) => item.meio === pagamento.meio) === index,
  );
  return unique.length ? unique : initialDraft.pagamentos.map((pagamento) => ({ ...pagamento }));
}

function normalizeTransporte(value: unknown): DraftTransporte {
  const transporte = value && typeof value === "object" ? (value as Partial<DraftTransporte>) : {};
  const modFrete = ["0", "1", "2", "3", "4", "9"].includes(String(transporte.modFrete))
    ? String(transporte.modFrete) as DraftTransporte["modFrete"]
    : "9";

  return {
    modFrete,
    freteIntegraBaseIcms:
      typeof transporte.freteIntegraBaseIcms === "boolean" ? transporte.freteIntegraBaseIcms : null,
    transportadora: {
      ...initialDraft.transporte.transportadora,
      ...(transporte.transportadora ?? {}),
      documento: normalizeCpfOrCnpj(transporte.transportadora?.documento),
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

function normalizeEntrega(value: unknown): DraftEntrega {
  const entrega = value && typeof value === "object" ? (value as Partial<DraftEntrega>) : {};
  const tipoPessoa = entrega.tipoPessoa === "JURIDICA" ? "JURIDICA" : "FISICA";

  return {
    ...initialDraft.entrega,
    ...entrega,
    habilitado: Boolean(entrega.habilitado),
    tipoPessoa,
    cpfCnpj: tipoPessoa === "JURIDICA"
      ? normalizeCnpj(entrega.cpfCnpj)
      : normalizeCpf(entrega.cpfCnpj),
    estado: String(entrega.estado ?? "").toUpperCase().slice(0, 2),
    cep: onlyDigits(String(entrega.cep ?? "")),
    codigoMunicipio: onlyDigits(String(entrega.codigoMunicipio ?? "")),
  };
}

/** Aceita tanto a lista de objetos quanto uma lista de chaves soltas. */
function normalizeReferencias(value: unknown): { chaveAcesso: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((referencia) =>
      typeof referencia === "string"
        ? { chaveAcesso: referencia }
        : { chaveAcesso: String((referencia as any)?.chaveAcesso ?? "") },
    )
    .filter((referencia) => referencia.chaveAcesso.trim() !== "");
}

function normalizePersistedDraft(value: unknown): DraftPayload | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<DraftPayload>;
  if (!draft.operacao || !draft.destinatario || !Array.isArray(draft.itens)) return null;
  const pagamentos = normalizePagamentos(draft.pagamentos, draft.pagamento);
  return {
    ...initialDraft,
    ...draft,
    nfeId: draft.nfeId ?? null,
    currentStep: Number(draft.currentStep ?? 0),
    operacao: {
      ...initialDraft.operacao,
      ...draft.operacao,
    },
    pagamento: pagamentos[0],
    pagamentos,
    transporte: normalizeTransporte(draft.transporte),
    entrega: normalizeEntrega(draft.entrega),
    documentosReferenciados: normalizeReferencias(draft.documentosReferenciados),
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

/**
 * Campos de ICMS informados na emissão, lidos de volta do snapshot do item.
 * Só volta o que foi decisão do usuário: base e ICMS-ST calculados pela MVA ou
 * pelo ICMS próprio são refeitos pelo núcleo ao salvar de novo.
 */
function camposIcmsDoSnapshot(snapshot: any): Partial<DraftItem> {
  const icms = snapshot?.icms as IcmsCanonico | undefined;
  if (!icms) return {};
  const decisao = snapshot?.icmsDecisao;
  const semProprio = icms.vICMS === null;
  return {
    icmsDestacarProprio: icms.vBC !== null,
    pRedBC: stringifyNumber(icms.pRedBC),
    pFCP: stringifyNumber(icms.pFCP),
    pDif: stringifyNumber(icms.pDif),
    icmsReterSt: icms.vBCST !== null,
    modBCST: stringifyNumber(icms.modBCST),
    pMVAST: stringifyNumber(icms.pMVAST),
    pRedBCST: stringifyNumber(icms.pRedBCST),
    vBCST: icms.pMVAST === null ? stringifyNumber(icms.vBCST) : "",
    pICMSST: stringifyNumber(icms.pICMSST),
    vICMSST: semProprio ? stringifyNumber(icms.vICMSST) : "",
    pFCPST: stringifyNumber(icms.pFCPST),
    vBCSTRet: stringifyNumber(icms.vBCSTRet),
    pST: stringifyNumber(icms.pST),
    vICMSSubstituto: stringifyNumber(icms.vICMSSubstituto),
    vICMSSTRet: stringifyNumber(icms.vICMSSTRet),
    vBCFCPSTRet: stringifyNumber(icms.vBCFCPSTRet),
    pFCPSTRet: stringifyNumber(icms.pFCPSTRet),
    vFCPSTRet: stringifyNumber(icms.vFCPSTRet),
    vICMSDeson: stringifyNumber(icms.vICMSDeson),
    motDesICMS: stringifyNumber(icms.motDesICMS),
    pCredSN: stringifyNumber(icms.pCredSN),
    // Só volta a ciência gravada com fingerprint: a de rascunho antigo (só o
    // código) não diz qual situação foi conferida e é pedida de novo.
    avisosFiscaisConfirmados: Array.isArray(decisao?.avisosConfirmados)
      ? decisao.avisosConfirmados
          .filter((aviso: { code?: string; fingerprint?: string }) => aviso?.code && aviso?.fingerprint)
          .map((aviso: { code: string; fingerprint: string }) => `${aviso.code}@${aviso.fingerprint}`)
      : [],
  };
}

/**
 * O frete cobrado na nota integra a base do ICMS próprio? A mesma decisão que o
 * servidor toma em `decisaoFreteDoDraft`: por lei com transporte do remetente,
 * pela escolha do usuário nas demais modalidades.
 */
function freteNaBaseDaAvulsa(draft: DraftPayload) {
  return freteNaBaseIcms({
    modFrete: draft.transporte.modFrete,
    valorFrete: Number(
      draft.itens.reduce((total, item) => total + Math.max(0, parseCurrency(item.valorFrete)), 0).toFixed(2),
    ),
    decisaoUsuario: draft.transporte.freteIntegraBaseIcms,
  });
}

/** Frete do item e decisão da nota, para a prévia calcular a base como o servidor. */
function contextoBaseDaAvulsa(item: DraftItem, draft: DraftPayload, ufEmitente?: string | null) {
  const saida = draft.operacao.tipoOperacao === "SAIDA";
  return {
    modFrete: draft.transporte.modFrete,
    indFinal: indFinalDoDestino(draft.operacao.destinoMercadoria, draft.operacao.consumidorFinal),
    valorFrete: Math.max(0, parseCurrency(item.valorFrete)),
    // Pendente: a prévia mostra o frete fora da base e o servidor não gera a nota.
    freteIntegraBaseIcms: freteNaBaseDaAvulsa(draft).integra ?? false,
    ufEmitente: ufEmitente ?? undefined,
    ufDestino: draft.destinatario.estado || undefined,
    // Mesmos dados que `salvarNFeAvulsaDraft` passa ao DIFAL: a base do IBS/CBS
    // desconta o ICMSUFDest, então a prévia precisa dele.
    difal: saida
      ? {
          indIEDest: draft.destinatario.indicadorIe || "9",
          tpNF: 1 as const,
          finNFe: ({ NORMAL: 1, COMPLEMENTAR: 2, AJUSTE: 3, DEVOLUCAO: 4 } as Record<string, number>)[
            draft.operacao.finalidade
          ] ?? 1,
          ufEntrega: draft.entrega?.habilitado ? draft.entrega.estado || null : null,
        }
      : null,
  };
}

function parametrosDifalDaAvulsa(draft: DraftPayload, setup: SetupResponse | null, dataEmissao: string) {
  return {
    modelo: MODELO_NFE,
    ufEmitente: setup?.empresa?.uf,
    ufDestino: draft.destinatario.estado,
    crt: setup?.empresa?.regimetributario,
    indFinal: indFinalDoDestino(draft.operacao.destinoMercadoria, draft.operacao.consumidorFinal)
      ?? ((draft.destinatario.indicadorIe || "9") === "9" ? 1 : 0),
    indIEDest: draft.destinatario.indicadorIe || "9",
    tpNF: draft.operacao.tipoOperacao === "SAIDA" ? 1 : 0,
    finNFe: ({ NORMAL: 1, COMPLEMENTAR: 2, AJUSTE: 3, DEVOLUCAO: 4 })[draft.operacao.finalidade],
    ufEntrega: draft.entrega.habilitado ? draft.entrega.estado || null : null,
    dataEmissao,
    // A chave da consulta identifica a linha, não o estoque de origem: duas
    // linhas podem vir do mesmo produto e ter classificações diferentes.
    itens: draft.itens.map((item, index) => ({ ...item, sourceItemId: `avulsa:${index}` })),
  };
}

/** O item da avulsa no formato que a seção de ICMS e o núcleo leem. */
function itemAssistidoDaAvulsa(item: DraftItem, index: number): AssistedFiscalItem {
  const quantidade = parseNumberInput(item.quantidade);
  const valorUnitario = parseNumberInput(item.valorUnitario);
  return {
    ...item,
    sourceItemId: item.sourceItemId ?? `avulsa:${index}`,
    produtoId: item.produtoId ?? 0,
    titulo: item.descricao,
    difalResolucao: item.difalResolucao ?? null,
    difalCamposManuais: item.difalCamposManuais ?? [],
    quantidade,
    valorUnitario,
    subtotal: Number((quantidade * valorUnitario).toFixed(2)),
    valorDesconto: parseNumberInput(item.valorDesconto),
    valorDescontoProprio: 0,
    cfopResolution: null,
    procedenciaFiscal: {},
  };
}

function mapServerDraftToPayload(value: any): { draft: DraftPayload; document: NFeDocumentState } {
  const nfe = value?.nfe ?? {};
  const dadosAvulsos = nfe.dados_avulsos ?? {};
  const snapshot = nfe.destinatario_snapshot ?? {};
  const destinatarioOriginal = dadosAvulsos.destinatario ?? {};
  const operacaoOriginal = dadosAvulsos.operacao ?? {};
  const pagamentoOriginal = dadosAvulsos.pagamento ?? {};
  const pagamentosOriginais = normalizePagamentos(dadosAvulsos.pagamentos, pagamentoOriginal);
  const transporteOriginal = dadosAvulsos.transporte ?? {};
  const entregaOriginal = dadosAvulsos.entrega ?? {};
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
      pagamento: pagamentosOriginais[0],
      pagamentos: pagamentosOriginais,
      // Se o rascunho é antigo e não guardou o geral, cai para a soma dos vDesc
      // dos itens — é o número que o usuário reconhece ao reabrir a nota.
      descontoGeral: stringifyNumber(
        dadosAvulsos.descontoGeral ??
          itens.reduce((soma: number, item: any) => soma + Number(item.valor_desconto ?? 0), 0),
        "0",
      ),
      transporte: normalizeTransporte(transporteOriginal),
      entrega: normalizeEntrega(entregaOriginal),
      documentosReferenciados: normalizeReferencias(dadosAvulsos.documentosReferenciados),
      destinatario: {
        ...initialDraft.destinatario,
        ...destinatarioOriginal,
        clienteId: dadosAvulsos.clienteSelecionadoId ?? destinatarioOriginal.clienteId ?? null,
        fornecedorId: dadosAvulsos.fornecedorSelecionadoId ?? destinatarioOriginal.fornecedorId ?? null,
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
            sourceItemId: item.tributacao_snapshot?.sourceItemId ?? null,
            // Sem produto, o código do item vive no snapshot: é ele que virou o
            // cProd do XML, e reabrir o rascunho não pode trocá-lo pelo número
            // da linha.
            codigo: stringifyNumber(
              item.produtoid ?? item.tributacao_snapshot?.codigoProduto ?? item.n_item,
            ),
            descricao: String(item.descricao ?? ""),
            ncm: String(item.ncm ?? ""),
            cfop: String(item.cfop ?? ""),
            unidade: String(item.unidade ?? "UN"),
            quantidade: stringifyNumber(item.quantidade, "1"),
            valorUnitario: stringifyNumber(item.valor_unitario, "0"),
            valorDesconto: stringifyNumber(
              item.valor_desconto ?? item.tributacao_snapshot?.valorDesconto,
              "0",
            ),
            valorFrete: stringifyNumber(item.valor_frete ?? item.tributacao_snapshot?.valorFrete, "0"),
            orig: String(item.tributacao_snapshot?.orig ?? ""),
            csosn: String(item.csosn ?? ""),
            cst: String(item.cst ?? ""),
            // nfe_item.aliquotaicms é o pICMS do XML (vazio no CST 60); a alíquota
            // da classificação fica no snapshot.
            aliquotaIcms: stringifyNumber(item.tributacao_snapshot?.aliquotaIcms ?? item.aliquotaicms),
            ...camposIcmsDoSnapshot(item.tributacao_snapshot),
            cstPis: String(item.cst_pis ?? ""),
            aliquotaPis: stringifyNumber(item.aliquota_pis),
            cstCofins: String(item.cst_cofins ?? ""),
            aliquotaCofins: stringifyNumber(item.aliquota_cofins),
            cest: String(item.cest ?? ""),
            modoPis: item.tributacao_snapshot?.pis?.modo ?? inferPisCofinsMode(item.cst_pis, item.aliquota_pis),
            basePis: stringifyNumber(item.tributacao_snapshot?.pis?.base),
            quantidadePis: stringifyNumber(item.tributacao_snapshot?.pis?.quantidade),
            aliquotaPorUnidadePis: stringifyNumber(item.tributacao_snapshot?.pis?.aliquotaPorUnidade),
            valorPis: stringifyNumber(item.tributacao_snapshot?.pis?.valor),
            modoCofins: item.tributacao_snapshot?.cofins?.modo ?? inferPisCofinsMode(item.cst_cofins, item.aliquota_cofins),
            baseCofins: stringifyNumber(item.tributacao_snapshot?.cofins?.base),
            quantidadeCofins: stringifyNumber(item.tributacao_snapshot?.cofins?.quantidade),
            aliquotaPorUnidadeCofins: stringifyNumber(item.tributacao_snapshot?.cofins?.aliquotaPorUnidade),
            valorCofins: stringifyNumber(item.tributacao_snapshot?.cofins?.valor),
            rtcHabilitado: Boolean(item.tributacao_snapshot?.rtc),
            cstIbsCbs: String(item.tributacao_snapshot?.rtc?.cstIbsCbs ?? ""),
            cClassTrib: String(item.tributacao_snapshot?.rtc?.cClassTrib ?? ""),
            baseRtc: baseRtcParaEdicao(item.tributacao_snapshot?.rtc),
            aliquotaIbsUf: stringifyNumber(item.tributacao_snapshot?.rtc?.ibsUf?.aliquota),
            valorIbsUf: valorRtcParaEdicao(item.tributacao_snapshot?.rtc, "ibsUf"),
            aliquotaIbsMunicipio: stringifyNumber(item.tributacao_snapshot?.rtc?.ibsMunicipio?.aliquota),
            valorIbsMunicipio: valorRtcParaEdicao(item.tributacao_snapshot?.rtc, "ibsMun"),
            aliquotaCbs: stringifyNumber(item.tributacao_snapshot?.rtc?.cbs?.aliquota),
            valorCbs: valorRtcParaEdicao(item.tributacao_snapshot?.rtc, "cbs"),
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
      origemLabel: nfe.ordemservicoid
        ? `OS #${nfe.ordemservicoid}`
        : nfe.vendaid
          ? `Venda #${nfe.vendaid}`
          : nfe.entradaid
            ? `Entrada #${nfe.entradaid}`
            : null,
    },
  };
}

export default function NFeAvulsaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
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
    origemLabel: null,
  });
  const [errors, setErrors] = React.useState<ValidationError[]>([]);
  const errorsClassificados = React.useMemo(() => classificarIssuesFiscais(errors), [errors]);
  const errorsPorItem = React.useMemo(() => {
    const porItem = new Map<number, ValidationError[]>();
    for (const error of errors) {
      if (error.itemIndex === undefined) continue;
      const atuais = porItem.get(error.itemIndex) ?? [];
      atuais.push(error);
      porItem.set(error.itemIndex, atuais);
    }
    return porItem;
  }, [errors]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // Data fiscal da nota, uma só para a tela inteira. A avulsa é emitida agora,
  // e o servidor carimba a data na gravação; aqui ela serve para o catálogo de
  // NCM recortar a vigência pelo mesmo dia que o emitente enxerga — não pelo
  // dia em UTC, que das 21h à meia-noite já é o seguinte.
  const dataEmissaoFiscal = React.useMemo(() => dataCivilDeHoje(), []);

  const difalAtivo = draft.itens.some((item) => item.difalHabilitado);
  const [authorizing, setAuthorizing] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [openCustomerSelect, setOpenCustomerSelect] = React.useState(false);
  const [openFornecedorSelect, setOpenFornecedorSelect] = React.useState(false);
  const [openProductSelect, setOpenProductSelect] = React.useState(false);
  const [openUsoConsumoSelect, setOpenUsoConsumoSelect] = React.useState(false);
  // A busca de itens de uso/consumo exige a permissão do módulo; sem ela a rota
  // recusaria e o botão só levaria a um erro. `estoque:visualizar` já a implica.
  const podeVerUsoConsumo = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.USOCONSUMO,
  );
  const [paymentMethodsOpen, setPaymentMethodsOpen] = React.useState(false);
  const [confirmAuthorizeOpen, setConfirmAuthorizeOpen] = React.useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = React.useState(false);
  // O que a última consulta de CNPJ disse sobre a inscrição estadual. É aviso,
  // não trava: os campos continuam editáveis.
  const [ieConsultada, setIeConsultada] = React.useState<
    { inscricao: string; ativa: boolean; uf: string } | null
  >(null);
  const ultimoCnpjConsultado = React.useRef("");

  // Total já líquido do desconto: é o que vira vNF e o que os pagamentos
  // precisam fechar.
  const totalProdutos = React.useMemo(
    () =>
      draft.itens.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario) -
              parseCurrency(item.valorDesconto),
          ),
        0,
      ),
    [draft.itens],
  );
  const totalBrutoProdutos = React.useMemo(
    () =>
      draft.itens.reduce(
        (sum, item) => sum + parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario),
        0,
      ),
    [draft.itens],
  );
  // Soma dos vDesc que realmente vão para o ICMSTot, inclusive os ajustados à
  // mão depois do rateio.
  const totalDescontoItens = React.useMemo(
    () => draft.itens.reduce((sum, item) => sum + Math.max(0, parseCurrency(item.valorDesconto)), 0),
    [draft.itens],
  );
  // Frete rateado nos itens (vFrete do ICMSTot). Entra no vNF e, por isso, nos
  // pagamentos: é o que o motor valida antes de assinar a nota.
  const totalFreteItens = React.useMemo(
    () => draft.itens.reduce((sum, item) => sum + Math.max(0, parseCurrency(item.valorFrete)), 0),
    [draft.itens],
  );
  const totalNota = totalProdutos + totalFreteItens;

  function aplicarDescontoGeral(valor: number) {
    const desconto = Math.max(0, Math.min(valor, Number(totalBrutoProdutos.toFixed(2))));
    updateDraft((current) => {
      const linhas = current.itens.map((item) => {
        const bruto = Number(
          (parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario)).toFixed(2),
        );
        // Na avulsa não existe desconto "do item" vindo de origem: tudo o que há
        // é o geral sendo distribuído, então o líquido é o próprio bruto.
        return { bruto, liquido: bruto };
      });
      const rateio = descontoPorItem(linhas, desconto);
      return {
        ...current,
        descontoGeral: desconto.toFixed(2),
        itens: current.itens.map((item, index) => ({
          ...item,
          valorDesconto: (rateio[index] ?? 0).toFixed(2),
        })),
      };
    });
  }

  const selectedClienteLabel = draft.destinatario.clienteId
    ? `Cliente: ${draft.destinatario.nomeRazaoSocial || "Cliente selecionado"} - ${formatCpfCnpj(draft.destinatario.cpfCnpj)}`
    : null;
  const selectedFornecedorLabel = draft.destinatario.fornecedorId
    ? `Fornecedor: ${draft.destinatario.nomeRazaoSocial || "Fornecedor selecionado"} - ${formatCpfCnpj(draft.destinatario.cpfCnpj)}`
    : null;
  const ambienteLabel = formatAmbiente(setup?.empresa?.ambiente || setup?.config?.ambiente);
  const isHomologacao = Boolean(setup) && (setup?.empresa?.ambiente || setup?.config?.ambiente) !== "PRODUCAO";
  const isEditingPersistedDraft = Boolean(draft.nfeId);
  const isAutorizada = String(documentState.status ?? "").toUpperCase() === "AUTORIZADA";
  const consultaDifal = parametrosDifalDaAvulsa(draft, setup, dataEmissaoFiscal);
  const assinaturaDifal = assinaturaDifalDe(consultaDifal);

  React.useEffect(() => {
    if (loading || !setup?.empresa?.uf || isAutorizada || !consultaDifal.itens.length) return;
    const controle = new AbortController();
    const corresponde = (current: DraftPayload) =>
      assinaturaDifalDe(parametrosDifalDaAvulsa(current, setup, dataEmissaoFiscal)) === assinaturaDifal;

    // Invalida alíquotas automáticas do contexto anterior enquanto consulta o
    // motor. Os campos manuais permanecem; uma falha não restaura valores velhos.
    setDraft((current) => {
      if (controle.signal.aborted || !corresponde(current)) return current;
      // Limpa ANTES de sugerir. `aplicarSugestaoDifal` só preenche campo vazio:
      // na ordem inversa ela não substituiria a interestadual do contexto
      // anterior, e a limpeza seguinte apagaria as duas. Assim a interestadual
      // e a partilha — que saem da origem da mercadoria e da geografia, sem
      // depender do banco — já ficam certas para o contexto novo, mesmo que a
      // consulta ao motor falhe. O que depende de regra continua vazio, e é
      // isso que segura a emissão.
      const limpos = aplicarResolucaoDifal(current.itens, new Map(), (_, index) => `avulsa:${index}`);
      const itens = limpos.map((item) => aplicarSugestaoDifal(item, {
        ufEmitente: consultaDifal.ufEmitente,
        ufDestinatario: consultaDifal.ufDestino,
        tipoOperacao: current.operacao.tipoOperacao,
        indFinal: consultaDifal.indFinal,
        indIEDest: consultaDifal.indIEDest,
        crt: consultaDifal.crt,
        modelo: MODELO_NFE,
      }));
      return itens.some((item, index) => item !== current.itens[index]) ? { ...current, itens } : current;
    });

    const timer = setTimeout(async () => {
      const resolucoes = await resolverDifalDosItens({ ...consultaDifal, signal: controle.signal });
      if (controle.signal.aborted) return;
      setDraft((current) => {
        if (controle.signal.aborted || !corresponde(current)) return current;
        const itens = aplicarResolucaoDifal(current.itens, resolucoes, (_, index) => `avulsa:${index}`);
        return itens === current.itens ? current : { ...current, itens };
      });
    }, 350);

    return () => {
      clearTimeout(timer);
      controle.abort();
    };
    // A assinatura inclui contexto e classificação, mas exclui as alíquotas
    // devolvidas. Depender do draft dispararia outra consulta a cada resposta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaDifal, loading, isAutorizada, draftIdParam]);

  const isSemPagamentoObrigatorio =
    draft.operacao.finalidade === "AJUSTE" || draft.operacao.finalidade === "DEVOLUCAO";
  // finNFe=4 sem <NFref> cai na rejeição 321. O CFOP não isenta da regra.
  const exigeNotaReferenciada = draft.operacao.finalidade === "DEVOLUCAO";
  const pagamentosAtuais = isSemPagamentoObrigatorio
    ? [{ ...initialDraft.pagamento, meio: "90", valor: 0 }]
    : draft.pagamentos;
  const paymentMethodsLabel = pagamentosAtuais.length === 0
    ? "Selecione os métodos"
    : pagamentosAtuais
        .map((pagamento) => getPaymentLabel(pagamento.meio))
        .join(", ");
  const paymentSummary = pagamentosAtuais.length === 0
    ? "Pendente"
    : pagamentosAtuais
        .map((pagamento) => `${pagamento.meio} - ${getPaymentLabel(pagamento.meio)}`)
        .join(" · ");
  const paymentErrors = React.useMemo(() => {
    if (isSemPagamentoObrigatorio) return [];
    if (draft.pagamentos.length === 0) return ["Selecione pelo menos um método de pagamento."];

    const result: string[] = [];
    if (draft.pagamentos.length > 1 && draft.pagamentos.some((pagamento) => pagamento.valor <= 0)) {
      result.push("Informe um valor maior que zero para cada método.");
    }
    const totalPagamentos = draft.pagamentos.reduce((total, pagamento) => total + pagamento.valor, 0);
    if (draft.pagamentos.length > 1 && Math.abs(totalPagamentos - totalNota) > 0.01) {
      result.push(`A soma dos pagamentos deve ser ${formatarEmReal(totalNota)}.`);
    }
    if (draft.pagamentos.length > 1 && draft.pagamentos.some((pagamento) => pagamento.meio === "90")) {
      result.push("Sem pagamento não pode ser combinado com outros métodos.");
    }
    draft.pagamentos.forEach((pagamento) => {
      if (pagamento.meio !== "03" && pagamento.meio !== "04") return;
      if (!pagamento.bandeira) {
        result.push(`Informe a bandeira de ${getPaymentLabel(pagamento.meio)}.`);
      }
      if (pagamento.tipoIntegracao === "1") {
        if (!isValidCnpj(pagamento.cnpjCredenciadora)) {
          result.push(`Informe o CNPJ da credenciadora de ${getPaymentLabel(pagamento.meio)}.`);
        }
        if (!pagamento.autorizacao.trim()) {
          result.push(`Informe o código de autorização de ${getPaymentLabel(pagamento.meio)}.`);
        }
      }
    });
    draft.pagamentos.forEach((pagamento) => {
      if (pagamento.meio !== "99") return;
      if (!pagamento.descricao.trim()) {
        result.push("Informe a descrição da forma de pagamento \"Outros\".");
      }
    });
    return result;
  }, [draft.pagamentos, isSemPagamentoObrigatorio, totalNota]);
  const isSemTransporte = draft.transporte.modFrete === "9";
  const isFreteContratado = ["0", "1", "2"].includes(draft.transporte.modFrete);
  const isTransporteProprio = ["3", "4"].includes(draft.transporte.modFrete);
  const crtEmitente = String(setup?.empresa?.regimetributario ?? "");
  // A seção de ICMS e o núcleo leem o setup no formato da emissão assistida.
  const setupFiscal = React.useMemo<FiscalSetup | null>(
    () =>
      setup
        ? {
            empresa: setup.empresa
              ? {
                  id: setup.empresa.id,
                  nome: setup.empresa.razaosocial,
                  uf: setup.empresa.uf,
                  crt: setup.empresa.regimetributario,
                  ambiente: setup.empresa.ambiente,
                }
              : null,
            config: null,
            empresaErros: [],
            unidades: [],
            regrasFiscais: setup.regrasFiscais as FiscalSetup["regrasFiscais"],
            versaoRegraFiscal: "",
            classificacoesRtc: setup.classificacoesRtc as FiscalSetup["classificacoesRtc"],
          }
        : null,
    [setup],
  );
  const isDestinatarioExterior = draft.destinatario.tipoPessoa === "ESTRANGEIRO";
  const isDestinatarioJuridica = draft.destinatario.tipoPessoa === "JURIDICA";

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
              // Cópia que já tem id é resto de nota gravada no banco (inclusive
              // emitida): ela vive na listagem fiscal, e restaurar aqui abriria
              // uma emissão nova com os dados da anterior.
              if (parsed?.nfeId) {
                window.localStorage.removeItem(storageKey);
              } else if (parsed && !cancelled) {
                setDraft(parsed);
              }
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
    // A cópia local só serve para nota que ainda não existe no banco. Assim que
    // ela é gravada — e mais ainda depois de transmitida — quem manda é o
    // servidor: sem o corte por `nfeId`, uma nota já emitida continuava sendo
    // regravada no navegador e voltava sozinha na próxima emissão avulsa.
    if (draftIdParam || draft.nfeId) return;
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

  function togglePaymentMethod(meio: string) {
    updateDraft((current) => {
      const selected = current.pagamentos.some((pagamento) => pagamento.meio === meio);
      const pagamentos = selected
        ? current.pagamentos.filter((pagamento) => pagamento.meio !== meio)
        : [
            ...current.pagamentos,
            {
              ...initialDraft.pagamento,
              meio,
              bandeira: meio === "03" || meio === "04" ? "99" : "",
            },
          ];
      return {
        ...current,
        pagamentos,
        pagamento: pagamentos[0] ?? current.pagamento,
      };
    });
  }

  function updatePayment(meio: string, patch: Partial<DraftPayment>) {
    updateDraft((current) => {
      const pagamentos = current.pagamentos.map((pagamento) =>
        pagamento.meio === meio ? { ...pagamento, ...patch } : pagamento,
      );
      return {
        ...current,
        pagamentos,
        pagamento: pagamentos[0] ?? current.pagamento,
      };
    });
  }

  function getDraftForSubmission(current: DraftPayload): DraftPayload {
    const pagamentos = current.operacao.finalidade === "AJUSTE" || current.operacao.finalidade === "DEVOLUCAO"
      ? [{ ...initialDraft.pagamento, meio: "90", valor: 0 }]
      : current.pagamentos.map((pagamento) => ({
          ...pagamento,
          // "Sem pagamento" declara que nada foi pago: vPag é sempre 0, mesmo
          // sendo o único método da nota.
          valor: pagamento.meio === "90"
            ? 0
            : current.pagamentos.length === 1
              ? Number(totalNota.toFixed(2))
              : Number(pagamento.valor.toFixed(2)),
        }));

    return {
      ...current,
      pagamento: pagamentos[0] ?? current.pagamento,
      pagamentos,
      // O motor lê o DIFAL sob outros nomes; sem essa tradução o que o usuário
      // digitou seria descartado e recalculado com os padrões.
      itens: current.itens.map((item) => ({
        ...item,
        aliquotaInternaDestino: item.difalHabilitado ? item.difalAliquotaInterna || null : null,
        aliquotaInterestadual: item.difalHabilitado ? item.difalAliquotaInterestadual || null : null,
        aliquotaFcpDestino: item.difalHabilitado ? item.difalAliquotaFcp || null : null,
        percentualPartilhaDestino: item.difalHabilitado ? item.difalPercentualPartilha || null : null,
        baseCalculoFcpDestino: item.difalHabilitado ? item.difalBaseFcp || null : null,
        overrideDifalManual: item.difalHabilitado
          ? overrideDifalDaTela(item.difalCamposManuais)
          : undefined,
      })),
    };
  }

  /**
   * Cada item leva os blocos de ICMS que o CST/CSOSN aceita (`icms`). Os campos
   * soltos de ST retida saem vazios: quem manda é o bloco, e um valor guardado
   * de um CST anterior não pode voltar pela porta dos fundos.
   */
  function comBlocosIcms(payload: DraftPayload) {
    return {
      ...payload,
      itens: payload.itens.map((item, index) => ({
        ...item,
        icms: setupFiscal
          ? icmsInputDoItem(itemAssistidoDaAvulsa(item, index), tratamentoIcmsDoItem(item, setupFiscal))
          : null,
        vBCSTRet: null,
        pST: null,
        vICMSSTRet: null,
      })),
    };
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    updateDraft((current) => ({
      ...current,
      itens: current.itens.map((item, itemIndex) =>
        itemIndex === index ? aplicarAlteracoesComCienciaFiscal(item, patch) : item,
      ),
    }));
  }

  function updatePisCofinsCst(index: number, type: "PIS" | "COFINS", cst: string) {
    const item = draft.itens[index];
    if (!item) return;

    const isPis = type === "PIS";
    const currentMode = isPis ? item.modoPis : item.modoCofins;
    const requiredMode = getRequiredPisCofinsMode(cst);
    const mode = requiredMode ?? (currentMode === "NAO_TRIBUTADO" ? "" : currentMode);
    const commonPatch = requiredMode === "NAO_TRIBUTADO"
      ? {
          ...(isPis
            ? { aliquotaPis: "", basePis: "", quantidadePis: "", aliquotaPorUnidadePis: "", valorPis: "" }
            : { aliquotaCofins: "", baseCofins: "", quantidadeCofins: "", aliquotaPorUnidadeCofins: "", valorCofins: "" }),
        }
      : requiredMode === "QUANTIDADE"
        ? isPis
          ? { aliquotaPis: "", basePis: "", valorPis: "" }
          : { aliquotaCofins: "", baseCofins: "", valorCofins: "" }
        : requiredMode === "PERCENTUAL"
          ? isPis
            ? { quantidadePis: "", aliquotaPorUnidadePis: "", valorPis: "" }
            : { quantidadeCofins: "", aliquotaPorUnidadeCofins: "", valorCofins: "" }
          : {};

    updateItem(index, isPis
      ? { cstPis: cst, modoPis: mode, ...commonPatch }
      : { cstCofins: cst, modoCofins: mode, ...commonPatch });
  }

  function addItemAvulso() {
    updateDraft((current) => ({
      ...current,
      itens: [
        ...current.itens,
        {
          ...emptyItem,
          cfop: normalizeCfopForOperation(
            emptyItem.cfop,
            current.operacao.tipoOperacao,
            setup?.empresa?.uf,
            current.destinatario.estado,
          ),
        },
      ],
    }));
  }

  function addItemFromProduct(produto: Produto) {
    // O perfil tributário sai da mesma resolução que as notas de venda e de OS
    // usam: o cadastro do produto vence, e o que ele deixou em branco recebe o
    // padrão de saída da empresa. A avulsa era a única tela que lia só o
    // produto, então o mesmo item saía completo por uma venda e pela metade
    // aqui. O CRT decide sozinho entre CSOSN e CST — não precisa do teste de
    // regime que existia nestas linhas.
    const { campos } = resolverPadraoFiscalItem({
      fontes: [{ origem: "PRODUTO", valores: produto }],
      padrao: setup?.padraoFiscalItem ?? null,
      crt: setup?.crt ?? (Number(crtEmitente) || null),
    });
    const texto = (valor: string | number | null | undefined) =>
      valor == null ? "" : String(valor);
    const modoPis = campos.modo_pis || inferPisCofinsMode(campos.cst_pis, campos.aliquota_pis);
    const modoCofins =
      campos.modo_cofins || inferPisCofinsMode(campos.cst_cofins, campos.aliquota_cofins);

    updateDraft((current) => ({
      ...current,
      itens: [
        ...current.itens,
        {
          ...emptyItem,
          produtoId: produto.id ?? null,
          codigo: String(produto.referencia ?? produto.codigobarras ?? produto.id ?? ""),
          descricao: produto.titulo || produto.descricao || String(produto.id ?? ""),
          // NCM e CEST continuam só do produto: são do item, não do perfil.
          ncm: onlyDigits(produto.ncm ?? ""),
          cfop: normalizeCfopForOperation(
            campos.cfop || "5102",
            current.operacao.tipoOperacao,
            setup?.empresa?.uf,
            current.destinatario.estado,
          ),
          unidade: produto.unidade || "UN",
          valorUnitario: String(produto.precovenda ?? 0),
          orig: texto(campos.origem_mercadoria),
          csosn: texto(campos.csosn),
          cst: texto(campos.cst),
          aliquotaIcms: texto(campos.aliquotaicms),
          cstPis: texto(campos.cst_pis),
          aliquotaPis: texto(campos.aliquota_pis),
          modoPis,
          quantidadePis: modoPis === "QUANTIDADE" ? "1" : "",
          aliquotaPorUnidadePis: texto(campos.aliquota_por_unidade_pis),
          cstCofins: texto(campos.cst_cofins),
          aliquotaCofins: texto(campos.aliquota_cofins),
          modoCofins,
          quantidadeCofins: modoCofins === "QUANTIDADE" ? "1" : "",
          aliquotaPorUnidadeCofins: texto(campos.aliquota_por_unidade_cofins),
          cest: produto.cest || "",
          rtcHabilitado: campos.rtc_habilitado,
          cstIbsCbs: texto(campos.cst_ibscbs),
          cClassTrib: texto(campos.cclass_trib),
          aliquotaIbsUf: texto(campos.aliquota_ibs_uf),
          aliquotaIbsMunicipio: texto(campos.aliquota_ibs_municipio),
          aliquotaCbs: texto(campos.aliquota_cbs),
        },
      ],
    }));
    toast.success("Produto adicionado à NF-e");
  }

  function addItemFromUsoConsumo(item: UsoConsumoItemOption) {
    // Item do estoque de uso/consumo. O bloco tributário do cadastro passa pela
    // mesma resolução do produto de venda — o que ele deixou em branco recebe o
    // padrão de saída da empresa —, mas três coisas mudam:
    //
    // 1. `produtoId` fica nulo: `nfe_item.produtoid` aponta para `produto(id)` e
    //    os ids dos dois estoques colidem. A origem vai em `sourceItemId`.
    // 2. O cadastro só tem `cfop_entrada` (1556/2556), que não serve para saída.
    //    Por isso ele não é oferecido como fonte: o CFOP sai do padrão da
    //    empresa, com o mesmo fallback 5102 do produto.
    // 3. Não existe preço de venda, só custo. O item entra zerado para que o
    //    valor da nota seja uma decisão de quem emite, não o custo por descuido.
    const { campos } = resolverPadraoFiscalItem({
      fontes: [{ origem: "USOCONSUMO", valores: item }],
      padrao: setup?.padraoFiscalItem ?? null,
      crt: setup?.crt ?? (Number(crtEmitente) || null),
    });
    const texto = (valor: string | number | null | undefined) =>
      valor == null ? "" : String(valor);
    const modoPis = campos.modo_pis || inferPisCofinsMode(campos.cst_pis, campos.aliquota_pis);
    const modoCofins =
      campos.modo_cofins || inferPisCofinsMode(campos.cst_cofins, campos.aliquota_cofins);

    updateDraft((current) => ({
      ...current,
      itens: [
        ...current.itens,
        {
          ...emptyItem,
          produtoId: null,
          // O seletor cobre os tres estoques, mas a NF-e avulsa so oferece os
          // dois simples (nao passa `escopos`). O estreitamento existe para o
          // dia em que alguem ligar o terceiro aqui sem lembrar que
          // `nfe_item.produtoid` tem FK propria para produto.
          sourceItemId: `${PREFIXO_ORIGEM[ehEstoqueSimples(item.escopo) ? item.escopo : ESCOPO_PADRAO]}:${item.id}`,
          // Vira o cProd do XML. Referência em branco cairia no número da linha
          // lá no serviço, e aí a nota não diria mais de qual item ela saiu.
          codigo:
            String(item.referencia ?? "").trim() ||
            String(item.codigobarras ?? "").trim() ||
            `UC-${item.id}`,
          descricao: item.titulo || item.descricao || `UC-${item.id}`,
          ncm: onlyDigits(item.ncm ?? ""),
          cfop: normalizeCfopForOperation(
            campos.cfop || "5102",
            current.operacao.tipoOperacao,
            setup?.empresa?.uf,
            current.destinatario.estado,
          ),
          unidade: item.unidade || "UN",
          orig: texto(campos.origem_mercadoria),
          csosn: texto(campos.csosn),
          cst: texto(campos.cst),
          aliquotaIcms: texto(campos.aliquotaicms),
          cstPis: texto(campos.cst_pis),
          aliquotaPis: texto(campos.aliquota_pis),
          modoPis,
          quantidadePis: modoPis === "QUANTIDADE" ? "1" : "",
          aliquotaPorUnidadePis: texto(campos.aliquota_por_unidade_pis),
          cstCofins: texto(campos.cst_cofins),
          aliquotaCofins: texto(campos.aliquota_cofins),
          modoCofins,
          quantidadeCofins: modoCofins === "QUANTIDADE" ? "1" : "",
          aliquotaPorUnidadeCofins: texto(campos.aliquota_por_unidade_cofins),
          cest: item.cest || "",
          rtcHabilitado: campos.rtc_habilitado,
          cstIbsCbs: texto(campos.cst_ibscbs),
          cClassTrib: texto(campos.cclass_trib),
          aliquotaIbsUf: texto(campos.aliquota_ibs_uf),
          aliquotaIbsMunicipio: texto(campos.aliquota_ibs_municipio),
          aliquotaCbs: texto(campos.aliquota_cbs),
        },
      ],
    }));
    toast.success("Item de uso/consumo adicionado à NF-e", {
      description: "Informe o valor unitário: o cadastro de uso/consumo não tem preço de venda.",
    });
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
      itens: current.itens.map((item) => ({
        ...item,
        cfop: normalizeCfopForOperation(
          item.cfop,
          current.operacao.tipoOperacao,
          setup?.empresa?.uf,
          cliente.estado,
        ),
      })),
      destinatario: {
        ...current.destinatario,
        clienteId: cliente.id,
        fornecedorId: null,
        tipoPessoa: cliente.tipopessoa === "FISICA" ? "FISICA" : "JURIDICA",
        cpfCnpj: cliente.cpfcnpj ?? "",
        nomeRazaoSocial: isHomologacao ? NFE_HOMOLOGACAO_DESTINATARIO_NOME : cliente.nomerazaosocial ?? "",
        // Vem do cadastro. Cliente ainda não classificado abre na sugestão, que
        // o usuário confirma no seletor logo abaixo — deduzir e emitir direto é
        // o que produzia a rejeição 306.
        indicadorIe: String(
          normalizarIndIEDest(cliente.ind_ie_dest) ??
            sugerirIndIEDest(cliente.inscricaoestadual),
        ),
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

  /**
   * Preenche o destinatário a partir de um fornecedor do cadastro.
   *
   * O cadastro de fornecedor não guarda tipo de pessoa nem inscrição
   * estadual — diferente do cliente. O tipo é deduzido do tamanho do
   * documento e o indicador de IE abre em "não contribuinte", igual à
   * sugestão para cliente ainda não classificado: o usuário confirma antes
   * de emitir.
   */
  function preencherDestinatarioComFornecedor(fornecedor: Fornecedor) {
    const documento = normalizeCpfOrCnpj(fornecedor.cpfcnpj);
    updateDraft((current) => ({
      ...current,
      itens: current.itens.map((item) => ({
        ...item,
        cfop: normalizeCfopForOperation(
          item.cfop,
          current.operacao.tipoOperacao,
          setup?.empresa?.uf,
          fornecedor.estado,
        ),
      })),
      destinatario: {
        ...current.destinatario,
        clienteId: null,
        fornecedorId: fornecedor.id,
        tipoPessoa: documento.length === 11 ? "FISICA" : "JURIDICA",
        cpfCnpj: documento,
        nomeRazaoSocial: isHomologacao ? NFE_HOMOLOGACAO_DESTINATARIO_NOME : fornecedor.nomerazaosocial ?? "",
        indicadorIe: String(sugerirIndIEDest(null)),
        inscricaoEstadual: "",
        inscricaoMunicipal: "",
        email: "",
        telefone: "",
        endereco: fornecedor.endereco ?? "",
        numero: fornecedor.endereconumero ?? "",
        complemento: fornecedor.enderecocomplemento ?? "",
        bairro: fornecedor.bairro ?? "",
        cidade: fornecedor.cidade ?? "",
        estado: fornecedor.estado ?? "",
        cep: fornecedor.cep ?? "",
        codigoMunicipio: fornecedor.codigomunicipio ?? "",
        codigoPais: "1058",
        nomePais: "BRASIL",
      },
    }));
  }

  /**
   * Preenche o destinatário a partir do CNPJ digitado.
   *
   * Dispara sozinha quando o campo fecha 14 dígitos válidos e também pelo botão
   * de lupa. O `ultimoCnpjConsultado` evita repetir a consulta a cada tecla —
   * a API pública tem limite por minuto.
   */
  async function buscarPorCnpj(documento?: string) {
    const cnpj = normalizeCnpj(documento ?? draft.destinatario.cpfCnpj);
    if (!isValidCnpj(cnpj)) {
      toast.error("Informe um CNPJ válido para consultar.");
      return;
    }
    if (!/^\d{14}$/.test(cnpj)) {
      toast.info("A consulta automática ainda não aceita CNPJ alfanumérico. Preencha os dados manualmente.");
      return;
    }

    ultimoCnpjConsultado.current = cnpj;
    setBuscandoCnpj(true);
    try {
      const response = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Muitas consultas em sequência. Aguarde um pouco e tente de novo.");
        }
        if (response.status === 400 || response.status === 404) {
          throw new Error("CNPJ não encontrado. Confira o número informado.");
        }
        throw new Error("Não foi possível consultar os dados do CNPJ.");
      }

      const empresaConsultada = await response.json();
      const estabelecimento = empresaConsultada?.estabelecimento;
      const uf = String(estabelecimento?.estado?.sigla ?? "").trim().toUpperCase();
      const cidade = String(estabelecimento?.cidade?.nome ?? "").trim();
      const codigoMunicipio = onlyDigits(estabelecimento?.cidade?.ibge_id).slice(0, 7);
      if (!empresaConsultada?.razao_social || !estabelecimento || !uf || !cidade || !codigoMunicipio) {
        throw new Error("A consulta não retornou dados cadastrais suficientes.");
      }

      const inscricoes = Array.isArray(estabelecimento.inscricoes_estaduais)
        ? estabelecimento.inscricoes_estaduais
        : [];
      const inscricaoDaUf =
        inscricoes.find(
          (entrada: any) =>
            entrada?.ativo !== false && String(entrada?.estado?.sigla ?? "").toUpperCase() === uf,
        ) ??
        inscricoes.find((entrada: any) => entrada?.ativo !== false) ??
        inscricoes.find(
          (entrada: any) => String(entrada?.estado?.sigla ?? "").toUpperCase() === uf,
        ) ??
        inscricoes[0];
      const inscricaoEstadual = onlyDigits(inscricaoDaUf?.inscricao_estadual);
      const inscricaoAtiva = Boolean(inscricaoDaUf) && inscricaoDaUf?.ativo !== false;
      const telefone = onlyDigits(
        `${estabelecimento.ddd1 ?? estabelecimento.ddd2 ?? ""}${estabelecimento.telefone1 ?? estabelecimento.telefone2 ?? ""}`,
      ).slice(0, 14);

      updateDraft((current) => ({
        ...current,
        itens: current.itens.map((item) => ({
          ...item,
          cfop: normalizeCfopForOperation(
            item.cfop,
            current.operacao.tipoOperacao,
            setup?.empresa?.uf,
            uf,
          ),
        })),
        destinatario: {
          ...current.destinatario,
          // A consulta traz um destinatário avulso: nada aqui vira cadastro.
          clienteId: null,
          fornecedorId: null,
          tipoPessoa: "JURIDICA",
          cpfCnpj: cnpj,
          nomeRazaoSocial: String(empresaConsultada.razao_social ?? "").trim(),
          // O que a Receita devolveu entra preenchido, inclusive IE baixada: a
          // consulta informa, não decide. Os dois campos seguem editáveis e o
          // aviso abaixo do formulário diz o que veio.
          indicadorIe: inscricaoEstadual ? "1" : "9",
          inscricaoEstadual,
          email: String(estabelecimento.email ?? "").trim().toLowerCase(),
          telefone,
          endereco: String(estabelecimento.logradouro ?? "").trim(),
          numero: String(estabelecimento.numero ?? "").trim(),
          complemento: String(estabelecimento.complemento ?? "").trim(),
          bairro: String(estabelecimento.bairro ?? "").trim(),
          cidade,
          estado: uf,
          cep: onlyDigits(estabelecimento.cep).slice(0, 8),
          codigoMunicipio,
          codigoPais: "1058",
          nomePais: "BRASIL",
        },
      }));
      setIeConsultada({
        inscricao: inscricaoEstadual,
        ativa: inscricaoAtiva,
        uf,
      });
      toast.success("Dados do CNPJ preenchidos.", {
        description: inscricaoEstadual
          ? inscricaoAtiva
            ? `IE ${inscricaoEstadual} ativa em ${uf}. Confira antes de emitir.`
            : `IE ${inscricaoEstadual} consta como baixada/inativa. Confira antes de emitir.`
          : "A Receita não retornou inscrição estadual. Ajuste o indicador se o destinatário for contribuinte.",
      });
    } catch (error: any) {
      toast.error(error?.message || "Erro ao consultar o CNPJ.");
    } finally {
      setBuscandoCnpj(false);
    }
  }

  function tornarDestinatarioAvulso() {
    updateDraft((current) => ({
      ...current,
      destinatario: {
        ...current.destinatario,
        clienteId: null,
        fornecedorId: null,
      },
    }));
  }

  async function salvarRascunho(options?: { goNext?: boolean; silent?: boolean; replaceUrl?: boolean }) {
    const goNext = options?.goNext ?? false;
    const wasEditing = Boolean(draft.nfeId);
    setSaving(true);
    setErrors([]);
    try {
      if (paymentErrors.length > 0) {
        const validationErrors = paymentErrors.map((message) => ({
          step: "payment",
          field: "pagamentos",
          message,
        }));
        setErrors(validationErrors);
        setDraft((current) => ({ ...current, currentStep: validationStepIndexes.payment }));
        toast.error("Revise os pagamentos", { description: paymentErrors[0] });
        return null;
      }
      const submissionDraft = comBlocosIcms(getDraftForSubmission(draft));
      const response = draft.nfeId
        ? await axios.patch(`/api/fiscal/nfe-avulsa/drafts/${draft.nfeId}`, submissionDraft)
        : await axios.post("/api/fiscal/nfe-avulsa/drafts", submissionDraft);

      const nfeId = Number(response.data?.nfeId);
      const finalNfeId = Number.isFinite(nfeId) ? nfeId : draft.nfeId;
      setDraft((current) => ({
        ...getDraftForSubmission(current),
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
      // Gravou no banco: a cópia local perde a função, mesmo quando a URL não é
      // trocada (é o caso do salvamento que antecede a transmissão).
      if (finalNfeId) {
        window.localStorage.removeItem(storageKey);
      }
      if (!wasEditing && finalNfeId && options?.replaceUrl !== false) {
        router.replace(`/fiscal/nfe-avulsa?id=${finalNfeId}`);
      }
      return finalNfeId ?? null;
    } catch (error) {
      if (isAxiosError(error) && Array.isArray(error.response?.data?.errors)) {
        const validationErrors = error.response.data.errors as ValidationError[];
        const classificadas = classificarIssuesFiscais(validationErrors);
        setErrors(validationErrors);

        const firstErrorStep = validationStepIndexes[validationErrors[0]?.step];
        if (firstErrorStep !== undefined) {
          setDraft((current) => ({ ...current, currentStep: firstErrorStep }));
        }

        const issuesVisiveis = [...classificadas.bloqueios, ...classificadas.avisos].slice(0, 3);
        const visibleErrors = issuesVisiveis.map(formatValidationError);
        const remainingErrors = classificadas.bloqueios.length + classificadas.avisos.length - visibleErrors.length;
        const description = [
          visibleErrors.join(" • "),
          remainingErrors > 0
            ? `E mais ${remainingErrors} ${remainingErrors === 1 ? "ocorrência fiscal" : "ocorrências fiscais"}.`
            : "",
        ].filter(Boolean).join(" ");

        if (classificadas.bloqueios.length > 0) {
          toast.error("Revise os campos pendentes", { description });
        } else {
          toast.warning("Confirme os avisos fiscais", { description });
        }
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

  /**
   * Zera o formulário e a cópia local do navegador.
   *
   * Não apaga nada no banco: nota já gravada continua na listagem fiscal. Serve
   * para começar uma emissão do zero sem herdar campo nenhum da anterior.
   */
  function limparTudo() {
    const confirmado = window.confirm(
      "Limpar todos os campos desta emissão?\nO que já foi salvo continua na listagem de notas fiscais.",
    );
    if (!confirmado) return;

    window.localStorage.removeItem(storageKey);
    ultimoCnpjConsultado.current = "";
    setIeConsultada(null);
    setErrors([]);
    setDirty(false);
    setDocumentState({
      status: null,
      chave: null,
      protocolo: null,
      numero: null,
      serie: null,
      dataAutorizacao: null,
      origemLabel: null,
    });
    setDraft({ ...initialDraft, currentStep: 0 });

    if (draftIdParam) {
      router.replace("/fiscal/nfe-avulsa");
    }
    toast.success("Formulário limpo.");
  }

  function irParaProximoPasso() {
    if (draft.currentStep === validationStepIndexes.payment && paymentErrors.length > 0) {
      setErrors(paymentErrors.map((message) => ({ step: "payment", field: "pagamentos", message })));
      toast.error("Revise os pagamentos", { description: paymentErrors[0] });
      return;
    }
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
      const nfeId = await salvarRascunho({ silent: true, replaceUrl: false });
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
        setupFiscal={setupFiscal}
        totalProdutos={totalProdutos}
        totalFrete={totalFreteItens}
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
          <Button variant="outline" onClick={limparTudo} title="Zera os campos e a cópia local do navegador">
            <Eraser className="h-4 w-4" />
            Limpar tudo
          </Button>
          <Button variant="outline" asChild>
            <Link href="/fiscal">Sair</Link>
          </Button>
        </div>
      </div>

      {setup?.config ? (
        <Alert>
          <Hash className="h-4 w-4" />
          <AlertTitle>
            Esta nota será a de número {setup.proximoNumero ?? "—"}, série {setup.config.serie}
          </AlertTitle>
          <AlertDescription>
            O número é atribuído no envio para a SEFAZ, e não agora: enquanto a nota for
            rascunho ou for rejeitada, ele continua livre. Se outra nota for transmitida
            antes desta, o número desta será o seguinte.
          </AlertDescription>
        </Alert>
      ) : null}

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

      {errorsClassificados.bloqueios.length > 0 && (
        <Alert variant="destructive" aria-live="polite">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {errorsClassificados.bloqueios.length}{" "}
            {errorsClassificados.bloqueios.length === 1 ? "pendência encontrada" : "pendências encontradas"}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {errorsClassificados.bloqueios.map((error, index) => {
                const stepIndex = validationStepIndexes[error.step];
                return (
                  <li key={`${error.step}-${error.itemIndex ?? "general"}-${error.field ?? "field"}-${index}`}>
                    {stepIndex === undefined ? (
                      formatValidationError(error)
                    ) : (
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => setDraft((current) => ({ ...current, currentStep: stepIndex }))}
                      >
                        {formatValidationError(error)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {errorsClassificados.avisos.length > 0 ? (
        <Alert
          className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
          aria-live="polite"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {errorsClassificados.avisos.length}{" "}
            {errorsClassificados.avisos.length === 1 ? "aviso fiscal a confirmar" : "avisos fiscais a confirmar"}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-2 pl-4">
              {errorsClassificados.avisos.map((error, index) => {
                const stepIndex = validationStepIndexes[error.step];
                const itemDoAviso = error.itemIndex === undefined ? undefined : draft.itens[error.itemIndex];
                const aviso = { ...error, code: error.code ?? "" };
                const checkboxId = `ciencia-avulsa-${error.itemIndex ?? "nota"}-${error.code ?? "aviso"}-${index}`;
                return (
                  <li
                    key={`${error.step}-${error.itemIndex ?? "general"}-${error.field ?? "field"}-${index}`}
                    className="space-y-1"
                  >
                    {stepIndex === undefined ? (
                      formatValidationError(error)
                    ) : (
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => setDraft((current) => ({ ...current, currentStep: stepIndex }))}
                      >
                        {formatValidationError(error)}
                      </button>
                    )}
                    <FontesDoAvisoFiscal fontes={error.fontes} />
                    {itemDoAviso && error.itemIndex !== undefined && error.code && error.fingerprint ? (
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id={checkboxId}
                          checked={avisoFiscalConfirmado(aviso, itemDoAviso.avisosFiscaisConfirmados)}
                          onCheckedChange={(checked) =>
                            updateItem(error.itemIndex!, {
                              avisosFiscaisConfirmados: alternarCienciaFiscal(
                                itemDoAviso.avisosFiscaisConfirmados,
                                aviso,
                                checked === true,
                              ),
                            })
                          }
                        />
                        <Label htmlFor={checkboxId} className="text-xs font-normal leading-snug">
                          Li este aviso e confirmo que os dados da operação foram conferidos.
                        </Label>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FiscalInformationBadge
        messages={errorsClassificados.informativos.map(formatValidationError)}
      />

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
                        itens: current.itens.map((item) => ({
                          ...item,
                          cfop: normalizeCfopForOperation(
                            item.cfop,
                            value,
                            setup?.empresa?.uf,
                            current.destinatario.estado,
                          ),
                        })),
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
                      updateDraft((current) => {
                        const semPagamento = value === "AJUSTE" || value === "DEVOLUCAO";
                        const pagamentos = semPagamento
                          ? [{ ...initialDraft.pagamento, meio: "90", valor: 0 }]
                          : current.pagamentos.length === 0 || current.pagamentos.every((item) => item.meio === "90")
                            ? initialDraft.pagamentos.map((item) => ({ ...item }))
                            : current.pagamentos;
                        // Devolução não houve balcão (indPres=0, não se aplica). O
                        // destino da mercadoria continua sendo escolha do usuário:
                        // a finalidade não diz se o destinatário revende.
                        const operacao = value === "DEVOLUCAO"
                          ? {
                              ...current.operacao,
                              finalidade: value,
                              indicadorPresenca: "0",
                            }
                          : { ...current.operacao, finalidade: value };
                        return {
                          ...current,
                          operacao,
                          pagamento: pagamentos[0],
                          pagamentos,
                        };
                      })
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
                      <SelectItem value="0">Não se aplica</SelectItem>
                      <SelectItem value="1">Operação presencial</SelectItem>
                      <SelectItem value="2">Internet</SelectItem>
                      <SelectItem value="3">Teleatendimento</SelectItem>
                      <SelectItem value="5">Presencial fora do estabelecimento</SelectItem>
                      <SelectItem value="9">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {draft.operacao.tipoOperacao === "SAIDA" ? (
                  <DestinoMercadoriaField
                    destino={draft.operacao.destinoMercadoria}
                    consumidorFinal={draft.operacao.consumidorFinal}
                    naoContribuinte={draft.destinatario.indicadorIe === "9"}
                    alertaDifal={difalAtivo}
                    onChange={({ destino, consumidorFinal }) =>
                      updateDraft((current) => ({
                        ...current,
                        operacao: { ...current.operacao, destinoMercadoria: destino, consumidorFinal },
                      }))
                    }
                  />
                ) : (
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
                )}
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

                <div className="md:col-span-2 space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Label className="text-sm">
                        NF-e referenciada
                        {exigeNotaReferenciada ? (
                          <span className="ml-1 font-semibold text-destructive">*</span>
                        ) : null}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {exigeNotaReferenciada
                          ? "Chave de acesso da nota que está sendo devolvida. Devolução sem esta chave é rejeitada pela SEFAZ (rejeição 321)."
                          : "Opcional: chave de acesso de uma NF-e citada por esta nota."}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          documentosReferenciados: [
                            ...current.documentosReferenciados,
                            { chaveAcesso: "" },
                          ],
                        }))
                      }
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Adicionar chave
                    </Button>
                  </div>

                  {draft.documentosReferenciados.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {exigeNotaReferenciada
                        ? "Nenhuma nota referenciada. Adicione a chave da NF-e de compra."
                        : "Nenhuma nota referenciada."}
                    </p>
                  ) : (
                    draft.documentosReferenciados.map((referencia, index) => {
                      const digitos = onlyDigits(referencia.chaveAcesso);
                      const invalida = digitos.length > 0 && !chaveAcessoValida(digitos);
                      return (
                        <div key={index} className="flex items-start gap-2">
                          <div className="flex-1">
                            <Input
                              inputMode="numeric"
                              placeholder="44 dígitos da chave de acesso"
                              value={referencia.chaveAcesso}
                              onChange={(event) =>
                                updateDraft((current) => ({
                                  ...current,
                                  documentosReferenciados: current.documentosReferenciados.map(
                                    (item, itemIndex) =>
                                      itemIndex === index
                                        ? { chaveAcesso: onlyDigits(event.target.value).slice(0, 44) }
                                        : item,
                                  ),
                                }))
                              }
                            />
                            {invalida ? (
                              <p className="mt-1 text-[11px] text-destructive">
                                {digitos.length < 44
                                  ? `Faltam ${44 - digitos.length} dígito(s).`
                                  : "Dígito verificador não confere: revise a chave."}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Remover chave referenciada"
                            onClick={() =>
                              updateDraft((current) => ({
                                ...current,
                                documentosReferenciados: current.documentosReferenciados.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              }))
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
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
                <FornecedorSelect
                  open={openFornecedorSelect}
                  setOpen={setOpenFornecedorSelect}
                  OnSelect={preencherDestinatarioComFornecedor}
                />
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <Button className="w-min shrink-0" type="button" variant="outline" onClick={() => setOpenCustomerSelect(true)}>
                    + Selecionar cliente
                  </Button>
                  <Button className="w-min shrink-0" type="button" variant="outline" onClick={() => setOpenFornecedorSelect(true)}>
                    + Selecionar fornecedor
                  </Button>
                  {selectedClienteLabel || selectedFornecedorLabel ? (
                    <Badge
                      variant="secondary"
                      className="min-w-0 max-w-full truncate"
                      title={selectedClienteLabel ?? selectedFornecedorLabel ?? undefined}
                    >
                      {selectedClienteLabel ?? selectedFornecedorLabel}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="w-fit shrink-0">
                      Destinatário avulso
                    </Badge>
                  )}
                  {(draft.destinatario.clienteId || draft.destinatario.fornecedorId) && (
                    <Button className="shrink-0" type="button" variant="ghost" onClick={tornarDestinatarioAvulso}>
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
                    <div className="relative">
                      <Input
                        inputMode={draft.destinatario.tipoPessoa === "FISICA" ? "numeric" : "text"}
                        className={isDestinatarioJuridica ? "pr-10" : undefined}
                        value={draft.destinatario.cpfCnpj}
                        onChange={(event) => {
                          const documento = draft.destinatario.tipoPessoa === "FISICA"
                            ? normalizeCpf(event.target.value).slice(0, 11)
                            : draft.destinatario.tipoPessoa === "JURIDICA"
                              ? normalizeCnpj(event.target.value).slice(0, 14)
                              : normalizeForeignFiscalId(event.target.value);
                          updateDraft((current) => ({
                            ...current,
                            destinatario: { ...current.destinatario, cpfCnpj: documento },
                          }));
                          // Fechou um CNPJ válido: busca os dados na hora. Fica
                          // no onChange de propósito — preenchimento vindo do
                          // cadastro de cliente não deve disparar consulta.
                          if (
                            draft.destinatario.tipoPessoa === "JURIDICA" &&
                            /^\d{14}$/.test(documento) &&
                            isValidCnpj(documento) &&
                            documento !== ultimoCnpjConsultado.current &&
                            !buscandoCnpj
                          ) {
                            void buscarPorCnpj(documento);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && isDestinatarioJuridica) {
                            event.preventDefault();
                            void buscarPorCnpj();
                          }
                        }}
                      />
                      {isDestinatarioJuridica ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-9 w-9"
                          disabled={buscandoCnpj}
                          onClick={() => void buscarPorCnpj()}
                          aria-label="Consultar CNPJ"
                          title="Consultar CNPJ na Receita"
                        >
                          {buscandoCnpj ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Search className="h-4 w-4" />
                          )}
                        </Button>
                      ) : null}
                    </div>
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
                    {!isHomologacao &&
                    sanitizeString(draft.destinatario.nomeRazaoSocial).length > NFE_XNOME_MAX_LENGTH ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        O nome será reduzido para {NFE_XNOME_MAX_LENGTH} caracteres no XML da NF-e.
                      </p>
                    ) : null}
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
                  {ieConsultada ? (
                    // Informa o que a consulta trouxe e para por aí: indicador e
                    // IE ficam como o usuário quiser deixar.
                    <p
                      className={`text-xs md:col-span-3 ${
                        ieConsultada.inscricao && !ieConsultada.ativa
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {ieConsultada.inscricao
                        ? `Consulta do CNPJ: IE ${ieConsultada.inscricao} em ${ieConsultada.uf}, ${
                            ieConsultada.ativa
                              ? "ativa na Receita"
                              : "constando como baixada/inativa — IE inativa costuma gerar a rejeição 306"
                          }.`
                        : "Consulta do CNPJ: nenhuma inscrição estadual retornada — preenchemos como não contribuinte."}{" "}
                      Os campos acima continuam livres para edição.
                    </p>
                  ) : null}
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
                      onChange={(event) => {
                        const estado = event.target.value.toUpperCase();
                        updateDraft((current) => ({
                          ...current,
                          destinatario: { ...current.destinatario, estado },
                          itens: estado.length === 2
                            ? current.itens.map((item) => ({
                                ...item,
                                cfop: normalizeCfopForOperation(
                                  item.cfop,
                                  current.operacao.tipoOperacao,
                                  setup?.empresa?.uf,
                                  estado,
                                ),
                              }))
                            : current.itens,
                        }));
                      }}
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
                  {podeVerUsoConsumo ? (
                    <ItemSelectDialog
                      open={openUsoConsumoSelect}
                      setOpen={setOpenUsoConsumoSelect}
                      onSelect={addItemFromUsoConsumo}
                      permitirTrocaDeEscopo
                    >
                      <Button type="button" variant="secondary">
                        <Plus className="h-4 w-4" />
                        Item de uso/consumo ou geral
                      </Button>
                    </ItemSelectDialog>
                  ) : null}
                  <Button type="button" variant="outline" onClick={addItemAvulso}>
                    <Plus className="h-4 w-4" />
                    Produto avulso
                  </Button>
                </div>

                {draft.itens.length > 0 ? (
                  <div className="min-w-0 space-y-2 rounded-md border bg-muted/20 p-3">
                    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-start">
                      <div className="min-w-0 space-y-1.5">
                        <Label>Desconto geral da nota</Label>
                        <ValueInput
                          price={parseCurrency(draft.descontoGeral)}
                          setPrice={aplicarDescontoGeral}
                        />
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground sm:pt-7">
                        Rateado nos produtos proporcionalmente ao valor de cada um, com a sobra de
                        centavos no último item. O XML não tem desconto de nota: o valor vira o vDesc
                        de cada item e o somatório aparece no ICMSTot. Cada item ainda pode ser
                        ajustado à mão abaixo.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Produtos: <b>{formatarEmReal(totalBrutoProdutos)}</b></span>
                      <span>Desconto (vDesc): <b>- {formatarEmReal(totalDescontoItens)}</b></span>
                      {totalFreteItens > 0 ? (
                        <span>Frete (vFrete): <b>+ {formatarEmReal(totalFreteItens)}</b></span>
                      ) : null}
                      <span>Total da NF-e: <b>{formatarEmReal(totalNota)}</b></span>
                    </div>
                  </div>
                ) : null}

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
                        <StatusFiscalDoItemAvulso issues={errorsPorItem.get(index) ?? []} />
                        <div className="md:col-span-5">
                          <Label className="inline-flex items-center gap-1">
                            Descrição <RequiredMark />
                            {/* Item de estoque simples entra sem produtoId e com
                                valor zerado — sem o rótulo ele fica igual a um avulso. */}
                            {escopoDaOrigem(item.sourceItemId) ? (
                              <Badge variant="secondary" className="ml-1 font-normal">
                                {rotuloDeEscopo(escopoDaOrigem(item.sourceItemId)!).curto}
                              </Badge>
                            ) : null}
                          </Label>
                          <Input value={item.descricao} onChange={(event) => updateItem(index, { descricao: event.target.value })} />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="inline-flex items-center gap-1">NCM <RequiredMark /></Label>
                          <NcmCombobox
                            value={item.ncm}
                            onValueChange={(ncm) => updateItem(index, { ncm })}
                            dataFiscal={dataEmissaoFiscal}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="inline-flex items-center gap-1">CFOP <RequiredMark /></Label>
                          <CfopCombobox
                            value={item.cfop}
                            modelo={MODELO_NFE}
                            operation={draft.operacao.tipoOperacao}
                            emitterUf={setup?.empresa?.uf}
                            partnerUf={draft.destinatario.estado}
                            onValueChange={(cfop) => updateItem(index, { cfop })}
                          />
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
                        <div className="md:col-span-2">
                          <Label>Desconto</Label>
                          <ValueInput
                            price={parseCurrency(item.valorDesconto)}
                            setPrice={(value) => updateItem(index, { valorDesconto: value.toFixed(2) })}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label>Frete</Label>
                          <ValueInput
                            price={parseCurrency(item.valorFrete)}
                            setPrice={(value) => updateItem(index, { valorFrete: Math.max(0, value).toFixed(2) })}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label className="inline-flex items-center gap-1">
                            CEST
                            {setupFiscal && calcularIcmsDoItem(itemAssistidoDaAvulsa(item, index), setupFiscal, contextoBaseDaAvulsa(item, draft, setupFiscal?.empresa?.uf)).valores?.vBCST != null ? <RequiredMark /> : null}
                          </Label>
                          <Input value={item.cest} onChange={(event) => updateItem(index, { cest: onlyDigits(event.target.value) })} />
                        </div>
                        <Info
                          label="Total do item"
                          value={formatarEmReal(
                            Math.max(
                              0,
                              parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario) -
                                parseCurrency(item.valorDesconto),
                            ) + Math.max(0, parseCurrency(item.valorFrete)),
                          )}
                          className="md:col-span-2"
                        />
                        <div className="md:col-span-12">
                          <Separator />
                        </div>
                        <p className="text-sm font-medium md:col-span-12">Tributação do item</p>
                        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4 md:col-span-12">
                        {setupFiscal ? (
                          <div className="min-w-0 sm:col-span-2 lg:col-span-4">
                            <NfeItemIcmsSection
                              item={itemAssistidoDaAvulsa(item, index)}
                              setup={setupFiscal}
                              contextoBase={contextoBaseDaAvulsa(item, draft, setupFiscal?.empresa?.uf)}
                              procedencia={{}}
                              onChange={(patch) => updateItem(index, patch as Partial<DraftItem>)}
                              Field={Field}
                            />
                          </div>
                        ) : null}
                        </div>

                        {item.difalHabilitado ? (
                          <div className="flex flex-1 flex-col gap-3 md:col-span-12">
                            <div>
                              <p className="text-sm font-semibold">DIFAL — partilha para a UF de destino</p>
                              {/* <p className="text-xs text-muted-foreground">
                                Venda interestadual a consumidor final não contribuinte. Os valores são
                                sugestões: confira a legislação vigente da UF de destino e ajuste.
                              </p> */}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <Field label="% interna destino" required>
                                <Input
                                  placeholder="Pesquise a alíquota"
                                  value={item.difalAliquotaInterna}
                                  onChange={(event) =>
                                    updateItem(index, {
                                      difalAliquotaInterna: event.target.value,
                                      difalCamposManuais: marcarDifalManual(item.difalCamposManuais, "aliquotaInterna"),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="% interestadual" required>
                                <Input
                                  value={item.difalAliquotaInterestadual}
                                  onChange={(event) =>
                                    updateItem(index, {
                                      difalAliquotaInterestadual: event.target.value,
                                      difalCamposManuais: marcarDifalManual(item.difalCamposManuais, "aliquotaInterestadual"),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="% partilha destino">
                                <Input
                                  value={item.difalPercentualPartilha}
                                  onChange={(event) =>
                                    updateItem(index, {
                                      difalPercentualPartilha: event.target.value,
                                      difalCamposManuais: marcarDifalManual(item.difalCamposManuais, "percentualPartilha"),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="% FCP" required>
                                <Input
                                  placeholder="Informe 0 se não devido"
                                  value={item.difalAliquotaFcp}
                                  onChange={(event) =>
                                    updateItem(index, {
                                      difalAliquotaFcp: event.target.value,
                                      difalCamposManuais: marcarDifalManual(item.difalCamposManuais, "aliquotaFcp"),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Base FCP (R$)">
                                <Input
                                  placeholder="Mesma do DIFAL"
                                  value={item.difalBaseFcp}
                                  onChange={(event) =>
                                    updateItem(index, {
                                      difalBaseFcp: event.target.value,
                                      difalCamposManuais: marcarDifalManual(item.difalCamposManuais, "baseFcp"),
                                    })
                                  }
                                />
                              </Field>
                            </div>
                            {!item.difalAliquotaInterna.trim() ? (
                              <p className="text-xs text-destructive">
                                Informe a alíquota interna da UF de destino para calcular o DIFAL.
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="md:col-span-12"><Separator /></div>
                        <p className="text-sm font-medium md:col-span-12">PIS e COFINS</p>
                        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:col-span-12">
                        <Field label="CST PIS" required className="sm:col-span-2">
                          <PisCofinsCstSelect
                            value={item.cstPis}
                            operationType={draft.operacao.tipoOperacao}
                            onValueChange={(value) => updatePisCofinsCst(index, "PIS", value)}
                          />
                        </Field>
                        <Field label="Modo PIS" required>
                          <Select value={item.modoPis} onValueChange={(value: DraftItem["modoPis"]) => updateItem(index, { modoPis: value })}>
                            <SelectTrigger disabled={!item.cstPis}><SelectValue placeholder={item.cstPis ? "Selecione" : "Escolha o CST"} /></SelectTrigger>
                            <SelectContent>
                              {getPisCofinsModeOptions(item.cstPis).map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        {item.modoPis === "PERCENTUAL" && <Field label="% PIS" required><Input value={item.aliquotaPis} onChange={(event) => updateItem(index, { aliquotaPis: event.target.value })} /></Field>}
                        {item.modoPis === "QUANTIDADE" && <><Field label="Quantidade base PIS" required><Input value={item.quantidadePis} onChange={(event) => updateItem(index, { quantidadePis: event.target.value })} /></Field><Field label="Alíquota por unidade PIS" required><Input value={item.aliquotaPorUnidadePis} onChange={(event) => updateItem(index, { aliquotaPorUnidadePis: event.target.value })} /></Field></>}
                        <Field label="CST COFINS" required className="sm:col-span-2">
                          <PisCofinsCstSelect
                            value={item.cstCofins}
                            operationType={draft.operacao.tipoOperacao}
                            onValueChange={(value) => updatePisCofinsCst(index, "COFINS", value)}
                          />
                        </Field>
                        <Field label="Modo COFINS" required>
                          <Select value={item.modoCofins} onValueChange={(value: DraftItem["modoCofins"]) => updateItem(index, { modoCofins: value })}>
                            <SelectTrigger disabled={!item.cstCofins}><SelectValue placeholder={item.cstCofins ? "Selecione" : "Escolha o CST"} /></SelectTrigger>
                            <SelectContent>
                              {getPisCofinsModeOptions(item.cstCofins).map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        {item.modoCofins === "PERCENTUAL" && <Field label="% COFINS" required><Input value={item.aliquotaCofins} onChange={(event) => updateItem(index, { aliquotaCofins: event.target.value })} /></Field>}
                        {item.modoCofins === "QUANTIDADE" && <><Field label="Quantidade base COFINS" required><Input value={item.quantidadeCofins} onChange={(event) => updateItem(index, { quantidadeCofins: event.target.value })} /></Field><Field label="Alíquota por unidade COFINS" required><Input value={item.aliquotaPorUnidadeCofins} onChange={(event) => updateItem(index, { aliquotaPorUnidadeCofins: event.target.value })} /></Field></>}
                        </div>

                        <div className="md:col-span-12"><Separator /></div>
                        <p className="text-sm font-medium md:col-span-12">Reforma tributária (IBS/CBS)</p>
                        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 md:col-span-12">
                        <Field label="Aplicar IBS/CBS" required={setup?.regrasFiscais?.rtc.status === "REQUIRED"}>
                          <Select value={item.rtcHabilitado ? "SIM" : "NAO"} onValueChange={(value) => updateItem(index, { rtcHabilitado: value === "SIM" })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="NAO">Não se aplica</SelectItem><SelectItem value="SIM">Aplicar</SelectItem></SelectContent>
                          </Select>
                        </Field>
                        {item.rtcHabilitado && <>
                          <Field label="Classificação tributária" required className="sm:col-span-2 xl:col-span-2">
                            <Select value={item.cClassTrib} onValueChange={(value) => {
                              const selected = setup?.classificacoesRtc.find((option) => option.codigo === value);
                              updateItem(index, { cClassTrib: value, cstIbsCbs: selected?.cst ?? "" });
                            }}>
                              <SelectTrigger
                                title={setup?.classificacoesRtc.find((option) => option.codigo === item.cClassTrib)?.nome}
                              >
                                <SelectValue placeholder="Selecione o cClassTrib" />
                              </SelectTrigger>
                              <SelectContent className="max-w-[calc(100vw-2rem)] sm:max-w-2xl">
                                {setup?.classificacoesRtc.map((option) => (
                                  <SelectItem
                                    className="whitespace-normal py-2 pr-8 leading-snug"
                                    key={`${option.cst}-${option.codigo}`}
                                    value={option.codigo}
                                  >
                                    {option.cst} / {option.codigo} - {option.nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="CST IBS/CBS" required><Input value={item.cstIbsCbs} disabled /></Field>
                          <Field label="Base IBS/CBS" required><Input value={item.baseRtc} placeholder="Automática conforme a operação" onChange={(event) => updateItem(index, { baseRtc: event.target.value })} /></Field>
                          <Field label="% IBS UF" required><Input value={item.aliquotaIbsUf} onChange={(event) => updateItem(index, { aliquotaIbsUf: event.target.value })} /></Field>
                          <Field label="% IBS Município" required><Input value={item.aliquotaIbsMunicipio} onChange={(event) => updateItem(index, { aliquotaIbsMunicipio: event.target.value })} /></Field>
                          <Field label="% CBS" required><Input value={item.aliquotaCbs} onChange={(event) => updateItem(index, { aliquotaCbs: event.target.value })} /></Field>
                        </>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {currentStep === 4 && (
              <>
                <TransporteStep
                  draft={draft}
                  updateDraft={updateDraft}
                  isSemTransporte={isSemTransporte}
                  isFreteContratado={isFreteContratado}
                  isTransporteProprio={isTransporteProprio}
                />
                <Separator />
                <EntregaStep draft={draft} updateDraft={updateDraft} />
              </>
            )}
            {false && (
              <ReadOnlyStep
                title="Transporte"
                description="Esta primeira versão emite a NF-e avulsa com modalidade sem frete. Dados de transportadora e volumes ficam bloqueados até a parametrização fiscal específica."
              />
            )}

            {currentStep === 5 && (
              <section className="min-w-0 space-y-4">
                {isSemPagamentoObrigatorio ? (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Pagamento definido pela finalidade</AlertTitle>
                    <AlertDescription>
                      NF-e de ajuste ou devolução deve ser emitida com 90 - Sem pagamento.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="grid min-w-0 gap-4 md:grid-cols-2">
                    <Field label="Métodos de pagamento" required>
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
                                {paymentOptions.map((option) => {
                                  const checked = draft.pagamentos.some(
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
                    </Field>
                    <Info
                      label="Total da NF-e"
                      value={formatarEmReal(totalNota)}
                    />
                  </div>
                )}

                {!isSemPagamentoObrigatorio && draft.pagamentos.length === 1 ? (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Pagamento integral</AlertTitle>
                    <AlertDescription>
                      O total de {formatarEmReal(totalNota)} será atribuído automaticamente ao método selecionado.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {!isSemPagamentoObrigatorio && draft.pagamentos.length > 1 ? (
                  <div className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4">
                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">Distribuição do pagamento</p>
                        <p className="text-xs text-muted-foreground">
                          Informe quanto foi pago em cada método selecionado.
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-medium">Total: {formatarEmReal(totalNota)}</p>
                    </div>
                    <div className="grid min-w-0 gap-3 md:grid-cols-2">
                      {draft.pagamentos.map((pagamento) => (
                        <Field
                          key={pagamento.meio}
                          label={`${pagamento.meio} - ${getPaymentLabel(pagamento.meio)}`}
                          required
                        >
                          <ValueInput
                            price={pagamento.valor}
                            setPrice={(valor) => updatePayment(pagamento.meio, { valor })}
                          />
                        </Field>
                      ))}
                    </div>
                    {paymentErrors.length ? (
                      <p className="text-xs text-destructive">{paymentErrors.join(" ")}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Soma informada: {formatarEmReal(draft.pagamentos.reduce(
                          (total, pagamento) => total + pagamento.valor,
                          0,
                        ))}
                      </p>
                    )}
                  </div>
                ) : !isSemPagamentoObrigatorio && paymentErrors.length ? (
                  <p className="text-xs text-destructive">{paymentErrors.join(" ")}</p>
                ) : null}

                {!isSemPagamentoObrigatorio && draft.pagamentos
                  .filter((pagamento) => pagamento.meio === "03" || pagamento.meio === "04")
                  .map((pagamento) => (
                    <div key={pagamento.meio} className="min-w-0 space-y-4 rounded-lg border p-3 sm:p-4">
                      <div>
                        <p className="font-medium">
                          Dados do {pagamento.meio} - {getPaymentLabel(pagamento.meio)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Informe os dados específicos desta forma de pagamento.
                        </p>
                      </div>
                      <div className="grid min-w-0 gap-4 md:grid-cols-2">
                        <Field label="Integração do cartão" required>
                      <Select
                        value={pagamento.tipoIntegracao}
                        onValueChange={(value: "1" | "2") =>
                          updatePayment(pagamento.meio, { tipoIntegracao: value })
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
                        value={pagamento.bandeira || "99"}
                        onValueChange={(value) => updatePayment(pagamento.meio, { bandeira: value })}
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
                        {pagamento.tipoIntegracao === "1" && (
                          <>
                            <Field label="CNPJ da credenciadora" required>
                          <Input
                            value={pagamento.cnpjCredenciadora}
                            onChange={(event) =>
                              updatePayment(pagamento.meio, {
                                cnpjCredenciadora: normalizeCnpj(event.target.value).slice(0, 14),
                              })
                            }
                          />
                            </Field>
                            <Field label="Código de autorização" required>
                          <Input
                            value={pagamento.autorizacao}
                            onChange={(event) =>
                              updatePayment(pagamento.meio, { autorizacao: event.target.value })
                            }
                          />
                            </Field>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                {!isSemPagamentoObrigatorio && draft.pagamentos
                  .filter((pagamento) => pagamento.meio === "99")
                  .map((pagamento) => (
                    <div key={pagamento.meio} className="min-w-0 space-y-4 rounded-lg border p-3 sm:p-4">
                      <div>
                        <p className="font-medium">
                          Dados do {pagamento.meio} - {getPaymentLabel(pagamento.meio)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          A SEFAZ exige a descrição da forma de pagamento quando o método for &quot;Outros&quot;.
                        </p>
                      </div>
                      <Field label="Descrição do pagamento" required>
                        <Input
                          value={pagamento.descricao}
                          maxLength={60}
                          onChange={(event) =>
                            updatePayment(pagamento.meio, { descricao: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                  ))}
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
                  <Info label="Total" value={formatarEmReal(totalNota)} />
                  <Info label="Pagamento" value={paymentSummary} />
                  <Info label="Frete" value={`${draft.transporte.modFrete} - ${getFreightLabel(draft.transporte.modFrete)}`} />
                  <Info
                    label="Entrega/Retirada"
                    value={draft.entrega.habilitado ? draft.entrega.nome || "Local diferente informado" : "Mesmo do destinatário"}
                  />
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
                          {formatarEmReal(
                            Math.max(
                              0,
                              parseCurrency(item.quantidade) * parseCurrency(item.valorUnitario) -
                                parseCurrency(item.valorDesconto),
                            ),
                          )}
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
            <Info label="Pagamento" value={paymentSummary} />
            <Info label="Status do documento" value={draft.nfeId ? `Rascunho #${draft.nfeId}` : "Não salvo"} />
            {documentState.origemLabel ? (
              <Info label="Origem" value={`${documentState.origemLabel} — vínculo mantido ao salvar`} />
            ) : null}
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
          <div className="rounded-md border bg-card p-3 text-sm">
            <p className="font-medium">{draft.destinatario.nomeRazaoSocial || "Destinatário pendente"}</p>
            <p className="mt-1 text-muted-foreground">
              Total da NF-e: {formatarEmReal(totalNota)} - Ambiente: {ambienteLabel}
            </p>
            <p className="mt-1 text-muted-foreground">
              Será a nota de número {setup?.proximoNumero ?? "—"}, série {setup?.config?.serie ?? "—"}.
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

function PisCofinsCstSelect({
  value,
  operationType,
  onValueChange,
}: {
  value: string;
  operationType: DraftPayload["operacao"]["tipoOperacao"];
  onValueChange: (value: string) => void;
}) {
  const groupOrder = operationType === "ENTRADA"
    ? (["ENTRADA", "SAIDA", "OUTROS"] as const)
    : (["SAIDA", "ENTRADA", "OUTROS"] as const);
  const groupLabels = {
    SAIDA: `Operações de saída${operationType === "SAIDA" ? " — tipo atual da NF-e" : ""}`,
    ENTRADA: `Operações de entrada e crédito${operationType === "ENTRADA" ? " — tipo atual da NF-e" : ""}`,
    OUTROS: "Outras situações",
  } as const;

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger title={value ? formatPisCofinsCst(value) : undefined}>
        <SelectValue placeholder="Selecione" />
      </SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2rem)] sm:w-[42rem]">
        {groupOrder.map((group) => (
          <SelectGroup key={group}>
            <SelectLabel>{groupLabels[group]}</SelectLabel>
            {PIS_COFINS_CST_OPTIONS
              .filter((option) => option.operation === group)
              .map((option) => (
                <SelectItem
                  className="whitespace-normal py-2 pr-8 leading-snug"
                  key={option.value}
                  value={option.value}
                >
                  {option.value} - {option.description}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({
  label,
  children,
  required = false,
  className = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 space-y-2 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:overflow-hidden [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:max-w-full [&_[data-slot=select-value]]:truncate ${className}`}
    >
      <Label className="inline-flex min-h-5 items-start gap-1 leading-tight">
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
  setupFiscal,
  totalProdutos,
  totalFrete,
}: {
  draft: DraftPayload;
  documentState: NFeDocumentState;
  setup: SetupResponse | null;
  /** Para a prévia calcular o ICMS com o mesmo núcleo do servidor. */
  setupFiscal: FiscalSetup | null;
  totalProdutos: number;
  totalFrete: number;
}) {
  const totalNota = totalProdutos + totalFrete;
  const pagamentosAtuais = draft.operacao.finalidade === "AJUSTE" || draft.operacao.finalidade === "DEVOLUCAO"
    ? [{ ...initialDraft.pagamento, meio: "90", valor: 0 }]
    : draft.pagamentos;

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
    const valorDesconto = Math.min(Math.max(0, parseNumberInput(item.valorDesconto)), valorTotal);
    // Os tributos incidem sobre o item já líquido do desconto incondicional.
    const valorLiquido = Number((valorTotal - valorDesconto).toFixed(2));
    // ICMS da prévia = o que o servidor vai serializar: sem ICMS próprio no
    // CST 60/40/SN102 mesmo com alíquota no cadastro.
    const taxItem = toNFeItem(itemAssistidoDaAvulsa(item, index), index, setupFiscal ?? undefined, contextoBaseDaAvulsa(item, draft, setupFiscal?.empresa?.uf));
    const icms = taxItem.icms;
    const rtc = taxItem.rtc;
    const aliquotaPis = parseNumberInput(item.aliquotaPis);
    const aliquotaCofins = parseNumberInput(item.aliquotaCofins);

    return {
      id: `${item.produtoId ?? item.codigo ?? "item"}-${index}`,
      n_item: index + 1,
      produtoid: item.produtoId != null ? String(item.produtoId) : item.codigo || null,
      ean: "",
      descricao: item.descricao,
      ncm: item.ncm || null,
      cest: item.cest,
      cfop: item.cfop,
      origem: item.orig,
      csosn: item.csosn || item.cst || null,
      unidade: item.unidade,
      quantidade,
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
      valor_desconto: valorDesconto,
      valor_bc_icms: icms?.vBC ?? 0,
      aliquotaicms: icms?.pICMS ?? 0,
      valor_icms: icms?.vICMS ?? 0,
      cst_ipi: null,
      valor_bc_ipi: 0,
      aliquota_ipi: 0,
      valor_ipi: 0,
      cst_pis: item.cstPis || null,
      aliquota_pis: aliquotaPis,
      valor_pis: Number((valorLiquido * (aliquotaPis / 100)).toFixed(2)),
      cst_cofins: item.cstCofins || null,
      aliquota_cofins: aliquotaCofins,
      valor_cofins: Number((valorLiquido * (aliquotaCofins / 100)).toFixed(2)),
      cst_ibs_cbs: item.rtcHabilitado ? item.cstIbsCbs || null : null,
      classificacao_tributaria: item.rtcHabilitado ? item.cClassTrib || null : null,
      base_ibs_cbs: rtc?.baseCalculo ?? 0,
      aliquota_ibs_uf: rtc?.ibsUf.aliquota ?? 0,
      valor_ibs_uf: rtc?.ibsUf.valor ?? 0,
      aliquota_ibs_municipio: rtc?.ibsMunicipio.aliquota ?? 0,
      valor_ibs_municipio: rtc?.ibsMunicipio.valor ?? 0,
      valor_ibs: rtc?.valorIbs ?? 0,
      aliquota_cbs: rtc?.cbs.aliquota ?? 0,
      valor_cbs: rtc?.cbs.valor ?? 0,
      cst_is: null,
      valor_is: 0,
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
    destinatarioIe: draft.destinatario.inscricaoEstadual || null,
    dataEmissaoDanfe: documentState.dataAutorizacao,
    dataSaidaEntrada: null,
    tipoOperacao: draft.operacao.tipoOperacao === "ENTRADA" ? "ENTRADA" : "SAÍDA",
    naturezaOperacao: draft.operacao.naturezaOperacao || "-",
    ambiente: (setup?.empresa?.ambiente || setup?.config?.ambiente) === "PRODUCAO" ? "1" : "2",
    tipoEmissao: "1",
    statusUpper: "AUTORIZADA",
    statusLabel: "Autorizada",
    chaveAcesso: documentState.chave || "",
    chaveFormatada: formatChaveAcesso(documentState.chave),
    isAutorizada: true,
    xmlError: null,
    xmlBaseAvailable: true,
    itensDisplay,
    totais: {
      vBC: totalBcIcms,
      vICMS: totalIcms,
      vICMSDeson: 0,
      vFCP: 0,
      vBCST: 0,
      vST: 0,
      vFCPST: 0,
      vFCPSTRet: 0,
      vProd: totalProdutos,
      vFrete: totalFrete,
      vSeg: 0,
      vDesc: 0,
      vII: 0,
      vIPI: 0,
      vIPIDevol: 0,
      vPIS: itensDisplay.reduce((sum, item) => sum + item.valor_pis, 0),
      vCOFINS: itensDisplay.reduce((sum, item) => sum + item.valor_cofins, 0),
      vOutro: 0,
      vNF: totalNota,
      vTotTrib: 0,
      vBCIBSCBS: itensDisplay.reduce((sum, item) => sum + item.base_ibs_cbs, 0),
      vIBSUF: itensDisplay.reduce((sum, item) => sum + item.valor_ibs_uf, 0),
      vIBSMun: itensDisplay.reduce((sum, item) => sum + item.valor_ibs_municipio, 0),
      vIBS: itensDisplay.reduce((sum, item) => sum + item.valor_ibs, 0),
      vCBS: itensDisplay.reduce((sum, item) => sum + item.valor_cbs, 0),
      vIS: 0,
      vServ: 0,
      vBCISS: 0,
      vISS: 0,
    },
    transporte: {
      modFrete: draft.transporte.modFrete,
      nome: draft.transporte.transportadora.nome,
      documento: draft.transporte.transportadora.documento,
      ie: draft.transporte.transportadora.inscricaoEstadual,
      endereco: draft.transporte.transportadora.endereco,
      municipio: draft.transporte.transportadora.municipio,
      uf: draft.transporte.transportadora.uf,
      placa: draft.transporte.veiculo.placa,
      ufVeiculo: draft.transporte.veiculo.uf,
      rntc: draft.transporte.veiculo.rntc,
      volumes: draft.transporte.volume.quantidade || draft.transporte.volume.especie ? [{
        quantidade: parseNumberInput(draft.transporte.volume.quantidade),
        especie: draft.transporte.volume.especie,
        marca: draft.transporte.volume.marca,
        numeracao: draft.transporte.volume.numeracao,
        pesoLiquido: parseNumberInput(draft.transporte.volume.pesoLiquido),
        pesoBruto: parseNumberInput(draft.transporte.volume.pesoBruto),
      }] : [],
    },
    entrega: draft.entrega.habilitado ? {
      nome: draft.entrega.nome,
      documento: draft.entrega.cpfCnpj,
      logradouro: draft.entrega.endereco,
      numero: draft.entrega.numero,
      complemento: draft.entrega.complemento,
      bairro: draft.entrega.bairro,
      municipio: draft.entrega.cidade,
      uf: draft.entrega.estado,
      cep: draft.entrega.cep,
    } : null,
    fatura: null,
    duplicatas: [],
    pagamentos: pagamentosAtuais.map((pagamento) => ({
      tipo: pagamento.meio,
      valor: pagamento.meio === "90"
        ? 0
        : pagamentosAtuais.length === 1
          ? totalNota
          : pagamento.valor,
      descricao: pagamento.descricao,
      integracao: pagamento.tipoIntegracao,
      cnpjCredenciadora: pagamento.cnpjCredenciadora,
      bandeira: pagamento.bandeira,
      autorizacao: pagamento.autorizacao,
    })),
    infCpl: draft.operacao.observacoesFiscais || null,
    infAdFisco: null,
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
          {/* Formulário limpo, sem herdar nada da nota que acabou de sair. */}
          <Button variant="outline" asChild>
            <Link href="/fiscal/nfe-avulsa">
              <Plus className="h-4 w-4" />
              Emitir outra
            </Link>
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

/**
 * Frete cobrado na nota e a base do ICMS. Com transporte do remetente a lei
 * decide; nas demais modalidades o usuário escolhe e a escolha fica gravada.
 */
function FreteNaBaseIcms({
  draft,
  updateTransporte,
}: {
  draft: DraftPayload;
  updateTransporte: (patch: Partial<DraftTransporte>) => void;
}) {
  const decisao = freteNaBaseDaAvulsa(draft);
  if (decisao.fonte === "SEM_FRETE") return null;
  if (decisao.fonte === "INCONSISTENTE") return <p role="alert" className="text-sm text-destructive">{decisao.motivo}</p>;
  if (decisao.fonte === "LEI") {
    return (
      <p className="text-xs text-muted-foreground">
        Transporte do remetente: o frete de {formatarEmReal(decisao.valorFrete)} entra na base do ICMS próprio
        (LC 87/96, art. 13, §1º, II, &quot;b&quot;) e na base da ST.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="O frete integra a base do ICMS próprio?" required>
        <Select
          value={
            draft.transporte.freteIntegraBaseIcms === null
              ? undefined
              : draft.transporte.freteIntegraBaseIcms
                ? "SIM"
                : "NAO"
          }
          onValueChange={(value) => updateTransporte({ freteIntegraBaseIcms: value === "SIM" })}
        >
          <SelectTrigger aria-invalid={draft.transporte.freteIntegraBaseIcms === null}>
            <SelectValue placeholder="Escolha conforme a operação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SIM">Sim, integra a base do ICMS próprio</SelectItem>
            <SelectItem value="NAO">Não, fica fora da base do ICMS próprio</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <p className="self-end text-xs text-muted-foreground">
        {decisao.fonte === "PENDENTE"
          ? decisao.motivo
          : "Fora da hipótese automática da LC 87/96. A escolha fica registrada na nota. Na ST, o frete cobrado entra na base de qualquer forma."}
      </p>
    </div>
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

      <FreteNaBaseIcms draft={draft} updateTransporte={updateTransporte} />

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
                ? "A transportadora e opcional nessa modalidade. Se preencher algum dado dela, CPF/CNPJ, nome e UF passam a ser obrigatorios juntos."
                : "No transporte proprio, o XML usa os dados do responsavel pela modalidade selecionada e aceita veiculo e volumes quando informados."}
            </AlertDescription>
          </Alert>

          {isFreteContratado && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Transportadora</p>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="CPF/CNPJ">
                  <Input
                    value={draft.transporte.transportadora.documento}
                    onChange={(event) => updateTransportadora({ documento: normalizeCpfOrCnpj(event.target.value).slice(0, 14) })}
                    maxLength={14}
                  />
                </Field>
                <Field label="Nome/Razao social">
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
                <Field label="UF">
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

/**
 * Entrega/retirada em local diferente do destinatário (grupo `<entrega>`).
 * Independente do transporte: a pessoa indicada aqui é quem recebe ou retira
 * a mercadoria, e nunca substitui o destinatário fiscal do `<dest>`.
 */
function EntregaStep({
  draft,
  updateDraft,
}: {
  draft: DraftPayload;
  updateDraft: (updater: (current: DraftPayload) => DraftPayload) => void;
}) {
  const updateEntrega = (patch: Partial<DraftEntrega>) => {
    updateDraft((current) => ({
      ...current,
      entrega: {
        ...current.entrega,
        ...patch,
      },
    }));
  };

  const isEntregaJuridica = draft.entrega.tipoPessoa === "JURIDICA";
  const [buscandoCnpjEntrega, setBuscandoCnpjEntrega] = React.useState(false);
  const [buscandoCepEntrega, setBuscandoCepEntrega] = React.useState(false);
  const ultimoCnpjEntrega = React.useRef("");
  const ultimoCepEntrega = React.useRef("");

  /**
   * Preenche a pessoa e o endereco de retirada a partir do CNPJ digitado.
   * Vale so para pessoa juridica: no CPF nao existe consulta publica
   * equivalente. Nada aqui toca o destinatario fiscal do `<dest>`.
   */
  async function buscarCnpjEntrega(documento?: string) {
    const cnpj = normalizeCnpj(documento ?? draft.entrega.cpfCnpj);
    if (!isValidCnpj(cnpj)) {
      toast.error("Informe um CNPJ válido para consultar.");
      return;
    }
    if (!/^\d{14}$/.test(cnpj)) {
      toast.info("A consulta automática ainda não aceita CNPJ alfanumérico. Preencha os dados manualmente.");
      return;
    }

    ultimoCnpjEntrega.current = cnpj;
    setBuscandoCnpjEntrega(true);
    try {
      const response = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Muitas consultas em sequência. Aguarde um pouco e tente de novo.");
        }
        if (response.status === 400 || response.status === 404) {
          throw new Error("CNPJ não encontrado. Confira o número informado.");
        }
        throw new Error("Não foi possível consultar os dados do CNPJ.");
      }

      const empresaConsultada = await response.json();
      const estabelecimento = empresaConsultada?.estabelecimento;
      const uf = String(estabelecimento?.estado?.sigla ?? "").trim().toUpperCase();
      const cidade = String(estabelecimento?.cidade?.nome ?? "").trim();
      const codigoMunicipio = onlyDigits(estabelecimento?.cidade?.ibge_id).slice(0, 7);
      if (!empresaConsultada?.razao_social || !estabelecimento || !uf || !cidade || !codigoMunicipio) {
        throw new Error("A consulta não retornou dados cadastrais suficientes.");
      }

      const cep = onlyDigits(estabelecimento.cep).slice(0, 8);
      ultimoCepEntrega.current = cep;
      updateEntrega({
        tipoPessoa: "JURIDICA",
        cpfCnpj: cnpj,
        nome: String(empresaConsultada.razao_social ?? "").trim(),
        endereco: String(estabelecimento.logradouro ?? "").trim(),
        numero: String(estabelecimento.numero ?? "").trim(),
        complemento: String(estabelecimento.complemento ?? "").trim(),
        bairro: String(estabelecimento.bairro ?? "").trim(),
        cidade,
        estado: uf,
        cep,
        codigoMunicipio,
      });
      toast.success("Dados do CNPJ preenchidos no local de entrega/retirada.");
    } catch (error: any) {
      toast.error(error?.message || "Erro ao consultar o CNPJ.");
    } finally {
      setBuscandoCnpjEntrega(false);
    }
  }

  /**
   * Preenche o endereco a partir do CEP, valendo para CPF e CNPJ: o local de
   * retirada e do endereco, nao da pessoa. Numero e complemento ficam de fora
   * porque o CEP nao os informa e limpa-los apagaria o que ja foi digitado.
   */
  async function buscarCepEntrega(valor?: string) {
    const cep = onlyDigits(valor ?? draft.entrega.cep).slice(0, 8);
    if (cep.length !== 8) {
      toast.error("Informe um CEP com 8 dígitos para consultar.");
      return;
    }

    ultimoCepEntrega.current = cep;
    setBuscandoCepEntrega(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Não foi possível consultar o CEP.");
      }

      // O ViaCEP responde 200 com `erro` quando o CEP nao existe.
      const consulta = await response.json();
      if (consulta?.erro) {
        throw new Error("CEP não encontrado. Confira o número informado.");
      }

      const uf = String(consulta?.uf ?? "").trim().toUpperCase();
      const cidade = String(consulta?.localidade ?? "").trim();
      if (!uf || !cidade) {
        throw new Error("A consulta não retornou endereço suficiente.");
      }

      // CEP geral de cidade vem sem logradouro/bairro: nesse caso o que ja
      // estava digitado continua valendo.
      const logradouro = String(consulta?.logradouro ?? "").trim();
      const bairro = String(consulta?.bairro ?? "").trim();
      const codigoMunicipio = onlyDigits(consulta?.ibge).slice(0, 7);
      updateEntrega({
        cep,
        endereco: logradouro || draft.entrega.endereco,
        bairro: bairro || draft.entrega.bairro,
        cidade,
        estado: uf,
        codigoMunicipio: codigoMunicipio || draft.entrega.codigoMunicipio,
      });
      toast.success("Endereço do CEP preenchido.", {
        description: "Confira o número e o complemento — o CEP não informa esses campos.",
      });
    } catch (error: any) {
      toast.error(error?.message || "Erro ao consultar o CEP.");
    } finally {
      setBuscandoCepEntrega(false);
    }
  }

  const usarEnderecoDestinatario = () => {
    updateEntrega({
      nome: draft.destinatario.nomeRazaoSocial,
      tipoPessoa: draft.destinatario.tipoPessoa === "FISICA" ? "FISICA" : "JURIDICA",
      cpfCnpj: draft.destinatario.cpfCnpj,
      endereco: draft.destinatario.endereco,
      numero: draft.destinatario.numero,
      complemento: draft.destinatario.complemento,
      bairro: draft.destinatario.bairro,
      cidade: draft.destinatario.cidade,
      estado: draft.destinatario.estado,
      cep: draft.destinatario.cep,
      codigoMunicipio: draft.destinatario.codigoMunicipio,
    });
  };

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm font-medium">Entrega / Retirada</p>
        <p className="text-xs text-muted-foreground">
          Use quando a mercadoria for entregue ou retirada em local diferente do endereço do
          destinatário — a nota continua emitida para o mesmo destinatário fiscal.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="entrega-habilitada"
          checked={draft.entrega.habilitado}
          onCheckedChange={(checked) => updateEntrega({ habilitado: checked === true })}
        />
        <Label htmlFor="entrega-habilitada" className="cursor-pointer font-normal">
          Informar local de entrega/retirada diferente do destinatário
        </Label>
      </div>

      {draft.entrega.habilitado && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={usarEnderecoDestinatario}>
              Usar endereço do destinatário
            </Button>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Pessoa indicada para entrega/retirada</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Tipo de pessoa" required>
                <Select
                  value={draft.entrega.tipoPessoa}
                  onValueChange={(value) => updateEntrega({ tipoPessoa: value as DraftEntrega["tipoPessoa"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FISICA">CPF</SelectItem>
                    <SelectItem value="JURIDICA">CNPJ</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={isEntregaJuridica ? "CNPJ" : "CPF"} required>
                <div className="relative">
                  <Input
                    inputMode={isEntregaJuridica ? "text" : "numeric"}
                    className={isEntregaJuridica ? "pr-10" : undefined}
                    value={draft.entrega.cpfCnpj}
                    maxLength={isEntregaJuridica ? 14 : 11}
                    onChange={(event) => {
                      const documento = isEntregaJuridica
                        ? normalizeCnpj(event.target.value).slice(0, 14)
                        : normalizeCpf(event.target.value).slice(0, 11);
                      updateEntrega({ cpfCnpj: documento });
                      // Mesmo comportamento do destinatario: fechou um CNPJ
                      // valido, consulta na hora sem esperar a lupa.
                      if (
                        isEntregaJuridica &&
                        /^\d{14}$/.test(documento) &&
                        isValidCnpj(documento) &&
                        documento !== ultimoCnpjEntrega.current &&
                        !buscandoCnpjEntrega
                      ) {
                        void buscarCnpjEntrega(documento);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && isEntregaJuridica) {
                        event.preventDefault();
                        void buscarCnpjEntrega();
                      }
                    }}
                  />
                  {isEntregaJuridica ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-9 w-9"
                      disabled={buscandoCnpjEntrega}
                      onClick={() => void buscarCnpjEntrega()}
                      aria-label="Consultar CNPJ"
                      title="Consultar CNPJ na Receita"
                    >
                      {buscandoCnpjEntrega ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                </div>
              </Field>
              <Field label="Nome" required>
                <Input
                  value={draft.entrega.nome}
                  onChange={(event) => updateEntrega({ nome: event.target.value })}
                />
              </Field>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">Endereço de entrega/retirada</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Logradouro" required>
                <Input
                  value={draft.entrega.endereco}
                  onChange={(event) => updateEntrega({ endereco: event.target.value })}
                />
              </Field>
              <Field label="Número" required>
                <Input
                  value={draft.entrega.numero}
                  onChange={(event) => updateEntrega({ numero: event.target.value })}
                />
              </Field>
              <Field label="Complemento">
                <Input
                  value={draft.entrega.complemento}
                  onChange={(event) => updateEntrega({ complemento: event.target.value })}
                />
              </Field>
              <Field label="Bairro" required>
                <Input
                  value={draft.entrega.bairro}
                  onChange={(event) => updateEntrega({ bairro: event.target.value })}
                />
              </Field>
              <Field label="Cidade" required>
                <Input
                  value={draft.entrega.cidade}
                  onChange={(event) => updateEntrega({ cidade: event.target.value })}
                />
              </Field>
              <Field label="UF" required>
                <Input
                  value={draft.entrega.estado}
                  maxLength={2}
                  onChange={(event) => updateEntrega({ estado: event.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="CEP">
                <div className="relative">
                  <Input
                    inputMode="numeric"
                    className="pr-10"
                    value={draft.entrega.cep}
                    maxLength={8}
                    onChange={(event) => {
                      const cep = onlyDigits(event.target.value).slice(0, 8);
                      updateEntrega({ cep });
                      // Independe de CPF ou CNPJ: quem manda aqui e o endereco.
                      if (
                        cep.length === 8 &&
                        cep !== ultimoCepEntrega.current &&
                        !buscandoCepEntrega
                      ) {
                        void buscarCepEntrega(cep);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void buscarCepEntrega();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-9 w-9"
                    disabled={buscandoCepEntrega}
                    onClick={() => void buscarCepEntrega()}
                    aria-label="Consultar CEP"
                    title="Buscar endereço pelo CEP"
                  >
                    {buscandoCepEntrega ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </Field>
              <Field label="Código IBGE do município" required>
                <Input
                  value={draft.entrega.codigoMunicipio}
                  onChange={(event) => updateEntrega({ codigoMunicipio: onlyDigits(event.target.value) })}
                />
              </Field>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
