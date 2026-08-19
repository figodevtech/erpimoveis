/**
 * A conta da taxa da maquineta.
 *
 * Vive fora do dialog de proposito. O `registerContent` tem 1900 linhas e nenhum
 * teste — toda regra que mora la so e verificada abrindo a tela. Aqui a conta e
 * uma funcao pura, entra na suite `test:financeiro` pelo glob de
 * `src/lib/financeiro/*.test.ts` e o servidor pode usar exatamente a mesma, que
 * e o que impede o liquido calculado na tela de divergir do que o banco grava.
 */

/** Uma faixa da tabela da bandeira: "em 3x eu cobro 5,20%". */
export type FaixaDeParcela = {
  parcelas: number;
  taxaPercentual: number;
};

/** Centavos, sempre. Dinheiro em ponto flutuante e como areia entre os dedos. */
function arredondar(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.round(valor * 100) / 100;
}

function paraNumero(valor: unknown): number {
  return paraNumeroOuNulo(valor) ?? 0;
}

/**
 * `null` quando o valor nao e numero — nao zero.
 *
 * A diferenca vale dinheiro na taxa. Um percentual ilegivel virando 0% daria
 * "esta bandeira nao cobra nada", e o lancamento sairia com o liquido cheio sem
 * ninguem perceber; virando `null`, a faixa e descartada e a tela nao oferece a
 * opcao. Numeric do Postgres chega como string ("5.2000"), e formulario
 * brasileiro manda com virgula — os dois sao aceitos.
 */
function paraNumeroOuNulo(valor: unknown): number | null {
  if (valor == null || typeof valor === "boolean") return null;

  const texto = typeof valor === "string" ? valor.replace(",", ".").trim() : valor;
  if (texto === "") return null;

  const convertido = Number(texto);
  return Number.isFinite(convertido) ? convertido : null;
}

/**
 * As faixas em ordem crescente de parcela, sem repetidas e sem lixo.
 *
 * A ordem importa porque a lista vira seletor: 1x, 2x, 3x. O banco ja garante a
 * unicidade por `bandeira_cartao_parcela_unica`, mas a lista tambem chega aqui
 * vinda de um formulario em edicao, onde a linha duplicada existe enquanto o
 * usuario ainda esta digitando.
 */
export function faixasOrdenadas(faixas: FaixaDeParcela[]): FaixaDeParcela[] {
  const porParcela = new Map<number, FaixaDeParcela>();

  for (const faixa of faixas ?? []) {
    const quantidade = paraNumeroOuNulo(faixa?.parcelas);
    if (quantidade == null) continue;

    const parcelas = Math.trunc(quantidade);
    if (parcelas < 1) continue;

    // Taxa ilegivel derruba a faixa inteira. Ver `paraNumeroOuNulo`.
    const taxa = paraNumeroOuNulo(faixa?.taxaPercentual);
    if (taxa == null || taxa < 0 || taxa > 100) continue;

    porParcela.set(parcelas, { parcelas, taxaPercentual: taxa });
  }

  return [...porParcela.values()].sort((a, b) => a.parcelas - b.parcelas);
}

/**
 * A taxa daquela contagem, ou `null` quando a bandeira nao oferece a faixa.
 *
 * `null` e diferente de zero: zero e "esta bandeira nao cobra em 1x", que e uma
 * negociacao real e comum no debito. Quem confundir os dois calcula liquido
 * cheio para uma faixa que a bandeira nem aceita.
 */
export function taxaDaFaixa(
  faixas: FaixaDeParcela[],
  parcelas: number,
): number | null {
  const alvo = Math.trunc(paraNumero(parcelas));
  const encontrada = faixasOrdenadas(faixas).find(
    (faixa) => faixa.parcelas === alvo,
  );
  return encontrada ? encontrada.taxaPercentual : null;
}

/** Maior parcelamento que a bandeira aceita. Zero quando a tabela esta vazia. */
export function maximoDeParcelas(faixas: FaixaDeParcela[]): number {
  const ordenadas = faixasOrdenadas(faixas);
  return ordenadas.length === 0 ? 0 : ordenadas[ordenadas.length - 1].parcelas;
}

export type CalculoDaTaxa = {
  /** O que a maquineta retem, em reais. */
  taxa: number;
  /** O que sobra e entra na conta. */
  liquido: number;
  /** O percentual efetivamente aplicado. */
  taxaPercentual: number;
};

/**
 * Reparte o bruto entre taxa e liquido.
 *
 * O liquido e sempre `bruto - taxa`, nunca o produto de outro arredondamento:
 * calcular os dois lados em separado abriria a porta para eles nao fecharem, e o
 * gatilho `transacao_valor_coerente_trg` cobra `liquido <= bruto` a cada escrita.
 *
 * Bruto negativo ou zero devolve tudo zerado — nao ha taxa sobre nada, e a rota
 * ja recusa transacao de valor nao positivo antes de chegar aqui.
 */
export function calcularTaxaDaBandeira(
  valorBruto: unknown,
  taxaPercentual: unknown,
): CalculoDaTaxa {
  const bruto = arredondar(Math.max(0, paraNumero(valorBruto)));
  const percentual = Math.min(100, Math.max(0, paraNumero(taxaPercentual)));

  if (bruto <= 0) {
    return { taxa: 0, liquido: 0, taxaPercentual: percentual };
  }

  const taxa = arredondar(bruto * (percentual / 100));

  return {
    taxa,
    liquido: arredondar(bruto - taxa),
    taxaPercentual: percentual,
  };
}

/**
 * O mesmo calculo, partindo da tabela em vez do percentual solto.
 *
 * Devolve `null` quando a faixa nao existe — e o sinal de que a tela precisa
 * pedir outra contagem em vez de mostrar um liquido inventado.
 */
export function calcularPelaFaixa(
  valorBruto: unknown,
  faixas: FaixaDeParcela[],
  parcelas: number,
): CalculoDaTaxa | null {
  const percentual = taxaDaFaixa(faixas, parcelas);
  if (percentual == null) return null;
  return calcularTaxaDaBandeira(valorBruto, percentual);
}

/**
 * Rotulo de uma faixa no seletor: `3x — 5,20% — líquido R$ 947,80`.
 *
 * Montado aqui, e nao no componente, porque as duas telas do cadastro (o
 * recebimento a vista e o parcelado futuro) mostram a mesma coisa e ja
 * divergiram uma vez em campos parecidos.
 */
export function rotuloDaFaixa(
  faixa: FaixaDeParcela,
  valorBruto?: unknown,
): string {
  const percentual = faixa.taxaPercentual
    .toFixed(2)
    .replace(".", ",");

  const base = `${faixa.parcelas}x — ${percentual}%`;

  const bruto = paraNumero(valorBruto);
  if (bruto <= 0) return base;

  const { liquido } = calcularTaxaDaBandeira(bruto, faixa.taxaPercentual);
  const emReal = liquido.toFixed(2).replace(".", ",");

  return `${base} — líquido R$ ${emReal}`;
}
