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
 * Divide `totalCentavos` em `quantidade` partes iguais.
 * Os centavos que sobram da divisao vao para as primeiras parcelas, entao a
 * soma do resultado e sempre exatamente `totalCentavos`.
 */
export function distribuirIgualmenteEmCentavos(
  totalCentavos: number,
  quantidade: number,
): number[] {
  if (quantidade <= 0) return [];

  const base = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos - base * quantidade;

  return Array.from(
    { length: quantidade },
    (_, indice) => base + (indice < resto ? 1 : 0),
  );
}

/** Mesma divisao, em reais — o formato que o formulario de parcelas usa. */
export function distribuirValoresIguais(total: number, quantidade: number): number[] {
  return distribuirIgualmenteEmCentavos(paraCentavos(total), quantidade).map(paraReais);
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

export interface DocumentoParaRatear {
  id: number;
  /** Quanto ainda falta receber deste documento, em centavos. */
  saldoEmCentavos: number;
}

export interface FatiaDoDocumento {
  id: number;
  valorEmCentavos: number;
}

export class RateioInvalidoError extends Error {}

/**
 * Rateia um pagamento único entre vários documentos (OS ou vendas).
 *
 * O peso de cada documento é o que ele ainda deve: quem deve mais recebe a maior
 * fatia. Pagamento parcial — valor menor que a soma dos saldos — é permitido e
 * cai no mesmo proporcional; é o caso do cliente que adianta parte da dívida.
 *
 * Recusa valor acima da soma dos saldos: o excedente não teria documento a que
 * pertencer e viraria crédito órfão. Quem quiser registrar adiantamento tem o
 * fluxo próprio para isso.
 */
export function ratearEntreDocumentos(
  documentos: DocumentoParaRatear[],
  totalEmCentavos: number,
): FatiaDoDocumento[] {
  if (documentos.length === 0) {
    throw new RateioInvalidoError("Selecione ao menos um documento.");
  }
  if (!Number.isSafeInteger(totalEmCentavos) || totalEmCentavos <= 0) {
    throw new RateioInvalidoError("O valor do pagamento deve ser maior que zero.");
  }

  const semSaldo = documentos.filter((documento) => documento.saldoEmCentavos <= 0);
  if (semSaldo.length > 0) {
    throw new RateioInvalidoError(
      `Documento(s) sem saldo em aberto: ${semSaldo.map((d) => `#${d.id}`).join(", ")}.`,
    );
  }

  const somaDosSaldos = documentos.reduce(
    (total, documento) => total + documento.saldoEmCentavos,
    0,
  );
  if (totalEmCentavos > somaDosSaldos) {
    throw new RateioInvalidoError(
      `O valor excede o total em aberto (${formatarCentavos(somaDosSaldos)}).`,
    );
  }

  const fatias = distribuirPorPesos(
    documentos.map((documento) => documento.saldoEmCentavos),
    totalEmCentavos,
  );

  return documentos.map((documento, indice) => ({
    id: documento.id,
    valorEmCentavos: fatias[indice] ?? 0,
  }));
}

/**
 * A grade do pagamento parcelado: cada documento recebe a sua fatia, e cada
 * fatia é dividida nas parcelas.
 *
 * Rateia primeiro entre documentos e só depois no tempo. A ordem importa: dividir
 * primeiro em parcelas e depois ratear cada parcela produziria arredondamentos
 * independentes por parcela, e a soma por documento deixaria de fechar com o que
 * aquele documento deve.
 */
export function ratearEmParcelas(
  documentos: DocumentoParaRatear[],
  totalEmCentavos: number,
  quantidadeDeParcelas: number,
): Array<{ id: number; parcela: number; valorEmCentavos: number }> {
  if (!Number.isSafeInteger(quantidadeDeParcelas) || quantidadeDeParcelas <= 0) {
    throw new RateioInvalidoError("Informe ao menos uma parcela.");
  }

  return ratearEntreDocumentos(documentos, totalEmCentavos).flatMap((fatia) => {
    const porParcela = distribuirIgualmenteEmCentavos(
      fatia.valorEmCentavos,
      quantidadeDeParcelas,
    );

    return porParcela.map((valorEmCentavos, indice) => ({
      id: fatia.id,
      parcela: indice + 1,
      valorEmCentavos,
    }));
  });
}
