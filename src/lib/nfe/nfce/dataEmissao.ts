// Atualização da data de emissão da NFC-e na beira do envio.
//
// A NT 2025.001 (item 02.4) diz que, para a NFC-e, se espera um atraso máximo
// de ~5 minutos entre a data de emissão declarada e a autorização pelo Fisco.
//
// O rascunho, porém, nasce com `dhEmi` do momento em que foi criado: se o
// operador monta a nota, confere os itens e transmite dez minutos depois, a
// data já está velha quando chega na SEFAZ. Por isso a NFC-e tem o `dhEmi`
// renovado imediatamente antes da assinatura — a NF-e não precisa, porque o
// prazo dela é de dias.
//
// A troca é feita no XML pronto, no mesmo espírito de `renumerarNFeXml`: mexer
// só no campo necessário evita reconstruir o documento inteiro.

import { decomporChaveAcesso } from "../chaveAcesso";
import { extrairChaveDoXml } from "../renumerarNFeXml";

/** Formata no padrão da NF-e 4.00: AAAA-MM-DDThh:mm:ss-03:00 */
export function formatarDataEmissao(data: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  const offsetMinutos = data.getTimezoneOffset();
  const total = Math.abs(offsetMinutos);
  const sinal = offsetMinutos > 0 ? "-" : "+";

  return (
    `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}` +
    `T${pad(data.getHours())}:${pad(data.getMinutes())}:${pad(data.getSeconds())}` +
    `${sinal}${pad(Math.floor(total / 60))}:${pad(total % 60)}`
  );
}

/**
 * Põe `dhEmi` no instante atual.
 *
 * Se a virada de mês tiver acontecido entre o rascunho e o envio, a chave de
 * acesso — que carrega AAMM — deixa de casar com a data. Nesse caso a função
 * recusa em vez de emitir um documento incoerente: o rascunho precisa ser
 * regerado, o que também renova a chave.
 */
export function atualizarDataEmissao(xml: string, agora = new Date()): string {
  if (!/<dhEmi>[^<]*<\/dhEmi>/.test(xml)) {
    throw new Error("XML da NFC-e não tem <dhEmi> para atualizar.");
  }

  const chave = extrairChaveDoXml(xml);
  if (chave) {
    const { aa, mm } = decomporChaveAcesso(chave);
    const aaAtual = String(agora.getFullYear()).slice(-2);
    const mmAtual = String(agora.getMonth() + 1).padStart(2, "0");

    if (aa !== aaAtual || mm !== mmAtual) {
      throw new Error(
        "A chave de acesso foi gerada em outro mês. Gere o rascunho da NFC-e novamente " +
          "antes de transmitir.",
      );
    }
  }

  // Só o <dhEmi> do grupo <ide>: <dhSaiEnt> e datas de referência ficam intactas.
  return xml.replace(/<dhEmi>[^<]*<\/dhEmi>/, `<dhEmi>${formatarDataEmissao(agora)}</dhEmi>`);
}
