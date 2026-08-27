import { DOMParser } from "@xmldom/xmldom";

export type DanfeAddress = {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone: string;
};

export type DanfeParty = {
  nome: string;
  fantasia: string;
  documento: string;
  ie: string;
  iest: string;
  im: string;
  endereco: DanfeAddress;
};

export type DanfeTaxTotals = {
  vBC: number;
  vICMS: number;
  vICMSDeson: number;
  vFCP: number;
  vBCST: number;
  vST: number;
  vFCPST: number;
  vFCPSTRet: number;
  vProd: number;
  vFrete: number;
  vSeg: number;
  vDesc: number;
  vII: number;
  vIPI: number;
  vIPIDevol: number;
  vPIS: number;
  vCOFINS: number;
  vOutro: number;
  vNF: number;
  vTotTrib: number;
  vBCIBSCBS: number;
  vIBSUF: number;
  vIBSMun: number;
  vIBS: number;
  vCBS: number;
  vIS: number;
  vServ: number;
  vBCISS: number;
  vISS: number;
};

export type DanfeItem = {
  id: string;
  n_item: number;
  produtoid: string | null;
  ean: string;
  descricao: string;
  ncm: string | null;
  cest: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  valor_desconto: number;
  origem: string;
  csosn: string | null;
  valor_bc_icms: number;
  aliquotaicms: number;
  valor_icms: number;
  cst_ipi: string | null;
  valor_bc_ipi: number;
  aliquota_ipi: number;
  valor_ipi: number;
  cst_pis: string | null;
  aliquota_pis: number;
  valor_pis: number;
  cst_cofins: string | null;
  aliquota_cofins: number;
  valor_cofins: number;
  cst_ibs_cbs: string | null;
  classificacao_tributaria: string | null;
  base_ibs_cbs: number;
  aliquota_ibs_uf: number;
  valor_ibs_uf: number;
  aliquota_ibs_municipio: number;
  valor_ibs_municipio: number;
  valor_ibs: number;
  aliquota_cbs: number;
  valor_cbs: number;
  cst_is: string | null;
  valor_is: number;
};

export type DanfeTransport = {
  modFrete: string;
  nome: string;
  documento: string;
  ie: string;
  endereco: string;
  municipio: string;
  uf: string;
  placa: string;
  ufVeiculo: string;
  rntc: string;
  volumes: Array<{
    quantidade: number;
    especie: string;
    marca: string;
    numeracao: string;
    pesoLiquido: number;
    pesoBruto: number;
  }>;
};

/** Local de entrega/retirada (grupo `<entrega>`), quando diferente do destinatário. */
export type DanfeEntrega = {
  nome: string;
  documento: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
};

export type ParsedDanfeNFe = {
  chave: string;
  ide: {
    natOp: string;
    dhEmi: string;
    dhSaiEnt: string;
    tpNF: string;
    tpAmb: string;
    tpEmis: string;
    idDest: string;
    numero: number;
    serie: number;
  };
  protocolo: {
    chave: string;
    numero: string;
    data: string;
    cStat: string;
    motivo: string;
  };
  emitente: DanfeParty;
  destinatario: DanfeParty;
  totais: DanfeTaxTotals;
  itens: DanfeItem[];
  transporte: DanfeTransport;
  entrega: DanfeEntrega | null;
  fatura: { numero: string; valorOriginal: number; desconto: number; valorLiquido: number } | null;
  duplicatas: Array<{ numero: string; vencimento: string; valor: number }>;
  pagamentos: Array<{
    tipo: string;
    valor: number;
    descricao: string;
    integracao: string;
    cnpjCredenciadora: string;
    bandeira: string;
    autorizacao: string;
  }>;
  infCpl: string;
  infAdFisco: string;
};

function tagName(node: Element) {
  return String(node.localName || node.nodeName).replace(/^.*:/, "");
}

function children(node?: Element | null) {
  if (!node) return [] as Element[];
  const result: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child?.nodeType === 1) result.push(child as Element);
  }
  return result;
}

function child(node: Element | null | undefined, name: string) {
  return children(node).find((candidate) => tagName(candidate) === name) ?? null;
}

function descendants(node: Element | Document, name: string) {
  const all = node.getElementsByTagName("*");
  const result: Element[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const candidate = all.item(index) as Element;
    if (tagName(candidate) === name) result.push(candidate);
  }
  return result;
}

function first(node: Element | Document | null | undefined, name: string) {
  return node ? descendants(node, name)[0] ?? null : null;
}

function value(node: Element | null | undefined, name: string) {
  return String(child(node, name)?.textContent ?? "").trim();
}

function numberValue(node: Element | null | undefined, name: string) {
  const raw = value(node, name).replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAddress(node: Element | null): DanfeAddress {
  return {
    logradouro: value(node, "xLgr"),
    numero: value(node, "nro"),
    complemento: value(node, "xCpl"),
    bairro: value(node, "xBairro"),
    municipio: value(node, "xMun"),
    uf: value(node, "UF"),
    cep: value(node, "CEP"),
    telefone: value(node, "fone"),
  };
}

function parseParty(node: Element | null, addressTag: string): DanfeParty {
  return {
    nome: value(node, "xNome"),
    fantasia: value(node, "xFant"),
    documento: value(node, "CNPJ") || value(node, "CPF") || value(node, "idEstrangeiro"),
    ie: value(node, "IE"),
    iest: value(node, "IEST"),
    im: value(node, "IM"),
    endereco: parseAddress(child(node, addressTag)),
  };
}

function firstTaxChild(imposto: Element | null, group: string) {
  return children(child(imposto, group))[0] ?? null;
}

export function parseDanfeNFeXml(xml: string): ParsedDanfeNFe {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const parserError = first(doc, "parsererror");
  if (parserError) throw new Error(`XML inválido: ${String(parserError.textContent ?? "erro de leitura").trim()}`);

  const infNFe = first(doc, "infNFe");
  if (!infNFe) throw new Error("Tag <infNFe> não encontrada no XML da NF-e.");

  const ide = child(infNFe, "ide");
  const prot = first(doc, "infProt");
  const emit = child(infNFe, "emit");
  const dest = child(infNFe, "dest");
  const total = child(infNFe, "total");
  const icmsTot = child(total, "ICMSTot");
  const issqnTot = child(total, "ISSQNtot");
  const ibsCbsTot = child(total, "IBSCBSTot");
  const gIbsTot = child(ibsCbsTot, "gIBS");
  const gIbsUfTot = child(gIbsTot, "gIBSUF");
  const gIbsMunTot = child(gIbsTot, "gIBSMun");
  const gCbsTot = child(ibsCbsTot, "gCBS");
  const isTot = child(total, "ISTot");
  const chaveId = String(infNFe.getAttribute("Id") ?? "").replace(/^NFe/, "");

  const itens = descendants(infNFe, "det").map((det, index): DanfeItem => {
    const prod = child(det, "prod");
    const imposto = child(det, "imposto");
    const icms = firstTaxChild(imposto, "ICMS");
    const ipiGroup = child(imposto, "IPI");
    const ipi = children(ipiGroup).find((node) => tagName(node) === "IPITrib" || tagName(node) === "IPINT") ?? null;
    const pis = firstTaxChild(imposto, "PIS");
    const cofins = firstTaxChild(imposto, "COFINS");
    const ibsCbs = child(imposto, "IBSCBS");
    const gIbsCbs = child(ibsCbs, "gIBSCBS");
    const gIbsUf = child(gIbsCbs, "gIBSUF");
    const gIbsMun = child(gIbsCbs, "gIBSMun");
    const gCbs = child(gIbsCbs, "gCBS");
    const isGroup = child(imposto, "IS");
    const nItem = Number(det.getAttribute("nItem")) || index + 1;

    return {
      id: `xml-${nItem}`,
      n_item: nItem,
      produtoid: value(prod, "cProd") || null,
      ean: value(prod, "cEAN"),
      descricao: value(prod, "xProd"),
      ncm: value(prod, "NCM") || null,
      cest: value(prod, "CEST"),
      cfop: value(prod, "CFOP"),
      unidade: value(prod, "uCom"),
      quantidade: numberValue(prod, "qCom"),
      valor_unitario: numberValue(prod, "vUnCom"),
      valor_total: numberValue(prod, "vProd"),
      valor_desconto: numberValue(prod, "vDesc"),
      origem: value(icms, "orig"),
      csosn: value(icms, "CSOSN") || value(icms, "CST") || null,
      valor_bc_icms: numberValue(icms, "vBC"),
      aliquotaicms: numberValue(icms, "pICMS"),
      valor_icms: numberValue(icms, "vICMS"),
      cst_ipi: value(ipi, "CST") || null,
      valor_bc_ipi: numberValue(ipi, "vBC"),
      aliquota_ipi: numberValue(ipi, "pIPI"),
      valor_ipi: numberValue(ipi, "vIPI"),
      cst_pis: value(pis, "CST") || null,
      aliquota_pis: numberValue(pis, "pPIS"),
      valor_pis: numberValue(pis, "vPIS"),
      cst_cofins: value(cofins, "CST") || null,
      aliquota_cofins: numberValue(cofins, "pCOFINS"),
      valor_cofins: numberValue(cofins, "vCOFINS"),
      cst_ibs_cbs: value(ibsCbs, "CST") || null,
      classificacao_tributaria: value(ibsCbs, "cClassTrib") || null,
      base_ibs_cbs: numberValue(gIbsCbs, "vBC"),
      aliquota_ibs_uf: numberValue(gIbsUf, "pIBSUF"),
      valor_ibs_uf: numberValue(gIbsUf, "vIBSUF"),
      aliquota_ibs_municipio: numberValue(gIbsMun, "pIBSMun"),
      valor_ibs_municipio: numberValue(gIbsMun, "vIBSMun"),
      valor_ibs: numberValue(gIbsCbs, "vIBS"),
      aliquota_cbs: numberValue(gCbs, "pCBS"),
      valor_cbs: numberValue(gCbs, "vCBS"),
      cst_is: value(isGroup, "CSTIS") || null,
      valor_is: numberValue(isGroup, "vIS"),
    };
  });

  const transp = child(infNFe, "transp");
  const transporta = child(transp, "transporta");
  const veiculo = child(transp, "veicTransp");
  const entregaNode = child(infNFe, "entrega");
  const cobr = child(infNFe, "cobr");
  const fat = child(cobr, "fat");
  const pag = child(infNFe, "pag");
  const infAdic = child(infNFe, "infAdic");

  return {
    chave: value(prot, "chNFe") || chaveId,
    ide: {
      natOp: value(ide, "natOp"),
      dhEmi: value(ide, "dhEmi") || value(ide, "dEmi"),
      dhSaiEnt: value(ide, "dhSaiEnt") || value(ide, "dSaiEnt"),
      tpNF: value(ide, "tpNF"),
      tpAmb: value(ide, "tpAmb"),
      tpEmis: value(ide, "tpEmis"),
      idDest: value(ide, "idDest"),
      numero: Number(value(ide, "nNF")) || 0,
      serie: Number(value(ide, "serie")) || 0,
    },
    protocolo: {
      chave: value(prot, "chNFe"),
      numero: value(prot, "nProt"),
      data: value(prot, "dhRecbto"),
      cStat: value(prot, "cStat"),
      motivo: value(prot, "xMotivo"),
    },
    emitente: parseParty(emit, "enderEmit"),
    destinatario: parseParty(dest, "enderDest"),
    totais: {
      vBC: numberValue(icmsTot, "vBC"),
      vICMS: numberValue(icmsTot, "vICMS"),
      vICMSDeson: numberValue(icmsTot, "vICMSDeson"),
      vFCP: numberValue(icmsTot, "vFCP"),
      vBCST: numberValue(icmsTot, "vBCST"),
      vST: numberValue(icmsTot, "vST"),
      vFCPST: numberValue(icmsTot, "vFCPST"),
      vFCPSTRet: numberValue(icmsTot, "vFCPSTRet"),
      vProd: numberValue(icmsTot, "vProd"),
      vFrete: numberValue(icmsTot, "vFrete"),
      vSeg: numberValue(icmsTot, "vSeg"),
      vDesc: numberValue(icmsTot, "vDesc"),
      vII: numberValue(icmsTot, "vII"),
      vIPI: numberValue(icmsTot, "vIPI"),
      vIPIDevol: numberValue(icmsTot, "vIPIDevol"),
      vPIS: numberValue(icmsTot, "vPIS"),
      vCOFINS: numberValue(icmsTot, "vCOFINS"),
      vOutro: numberValue(icmsTot, "vOutro"),
      vNF: numberValue(icmsTot, "vNF"),
      vTotTrib: numberValue(icmsTot, "vTotTrib"),
      vBCIBSCBS: numberValue(ibsCbsTot, "vBCIBSCBS"),
      vIBSUF: numberValue(gIbsUfTot, "vIBSUF"),
      vIBSMun: numberValue(gIbsMunTot, "vIBSMun"),
      vIBS: numberValue(gIbsTot, "vIBS"),
      vCBS: numberValue(gCbsTot, "vCBS"),
      vIS: numberValue(isTot, "vIS"),
      vServ: numberValue(issqnTot, "vServ"),
      vBCISS: numberValue(issqnTot, "vBC"),
      vISS: numberValue(issqnTot, "vISS"),
    },
    itens,
    transporte: {
      modFrete: value(transp, "modFrete") || "9",
      nome: value(transporta, "xNome"),
      documento: value(transporta, "CNPJ") || value(transporta, "CPF"),
      ie: value(transporta, "IE"),
      endereco: value(transporta, "xEnder"),
      municipio: value(transporta, "xMun"),
      uf: value(transporta, "UF"),
      placa: value(veiculo, "placa"),
      ufVeiculo: value(veiculo, "UF"),
      rntc: value(veiculo, "RNTC"),
      volumes: children(transp).filter((node) => tagName(node) === "vol").map((vol) => ({
        quantidade: numberValue(vol, "qVol"),
        especie: value(vol, "esp"),
        marca: value(vol, "marca"),
        numeracao: value(vol, "nVol"),
        pesoLiquido: numberValue(vol, "pesoL"),
        pesoBruto: numberValue(vol, "pesoB"),
      })),
    },
    entrega: entregaNode ? {
      nome: value(entregaNode, "xNome"),
      documento: value(entregaNode, "CNPJ") || value(entregaNode, "CPF"),
      logradouro: value(entregaNode, "xLgr"),
      numero: value(entregaNode, "nro"),
      complemento: value(entregaNode, "xCpl"),
      bairro: value(entregaNode, "xBairro"),
      municipio: value(entregaNode, "xMun"),
      uf: value(entregaNode, "UF"),
      cep: value(entregaNode, "CEP"),
    } : null,
    fatura: fat ? {
      numero: value(fat, "nFat"),
      valorOriginal: numberValue(fat, "vOrig"),
      desconto: numberValue(fat, "vDesc"),
      valorLiquido: numberValue(fat, "vLiq"),
    } : null,
    duplicatas: children(cobr).filter((node) => tagName(node) === "dup").map((dup) => ({
      numero: value(dup, "nDup"),
      vencimento: value(dup, "dVenc"),
      valor: numberValue(dup, "vDup"),
    })),
    pagamentos: children(pag).filter((node) => tagName(node) === "detPag").map((detPag) => {
      const card = child(detPag, "card");
      return {
        tipo: value(detPag, "tPag"),
        valor: numberValue(detPag, "vPag"),
        descricao: value(detPag, "xPag"),
        integracao: value(card, "tpIntegra"),
        cnpjCredenciadora: value(card, "CNPJ"),
        bandeira: value(card, "tBand"),
        autorizacao: value(card, "cAut"),
      };
    }),
    infCpl: value(infAdic, "infCpl"),
    infAdFisco: value(infAdic, "infAdFisco"),
  };
}
