import { XMLParser } from 'fast-xml-parser';
import { avaliarRegraE16a30, type ItemE16a30 } from './regraE16a30';

type XmlNode = Record<string, unknown>;
const asNode = (value: unknown): XmlNode => value && typeof value === 'object' ? value as XmlNode : {};

/** Lê os campos que realmente serão transmitidos, inclusive em XML salvo/editado. */
export function avaliarRegraE16a30Xml(xml: string) {
  const parsed = asNode(new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(xml));
  const envelope = asNode(parsed.nfeProc ?? parsed.enviNFe ?? parsed);
  const infNFe = asNode(asNode(envelope.NFe).infNFe);
  const ide = asNode(infNFe.ide);
  const dest = asNode(infNFe.dest);
  const det = Array.isArray(infNFe.det) ? infNFe.det : infNFe.det ? [infNFe.det] : [];
  const itens: ItemE16a30[] = det.map((detalhe) => {
    const icms = asNode(asNode(asNode(detalhe).imposto).ICMS);
    const grupo = asNode(Object.values(icms).find((value) => value && typeof value === 'object'));
    return {
      cst: grupo.CST == null ? null : String(grupo.CST),
      csosn: grupo.CSOSN == null ? null : String(grupo.CSOSN),
      vICMSST: grupo.vICMSST == null ? null : String(grupo.vICMSST),
      vICMSSTRet: grupo.vICMSSTRet == null ? null : String(grupo.vICMSSTRet),
    };
  });
  return avaliarRegraE16a30({
    modelo: String(ide.mod ?? ''),
    idDest: String(ide.idDest ?? ''),
    ufDestino: String(asNode(dest.enderDest).UF ?? ''),
    indIEDest: String(dest.indIEDest ?? ''),
    ambiente: String(ide.tpAmb ?? ''),
    dataEmissao: String(ide.dhEmi ?? ''),
    itens,
  });
}
