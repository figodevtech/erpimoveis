// src/app/(app)/(pages)/nfe/[id]/danfe/page.tsx
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DOMParser } from "@xmldom/xmldom";
import { traduzStatusNfe } from "@/lib/nfe/statusNfe";
import { DanfeView } from "@/components/danfe/danfe-view";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ origem?: string }>;
};

/* ========= HELPERS DE FORMATAÇÃO ========= */

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
    <DanfeView
      data={{
        nfe: {
          numero: nfe.numero,
          serie: nfe.serie,
          ordemservicoid: nfe.ordemservicoid,
          protocolo: nfe.protocolo,
          dataautorizacao: nfe.dataautorizacao,
          total_servicos: nfe.total_servicos,
        },
        emitenteNome,
        emitenteEndereco,
        emitenteCnpj,
        emitenteIe,
        emitenteTelefone,
        destinatarioNome,
        destinatarioDoc,
        destinatarioEndereco,
        destinatarioCidadeUf,
        destinatarioCep,
        dataEmissaoDanfe,
        tipoOperacao,
        statusUpper,
        statusLabel,
        chaveFormatada,
        isAutorizada,
        xmlError: xmlError?.message ?? null,
        xmlBaseAvailable: Boolean(xmlBase),
        itensDisplay,
        totalBcIcms,
        totalIcms,
        totalProdutos,
        totalNota,
        infCpl: parsed?.infCpl ?? null,
      }}
    />
  );
}
