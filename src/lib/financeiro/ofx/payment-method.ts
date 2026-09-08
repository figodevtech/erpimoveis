/**
 * Sugestão de forma de pagamento a partir do texto do extrato.
 *
 * É SUGESTÃO, nunca decisão: a função só devolve um método que exista na lista
 * que o chamador passou (o enum `metodo_pagamento` do banco), e devolve `null`
 * sempre que o texto não permitir afirmar nada. Quem grava é a conciliação, e
 * ela exige que o usuário confirme.
 *
 * A regra que não se deve quebrar: tarifa, IOF e juros são débitos, mas não são
 * cartão de débito. Traduzir "é débito no extrato" para "DEBITO" encheria o
 * financeiro de despesas com forma de pagamento errada, e forma de pagamento é
 * o que a DRE e os relatórios de recebimento usam para agrupar.
 */

import { normalizarTexto } from "./normalize";
import type { OfxMovimento } from "./types";

/**
 * Padrões do extrato para nome de método, do mais específico para o mais geral.
 *
 * A ordem importa: "PAGAMENTO DE BOLETO" tem que casar com BOLETO antes de
 * "PAGAMENTO" sozinho puxar qualquer outra coisa.
 */
const PADROES: Array<{ padrao: RegExp; metodo: string }> = [
  { padrao: /\bPIX\b/, metodo: "PIX" },
  { padrao: /\bBOLETO\b/, metodo: "BOLETO" },
  { padrao: /\bTED\b/, metodo: "TED" },
  { padrao: /\bDOC\b/, metodo: "DOC" },
  {
    padrao:
      /TARIFA|\bIOF\b|JUROS|ENCARGO|DEBITO AUTOMATICO|DEB AUT|CONCESSIONARIA|(PAGAMENTO|CONTA)( DE)? (AGUA|LUZ|ENERGIA|TELEFONE|INTERNET)/,
    metodo: "DEBITO AUTOMATICO",
  },
  { padrao: /TRANSFERENCIA|TRANSF /, metodo: "TRANSFERENCIA" },
  { padrao: /\bCHEQUE\b|\bCH\b COMPENSADO/, metodo: "CHEQUE" },
  { padrao: /SAQUE|DEPOSITO EM DINHEIRO|DINHEIRO/, metodo: "DINHEIRO" },
  { padrao: /CREDITO EM CONTA/, metodo: "CREDITO EM CONTA" },
];

/** O texto que o banco escreveu sobre o movimento, pronto para comparação. */
export function textoDoMovimento(movimento: Pick<OfxMovimento, "tipoOfx" | "nome" | "memo">): string {
  return normalizarTexto([movimento.memo, movimento.nome, movimento.tipoOfx].filter(Boolean).join(" "));
}

/**
 * Método sugerido, ou `null` quando não dá para afirmar.
 *
 * `metodosDisponiveis` são os valores reais do enum no banco desta empresa. Um
 * padrão que aponte para método inexistente é descartado em vez de cair num
 * método parecido — sugerir "TRANSFERENCIA" para uma tarifa porque "DEBITO
 * AUTOMATICO" não existe naquele banco seria pior do que não sugerir nada.
 */
export function sugerirMetodoPagamento(
  movimento: Pick<OfxMovimento, "tipoOfx" | "nome" | "memo">,
  metodosDisponiveis: readonly string[],
): string | null {
  const texto = textoDoMovimento(movimento);
  if (!texto) return null;

  const disponiveis = new Set(metodosDisponiveis.map((metodo) => normalizarTexto(metodo)));

  for (const { padrao, metodo } of PADROES) {
    if (!padrao.test(texto)) continue;
    const normalizado = normalizarTexto(metodo);
    if (!disponiveis.has(normalizado)) continue;
    // Devolve o rótulo como está no enum, não o normalizado: é ele que vai para
    // a coluna `metodopagamento`.
    return metodosDisponiveis.find((item) => normalizarTexto(item) === normalizado) ?? null;
  }

  return null;
}

/**
 * O método gravado numa transação é compatível com o que o extrato diz?
 *
 * Vale só como ingrediente de score. Incompatível não elimina candidato: o
 * título pode ter nascido como BOLETO e ter sido pago por PIX, o que é comum e
 * legítimo.
 */
export function metodoCompativel(
  movimento: Pick<OfxMovimento, "tipoOfx" | "nome" | "memo">,
  metodoDaTransacao: string | null | undefined,
): boolean {
  if (!metodoDaTransacao) return false;
  const sugerido = sugerirMetodoPagamento(movimento, [metodoDaTransacao]);
  return sugerido != null;
}
