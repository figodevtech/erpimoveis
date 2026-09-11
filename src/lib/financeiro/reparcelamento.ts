/**
 * Regras do reparcelamento, isoladas da tela.
 *
 * Reparcelar redivide o que ainda está PENDENTE — parcela baixada é dinheiro que
 * já andou e nunca entra. Se o TOTAL do que está pendente pode mudar junto
 * depende de quem é dono da divisão, e essa pergunta é de
 * `modoDeReparcelamento`: com documento o total é dado dele e fica travado; num
 * lançamento avulso o grupo é o próprio total, e travá-lo só impedia diminuir
 * uma parcela ou renegociar a dívida.
 *
 * Quem valida de verdade é `reparcelar_transacao` no banco — daqui sai só o que
 * destrava o botão e o que a tela precisa dizer ao usuário.
 */

import {
  distribuirIgualmenteEmCentavos,
  distribuirPorPesos,
  paraCentavos,
  paraReais,
} from "./rateio";

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

export interface OpcoesDeValidacao {
  /**
   * O total precisa continuar o mesmo?
   *
   * Padrão `true` — a trava é o comportamento de sempre, e o padrão fica no lado
   * restritivo de propósito: um chamador novo que esqueça de passar a opção
   * recusa demais, nunca destrava o total de um documento por descuido.
   */
  totalTravado?: boolean;
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

/** A soma das parcelas que estão na tela, em centavos. */
export function totalDasParcelas(parcelas: ParcelaPlanejada[]): number {
  return parcelas.reduce((total, parcela) => total + paraCentavos(parcela.valor), 0);
}

/**
 * Muda o total mantendo a PROPORÇÃO entre as parcelas, e as datas.
 *
 * Ratear igualmente ao mudar o total apagaria uma divisão montada de propósito —
 * entrada maior e o resto em prestações iguais é o desenho mais comum de uma
 * renegociação. Com `distribuirPorPesos` o desenho sobrevive à mudança de total
 * e a soma fecha exata: o resíduo do arredondamento cai na última parcela.
 *
 * Todas em zero não têm proporção nenhuma para preservar — aí o rateio igual é a
 * única resposta possível, e é o que a tela já faz ao somar uma parcela nova.
 */
export function redistribuirParaTotal(
  parcelas: ParcelaPlanejada[],
  totalEmCentavos: number,
): ParcelaPlanejada[] {
  const pesos = parcelas.map((parcela) => paraCentavos(parcela.valor));
  const somaDosPesos = pesos.reduce((total, peso) => total + peso, 0);

  if (somaDosPesos <= 0) return redistribuirIgualmente(parcelas, totalEmCentavos);

  const valores = distribuirPorPesos(pesos, totalEmCentavos);

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
  opcoes: OpcoesDeValidacao = {},
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

  // Sem trava, `fecha` continua sendo calculado e continua útil: no modo avulso
  // o alvo é o total que a pessoa escolheu, e a tela usa isso para dizer se as
  // parcelas somam o que ela pediu. O que muda é só quem barra o botão.
  const totalTravado = opcoes.totalTravado ?? true;

  return {
    somaEmCentavos,
    diferencaEmCentavos,
    fecha,
    semValor,
    semVencimento,
    podeSalvar:
      (!totalTravado || fecha) &&
      semValor.length === 0 &&
      semVencimento.length === 0 &&
      parcelas.length > 0 &&
      parcelas.length <= MAXIMO_DE_PARCELAS,
  };
}
