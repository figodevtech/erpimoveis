// src/app/(app)/(pages)/nfe/[id]/danfe/page.tsx
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "./components/PrintButton";
import type { Metadata } from "next";
import { DOMParser } from "@xmldom/xmldom";
import { traduzStatusNfe } from "@/lib/nfe/statusNfe";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ origem?: string }>;
};

/* ========= HELPERS DE FORMATAÇÃO ========= */

function fmtDate(s?: string | Date | null) {
  if (!s) return "—";
  const d = s instanceof Date ? s : new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function fmtMoney(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fmtPercent(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return `${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function fmtDoc(cpfCnpj: unknown) {
  if (cpfCnpj == null) return "—";
  const s = String(cpfCnpj).replace(/\D/g, "");
  if (!s) return "—";

  if (s.length === 11) {
    // CPF
    return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (s.length === 14) {
    // CNPJ
    return s.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
  }
  return s;
}

// chave em blocos de 4 dígitos (3.1.1 do manual)
function fmtChaveAcesso(chave?: string | null) {
  if (!chave) return "—";
  const s = chave.replace(/\D/g, "");
  if (!s) return "—";
  return s.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function isXmlCompletoNfe(xml?: string | null) {
  const value = String(xml ?? "");
  return value.includes("<nfeProc") || value.includes("<NFe");
}

function extractChaveAcessoFromXml(xml?: string | null) {
  const text = String(xml ?? "");
  const tagMatch = text.match(/<chNFe[^>]*>(\d{44})<\/chNFe>/i);
  if (tagMatch?.[1]) return tagMatch[1];

  const idMatch = text.match(/<infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i);
  return idMatch?.[1] ?? null;
}

function extractIdentificacaoFromChave(chave: string) {
  const digits = onlyDigits(chave);
  return {
    modelo: digits.slice(20, 22) === "65" ? "NFCE" : "NFE",
    serie: Number(digits.slice(22, 25)) || 0,
    numero: Number(digits.slice(25, 34)) || 0,
  };
}

/* ========= TIPOS DO BANCO ========= */

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

type NfeRow = {
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
  resumo: any;
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

/* ========= TIPO GENÉRICO PRA EXIBIR ITENS NO DANFE ========= */

type ItemDisplay = {
  id: string;
  n_item: number;
  produtoid: string | number | null;
  descricao: string;
  ncm: string | null;
  cfop: string;
  csosn: string | null; // aqui pode ir CST ou CSOSN, só pra exibição
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  valor_bc_icms: number;
  aliquotaicms: number;
  valor_icms: number;
  cst_pis: string | null;
  valor_pis: number;
  cst_cofins: string | null;
  valor_cofins: number;
};

/* ========= PARSE DO XML DA NF-E ========= */

type ParsedNFe = {
  ide: {
    dhEmi?: string;
    tpNF?: string;
  };
  emitente: {
    razaoSocial: string;
    nomeFantasia?: string;
    cnpj: string;
    enderecoFormatado: string;
    telefone?: string;
    ie?: string;
  };
  destinatario: {
    razaoSocial: string;
    cpfCnpj?: string;
    enderecoFormatado: string;
    cidadeUf?: string;
    cep?: string;
  };
  totais: {
    vBC: number;
    vICMS: number;
    vProd: number;
    vPIS: number;
    vCOFINS: number;
    vNF: number;
  };
  itens: ItemDisplay[];
  infCpl?: string;
};

function textFrom(el: Element | Document | null | undefined, tag: string): string {
  if (!el) return "";
  const nodes = (el as any).getElementsByTagName(tag) as HTMLCollectionOf<Element>;
  if (!nodes || nodes.length === 0) return "";
  const raw = nodes[0].textContent ?? "";
  return String(raw).trim();
}

function parseNumber(s: string): number {
  if (!s) return 0;
  const normalized = s.replace(",", ".");
  const n = Number(normalized);
  return isNaN(n) ? 0 : n;
}

function parseNFeXml(xml: string): ParsedNFe {
  const doc = new DOMParser().parseFromString(xml, "text/xml");

  // Encontra o nó <NFe> (pode estar dentro de <nfeProc>)
  let nfeNode: Element | null = null;
  const nfeList = doc.getElementsByTagName("NFe");
  if (nfeList && nfeList.length > 0) {
    nfeNode = nfeList[0] as Element;
  } else {
    const nfeProcList = doc.getElementsByTagName("nfeProc");
    if (nfeProcList && nfeProcList.length > 0) {
      const inner = (nfeProcList[0] as Element).getElementsByTagName("NFe");
      if (inner && inner.length > 0) {
        nfeNode = inner[0] as Element;
      }
    }
  }

  if (!nfeNode) {
    throw new Error("Tag <NFe> não encontrada no XML.");
  }

  const infNFeList = nfeNode.getElementsByTagName("infNFe");
  const infNFe = infNFeList && infNFeList.length > 0 ? (infNFeList[0] as Element) : null;
  if (!infNFe) {
    throw new Error("Tag <infNFe> não encontrada no XML.");
  }

  const ideNode = infNFe.getElementsByTagName("ide")[0] as Element | undefined;
  const emitNode = infNFe.getElementsByTagName("emit")[0] as Element | undefined;
  const destNode = infNFe.getElementsByTagName("dest")[0] as Element | undefined;

  // ------- IDE -------
  const ide = {
    dhEmi: ideNode ? textFrom(ideNode, "dhEmi") : undefined,
    tpNF: ideNode ? textFrom(ideNode, "tpNF") : undefined,
  };

  // ------- EMITENTE -------
  let emitenteEnderecoFormatado = "—";
  let emitenteTelefone: string | undefined;
  let emitenteIE: string | undefined;
  let emitenteNome = "—";
  let emitenteFantasia: string | undefined;
  let emitenteCnpj = "";

  if (emitNode) {
    const enderEmit = emitNode.getElementsByTagName("enderEmit")[0] as Element | undefined;

    const xLgr = enderEmit ? textFrom(enderEmit, "xLgr") : "";
    const nro = enderEmit ? textFrom(enderEmit, "nro") : "";
    const xBairro = enderEmit ? textFrom(enderEmit, "xBairro") : "";
    const cep = enderEmit ? textFrom(enderEmit, "CEP") : "";
    const uf = enderEmit ? textFrom(enderEmit, "UF") : "";
    const fone = enderEmit ? textFrom(enderEmit, "fone") : "";

    emitenteEnderecoFormatado = [
      xLgr,
      nro && `, ${nro}`,
      xBairro && ` - ${xBairro}`,
      cep && ` - CEP ${cep}`,
      uf && ` - ${uf}`,
    ]
      .filter(Boolean)
      .join("");

    emitenteTelefone = fone || undefined;
    emitenteIE = textFrom(emitNode, "IE") || undefined;
    emitenteNome = textFrom(emitNode, "xNome") || "—";
    const xFant = textFrom(emitNode, "xFant");
    emitenteFantasia = xFant || undefined;
    emitenteCnpj = textFrom(emitNode, "CNPJ");
  }

  // ------- DESTINATÁRIO -------
  let destEnderecoFormatado = "—";
  let destCidadeUf: string | undefined;
  let destCep: string | undefined;
  let destNome = "—";
  let destDoc: string | undefined;

  if (destNode) {
    const enderDest = destNode.getElementsByTagName("enderDest")[0] as Element | undefined;

    const xLgr = enderDest ? textFrom(enderDest, "xLgr") : "";
    const nro = enderDest ? textFrom(enderDest, "nro") : "";
    const xBairro = enderDest ? textFrom(enderDest, "xBairro") : "";
    const cep = enderDest ? textFrom(enderDest, "CEP") : "";
    const xMun = enderDest ? textFrom(enderDest, "xMun") : "";
    const uf = enderDest ? textFrom(enderDest, "UF") : "";

    destEnderecoFormatado = [
      xLgr,
      nro && `, ${nro}`,
      xBairro && ` - ${xBairro}`,
      cep && ` - CEP ${cep}`,
      xMun && uf && ` - ${xMun}/${uf}`,
    ]
      .filter(Boolean)
      .join("");

    destCidadeUf = xMun && uf ? `${xMun}/${uf}` : undefined;
    destCep = cep || undefined;
    destNome = textFrom(destNode, "xNome") || "—";

    const cpf = textFrom(destNode, "CPF");
    const cnpj = textFrom(destNode, "CNPJ");
    destDoc = cpf || cnpj || undefined;
  }

  // ------- TOTAIS (ICMSTot) -------
  const totalNode = infNFe.getElementsByTagName("total")[0] as Element | undefined;
  const icmsTotNode = totalNode
    ? (totalNode.getElementsByTagName("ICMSTot")[0] as Element | undefined)
    : undefined;

  const totais = {
    vBC: icmsTotNode ? parseNumber(textFrom(icmsTotNode, "vBC")) : 0,
    vICMS: icmsTotNode ? parseNumber(textFrom(icmsTotNode, "vICMS")) : 0,
    vProd: icmsTotNode ? parseNumber(textFrom(icmsTotNode, "vProd")) : 0,
    vPIS: icmsTotNode ? parseNumber(textFrom(icmsTotNode, "vPIS")) : 0,
    vCOFINS: icmsTotNode ? parseNumber(textFrom(icmsTotNode, "vCOFINS")) : 0,
    vNF: icmsTotNode ? parseNumber(textFrom(icmsTotNode, "vNF")) : 0,
  };

  // ------- ITENS (det) -------
  const itens: ItemDisplay[] = [];
  const detNodes = infNFe.getElementsByTagName("det");

  for (let i = 0; i < detNodes.length; i++) {
    const det = detNodes[i] as Element;
    const nItemAttr = det.getAttribute("nItem") || det.getAttribute("nitem") || String(i + 1);
    const n_item = parseInt(nItemAttr, 10) || i + 1;

    const prod = det.getElementsByTagName("prod")[0] as Element | undefined;
    const imposto = det.getElementsByTagName("imposto")[0] as Element | undefined;

    const cProd = prod ? textFrom(prod, "cProd") : "";
    const xProd = prod ? textFrom(prod, "xProd") : "";
    const ncm = prod ? textFrom(prod, "NCM") : "";
    const cfop = prod ? textFrom(prod, "CFOP") : "";
    const uCom = prod ? textFrom(prod, "uCom") : "";
    const qCom = prod ? parseNumber(textFrom(prod, "qCom")) : 0;
    const vUnCom = prod ? parseNumber(textFrom(prod, "vUnCom")) : 0;
    const vProd = prod ? parseNumber(textFrom(prod, "vProd")) : 0;

    // ----- ICMS (pega primeiro filho de <ICMS>) -----
    let csosnOuCst: string | null = null;
    let vBCIcms = 0;
    let pIcms = 0;
    let vIcms = 0;

    if (imposto) {
      const icmsParent = imposto.getElementsByTagName("ICMS")[0] as Element | undefined;
      if (icmsParent) {
        let icmsTag: Element | null = null;
        for (let j = 0; j < icmsParent.childNodes.length; j++) {
          const node = icmsParent.childNodes.item(j);
          if (node && node.nodeType === 1) {
            icmsTag = node as Element;
            break;
          }
        }
        if (icmsTag) {
          const cst = textFrom(icmsTag, "CST");
          const csosn = textFrom(icmsTag, "CSOSN");
          csosnOuCst = (csosn || cst || "") || null;
          vBCIcms = parseNumber(textFrom(icmsTag, "vBC"));
          pIcms = parseNumber(textFrom(icmsTag, "pICMS"));
          vIcms = parseNumber(textFrom(icmsTag, "vICMS"));
        }
      }
    }

    // ----- PIS -----
    let cstPis: string | null = null;
    let vPis = 0;
    if (imposto) {
      const pisParent = imposto.getElementsByTagName("PIS")[0] as Element | undefined;
      if (pisParent) {
        let pisTag: Element | null = null;
        for (let j = 0; j < pisParent.childNodes.length; j++) {
          const node = pisParent.childNodes.item(j);
          if (node && node.nodeType === 1) {
            pisTag = node as Element;
            break;
          }
        }
        if (pisTag) {
          cstPis = textFrom(pisTag, "CST") || null;
          vPis = parseNumber(textFrom(pisTag, "vPIS"));
        }
      }
    }

    // ----- COFINS -----
    let cstCofins: string | null = null;
    let vCofins = 0;
    if (imposto) {
      const cofinsParent = imposto.getElementsByTagName("COFINS")[0] as Element | undefined;
      if (cofinsParent) {
        let cofinsTag: Element | null = null;
        for (let j = 0; j < cofinsParent.childNodes.length; j++) {
          const node = cofinsParent.childNodes.item(j);
          if (node && node.nodeType === 1) {
            cofinsTag = node as Element;
            break;
          }
        }
        if (cofinsTag) {
          cstCofins = textFrom(cofinsTag, "CST") || null;
          vCofins = parseNumber(textFrom(cofinsTag, "vCOFINS"));
        }
      }
    }

    itens.push({
      id: `xml-${n_item}`,
      n_item,
      produtoid: cProd || null,
      descricao: xProd || "",
      ncm: ncm || null,
      cfop: cfop || "",
      csosn: csosnOuCst,
      unidade: uCom || "",
      quantidade: qCom,
      valor_unitario: vUnCom,
      valor_total: vProd,
      valor_bc_icms: vBCIcms || vProd,
      aliquotaicms: pIcms,
      valor_icms: vIcms,
      cst_pis: cstPis,
      valor_pis: vPis,
      cst_cofins: cstCofins,
      valor_cofins: vCofins,
    });
  }

  // ------- INFORMAÇÕES ADICIONAIS (infCpl) -------
  const infAdicNode = infNFe.getElementsByTagName("infAdic")[0] as Element | undefined;
  const infCpl = infAdicNode ? textFrom(infAdicNode, "infCpl") || undefined : undefined;

  return {
    ide,
    emitente: {
      razaoSocial: emitenteNome,
      nomeFantasia: emitenteFantasia,
      cnpj: emitenteCnpj,
      enderecoFormatado: emitenteEnderecoFormatado,
      telefone: emitenteTelefone,
      ie: emitenteIE,
    },
    destinatario: {
      razaoSocial: destNome,
      cpfCnpj: destDoc,
      enderecoFormatado: destEnderecoFormatado,
      cidadeUf: destCidadeUf,
      cep: destCep,
    },
    totais,
    itens,
    infCpl,
  };
}

async function carregarNfeEmitidaDanfe(id: number) {
  const { data, error } = await supabaseAdmin
    .from("nfe")
    .select(
      `
      id,
      modelo,
      serie,
      numero,
      chave_acesso,
      ambiente,
      status,
      ordemservicoid,
      vendaid,
      clienteid,
      empresaid,
      dataemissao,
      dataautorizacao,
      protocolo,
      total_produtos,
      total_servicos,
      total_nfe,
      xml_assinado,
      xml_autorizado,
      empresa:empresa (
        id,
        razaosocial,
        nomefantasia,
        cnpj,
        endereco,
        numero,
        bairro,
        complemento,
        cep,
        uf,
        codigomunicipio,
        telefone,
        inscricaoestadual
      ),
      cliente:cliente (
        id,
        nomerazaosocial,
        cpfcnpj,
        endereco,
        endereconumero,
        enderecocomplemento,
        bairro,
        cidade,
        estado,
        cep
      )
    `,
    )
    .eq("id", id)
    .maybeSingle<NfeRow>();

  if (error || !data) {
    console.error("[danfe] erro ao carregar nfe:", error);
    return null;
  }

  return data as NfeRow;
}

async function carregarNfeRecebidaDanfe(id: number) {
  const selectDfe = `
    id,
    empresa_id,
    chave_acesso,
    schema,
    xml,
    status,
    data_emissao,
    valor_total,
    resumo,
    empresa:empresa_id (
      id,
      razaosocial,
      nomefantasia,
      cnpj,
      endereco,
      numero,
      bairro,
      complemento,
      cep,
      uf,
      codigomunicipio,
      telefone,
      inscricaoestadual
    )
  `;
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select(selectDfe)
    .eq("id", id)
    .maybeSingle<FiscalDfeRow>();

  if (error || !data) {
    console.error("[danfe] erro ao carregar dfe recebido:", error);
    return null;
  }

  const chave = onlyDigits(data.chave_acesso).length === 44
    ? onlyDigits(data.chave_acesso)
    : extractChaveAcessoFromXml(data.xml);
  if (!chave) return null;

  let documento = data;
  if (!isXmlCompletoNfe(documento.xml)) {
    const { data: procNfe, error: procError } = await supabaseAdmin
      .from("fiscal_dfe_documento")
      .select(selectDfe)
      .eq("empresa_id", data.empresa_id)
      .eq("chave_acesso", chave)
      .like("schema", "procNFe%")
      .order("createdat", { ascending: false })
      .limit(1)
      .maybeSingle<FiscalDfeRow>();

    if (procError) {
      console.error("[danfe] erro ao buscar procNFe recebido:", procError);
      return null;
    }

    if (procNfe) documento = procNfe;
  }

  if (!isXmlCompletoNfe(documento.xml)) return null;

  const identificacao = extractIdentificacaoFromChave(chave);
  return {
    id: Number(documento.id),
    modelo: identificacao.modelo,
    serie: Number(documento.resumo?.serie ?? identificacao.serie),
    numero: Number(documento.resumo?.nNF ?? identificacao.numero),
    chave_acesso: chave,
    ambiente: "",
    status: String(documento.status ?? ""),
    ordemservicoid: null,
    vendaid: null,
    clienteid: 0,
    empresaid: Number(documento.empresa_id),
    dataemissao: String(documento.data_emissao ?? ""),
    dataautorizacao: documento.resumo?.dhRecbto ?? null,
    protocolo: documento.resumo?.nProt ? String(documento.resumo.nProt) : null,
    total_produtos: Number(documento.valor_total ?? 0),
    total_servicos: 0,
    total_nfe: Number(documento.valor_total ?? 0),
    xml_assinado: null,
    xml_autorizado: String(documento.xml ?? ""),
    empresa: documento.empresa,
    cliente: undefined,
  } satisfies NfeRow;
}

/* ========= METADATA ========= */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (Number.isNaN(id)) {
    return { title: "DANFE" };
  }

  const { data: nfe } = await supabaseAdmin
    .from("nfe")
    .select("numero")
    .eq("id", id)
    .maybeSingle();

  return {
    title: nfe?.numero ? `DANFE NF-e #${nfe.numero}` : "DANFE",
  };
}

/* ========= PÁGINA ========= */

export default async function DanfePage({ params, searchParams }: PageProps) {
  const { id: idStr } = await params;
  const search = searchParams ? await searchParams : {};
  const id = Number(idStr);
  if (Number.isNaN(id)) {
    notFound();
  }

  const nfeRaw =
    search.origem === "terceiros"
      ? await carregarNfeRecebidaDanfe(id)
      : await carregarNfeEmitidaDanfe(id);

  if (!nfeRaw) {
    notFound();
  }

  const nfe = nfeRaw as NfeRow;

  const statusUpper = (nfe.status || "").toUpperCase();
  const statusLabel = traduzStatusNfe(statusUpper);
  const emitenteDb = nfe.empresa;
  const destinatarioDb = nfe.cliente;

  // Monta endereço do emitente a partir do banco (fallback)
  const enderecoEmitenteDb = emitenteDb
    ? [
        emitenteDb.endereco,
        emitenteDb.numero && `, ${emitenteDb.numero}`,
        emitenteDb.bairro && ` - ${emitenteDb.bairro}`,
        emitenteDb.cep && ` - CEP ${emitenteDb.cep}`,
        emitenteDb.uf && ` - ${emitenteDb.uf}`,
      ]
        .filter(Boolean)
        .join("")
    : "—";

  // Endereço destinatário (fallback banco)
  const enderecoDestinatarioDb = destinatarioDb
    ? [
        destinatarioDb.endereco,
        destinatarioDb.endereconumero && `, ${destinatarioDb.endereconumero}`,
        destinatarioDb.bairro && ` - ${destinatarioDb.bairro}`,
        destinatarioDb.cep && ` - CEP ${destinatarioDb.cep}`,
        ` - ${destinatarioDb.cidade}/${destinatarioDb.estado}`,
      ]
        .filter(Boolean)
        .join("")
    : "—";

  // ======= TENTA LER XML (autorizado > assinado) =======
  const xmlBase =
    nfe.xml_autorizado && nfe.xml_autorizado.trim().length > 0
      ? nfe.xml_autorizado
      : nfe.xml_assinado && nfe.xml_assinado.trim().length > 0
      ? nfe.xml_assinado
      : null;

  let parsed: ParsedNFe | null = null;
  let xmlError: Error | null = null;

  if (xmlBase) {
    try {
      parsed = parseNFeXml(xmlBase);
    } catch (e: any) {
      console.error("[danfe] erro ao parsear XML da NF-e:", e);
      xmlError = e instanceof Error ? e : new Error(String(e));
    }
  }

  // ======= ITENS + TOTAIS A PARTIR DO XML (PRIORITÁRIO) =======
  let itensDisplay: ItemDisplay[] = [];
  let totalBcIcms = 0;
  let totalIcms = 0;
  let totalProdutos = nfe.total_produtos;
  let totalNota = nfe.total_nfe;

  if (parsed) {
    itensDisplay = parsed.itens;
    totalBcIcms = parsed.totais.vBC;
    totalIcms = parsed.totais.vICMS;
    // vProd / vNF do XML
    totalProdutos = parsed.totais.vProd;
    totalNota = parsed.totais.vNF;
  } else {
    // ======= FALLBACK: BUSCA ITENS NO BANCO (nfe_item) =======
    const { data: itensRaw, error: itensError } = await supabaseAdmin
      .from("nfe_item")
      .select(
        `
        id,
        n_item,
        produtoid,
        descricao,
        ncm,
        cfop,
        csosn,
        unidade,
        quantidade,
        valor_unitario,
        valor_total,
        valor_desconto,
        aliquotaicms,
        valor_bc_icms,
        valor_icms,
        cst_pis,
        aliquota_pis,
        valor_pis,
        cst_cofins,
        aliquota_cofins,
        valor_cofins
      `
      )
      .eq("nfe_id", id)
      .order("n_item", { ascending: true });

    if (itensError) {
      console.error("[select nfe_item] erro:", itensError);
    }

    const itensDb = (itensRaw ?? []) as NfeItemRow[];

    itensDisplay = itensDb.map((i) => ({
      id: String(i.id),
      n_item: i.n_item,
      produtoid: i.produtoid,
      descricao: i.descricao,
      ncm: i.ncm,
      cfop: i.cfop,
      csosn: i.csosn,
      unidade: i.unidade,
      quantidade: Number(i.quantidade ?? 0),
      valor_unitario: Number(i.valor_unitario ?? 0),
      valor_total: Number(i.valor_total ?? 0),
      valor_bc_icms: Number(i.valor_bc_icms ?? i.valor_total ?? 0),
      aliquotaicms: Number(i.aliquotaicms ?? 0),
      valor_icms: Number(i.valor_icms ?? 0),
      cst_pis: i.cst_pis,
      valor_pis: Number(i.valor_pis ?? 0),
      cst_cofins: i.cst_cofins,
      valor_cofins: Number(i.valor_cofins ?? 0),
    }));

    totalBcIcms = itensDisplay.reduce(
      (acc, i) => acc + Number(i.valor_bc_icms ?? 0),
      0
    );
    totalIcms = itensDisplay.reduce(
      (acc, i) => acc + Number(i.valor_icms ?? 0),
      0
    );
  }

  // Tipo de operação com base no tpNF do XML (fallback saída)
  const tpNF = parsed?.ide.tpNF || "1";
  const tipoOperacao: string = tpNF === "0" ? "ENTRADA" : "SAÍDA";

  const chaveFormatada = fmtChaveAcesso(nfe.chave_acesso);
  const isAutorizada = statusUpper === "AUTORIZADA";

  const emitenteNome =
    parsed?.emitente.razaoSocial ?? emitenteDb?.razaosocial ?? "—";
  const emitenteEndereco =
    parsed?.emitente.enderecoFormatado ?? enderecoEmitenteDb;
  const emitenteCnpj =
    parsed?.emitente.cnpj ?? emitenteDb?.cnpj ?? "";
  const emitenteIe =
    parsed?.emitente.ie ?? emitenteDb?.inscricaoestadual ?? undefined;
  const emitenteTelefone =
    parsed?.emitente.telefone ?? emitenteDb?.telefone ?? undefined;

  const destinatarioNome =
    parsed?.destinatario.razaoSocial ??
    destinatarioDb?.nomerazaosocial ??
    "—";
  const destinatarioDoc =
    parsed?.destinatario.cpfCnpj ?? destinatarioDb?.cpfcnpj ?? "";
  const destinatarioEndereco =
    parsed?.destinatario.enderecoFormatado ??
    enderecoDestinatarioDb;
  const destinatarioCidadeUf =
    parsed?.destinatario.cidadeUf ??
    (destinatarioDb
      ? `${destinatarioDb.cidade}/${destinatarioDb.estado}`
      : "—");
  const destinatarioCep =
    parsed?.destinatario.cep ?? destinatarioDb?.cep ?? "—";

  const dataEmissaoDanfe = parsed?.ide.dhEmi ?? nfe.dataemissao;

  return (
    <>
      <style>{`
        @page {
          size: A4;
          margin: 7mm 5mm;
        }

        .danfe-page {
          font-family: "Times New Roman", "Courier New", system-ui, -apple-system,
            BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 9px;
          color: #000;
          background: #f3f4f6;
          min-height: 100vh;
          padding: 16px 0;
        }

        .danfe-wrapper {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #ffffff;
          border: 1px solid #000;
          padding: 4mm;
          box-sizing: border-box;
        }

        .actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          align-items: center;
          width: 210mm;
          margin: 0 auto 8px auto;
          padding: 0 2px;
        }

        .exit-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 32px;
          padding: 0 12px;
          border: 1px solid hsl(214.3 31.8% 91.4%);
          border-radius: 6px;
          background: #ffffff;
          color: #111827;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 14px;
          font-weight: 500;
          text-decoration: none;
        }

        .exit-link:hover {
          background: #f9fafb;
        }

        .block-title {
          font-size: 7px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .field-label {
          font-size: 7px;
          text-transform: uppercase;
        }

        .field-value {
          font-size: 9px;
          font-weight: 500;
        }

        .border-box {
          border: 1px solid #000;
          box-sizing: border-box;
        }

        .flex-row {
          display: flex;
          flex-direction: row;
        }

        .flex-col {
          display: flex;
          flex-direction: column;
        }

        .center {
          text-align: center;
        }

        .right {
          text-align: right;
        }

        .small-text {
          font-size: 7px;
        }

        .danfe-main-title {
          font-size: 16px;
          font-weight: 700;
        }

        .danfe-subtitle {
          font-size: 9px;
          font-weight: 700;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          padding: 1px 8px;
          font-size: 7px;
          font-weight: 700;
          border: 1px solid #000;
        }

        .chave {
          font-family: "Courier New", ui-monospace, SFMono-Regular, Menlo, Monaco,
            Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 9px;
          letter-spacing: 1px;
          word-break: break-all;
        }

        .barcode-placeholder {
          border: 1px solid #000;
          height: 14mm;
          margin-top: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 7px;
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 7px;
        }

        .items-table thead {
          background: #f9fafb;
        }

        .items-table th,
        .items-table td {
          border: 1px solid #000;
          padding: 2px 3px;
        }

        .items-table th {
          font-weight: 700;
          text-transform: uppercase;
        }

        .items-table td.desc {
          word-break: break-word;
        }

        @media print {
          .danfe-page {
            background: #ffffff;
            padding: 0;
            min-height: auto;
          }
          .actions {
            display: none;
          }
          .danfe-wrapper {
            margin: 0;
            border: none;
            width: auto;
            min-height: auto;
            padding: 0;
          }
        }
      `}</style>

      <div className="danfe-page">
        <div className="actions">
          <Link href="/fiscal" className="exit-link">
            Sair
          </Link>
          <PrintButton />
        </div>

        <div className="danfe-wrapper">
          {/* CANHOTO DE RECEBIMENTO */}
          <div
            className="border-box"
            style={{
              display: "grid",
              gridTemplateColumns: "2.5fr 2fr",
              marginBottom: "2mm",
            }}
          >
            <div style={{ borderRight: "1px solid #000", padding: "2px 3px" }}>
              <div className="block-title">RECEBEMOS DE</div>
              <div className="small-text">
                {emitenteNome}
              </div>
              <div className="small-text">
                NF-e Nº {nfe.numero.toString().padStart(9, "0")} SÉRIE{" "}
                {nfe.serie.toString().padStart(3, "0")}
              </div>
              <div className="small-text">
                A descrição dos produtos e/ou serviços constantes na NF-e
                indicada ao lado.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr" }}>
              <div
                style={{
                  borderRight: "1px solid #000",
                  padding: "2px 3px",
                  fontSize: 8,
                }}
              >
                <div className="block-title">DATA DE RECEBIMENTO</div>
                <div style={{ minHeight: "14mm" }} />
              </div>
              <div style={{ padding: "2px 3px", fontSize: 8 }}>
                <div className="block-title">
                  IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR
                </div>
                <div style={{ minHeight: "14mm" }} />
              </div>
            </div>
          </div>

          {/* BLOCO IDENTIFICAÇÃO EMITENTE + DANFE + CHAVE */}
          <div
            className="border-box"
            style={{
              display: "grid",
              gridTemplateColumns: "2.8fr 2.2fr 2.5fr",
              marginBottom: "2mm",
            }}
          >
            {/* Emitente */}
            <div style={{ borderRight: "1px solid #000", padding: "2px 3px" }}>
              <div className="block-title">IDENTIFICAÇÃO DO EMITENTE</div>
              <div className="field-value">
                {emitenteNome}
              </div>
              <div className="small-text">{emitenteEndereco}</div>
              <div className="small-text">
                CNPJ: {fmtDoc(emitenteCnpj)}{" "}
                {emitenteIe && ` | IE: ${emitenteIe}`}
              </div>
              {emitenteTelefone && (
                <div className="small-text">Fone: {emitenteTelefone}</div>
              )}
            </div>

            {/* Meio - DANFE / tipo operação / nº, série, folha */}
            <div
              style={{
                borderRight: "1px solid #000",
                padding: "2px 3px",
                textAlign: "center",
              }}
            >
              <div className="danfe-main-title">DANFE</div>
              <div className="danfe-subtitle">
                DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA
              </div>
              <div className="small-text" style={{ marginTop: 4 }}>
                {tipoOperacao === "ENTRADA" ? "0-ENTRADA" : "1-SAÍDA"}
              </div>
              <div className="small-text" style={{ marginTop: 2 }}>
                Nº{" "}
                <strong>
                  {nfe.numero.toString().padStart(9, "0")}
                </strong>{" "}
                SÉRIE <strong>{nfe.serie.toString().padStart(3, "0")}</strong>
              </div>
              <div className="small-text">
                FOLHA <strong>1/1</strong>
              </div>
              {nfe.ordemservicoid && (
                <div className="small-text" style={{ marginTop: 2 }}>
                  Ref. OS nº {nfe.ordemservicoid}
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                <span className="field-label">Status: </span>
                <span className="status-pill">
                  {statusLabel || statusUpper || "DESCONHECIDO"}
                </span>
              </div>
              {xmlError && (
                <div className="small-text" style={{ marginTop: 4 }}>
                  ** Atenção: erro ao ler XML. DANFE baseado em dados do banco.
                </div>
              )}
            </div>

            {/* Chave + código de barras + info autorização */}
            <div style={{ padding: "2px 3px" }}>
              <div className="field-label center">CHAVE DE ACESSO</div>
              <div className="chave center">{chaveFormatada}</div>
              <div className="barcode-placeholder">
                CÓDIGO DE BARRAS (CODE-128C)
              </div>
              <div className="small-text" style={{ marginTop: 2 }}>
                {isAutorizada ? (
                  <>
                    Consulta de autenticidade no Portal Nacional da NF-e
                    (www.nfe.fazenda.gov.br/portal) ou no site da Sefaz
                    Autorizadora.
                  </>
                ) : (
                  <>
                    DANFE emitido em ambiente de homologação ou em contingência.
                    Consulte a NF-e no portal apropriado.
                  </>
                )}
              </div>
              {isAutorizada && nfe.protocolo && (
                <div className="small-text" style={{ marginTop: 2 }}>
                  PROTOCOLO DE AUTORIZAÇÃO DE USO: {nfe.protocolo}{" "}
                  {nfe.dataautorizacao && " – "}
                  {nfe.dataautorizacao && fmtDate(nfe.dataautorizacao)}
                </div>
              )}
            </div>
          </div>

          {/* DESTINATÁRIO / REMETENTE */}
          <div
            className="border-box"
            style={{ padding: "2px 3px", marginBottom: "2mm" }}
          >
            <div className="block-title">DESTINATÁRIO / REMETENTE</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "3fr 1.4fr 1.2fr",
                columnGap: "2mm",
                rowGap: "1mm",
                marginTop: 2,
              }}
            >
              <div>
                <div className="field-label">Nome / Razão Social</div>
                <div className="field-value">
                  {destinatarioNome}
                </div>
              </div>
              <div>
                <div className="field-label">CPF/CNPJ</div>
                <div className="field-value">
                  {fmtDoc(destinatarioDoc)}
                </div>
              </div>
              <div>
                <div className="field-label">Data de Emissão</div>
                <div className="field-value">{fmtDate(dataEmissaoDanfe)}</div>
              </div>
              <div>
                <div className="field-label">Endereço</div>
                <div className="field-value">{destinatarioEndereco}</div>
              </div>
              <div>
                <div className="field-label">Município / UF</div>
                <div className="field-value">
                  {destinatarioCidadeUf ?? "—"}
                </div>
              </div>
              <div>
                <div className="field-label">CEP</div>
                <div className="field-value">
                  {destinatarioCep}
                </div>
              </div>
            </div>
          </div>

          {/* CÁLCULO DO IMPOSTO */}
          <div
            className="border-box"
            style={{
              padding: "2px 3px",
              marginBottom: "2mm",
            }}
          >
            <div className="block-title">CÁLCULO DO IMPOSTO</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                columnGap: "2mm",
                marginTop: 2,
              }}
            >
              <div>
                <div className="field-label">Base de Cálculo do ICMS</div>
                <div className="field-value">{fmtMoney(totalBcIcms)}</div>
              </div>
              <div>
                <div className="field-label">Valor do ICMS</div>
                <div className="field-value">{fmtMoney(totalIcms)}</div>
              </div>
              <div>
                <div className="field-label">Base de Cálculo do ICMS ST</div>
                <div className="field-value">{fmtMoney(0)}</div>
              </div>
              <div>
                <div className="field-label">Valor do ICMS ST</div>
                <div className="field-value">{fmtMoney(0)}</div>
              </div>
              <div>
                <div className="field-label">Valor Total dos Produtos</div>
                <div className="field-value">
                  {fmtMoney(totalProdutos)}
                </div>
              </div>
              <div>
                <div className="field-label">Valor Total da Nota</div>
                <div className="field-value">
                  {fmtMoney(totalNota)}
                </div>
              </div>
            </div>
          </div>

          {/* TRANSPORTADOR / VOLUMES */}
          <div
            className="border-box"
            style={{ padding: "2px 3px", marginBottom: "2mm" }}
          >
            <div className="block-title">
              TRANSPORTADOR / VOLUMES TRANSPORTADOS
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "3fr 1fr 1.5fr 1fr 1.5fr",
                columnGap: "2mm",
                rowGap: "1mm",
                marginTop: 2,
              }}
            >
              <div>
                <div className="field-label">Nome / Razão Social</div>
                <div className="field-value">—</div>
              </div>
              <div>
                <div className="field-label">Frete por conta</div>
                <div className="field-value">9 - Sem Ocorrência</div>
              </div>
              <div>
                <div className="field-label">CNPJ/CPF</div>
                <div className="field-value">—</div>
              </div>
              <div>
                <div className="field-label">Placa do Veículo</div>
                <div className="field-value">—</div>
              </div>
              <div>
                <div className="field-label">UF</div>
                <div className="field-value">—</div>
              </div>
            </div>
          </div>

          {/* DADOS DOS PRODUTOS / SERVIÇOS */}
          <div
            className="border-box"
            style={{ padding: "2px 1px", marginBottom: "2mm" }}
          >
            <div className="block-title">DADOS DOS PRODUTOS / SERVIÇOS</div>
            <div style={{ marginTop: 2 }}>
              {itensDisplay.length === 0 ? (
                <div className="small-text">
                  Nenhum item cadastrado para esta NF-e.
                </div>
              ) : (
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Cód. Produto</th>
                      <th>Descrição do Produto / Serviço</th>
                      <th>NCM</th>
                      <th>CST/CSOSN</th>
                      <th>CFOP</th>
                      <th>UN</th>
                      <th>Qtde</th>
                      <th>Valor Unitário</th>
                      <th>Valor Total</th>
                      <th>BC ICMS</th>
                      <th>Alíquota ICMS</th>
                      <th>Valor ICMS</th>
                      <th>CST PIS</th>
                      <th>Valor PIS</th>
                      <th>CST COFINS</th>
                      <th>Valor COFINS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensDisplay.map((item) => (
                      <tr key={item.id}>
                        <td className="center">{item.n_item}</td>
                        <td className="center">
                          {item.produtoid ?? "—"}
                        </td>
                        <td className="desc">{item.descricao}</td>
                        <td className="center">{item.ncm ?? "—"}</td>
                        <td className="center">
                          {item.csosn ?? "—"}
                        </td>
                        <td className="center">{item.cfop}</td>
                        <td className="center">{item.unidade}</td>
                        <td className="right">
                          {Number(item.quantidade ?? 0).toLocaleString(
                            "pt-BR",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 4,
                            }
                          )}
                        </td>
                        <td className="right">
                          {fmtMoney(item.valor_unitario)}
                        </td>
                        <td className="right">
                          {fmtMoney(item.valor_total)}
                        </td>
                        <td className="right">
                          {fmtMoney(item.valor_bc_icms)}
                        </td>
                        <td className="right">
                          {fmtPercent(item.aliquotaicms)}
                        </td>
                        <td className="right">
                          {fmtMoney(item.valor_icms)}
                        </td>
                        <td className="center">{item.cst_pis ?? "—"}</td>
                        <td className="right">
                          {fmtMoney(item.valor_pis)}
                        </td>
                        <td className="center">
                          {item.cst_cofins ?? "—"}
                        </td>
                        <td className="right">
                          {fmtMoney(item.valor_cofins)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* CÁLCULO ISSQN + DADOS ADICIONAIS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 2fr 1.2fr",
              columnGap: "2mm",
            }}
          >
            {/* ISSQN */}
            <div className="border-box" style={{ padding: "2px 3px" }}>
              <div className="block-title">CÁLCULO DO ISSQN</div>
              <div style={{ marginTop: 2 }}>
                <div className="small-text">
                  Inscrição Municipal: —{/* sem coluna na tabela nfe */}
                </div>
                <div className="small-text">
                  Valor Total dos Serviços: {fmtMoney(nfe.total_servicos)}
                </div>
                <div className="small-text">
                  Base de Cálculo do ISSQN: {fmtMoney(0)}
                </div>
                <div className="small-text">
                  Valor do ISSQN: {fmtMoney(0)}
                </div>
              </div>
            </div>

            {/* Informações complementares */}
            <div className="border-box" style={{ padding: "2px 3px" }}>
              <div className="block-title">INFORMAÇÕES COMPLEMENTARES</div>
              {parsed?.infCpl && (
                <div className="small-text" style={{ marginTop: 2, fontWeight: 600 }}>
                  {parsed.infCpl}
                </div>
              )}
              <div className="small-text" style={{ marginTop: 2 }}>
                Versão de visualização do DANFE gerada pelo sistema. Para fins
                fiscais, prevalece o XML da NF-e autorizado pela SEFAZ.
              </div>
              {!xmlBase && (
                <div className="small-text" style={{ marginTop: 2 }}>
                  ** Atenção: XML da NF-e não está armazenado nesta NF-e.
                  Visualização baseada apenas nos dados do banco.
                </div>
              )}
            </div>

            {/* Reservado ao Fisco */}
            <div className="border-box" style={{ padding: "2px 3px" }}>
              <div className="block-title">RESERVADO AO FISCO</div>
              <div className="small-text" style={{ marginTop: 2 }}>
                {/* Uso exclusivo do Fisco. */}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
