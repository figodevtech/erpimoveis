/**
 * Como a tela oferece as linhas da DRE para um plano de conta.
 *
 * O usuário escolhe a linha; o catálogo de classificação fica por trás. Por isso
 * as opções saem na ordem do relatório — receita, deduções, custos, despesas,
 * financeiro, outros, tributos — e o que fica fora da DRE vai para o fim.
 */

export type OpcaoDeLinha = {
  nome: string;
  destino: { fora_da_dre: boolean; linha_codigo: string | null; linha_nome: string | null } | null;
};

/** "10.2" vem depois de "6.6": comparar texto poria o financeiro antes das despesas. */
function partesDoCodigo(codigo: string) {
  return codigo.split(".").map((parte) => Number(parte) || 0);
}

function compararCodigos(a: string, b: string) {
  const pa = partesDoCodigo(a);
  const pb = partesDoCodigo(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diferenca = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

/** Posição da opção: com linha, fora da DRE, sem destino. */
function faixa(item: OpcaoDeLinha) {
  if (item.destino?.linha_codigo && !item.destino.fora_da_dre) return 0;
  if (item.destino?.fora_da_dre) return 1;
  return 2;
}

export function ordenarPorLinha<T extends OpcaoDeLinha>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const porFaixa = faixa(a) - faixa(b);
    if (porFaixa !== 0) return porFaixa;
    if (faixa(a) === 0) {
      const porCodigo = compararCodigos(a.destino!.linha_codigo!, b.destino!.linha_codigo!);
      if (porCodigo !== 0) return porCodigo;
    }
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/**
 * Rótulo da opção. O nome é o da classificação, não o da linha: duas
 * classificações podem cair na mesma linha (frete e outras receitas, na 1.3), e
 * o nome da linha repetido não deixaria escolher entre elas.
 */
export function rotuloDaLinha(item: OpcaoDeLinha) {
  if (item.destino?.fora_da_dre) return `Fora da DRE · ${item.nome}`;
  if (item.destino?.linha_codigo) return `${item.destino.linha_codigo} · ${item.nome}`;
  return `${item.nome} · sem linha no relatório`;
}
