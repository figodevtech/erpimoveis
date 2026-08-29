// Desconto que vem de uma OS ou venda para a NF-e.
//
// A origem guarda desconto em dois níveis que não se substituem: o do item
// (sobre quantidade × preço unitário) e o geral (sobre a soma dos itens). Na
// NF-e os dois viram uma coisa só — o desconto incondicional do item (vDesc) —
// porque o leiaute 4.00 não tem desconto de nota, apenas o somatório dos itens.
//
// Os valores em reais são deduzidos dos totais já gravados, e não relidos de
// `desconto_tipo`/`desconto`: essas colunas guardam ora percentual, ora reais,
// dependendo de onde a OS/venda foi criada. A diferença entre bruto e líquido
// é a mesma nos dois casos.

export function distribuirDinheiro(total: number, pesos: number[]): number[] {
  const totalEmCentavos = Math.max(0, Math.round(total * 100));
  const somaDosPesos = pesos.reduce((soma, peso) => soma + Math.max(0, peso), 0);
  let restante = totalEmCentavos;
  return pesos.map((peso, indice) => {
    const centavos = indice === pesos.length - 1
      ? restante
      : somaDosPesos > 0
        ? Math.floor((totalEmCentavos * Math.max(0, peso)) / somaDosPesos)
        : 0;
    restante -= centavos;
    return centavos / 100;
  });
}

/**
 * Rateia o desconto geral da origem sobre os produtos que vão para a NF-e.
 *
 * `pesosNaNota` são os valores líquidos dos produtos emitidos e `pesosForaDaNota`
 * o que divide o mesmo desconto sem entrar na nota — os serviços da OS, que
 * saem em NFS-e. Sem separar os dois, o desconto geral de uma OS de mão de obra
 * cairia inteiro sobre as peças e a nota sairia barata demais.
 */
export function ratearDescontoGeral(
  descontoGeral: number,
  pesosNaNota: number[],
  pesosForaDaNota: number[] = [],
): number[] {
  const total = Math.max(0, descontoGeral);
  if (total <= 0) return pesosNaNota.map(() => 0);
  return distribuirDinheiro(total, [...pesosNaNota, ...pesosForaDaNota]).slice(0, pesosNaNota.length);
}

/**
 * Quanto do desconto geral cabe aos produtos que entram na nota.
 *
 * É o valor que a tela de emissão mostra no campo "desconto geral": numa OS com
 * serviços, o desconto da ordem inteira é maior que este número, porque a parte
 * da mão de obra sai na NFS-e.
 */
export function parcelaDoDescontoNaNota(
  descontoGeral: number,
  pesosNaNota: number[],
  pesosForaDaNota: number[] = [],
): number {
  const partes = ratearDescontoGeral(descontoGeral, pesosNaNota, pesosForaDaNota);
  return Number(partes.reduce((soma, parte) => soma + parte, 0).toFixed(2));
}

export type ParticaoDoDesconto = {
  /** Desconto geral da OS, inteiro. */
  total: number;
  /** Fatia que sai na NF-e de produto. */
  produtos: number;
  /** Fatia que sai na NFS-e de serviço. */
  servicos: number;
  baseProdutos: number;
  baseServicos: number;
};

function somar(valores: number[]) {
  return Number(valores.reduce((soma, valor) => soma + valor, 0).toFixed(2));
}

/**
 * Divide o desconto geral da OS entre a NF-e de produto e a NFS-e de serviço.
 *
 * As duas telas de emissão chamam isto com os mesmos pesos, então mostram o
 * mesmo número — e a parte dos serviços é a sobra da conta dos produtos, não uma
 * segunda conta, para os dois lados fecharem o desconto da ordem sem centavo
 * perdido no meio.
 */
export function particionarDescontoDaOs(
  descontoGeral: number,
  pesosDosProdutos: number[],
  pesosDosServicos: number[],
): ParticaoDoDesconto {
  const total = Number(Math.max(0, descontoGeral).toFixed(2));
  const produtos = parcelaDoDescontoNaNota(total, pesosDosProdutos, pesosDosServicos);
  return {
    total,
    produtos,
    servicos: Number((total - produtos).toFixed(2)),
    baseProdutos: somar(pesosDosProdutos),
    baseServicos: somar(pesosDosServicos),
  };
}

export type LinhaComDesconto = {
  /** Quantidade × preço de tabela, antes de qualquer desconto. */
  bruto: number;
  /** Valor do item já descontado, como gravado na origem. */
  liquido: number;
};

/**
 * Junta o desconto do item com a parcela do desconto geral que cabe a ele,
 * limitado ao próprio bruto — um vDesc maior que vProd derruba a nota na SEFAZ.
 */
export function descontoPorItem(
  linhas: LinhaComDesconto[],
  descontoGeral: number,
  pesosForaDaNota: number[] = [],
): number[] {
  const rateio = ratearDescontoGeral(
    descontoGeral,
    linhas.map((linha) => linha.liquido),
    pesosForaDaNota,
  );
  return linhas.map((linha, indice) => {
    const doItem = Math.max(0, linha.bruto - linha.liquido);
    return Number(Math.min(doItem + (rateio[indice] ?? 0), Math.max(0, linha.bruto)).toFixed(2));
  });
}
