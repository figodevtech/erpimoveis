/**
 * O que as duas rotas de exclusão em massa compartilham.
 *
 * O teto é menor que o da baixa em lote (200) de propósito: dar baixa se desfaz
 * pelo estorno, isto não se desfaz por nada. Cem linhas ainda é um lote, e é o
 * tanto que dá para conferir numa prévia rolável antes de confirmar.
 */
export const LIMITE_DE_EXCLUSAO = 100;

export function lerIdsDoCorpo(bruto: unknown): number[] {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    throw new Error("Informe ao menos uma transação.");
  }

  if (bruto.length > LIMITE_DE_EXCLUSAO) {
    throw new Error(`Exclua no máximo ${LIMITE_DE_EXCLUSAO} transações por vez.`);
  }

  const limpos = [
    ...new Set(
      bruto
        .map((valor) => Number(valor))
        .filter((valor) => Number.isSafeInteger(valor) && valor > 0),
    ),
  ];

  if (limpos.length === 0) {
    throw new Error("Nenhum identificador válido na lista.");
  }

  return limpos;
}
