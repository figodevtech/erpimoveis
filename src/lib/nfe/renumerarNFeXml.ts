// Troca o número da NF-e dentro de um XML já montado.
//
// O rascunho é gerado com um número provisório, porque a prévia do XML e o
// DANFE precisam de uma chave de acesso para existir. O número real só é
// alocado na transmissão (`nfe_alocar_numero`), e é aqui que ele entra no
// documento: nNF, cDV, o Id do <infNFe> e, por consequência, a chave.
//
// Só a numeração muda. cUF, AAMM, CNPJ, modelo, série, tpEmis e cNF são
// relidos da chave antiga, então o documento continua sendo o mesmo — o que
// evita reconstruir a NF-e inteira só para renumerar.

import { decomporChaveAcesso, gerarChaveAcesso } from "./chaveAcesso";

export function extrairChaveDoXml(xml: string): string | null {
  const match = xml.match(/<infNFe[^>]*\sId=['"]NFe(\d{44})['"]/i);
  return match ? match[1] : null;
}

export function renumerarNFeXml(
  xml: string,
  numero: number,
): { xml: string; chave: string; id: string } {
  const chaveAtual = extrairChaveDoXml(xml);
  if (!chaveAtual) {
    throw new Error("XML da NF-e não tem chave de acesso no Id do <infNFe>.");
  }

  const partes = decomporChaveAcesso(chaveAtual);
  const { chave, id, dv } = gerarChaveAcesso({
    cUF: partes.cUF,
    ano: 2000 + Number(partes.aa),
    mes: Number(partes.mm),
    cnpj: partes.cnpj,
    mod: partes.mod,
    serie: Number(partes.serie),
    nNF: numero,
    tpEmis: Number(partes.tpEmis),
    cNF: partes.cNF,
  });

  // nNF também aparece em <NFref>/<refNF> quando a nota referencia outra, por
  // isso a troca fica restrita ao bloco <ide>.
  const ideMatch = xml.match(/<ide>[\s\S]*?<\/ide>/i);
  if (!ideMatch) {
    throw new Error("XML da NF-e não tem o grupo <ide>.");
  }

  const ideNovo = ideMatch[0]
    .replace(/<nNF>\d*<\/nNF>/i, `<nNF>${numero}</nNF>`)
    .replace(/<cDV>\d*<\/cDV>/i, `<cDV>${dv}</cDV>`);

  const xmlNovo = xml
    .replace(ideMatch[0], ideNovo)
    .replace(/(<infNFe[^>]*\sId=['"])NFe\d{44}(['"])/i, `$1${id}$2`);

  return { xml: xmlNovo, chave, id };
}
