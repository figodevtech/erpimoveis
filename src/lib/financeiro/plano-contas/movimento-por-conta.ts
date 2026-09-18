/**
 * Movimento de caixa somado por plano de conta.
 *
 * Eixo de caixa: a data do movimento da transação, não a competência. Isto NÃO
 * é a DRE e não fecha com ela — a DRE trabalha por competência e reconhece
 * parcelamento e rateio. Os dois números são diferentes de propósito.
 *
 * Módulo puro de propósito: roda na rota da API e no componente de cliente, que
 * refaz a mesma soma quando o usuário filtra por método de pagamento. Uma regra
 * só, nos dois lados.
 */

export type ChavePlano = string;

export type IdentidadeDoPlano = {
  contaId: number | null;
  contaCodigo: string | null;
  contaNome: string;
  grupoId: number | null;
  grupoCodigo: string | null;
  grupoNome: string;
};

export type MovimentoPorPlanoDeConta = IdentidadeDoPlano & {
  receita: number;
  despesa: number;
};

export type NivelDoPlano = "GRUPO" | "CONTA";

export type BarraDePlano = {
  chave: string;
  rotulo: string;
  receita: number;
  despesa: number;
  total: number;
};

export const CHAVE_SEM_CONTA = "SEM_CONTA";
export const ROTULO_SEM_CONTA = "Sem plano de conta";

export const IDENTIDADE_SEM_CONTA: IdentidadeDoPlano = {
  contaId: null,
  contaCodigo: null,
  contaNome: ROTULO_SEM_CONTA,
  grupoId: null,
  grupoCodigo: null,
  grupoNome: ROTULO_SEM_CONTA,
};

export function chaveDoPlano(planoDeContaId: unknown): ChavePlano {
  if (planoDeContaId == null || planoDeContaId === "") return CHAVE_SEM_CONTA;
  const numero = Number(planoDeContaId);
  return Number.isFinite(numero) ? String(numero) : CHAVE_SEM_CONTA;
}

/** "1.2 · Venda de peças" — o código ajuda a achar a conta no cadastro. */
export function rotuloDoPlano(codigo: string | null, nome: string): string {
  const limpo = String(codigo ?? "").trim();
  return limpo ? `${limpo} · ${nome}` : nome;
}

export function acumularMovimento(
  mapa: Map<ChavePlano, MovimentoPorPlanoDeConta>,
  identidade: IdentidadeDoPlano,
  entrada: number,
  saida: number,
): void {
  const chave = chaveDoPlano(identidade.contaId);
  const atual = mapa.get(chave) ?? { ...identidade, receita: 0, despesa: 0 };
  atual.receita += entrada;
  atual.despesa += saida;
  mapa.set(chave, atual);
}

/**
 * Junta as contas de um mesmo grupo. A chave é o id do grupo, nunca o nome:
 * nome de grupo não é único no cadastro.
 */
export function consolidarPorGrupo(linhas: MovimentoPorPlanoDeConta[]): MovimentoPorPlanoDeConta[] {
  const porGrupo = new Map<string, MovimentoPorPlanoDeConta>();

  for (const linha of linhas) {
    const chave = linha.grupoId == null ? CHAVE_SEM_CONTA : String(linha.grupoId);
    const atual = porGrupo.get(chave) ?? {
      contaId: linha.grupoId,
      contaCodigo: linha.grupoCodigo,
      contaNome: linha.grupoNome,
      grupoId: linha.grupoId,
      grupoCodigo: linha.grupoCodigo,
      grupoNome: linha.grupoNome,
      receita: 0,
      despesa: 0,
    };
    atual.receita += linha.receita;
    atual.despesa += linha.despesa;
    porGrupo.set(chave, atual);
  }

  return Array.from(porGrupo.values());
}

/**
 * Monta as barras do gráfico: ordena por movimento e joga para o fim o que é
 * falta de cadastro ("Sem plano de conta"), que não compete por posição com
 * quem tem conta de verdade. Não corta nada — o gráfico rola.
 */
export function montarBarras(linhas: MovimentoPorPlanoDeConta[], nivel: NivelDoPlano): BarraDePlano[] {
  const barra = (linha: MovimentoPorPlanoDeConta): BarraDePlano => ({
    chave: chaveDoPlano(linha.contaId),
    rotulo:
      nivel === "GRUPO"
        ? rotuloDoPlano(linha.grupoCodigo, linha.grupoNome)
        : linha.contaId == null
          ? ROTULO_SEM_CONTA
          : rotuloDoPlano(linha.contaCodigo, linha.contaNome),
    receita: linha.receita,
    despesa: linha.despesa,
    total: linha.receita + linha.despesa,
  });

  const comMovimento = linhas.filter((linha) => linha.receita + linha.despesa > 0);
  const semConta = comMovimento.filter((linha) => linha.contaId == null).map(barra);
  const classificadas = comMovimento
    .filter((linha) => linha.contaId != null)
    .map(barra)
    .sort((a, b) => b.total - a.total);

  return [...classificadas, ...semConta];
}
