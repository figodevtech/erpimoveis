/**
 * Por que a base da comissão não é o valor do serviço.
 *
 * Duas coisas encolhem a base, e nenhuma delas é óbvia para quem só vê o valor
 * do serviço na tela:
 *
 * 1. **Divisão.** Serviço com N realizadores divide a base por N.
 * 2. **Desconto da OS.** A comissão sai do líquido, não do bruto: o mesmo fator
 *    de desconto (ou acréscimo) aplicado à OS inteira entra na base — decidido
 *    em 20260802140000, para o desconto não ser absorvido só pela oficina.
 *
 * Sem explicar, a linha parece erro de cálculo: "serviço de R$ 1.800, 5%, por
 * que a comissão é R$ 88,30 e não R$ 90?".
 *
 * O texto sai daqui para as três telas que mostram a conta — detalhe da OS,
 * Central Pessoal e o `detalhe` do evento financeiro —, para as três dizerem a
 * mesma coisa.
 */

export type ExplicacaoBaseComissao = {
  /** Quantas pessoas dividiram o serviço. */
  realizadores: number;
  /** A base foi dividida entre mais de um realizador. */
  dividido: boolean;
  /** O desconto (ou acréscimo) da OS encolheu a base. */
  descontoAplicado: boolean;
  /** Frase curta para o rodapé da linha. Vazia quando não há o que explicar. */
  texto: string;
};

/**
 * Tolerância do arredondamento. A base é arredondada em duas casas por
 * realizador, então a soma pode ficar até um centavo por pessoa abaixo do
 * subtotal sem que exista desconto algum — R$ 333,33 × 3 = R$ 999,99.
 */
function houveDesconto(subtotalServico: number, valorBase: number, realizadores: number): boolean {
  const somaDasBases = valorBase * realizadores;
  return subtotalServico - somaDasBases > 0.01 * realizadores;
}

export function explicarBaseDaComissao({
  subtotalServico,
  valorBase,
  realizadores,
}: {
  subtotalServico: number;
  valorBase: number;
  realizadores: number;
}): ExplicacaoBaseComissao {
  const quantidade = Math.max(1, Math.trunc(realizadores) || 1);
  const subtotal = Number(subtotalServico) || 0;
  const base = Number(valorBase) || 0;

  const dividido = quantidade > 1;
  const descontoAplicado = subtotal > 0 && houveDesconto(subtotal, base, quantidade);

  const partes: string[] = [];
  if (dividido) partes.push(`1/${quantidade} do serviço`);
  if (descontoAplicado) partes.push("já com o desconto da OS");

  return {
    realizadores: quantidade,
    dividido,
    descontoAplicado,
    texto: partes.join(", "),
  };
}
