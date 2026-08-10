// Conversão de uma NFC-e para emissão em contingência offline (tpEmis = 9).
//
// A troca não é cosmética: `tpEmis` compõe a chave de acesso (posição 35), logo
// mudá-lo obriga a recalcular a chave inteira, o dígito verificador e o Id do
// <infNFe>. É a mesma mecânica de `renumerarNFeXml`, que troca o número.
//
// A data de emissão é fixada NESTE momento e nunca mais muda: o cupom sai
// impresso com ela e vai para a mão do consumidor. Quando a nota for
// transmitida horas depois, é essa data que a SEFAZ recebe — e é ela que o
// QR Code de contingência carrega no parâmetro "dia da emissão".

import { decomporChaveAcesso, gerarChaveAcesso } from "../chaveAcesso";
import { extrairChaveDoXml } from "../renumerarNFeXml";
import { formatarDataEmissao } from "./dataEmissao";

/** tpEmis 9 = contingência offline da NFC-e. */
export const TP_EMIS_CONTINGENCIA = 9;

export type ConversaoContingencia = {
  xml: string;
  chave: string;
  id: string;
  /** dhEmi congelado no momento da emissão offline. */
  dhEmi: string;
};

/**
 * Reescreve o XML do rascunho como documento de contingência.
 *
 * Não assina e não transmite — só produz o documento que será assinado,
 * impresso e guardado até a conexão voltar.
 */
export function converterParaContingencia(
  xml: string,
  agora = new Date(),
): ConversaoContingencia {
  const chaveAtual = extrairChaveDoXml(xml);
  if (!chaveAtual) {
    throw new Error("XML da NFC-e não tem chave de acesso no Id do <infNFe>.");
  }

  const partes = decomporChaveAcesso(chaveAtual);

  if (partes.mod !== "65") {
    throw new Error("Contingência offline com tpEmis 9 é exclusiva da NFC-e (modelo 65).");
  }

  if (Number(partes.tpEmis) === TP_EMIS_CONTINGENCIA) {
    throw new Error("Esta NFC-e já está em contingência.");
  }

  // A chave carrega AAMM: emitir em contingência num mês diferente do que gerou
  // o rascunho produziria um documento incoerente.
  const aaAtual = String(agora.getFullYear()).slice(-2);
  const mmAtual = String(agora.getMonth() + 1).padStart(2, "0");
  if (partes.aa !== aaAtual || partes.mm !== mmAtual) {
    throw new Error(
      "O rascunho foi gerado em outro mês. Gere a NFC-e novamente antes de emitir em contingência.",
    );
  }

  const { chave, id, dv } = gerarChaveAcesso({
    cUF: partes.cUF,
    ano: 2000 + Number(partes.aa),
    mes: Number(partes.mm),
    cnpj: partes.cnpj,
    mod: partes.mod,
    serie: Number(partes.serie),
    nNF: Number(partes.nNF),
    tpEmis: TP_EMIS_CONTINGENCIA,
    cNF: partes.cNF,
  });

  const dhEmi = formatarDataEmissao(agora);

  // tpEmis e cDV vivem dentro de <ide>; restringir a troca ao grupo evita
  // atingir datas e códigos de outros blocos.
  const ideMatch = xml.match(/<ide>[\s\S]*?<\/ide>/i);
  if (!ideMatch) throw new Error("XML da NFC-e não tem o grupo <ide>.");

  const ideNovo = ideMatch[0]
    .replace(/<tpEmis>\d*<\/tpEmis>/i, `<tpEmis>${TP_EMIS_CONTINGENCIA}</tpEmis>`)
    .replace(/<cDV>\d*<\/cDV>/i, `<cDV>${dv}</cDV>`)
    .replace(/<dhEmi>[^<]*<\/dhEmi>/i, `<dhEmi>${dhEmi}</dhEmi>`);

  const xmlNovo = xml
    .replace(ideMatch[0], ideNovo)
    .replace(/(<infNFe[^>]*\sId=['"])NFe\d{44}(['"])/i, `$1${id}$2`);

  return { xml: xmlNovo, chave, id, dhEmi };
}

/** Prazo legal para transmitir a NFC-e emitida em contingência, na Paraíba. */
export const PRAZO_TRANSMISSAO_CONTINGENCIA_HORAS = 24;

/**
 * Quanto tempo resta para transmitir, em horas.
 *
 * Negativo significa prazo estourado — a nota continua tendo que ser
 * transmitida, mas já está irregular e o operador precisa saber disso.
 */
export function horasRestantesParaTransmitir(dhEmi: string, agora = new Date()): number {
  const emissao = new Date(dhEmi);
  if (Number.isNaN(emissao.getTime())) {
    throw new Error(`dhEmi inválido ao calcular o prazo de contingência: "${dhEmi}".`);
  }
  const decorridas = (agora.getTime() - emissao.getTime()) / 3_600_000;
  return Number((PRAZO_TRANSMISSAO_CONTINGENCIA_HORAS - decorridas).toFixed(2));
}
