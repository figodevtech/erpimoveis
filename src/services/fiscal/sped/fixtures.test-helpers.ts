/** Gerador de XML de NF-e para os testes do SPED. Não é usado em produção. */

export const OWN_CNPJ = "12260723000109";
export const SUPPLIER_CNPJ = "04252011000110";
export const CUSTOMER_CPF = "52998224725";

export type FixtureItem = {
  cfop: string;
  orig?: string;
  cst?: string;
  csosn?: string;
  vProd?: number;
  pICMS?: number;
  vICMS?: number;
  vBC?: number;
  vICMSSTRet?: number;
  vCredICMSSN?: number;
  uCom?: string;
  qCom?: number;
  ean?: string;
  ncm?: string;
  cProd?: string;
  difal?: { vICMSUFDest: number; vFCPUFDest?: number; vICMSUFRemet?: number };
};

export type FixtureOptions = {
  key?: string;
  model?: "55" | "65";
  tpNF?: "0" | "1";
  finNFe?: "1" | "4";
  emission?: string;
  emitter?: { cnpj: string; uf: string; name?: string };
  recipient?: { cnpj?: string; cpf?: string; uf: string; name?: string } | null;
  items?: FixtureItem[];
};

function money(value: number): string {
  return value.toFixed(2);
}

export function fixtureKey(seed: number | string): string {
  return String(seed).replace(/\D/g, "").padStart(44, "0").slice(-44);
}

function icmsGroup(item: FixtureItem, vBC: number, vICMS: number): string {
  const orig = item.orig ?? "0";
  if (item.csosn) {
    const credit = item.vCredICMSSN ? `<pCredSN>1.25</pCredSN><vCredICMSSN>${money(item.vCredICMSSN)}</vCredICMSSN>` : "";
    return `<ICMSSN${item.csosn}><orig>${orig}</orig><CSOSN>${item.csosn}</CSOSN>${credit}</ICMSSN${item.csosn}>`;
  }
  const cst = item.cst ?? "00";
  if (cst === "60") {
    const ret = item.vICMSSTRet ? `<vBCSTRet>${money(item.vICMSSTRet * 5)}</vBCSTRet><pST>20.00</pST><vICMSSTRet>${money(item.vICMSSTRet)}</vICMSSTRet>` : "";
    return `<ICMS60><orig>${orig}</orig><CST>60</CST>${ret}</ICMS60>`;
  }
  if (cst === "40" || cst === "41") return `<ICMS40><orig>${orig}</orig><CST>${cst}</CST></ICMS40>`;
  return `<ICMS00><orig>${orig}</orig><CST>00</CST><modBC>3</modBC><vBC>${money(vBC)}</vBC><pICMS>${money(item.pICMS ?? 18)}</pICMS><vICMS>${money(vICMS)}</vICMS></ICMS00>`;
}

export function nfeXml(options: FixtureOptions = {}): string {
  const key = options.key ?? fixtureKey(1);
  const model = options.model ?? "55";
  const tpNF = options.tpNF ?? "1";
  const emission = options.emission ?? "2026-08-10T10:00:00-03:00";
  const emitter = options.emitter ?? { cnpj: OWN_CNPJ, uf: "PB", name: "Emitente" };
  const recipient = options.recipient === undefined ? { cnpj: SUPPLIER_CNPJ, uf: "PB", name: "Destinatário" } : options.recipient;
  const items = options.items ?? [{ cfop: "5102" }];
  let totalProd = 0;
  let totalBc = 0;
  let totalIcms = 0;
  const dets = items.map((item, index) => {
    const vProd = item.vProd ?? 100;
    const taxed = !item.csosn && (item.cst ?? "00") === "00";
    const vBC = taxed ? item.vBC ?? vProd : 0;
    const vICMS = taxed ? item.vICMS ?? Math.round(vBC * (item.pICMS ?? 18)) / 100 : 0;
    totalProd += vProd;
    totalBc += vBC;
    totalIcms += vICMS;
    const qCom = item.qCom ?? 1;
    const difal = item.difal
      ? `<ICMSUFDest><vBCUFDest>${money(vProd)}</vBCUFDest><pFCPUFDest>0.00</pFCPUFDest><pICMSUFDest>18.00</pICMSUFDest><pICMSInter>12.00</pICMSInter><vFCPUFDest>${money(item.difal.vFCPUFDest ?? 0)}</vFCPUFDest><vICMSUFDest>${money(item.difal.vICMSUFDest)}</vICMSUFDest><vICMSUFRemet>${money(item.difal.vICMSUFRemet ?? 0)}</vICMSUFRemet></ICMSUFDest>`
      : "";
    return `<det nItem="${index + 1}"><prod><cProd>${item.cProd ?? `XML-${index + 1}`}</cProd><cEAN>${item.ean ?? "SEM GTIN"}</cEAN><xProd>Produto ${index + 1} do XML</xProd><NCM>${item.ncm ?? "87089990"}</NCM><CFOP>${item.cfop}</CFOP><uCom>${item.uCom ?? "UN"}</uCom><qCom>${qCom.toFixed(4)}</qCom><vUnCom>${(vProd / qCom).toFixed(4)}</vUnCom><vProd>${money(vProd)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>${item.uCom ?? "UN"}</uTrib><qTrib>${qCom.toFixed(4)}</qTrib><vUnTrib>${(vProd / qCom).toFixed(4)}</vUnTrib><indTot>1</indTot></prod><imposto><ICMS>${icmsGroup(item, vBC, vICMS)}</ICMS>${difal}<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>`;
  }).join("");
  const dest = recipient
    ? `<dest>${recipient.cnpj ? `<CNPJ>${recipient.cnpj}</CNPJ>` : `<CPF>${recipient.cpf}</CPF>`}<xNome>${recipient.name ?? "Destinatário"}</xNome><enderDest><xLgr>Rua B</xLgr><nro>2</nro><xBairro>Centro</xBairro><cMun>2507507</cMun><xMun>Cidade</xMun><UF>${recipient.uf}</UF><cPais>1058</cPais></enderDest><indIEDest>9</indIEDest></dest>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe${key}" versao="4.00">
<ide><cUF>25</cUF><natOp>OPERACAO</natOp><mod>${model}</mod><serie>1</serie><nNF>${Number(key.slice(25, 34)) || 1}</nNF><dhEmi>${emission}</dhEmi><dhSaiEnt>${emission}</dhSaiEnt><tpNF>${tpNF}</tpNF><idDest>${recipient && recipient.uf !== emitter.uf ? "2" : "1"}</idDest><tpAmb>1</tpAmb><finNFe>${options.finNFe ?? "1"}</finNFe><indPag>0</indPag></ide>
<emit><CNPJ>${emitter.cnpj}</CNPJ><xNome>${emitter.name ?? "Emitente"}</xNome><enderEmit><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>2507507</cMun><xMun>Cidade</xMun><UF>${emitter.uf}</UF><cPais>1058</cPais></enderEmit><IE>161726542</IE><CRT>3</CRT></emit>
${dest}
${dets}
<total><ICMSTot><vBC>${money(totalBc)}</vBC><vICMS>${money(totalIcms)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${money(totalProd)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${money(totalProd)}</vNF></ICMSTot></total>
<transp><modFrete>9</modFrete></transp>
</infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}
