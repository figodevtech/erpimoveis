// src/app/api/dre/_arvore.ts
//
// Montagem da arvore da DRE: agregacao dos grupos, avaliacao das formulas e os
// percentuais. Sem nenhuma dependencia de banco, para poder ser testado direto.

export type LinhaDre = {
  id: number;
  codigo: string;
  nome: string;
  nivel: number;
  parentId: number | null;
  tipo: "GRUPO" | "DETALHE" | "SUBTOTAL" | "FORMULA";
  naturezaDre: string | null;
  formula: string | null;
  sinal: number;
  semFonte: boolean;
  valor: number;
  valorAnterior: number;
  variacao: number;
  variacaoPercentual: number | null;
  percentualReceitaLiquida: number | null;
  lancamentos: number;
  filhos: LinhaDre[];
};

type Registro = Record<string, unknown>;

export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Avalia expressoes do tipo "9 + 10 + 11" sobre os codigos ja calculados.
 *
 * Deliberadamente restrito a soma e subtracao de codigos: nao ha eval, nao ha
 * parenteses, e qualquer token desconhecido zera o termo em vez de quebrar o
 * relatorio inteiro. Formula de DRE nao precisa de mais que isso.
 */
function avaliarFormula(formula: string, porCodigo: Map<string, number>): number {
  const tokens = formula.replace(/\s+/g, " ").trim().split(" ");
  let total = 0;
  let sinal = 1;

  for (const token of tokens) {
    if (token === "+") { sinal = 1; continue; }
    if (token === "-") { sinal = -1; continue; }
    total += sinal * (porCodigo.get(token) ?? 0);
  }

  return Number(total.toFixed(2));
}

/**
 * Valor de um grupo a partir dos filhos, respeitando o sinal de cada um.
 *
 * O sinal do filho diz se ele entra somando ou subtraindo dentro do grupo. O
 * sinal do proprio grupo diz como a formula la embaixo vai usa-lo: `sinal = -1`
 * significa "a formula me subtrai" (RECEITA LIQUIDA = 1 - 2), entao o grupo
 * precisa carregar a magnitude positiva, nao o negativo.
 *
 * Somar os filhos direto — o que se fazia aqui — so acerta quando todos tem o
 * mesmo sinal. Em RESULTADO FINANCEIRO nao tem: 10.1 Receitas financeiras soma
 * e 10.2 Despesas financeiras subtrai. A despesa estava sendo somada, e como a
 * linha 12 usa `9 + 10 + 11`, o erro atravessava ate o resultado liquido — que
 * aparecia maior pelo DOBRO das despesas financeiras.
 *
 * A conta abaixo devolve exatamente o mesmo numero de antes para os grupos de
 * sinal uniforme (1, 2, 4, 6 e 13) e corrige o unico que mistura (10).
 */
function agregarFilhos(pai: LinhaDre, valorDe: (filho: LinhaDre) => number): number {
  const somaComSinal = pai.filhos.reduce((acc, f) => acc + f.sinal * valorDe(f), 0);
  const total = pai.sinal < 0 ? -somaComSinal : somaComSinal;
  return Number(total.toFixed(2));
}

export function montarArvore(
  linhas: Registro[],
  soma: Map<number, { valor: number; lancamentos: number }>,
  somaAnterior: Map<number, { valor: number; lancamentos: number }>,
) {
  const base: LinhaDre[] = linhas.map((l) => ({
    id: Number(l.id),
    codigo: String(l.codigo),
    nome: String(l.nome),
    nivel: Number(l.nivel ?? 1),
    parentId: l.parent_id == null ? null : Number(l.parent_id),
    tipo: String(l.tipo) as LinhaDre["tipo"],
    naturezaDre: (l.natureza_dre as string | null) ?? null,
    formula: (l.formula as string | null) ?? null,
    sinal: Number(l.sinal ?? 1),
    semFonte: l.sem_fonte === true,
    valor: soma.get(Number(l.id))?.valor ?? 0,
    valorAnterior: somaAnterior.get(Number(l.id))?.valor ?? 0,
    variacao: 0,
    variacaoPercentual: null,
    percentualReceitaLiquida: null,
    lancamentos: soma.get(Number(l.id))?.lancamentos ?? 0,
    filhos: [],
  }));

  const porId = new Map(base.map((l) => [l.id, l]));
  const raizes: LinhaDre[] = [];

  for (const linha of base) {
    if (linha.parentId != null && porId.has(linha.parentId)) porId.get(linha.parentId)!.filhos.push(linha);
    else raizes.push(linha);
  }

  // Pais somam os filhos. Percorre do nivel mais fundo para o mais raso.
  const porNivel = [...base].sort((a, b) => b.nivel - a.nivel);
  for (const linha of porNivel) {
    if (!linha.filhos.length) continue;
    linha.valor = agregarFilhos(linha, (f) => f.valor);
    linha.valorAnterior = agregarFilhos(linha, (f) => f.valorAnterior);
    linha.lancamentos = linha.filhos.reduce((acc, f) => acc + f.lancamentos, 0);
  }

  // Formulas dependem dos totais acima; resolvidas na ordem do template.
  const porCodigo = new Map(base.map((l) => [l.codigo, l.valor]));
  const anteriorPorCodigo = new Map(base.map((l) => [l.codigo, l.valorAnterior]));

  for (const linha of base) {
    if (linha.tipo !== "FORMULA" || !linha.formula) continue;
    linha.valor = avaliarFormula(linha.formula, porCodigo);
    linha.valorAnterior = avaliarFormula(linha.formula, anteriorPorCodigo);
    porCodigo.set(linha.codigo, linha.valor);
    anteriorPorCodigo.set(linha.codigo, linha.valorAnterior);
  }

  const receitaLiquida = porCodigo.get("3") ?? 0;

  for (const linha of base) {
    linha.variacao = Number((linha.valor - linha.valorAnterior).toFixed(2));
    linha.variacaoPercentual =
      linha.valorAnterior === 0 ? null : Number(((linha.variacao / Math.abs(linha.valorAnterior)) * 100).toFixed(2));
    // Sem receita liquida nao existe percentual: devolver 0 sugeriria "nada",
    // quando o correto e "indefinido".
    linha.percentualReceitaLiquida =
      receitaLiquida === 0 ? null : Number(((linha.valor / receitaLiquida) * 100).toFixed(2));
  }

  return { raizes, plano: base };
}
