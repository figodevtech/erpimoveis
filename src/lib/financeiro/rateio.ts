/**
 * Aritmetica de dinheiro em centavos e rateio de valores entre parcelas.
 *
 * Tudo que soma ou divide dinheiro no financeiro passa por aqui: em ponto
 * flutuante `0.1 + 0.2 !== 0.3`, e uma diferenca de um centavo derruba a
 * validacao de "a soma das parcelas bate com o total".
 */

export function paraCentavos(valor: number | string | null | undefined): number {
  if (valor == null) return 0;
  const numero =
    typeof valor === "number" ? valor : Number(String(valor).replace(",", ".").trim());
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

export function paraReais(centavos: number): number {
  return Number((centavos / 100).toFixed(2));
}

export function somarCentavos(
  valores: Array<number | string | null | undefined>,
): number {
  return valores.reduce<number>((total, valor) => total + paraCentavos(valor), 0);
}

/**
 * Divide `total` em `quantidade` partes iguais, em reais.
 * Os centavos que sobram da divisao vao para as primeiras parcelas, entao a
 * soma do resultado e sempre exatamente `total`.
 */
export function distribuirValoresIguais(total: number, quantidade: number): number[] {
  if (quantidade <= 0) return [];

  const totalCentavos = paraCentavos(total);
  const base = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos - base * quantidade;

  return Array.from({ length: quantidade }, (_, indice) =>
    paraReais(base + (indice < resto ? 1 : 0)),
  );
}

/**
 * Distribui `totalCentavos` entre as posicoes proporcionalmente a `pesos`.
 * A ultima posicao recebe o residuo, garantindo que a soma feche exatamente.
 * Usado para derivar os valores brutos a partir dos liquidos informados.
 */
export function distribuirPorPesos(pesos: number[], totalCentavos: number): number[] {
  const somaPesos = pesos.reduce((total, peso) => total + peso, 0);
  if (somaPesos <= 0) return pesos.map(() => 0);

  let alocado = 0;

  return pesos.map((peso, indice) => {
    if (indice === pesos.length - 1) return totalCentavos - alocado;

    const proporcional = Math.floor((peso * totalCentavos) / somaPesos);
    alocado += proporcional;
    return proporcional;
  });
}

export interface LinhaDeRateio {
  id: number;
  valor: number;
  valorLiquido: number;
}

export interface ResultadoDoRateio {
  somaEmCentavos: number;
  /** Alvo menos soma: positivo falta, negativo sobra, zero fecha. */
  diferencaEmCentavos: number;
  fecha: boolean;
  /** Ids das linhas com valor inválido, na ordem em que aparecem. */
  invalidas: number[];
  podeSalvar: boolean;
}

/**
 * A regra do rateio, isolada da tela.
 *
 * O total bruto já pago não muda — a operadora do cartão divide as parcelas de
 * um jeito diferente do que foi digitado, mas o que o cliente pagou é o mesmo.
 * Só sai daqui um conjunto que soma exatamente o alvo, com toda linha positiva
 * e nenhum líquido acima do próprio bruto.
 */
export function validarRateio(
  linhas: LinhaDeRateio[],
  alvoEmCentavos: number,
): ResultadoDoRateio {
  const somaEmCentavos = linhas.reduce(
    (total, linha) => total + paraCentavos(linha.valor),
    0,
  );

  const invalidas = linhas
    .filter((linha) => {
      const bruto = paraCentavos(linha.valor);
      const liquido = paraCentavos(linha.valorLiquido);
      return bruto <= 0 || liquido <= 0 || liquido > bruto;
    })
    .map((linha) => linha.id);

  const diferencaEmCentavos = alvoEmCentavos - somaEmCentavos;
  const fecha = diferencaEmCentavos === 0;

  return {
    somaEmCentavos,
    diferencaEmCentavos,
    fecha,
    invalidas,
    podeSalvar: fecha && invalidas.length === 0 && linhas.length > 0,
  };
}

export function formatarCentavos(centavos: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(centavos / 100);
}
