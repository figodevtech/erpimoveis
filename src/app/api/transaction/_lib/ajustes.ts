/**
 * A FORMA de um acréscimo ou desconto vindo do cliente.
 *
 * Duas portas lançam a mesma coisa — a aba Ajustes e, agora, a própria baixa — e
 * as recusas de formato têm que ser as mesmas, com as mesmas palavras. Escrever
 * isso duas vezes é como fraseados começam a divergir.
 *
 * Aqui NÃO se calcula dinheiro. O percentual vira reais dentro de
 * `baixar_transacao_pendente`, que é quem detém o `FOR UPDATE` do título:
 * converter no Node abriria uma janela em que a base lida aqui não é a base
 * travada lá. E a `natureza` também não viaja no payload — ela é lida de
 * `tipos_ajuste_transacao` no banco, porque deixar o cliente informá-la criaria
 * uma segunda verdade sobre o mesmo fato, que é exatamente o que
 * `tg_transacao_ajuste_coerente` existe para recusar.
 */

export type ModoDeAjuste = "FIXO" | "PORCENTAGEM";

export interface AjusteInformado {
  tipoId: number;
  modo: ModoDeAjuste;
  valorInformado: number;
  observacao: string | null;
}

export type NormalizacaoDeAjustes =
  | { ok: true; ajustes: AjusteInformado[] }
  | { ok: false; erro: string };

/**
 * Teto de linhas por baixa.
 *
 * O catálogo de fábrica tem sete tipos, e ninguém lança o mesmo juros duas
 * vezes. Oito é folga suficiente e impede que um payload torto vire dezenas de
 * linhas gravadas.
 */
const LIMITE_DE_LINHAS = 8;

export function normalizarAjustes(
  bruto: unknown,
  limite = LIMITE_DE_LINHAS,
): NormalizacaoDeAjustes {
  // Ausente e lista vazia são a mesma coisa: baixa sem ajuste, o caso de quase
  // sempre. Não é erro.
  if (bruto == null) return { ok: true, ajustes: [] };

  if (!Array.isArray(bruto)) {
    return { ok: false, erro: "Os ajustes devem vir em uma lista." };
  }
  if (bruto.length === 0) return { ok: true, ajustes: [] };
  if (bruto.length > limite) {
    return { ok: false, erro: `Lance no máximo ${limite} ajustes por baixa.` };
  }

  const ajustes: AjusteInformado[] = [];

  for (const [indice, item] of bruto.entries()) {
    const linha = (item ?? {}) as Record<string, unknown>;
    const tipoId = Number(linha.tipoId);
    const modo = String(linha.modo ?? "").toUpperCase();
    const valorInformado = Number(linha.valorInformado);

    // A posição no erro importa: numa lista de três, "o valor deve ser maior que
    // zero" sem dizer qual não ajuda ninguém.
    const recusar = (erro: string): NormalizacaoDeAjustes => ({
      ok: false,
      erro: bruto.length === 1 ? erro : `Ajuste ${indice + 1}: ${erro}`,
    });

    if (!Number.isSafeInteger(tipoId) || tipoId <= 0) {
      return recusar("informe o tipo do ajuste.");
    }
    if (modo !== "FIXO" && modo !== "PORCENTAGEM") {
      return recusar("o modo deve ser FIXO ou PORCENTAGEM.");
    }
    if (!Number.isFinite(valorInformado) || valorInformado <= 0) {
      return recusar("o valor do ajuste deve ser maior que zero.");
    }
    if (modo === "PORCENTAGEM" && valorInformado > 100) {
      return recusar("o percentual não pode passar de 100%.");
    }

    const observacao = linha.observacao ? String(linha.observacao).trim().slice(0, 500) : "";

    ajustes.push({
      tipoId,
      modo,
      valorInformado,
      observacao: observacao || null,
    });
  }

  return { ok: true, ajustes };
}
