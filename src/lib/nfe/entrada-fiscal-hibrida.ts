import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";

export type LinhaComCustoFiscal<T = unknown> = {
  numeroItem: number | null;
  custoEstoque: number;
  valor?: T;
};

/**
 * Separa linhas inteiras entre o fluxo normal e a consolidacao personalizada.
 * A conta e feita em centavos para provar que nenhum custo sumiu na separacao.
 */
export function classificarLinhasEntradaHibrida<T>(
  linhas: Array<LinhaComCustoFiscal<T>>,
  numerosNormais: number[],
) {
  const numeros = linhas.map((linha) => linha.numeroItem);
  if (
    numeros.some((numero) => !Number.isInteger(numero) || Number(numero) <= 0) ||
    new Set(numeros).size !== numeros.length
  ) {
    throw new Error("As linhas fiscais possuem numeros invalidos ou duplicados.");
  }

  if (
    numerosNormais.some((numero) => !Number.isInteger(numero) || numero <= 0) ||
    new Set(numerosNormais).size !== numerosNormais.length
  ) {
    throw new Error("Os itens normais possuem numeros invalidos ou duplicados.");
  }

  const existentes = new Set(numeros as number[]);
  const inexistente = numerosNormais.find((numero) => !existentes.has(numero));
  if (inexistente !== undefined) {
    throw new Error(`O item fiscal ${inexistente} nao existe na NF-e.`);
  }

  const normaisSet = new Set(numerosNormais);
  const normais = linhas.filter((linha) => normaisSet.has(Number(linha.numeroItem)));
  const personalizadas = linhas.filter((linha) => !normaisSet.has(Number(linha.numeroItem)));
  const somar = (itens: Array<LinhaComCustoFiscal<T>>) =>
    paraReais(
      itens.reduce((total, linha) => total + paraCentavos(linha.custoEstoque), 0),
    );

  const custoNormal = somar(normais);
  const custoPersonalizado = somar(personalizadas);
  const custoTotal = somar(linhas);
  if (
    paraCentavos(custoNormal) + paraCentavos(custoPersonalizado) !==
    paraCentavos(custoTotal)
  ) {
    throw new Error("Nao foi possivel reconciliar o custo da entrada hibrida.");
  }

  return {
    normais,
    personalizadas,
    custoNormal,
    custoPersonalizado,
    custoTotal,
  };
}
