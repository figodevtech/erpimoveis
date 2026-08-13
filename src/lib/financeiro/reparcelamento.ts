/**
 * Regras do reparcelamento de um lançamento avulso, isoladas da tela.
 *
 * Reparcelar redivide o que ainda está PENDENTE: a soma não muda, porque parcela
 * baixada é dinheiro que já andou e o total do parcelamento não é assunto desta
 * operação. Quem valida de verdade é `reparcelar_transacao_avulsa` no banco —
 * daqui sai só o que destrava o botão e o que a tela precisa dizer ao usuário.
 */

import { distribuirIgualmenteEmCentavos, paraCentavos, paraReais } from "./rateio";

/** Teto de sanidade, o mesmo que a RPC aplica. */
export const MAXIMO_DE_PARCELAS = 60;

export interface ParcelaPlanejada {
  /** Chave estável da lista na tela. Não viaja para o servidor. */
  id: number;
  valor: number;
  vencimento?: Date;
}

export interface ResultadoDoReparcelamento {
  somaEmCentavos: number;
  /** Alvo menos soma: positivo falta, negativo sobra, zero fecha. */
  diferencaEmCentavos: number;
  fecha: boolean;
  /** Posições (1-based) com valor menor ou igual a zero. */
  semValor: number[];
  /** Posições (1-based) sem data escolhida. */
  semVencimento: number[];
  podeSalvar: boolean;
}

/**
 * Avança meses preservando o dia, sem transbordar para o mês seguinte.
 *
 * `setMonth` puro leva 31/01 + 1 mês para 03/03, e o parcelamento passava a ter
 * duas parcelas em março e nenhuma em fevereiro. Fevereiro recebe 28 (ou 29).
 */
export function avancarMeses(data: Date, meses: number): Date {
  const alvo = new Date(data.getFullYear(), data.getMonth() + meses, 1);
  const ultimoDiaDoMes = new Date(
    alvo.getFullYear(),
    alvo.getMonth() + 1,
    0,
  ).getDate();

  return new Date(
    alvo.getFullYear(),
    alvo.getMonth(),
    Math.min(data.getDate(), ultimoDiaDoMes),
    data.getHours(),
    data.getMinutes(),
    data.getSeconds(),
    data.getMilliseconds(),
  );
}

/**
 * Monta `quantidade` parcelas iguais a partir de `primeiroVencimento`, mensais.
 * Os centavos que sobram da divisão vão para as primeiras, então a soma fecha
 * exatamente no total.
 */
export function gerarParcelas(
  totalEmCentavos: number,
  quantidade: number,
  primeiroVencimento: Date,
): ParcelaPlanejada[] {
  const valores = distribuirIgualmenteEmCentavos(totalEmCentavos, quantidade);

  return valores.map((centavos, indice) => ({
    id: indice + 1,
    valor: paraReais(centavos),
    vencimento: avancarMeses(primeiroVencimento, indice),
  }));
}

/**
 * Redistribui o total entre as parcelas que já estão na tela, mantendo as datas.
 * Serve o botão "Distribuir igualmente", que só mexe em valor.
 */
export function redistribuirIgualmente(
  parcelas: ParcelaPlanejada[],
  totalEmCentavos: number,
): ParcelaPlanejada[] {
  const valores = distribuirIgualmenteEmCentavos(totalEmCentavos, parcelas.length);

  return parcelas.map((parcela, indice) => ({
    ...parcela,
    valor: paraReais(valores[indice] ?? 0),
  }));
}

/**
 * O vencimento pode ser passado de propósito.
 *
 * Reparcelar é o que se faz com título que não foi pago, e nesse ponto ele já
 * está vencido: exigir data futura impedia até manter a data da parcela que
 * venceu. Título vencido em aberto é estado legítimo — quem trata disso é o
 * acompanhamento financeiro, não uma trava no formulário.
 */
export function validarReparcelamento(
  parcelas: ParcelaPlanejada[],
  alvoEmCentavos: number,
): ResultadoDoReparcelamento {
  const somaEmCentavos = parcelas.reduce(
    (total, parcela) => total + paraCentavos(parcela.valor),
    0,
  );

  const semValor: number[] = [];
  const semVencimento: number[] = [];

  parcelas.forEach((parcela, indice) => {
    if (paraCentavos(parcela.valor) <= 0) semValor.push(indice + 1);
    if (!parcela.vencimento) semVencimento.push(indice + 1);
  });

  const diferencaEmCentavos = alvoEmCentavos - somaEmCentavos;
  const fecha = diferencaEmCentavos === 0;

  return {
    somaEmCentavos,
    diferencaEmCentavos,
    fecha,
    semValor,
    semVencimento,
    podeSalvar:
      fecha &&
      semValor.length === 0 &&
      semVencimento.length === 0 &&
      parcelas.length > 0 &&
      parcelas.length <= MAXIMO_DE_PARCELAS,
  };
}
