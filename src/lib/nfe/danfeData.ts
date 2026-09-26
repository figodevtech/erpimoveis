import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { traduzStatusNfe } from "@/lib/nfe/statusNfe";
import {
  parseDanfeNFeXml,
  type DanfeItem,
  type DanfeTaxTotals,
  type DanfeTransport,
  type ParsedDanfeNFe,
} from "@/lib/nfe/danfeParser";
import type { DanfeViewData } from "@/components/danfe/danfe-view";
import { formatarChaveDanfe } from "@/lib/nfe/danfeDocumentosReferenciados";

/**
 * Monta os dados do DANFE a partir do XML autorizado (com fallback no banco).
 *
 * Vive aqui, e nao dentro da pagina, porque a rota que gera o PDF vetorial
 * precisa exatamente do mesmo conteudo — se as duas montagens divergirem, o PDF
 * anexado deixa de bater com o DANFE exibido na tela.
 */

export type DanfeOrigem = "proprias" | "terceiros";

type EmpresaRow = {
  id: number;
  razaosocial: string;
  nomefantasia: string | null;
  cnpj: string;
  endereco: string;
  numero: string | null;
  bairro: string | null;
  complemento: string | null;
  cep: string | null;
  uf: string | null;
  codigomunicipio: string | null;
  telefone: string | null;
  inscricaoestadual: string | null;
};

type ClienteRow = {
  id: number;
  nomerazaosocial: string;
  cpfcnpj: string;
  endereco: string | null;
  endereconumero: string | null;
  enderecocomplemento: string | null;
  bairro: string | null;
  cidade: string;
  estado: string;
  cep: string | null;
};

export type NfeRow = {
  id: number;
  modelo: string;
  serie: number;
  numero: number;
  chave_acesso: string;
  ambiente: string;
  status: string;
  ordemservicoid: number | null;
  vendaid: number | null;
  clienteid: number;
  empresaid: number;
  dataemissao: string;
  dataautorizacao: string | null;
  protocolo: string | null;
  total_produtos: number;
  total_servicos: number;
  total_nfe: number;
  xml_assinado: string | null;
  xml_autorizado: string | null;
  empresa?: EmpresaRow;
  cliente?: ClienteRow;
};

type FiscalDfeRow = {
  id: number;
  empresa_id: number;
  chave_acesso: string | null;
  schema: string | null;
  xml: string | null;
  status: string | null;
  data_emissao: string | null;
  valor_total: number | string | null;
  resumo: Record<string, unknown> | null;
  empresa?: EmpresaRow;
};

type NfeItemRow = {
  id: number;
  n_item: number;
  produtoid: number | null;
  descricao: string;
  ncm: string | null;
  cfop: string;
  csosn: string | null;
  unidade: string;
  quantidade: number | string;
  valor_unitario: number | string;
  valor_total: number | string;
  valor_desconto: number | string | null;
  aliquotaicms: number | string | null;
  valor_bc_icms: number | string | null;
  valor_icms: number | string | null;
  cst_pis: string | null;
  aliquota_pis: number | string | null;
  valor_pis: number | string | null;
  cst_cofins: string | null;
  aliquota_cofins: number | string | null;
  valor_cofins: number | string | null;
};

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function isCompleteNFeXml(xml?: string | null) {
  const value = String(xml ?? "");
  return /<(?:\w+:)?(?:nfeProc|NFe)\b/i.test(value);
}

function extractAccessKey(xml?: string | null) {
  const value = String(xml ?? "");
  return value.match(/<(?:\w+:)?chNFe[^>]*>(\d{44})<\/(?:\w+:)?chNFe>/i)?.[1]
    ?? value.match(/<(?:\w+:)?infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i)?.[1]
    ?? null;
}

function keyIdentification(key: string) {
  const digits = onlyDigits(key);
  return {
    modelo: digits.slice(20, 22) === "65" ? "NFCE" : "NFE",
    serie: Number(digits.slice(22, 25)) || 0,
    numero: Number(digits.slice(25, 34)) || 0,
  };
}

function formatKey(key: string) {
  return formatarChaveDanfe(key) || "-";
}

function formatAddress(address: {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
}) {
  const street = [address.logradouro, address.numero].filter(Boolean).join(", ");
  return [street, address.complemento, address.bairro, address.cep ? `CEP ${address.cep}` : "", [address.municipio, address.uf].filter(Boolean).join("/")]
    .filter(Boolean)
    .join(" - ") || "-";
}

const EMPTY_TOTALS: DanfeTaxTotals = {
  vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0,
  vProd: 0, vFrete: 0, vSeg: 0, vDesc: 0, vII: 0, vIPI: 0, vIPIDevol: 0, vPIS: 0, vCOFINS: 0,
  vOutro: 0, vNF: 0, vTotTrib: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0, vIS: 0,
  vServ: 0, vBCISS: 0, vISS: 0,
};

const EMPTY_TRANSPORT: DanfeTransport = {
  modFrete: "9", nome: "", documento: "", ie: "", endereco: "", municipio: "", uf: "", placa: "", ufVeiculo: "", rntc: "", volumes: [],
};

async function loadIssuedNFe(id: number) {
  const { data, error } = await supabaseAdmin.from("nfe").select(`
    id, modelo, serie, numero, chave_acesso, ambiente, status, ordemservicoid, vendaid, clienteid, empresaid,
    dataemissao, dataautorizacao, protocolo, total_produtos, total_servicos, total_nfe, xml_assinado, xml_autorizado,
    empresa:empresa (id, razaosocial, nomefantasia, cnpj, endereco, numero, bairro, complemento, cep, uf, codigomunicipio, telefone, inscricaoestadual),
    cliente:cliente (id, nomerazaosocial, cpfcnpj, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep)
  `).eq("id", id).maybeSingle<NfeRow>();
  if (error || !data) {
    console.error("[danfe] erro ao carregar NF-e:", error);
    return null;
  }
  return data as NfeRow;
}

async function loadReceivedNFe(id: number) {
  const select = `id, empresa_id, chave_acesso, schema, xml, status, data_emissao, valor_total, resumo,
    empresa:empresa_id (id, razaosocial, nomefantasia, cnpj, endereco, numero, bairro, complemento, cep, uf, codigomunicipio, telefone, inscricaoestadual)`;
  const { data, error } = await supabaseAdmin.from("fiscal_dfe_documento").select(select).eq("id", id).maybeSingle<FiscalDfeRow>();
  if (error || !data) {
    console.error("[danfe] erro ao carregar DFe recebido:", error);
    return null;
  }
  const key = onlyDigits(data.chave_acesso).length === 44 ? onlyDigits(data.chave_acesso) : extractAccessKey(data.xml);
  if (!key) return null;
  let document = data;
  if (!isCompleteNFeXml(document.xml)) {
    const { data: procNFe, error: procError } = await supabaseAdmin.from("fiscal_dfe_documento").select(select)
      .eq("empresa_id", data.empresa_id).eq("chave_acesso", key).like("schema", "procNFe%")
      .order("createdat", { ascending: false }).limit(1).maybeSingle<FiscalDfeRow>();
    if (procError) console.error("[danfe] erro ao buscar procNFe recebido:", procError);
    if (procNFe) document = procNFe;
  }
  if (!isCompleteNFeXml(document.xml)) return null;
  const idFromKey = keyIdentification(key);
  const summary = document.resumo ?? {};
  return {
    id: Number(document.id), modelo: idFromKey.modelo, serie: Number(summary.serie ?? idFromKey.serie), numero: Number(summary.nNF ?? idFromKey.numero),
    chave_acesso: key, ambiente: "", status: String(document.status ?? ""), ordemservicoid: null, vendaid: null, clienteid: 0,
    empresaid: Number(document.empresa_id), dataemissao: String(document.data_emissao ?? ""), dataautorizacao: summary.dhRecbto ? String(summary.dhRecbto) : null,
    protocolo: summary.nProt ? String(summary.nProt) : null, total_produtos: Number(document.valor_total ?? 0), total_servicos: 0,
    total_nfe: Number(document.valor_total ?? 0), xml_assinado: null, xml_autorizado: String(document.xml ?? ""), empresa: document.empresa, cliente: undefined,
  } satisfies NfeRow;
}

async function loadFallbackItems(id: number): Promise<DanfeItem[]> {
  const { data, error } = await supabaseAdmin.from("nfe_item").select(`
    id, n_item, produtoid, descricao, ncm, cfop, csosn, unidade, quantidade, valor_unitario, valor_total, valor_desconto,
    aliquotaicms, valor_bc_icms, valor_icms, cst_pis, aliquota_pis, valor_pis, cst_cofins, aliquota_cofins, valor_cofins
  `).eq("nfe_id", id).order("n_item", { ascending: true });
  if (error) console.error("[danfe] erro ao buscar itens de fallback:", error);
  return ((data ?? []) as NfeItemRow[]).map((item) => ({
    id: String(item.id), n_item: item.n_item, produtoid: item.produtoid == null ? null : String(item.produtoid), ean: "", descricao: item.descricao,
    ncm: item.ncm, cest: "", cfop: item.cfop, unidade: item.unidade, quantidade: Number(item.quantidade ?? 0),
    valor_unitario: Number(item.valor_unitario ?? 0), valor_total: Number(item.valor_total ?? 0), valor_desconto: Number(item.valor_desconto ?? 0),
    origem: "", csosn: item.csosn, valor_bc_icms: Number(item.valor_bc_icms ?? 0), aliquotaicms: Number(item.aliquotaicms ?? 0),
    valor_icms: Number(item.valor_icms ?? 0), cst_ipi: null, valor_bc_ipi: 0, aliquota_ipi: 0, valor_ipi: 0,
    cst_pis: item.cst_pis, aliquota_pis: Number(item.aliquota_pis ?? 0), valor_pis: Number(item.valor_pis ?? 0),
    cst_cofins: item.cst_cofins, aliquota_cofins: Number(item.aliquota_cofins ?? 0), valor_cofins: Number(item.valor_cofins ?? 0),
    cst_ibs_cbs: null, classificacao_tributaria: null, base_ibs_cbs: 0, aliquota_ibs_uf: 0, valor_ibs_uf: 0,
    aliquota_ibs_municipio: 0, valor_ibs_municipio: 0, valor_ibs: 0, aliquota_cbs: 0, valor_cbs: 0, cst_is: null, valor_is: 0,
  }));
}

export type DadosDanfe = {
  /** Pronto para o `DanfeView` e para o gerador de PDF. */
  view: DanfeViewData;
  /** Linha crua, usada por quem precisa do vinculo com OS/venda. */
  nfe: NfeRow;
};

export async function carregarDadosDanfe(
  id: number,
  origem: DanfeOrigem = "proprias",
): Promise<DadosDanfe | null> {
  const nfe = origem === "terceiros" ? await loadReceivedNFe(id) : await loadIssuedNFe(id);
  if (!nfe) return null;

  const xml = nfe.xml_autorizado?.trim() || nfe.xml_assinado?.trim() || null;
  let parsed: ParsedDanfeNFe | null = null;
  let xmlError: Error | null = null;
  if (xml) {
    try {
      parsed = parseDanfeNFeXml(xml);
    } catch (error) {
      xmlError = error instanceof Error ? error : new Error(String(error));
      console.error("[danfe] erro ao interpretar XML:", error);
    }
  }

  const items = parsed?.itens ?? await loadFallbackItems(id);
  const totals: DanfeTaxTotals = parsed?.totais ?? {
    ...EMPTY_TOTALS,
    vBC: items.reduce((sum, item) => sum + item.valor_bc_icms, 0),
    vICMS: items.reduce((sum, item) => sum + item.valor_icms, 0),
    vPIS: items.reduce((sum, item) => sum + item.valor_pis, 0),
    vCOFINS: items.reduce((sum, item) => sum + item.valor_cofins, 0),
    vProd: Number(nfe.total_produtos ?? 0),
    vServ: Number(nfe.total_servicos ?? 0),
    vNF: Number(nfe.total_nfe ?? 0),
  };

  const issuerDb = nfe.empresa;
  const recipientDb = nfe.cliente;
  const key = onlyDigits(parsed?.chave || nfe.chave_acesso);
  const rawStatus = String(nfe.status || "").toUpperCase();
  const protocolStatus = parsed?.protocolo.cStat || "";
  const blockedStatus = /CANCEL|DENEG|REJEIT|INUTIL|RASCUNHO|ERRO/.test(rawStatus);
  const isAuthorized = !blockedStatus && (protocolStatus === "100" || protocolStatus === "150" || /AUTORIZ|EMITIDA/.test(rawStatus));
  const statusUpper = isAuthorized ? "AUTORIZADA" : rawStatus;
  const statusLabel = isAuthorized ? "Uso autorizado" : traduzStatusNfe(statusUpper);
  const issuerAddress = parsed ? formatAddress(parsed.emitente.endereco) : formatAddress({
    logradouro: issuerDb?.endereco, numero: issuerDb?.numero, complemento: issuerDb?.complemento, bairro: issuerDb?.bairro, cep: issuerDb?.cep, uf: issuerDb?.uf,
  });
  const recipientAddress = parsed ? formatAddress(parsed.destinatario.endereco) : formatAddress({
    logradouro: recipientDb?.endereco, numero: recipientDb?.endereconumero, complemento: recipientDb?.enderecocomplemento,
    bairro: recipientDb?.bairro, municipio: recipientDb?.cidade, uf: recipientDb?.estado, cep: recipientDb?.cep,
  });

  const view: DanfeViewData = {
    nfe: {
      numero: parsed?.ide.numero || nfe.numero,
      serie: parsed?.ide.serie || nfe.serie,
      ordemservicoid: nfe.ordemservicoid,
      protocolo: parsed?.protocolo.numero || nfe.protocolo,
      dataautorizacao: parsed?.protocolo.data || nfe.dataautorizacao,
    },
    emitenteNome: parsed?.emitente.nome || issuerDb?.razaosocial || "-",
    emitenteEndereco: issuerAddress,
    emitenteCnpj: parsed?.emitente.documento || issuerDb?.cnpj || "",
    emitenteIe: parsed?.emitente.ie || issuerDb?.inscricaoestadual,
    emitenteIest: parsed?.emitente.iest,
    emitenteIm: parsed?.emitente.im,
    emitenteTelefone: parsed?.emitente.endereco.telefone || issuerDb?.telefone,
    destinatarioNome: parsed?.destinatario.nome || recipientDb?.nomerazaosocial || "-",
    destinatarioDoc: parsed?.destinatario.documento || recipientDb?.cpfcnpj || "",
    destinatarioEndereco: recipientAddress,
    destinatarioCidadeUf: parsed ? [parsed.destinatario.endereco.municipio, parsed.destinatario.endereco.uf].filter(Boolean).join("/") : recipientDb ? `${recipientDb.cidade}/${recipientDb.estado}` : "-",
    destinatarioCep: parsed?.destinatario.endereco.cep || recipientDb?.cep,
    destinatarioIe: parsed?.destinatario.ie,
    dataEmissaoDanfe: parsed?.ide.dhEmi || nfe.dataemissao,
    dataSaidaEntrada: parsed?.ide.dhSaiEnt,
    tipoOperacao: parsed?.ide.tpNF === "0" ? "ENTRADA" : "SAÍDA",
    naturezaOperacao: parsed?.ide.natOp || "-",
    ambiente: parsed?.ide.tpAmb || (String(nfe.ambiente).toUpperCase() === "PRODUCAO" ? "1" : "2"),
    tipoEmissao: parsed?.ide.tpEmis || "1",
    statusUpper,
    statusLabel,
    chaveAcesso: key,
    chaveFormatada: formatKey(key),
    isAutorizada: isAuthorized,
    xmlError: xmlError?.message,
    xmlBaseAvailable: Boolean(xml),
    itensDisplay: items,
    totais: totals,
    transporte: parsed?.transporte ?? EMPTY_TRANSPORT,
    documentosReferenciados: parsed?.documentosReferenciados ?? [],
    entrega: parsed?.entrega ?? null,
    fatura: parsed?.fatura ?? null,
    duplicatas: parsed?.duplicatas ?? [],
    pagamentos: parsed?.pagamentos ?? [],
    infCpl: parsed?.infCpl,
    infAdFisco: parsed?.infAdFisco,
  };

  return { view, nfe };
}
