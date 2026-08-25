/**
 * O que cada componente fiscal faz com o CUSTO do produto no estoque.
 *
 * É deliberadamente um módulo separado do que compõe o `vNF`. Compor o valor da
 * nota e integrar o custo de estoque são perguntas diferentes: o ICMS-ST compõe
 * o `vNF` sempre, mas só vira custo quando a empresa não tem direito a crédito
 * naquela operação — e isso depende de regime, CST, CFOP e da finalidade do item.
 *
 * O ERP ainda não guarda essa configuração de recuperabilidade. Por isso o
 * default aqui NÃO afirma "não entra no custo": afirma `PENDENTE_DE_CLASSIFICACAO`
 * com o motivo, que é a verdade. Falta de configuração não é o mesmo que o valor
 * não pertencer ao produto, e a tela precisa dizer qual dos dois é o caso.
 *
 * Quando a configuração fiscal existir, é esta tabela que muda — num lugar só.
 */

import type { DestinoDaEntrada } from "./valor-fiscal-entrada";

export type TratamentoNoCusto =
  /** Soma ao custo de entrada da linha. */
  | "INTEGRA_CUSTO"
  /** Abate o custo de entrada da linha. */
  | "REDUZ_CUSTO"
  /** Fica fora do custo por regra fiscal conhecida. */
  | "NAO_INTEGRA_CUSTO"
  /** Falta configuração para decidir. NÃO é o mesmo que "não integra". */
  | "PENDENTE_DE_CLASSIFICACAO"
  /** Não é dinheiro cobrado: base de cálculo, estimativa, retenção, partilha. */
  | "INFORMATIVO";

export interface ClassificacaoDeCusto {
  tratamento: TratamentoNoCusto;
  /** Por que, em uma linha, para a tela poder explicar em vez de decretar. */
  motivo: string;
}

export interface ContextoDeCusto {
  /** Revenda e uso/consumo podem tratar crédito de forma diferente. */
  destino?: DestinoDaEntrada;
  /** CRT do emitente, quando conhecido. */
  regimeDoEmitente?: number | null;
  /** CST/CSOSN do item, quando conhecido. */
  situacaoTributaria?: string | null;
}

const INTEGRA = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "INTEGRA_CUSTO",
  motivo,
});
const REDUZ = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "REDUZ_CUSTO",
  motivo,
});
const PENDENTE = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "PENDENTE_DE_CLASSIFICACAO",
  motivo,
});
const INFORMATIVO = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "INFORMATIVO",
  motivo,
});

const CREDITO_NAO_CONFIGURADO =
  "depende de a empresa ter direito a crédito nesta operação; o ERP ainda não guarda essa configuração";

/**
 * A política vigente, por tipo de componente.
 *
 * Os cinco primeiros são exatamente o que a entrada já somava no custo da linha
 * — a fórmula antiga passou a sair daqui em vez de estar escrita à mão, para não
 * existirem duas versões da mesma regra.
 */
const POLITICA: Record<string, ClassificacaoDeCusto> = {
  PRODUTO: INTEGRA("valor da mercadoria"),
  DESCONTO: REDUZ("abatimento concedido na própria linha"),
  FRETE: INTEGRA("despesa de aquisição, informada na linha"),
  SEGURO: INTEGRA("despesa de aquisição, informada na linha"),
  OUTRAS_DESPESAS: INTEGRA("despesa acessória de aquisição, informada na linha"),
  IPI: INTEGRA("não recuperável para quem não é contribuinte de IPI"),

  ICMS_ST: PENDENTE(`ICMS-ST ${CREDITO_NAO_CONFIGURADO}`),
  FCP_ST: PENDENTE(`FCP-ST ${CREDITO_NAO_CONFIGURADO}`),
  ICMS_MONO_RETEN: PENDENTE(`ICMS monofásico retido ${CREDITO_NAO_CONFIGURADO}`),
  IMPOSTO_IMPORTACAO: PENDENTE(`imposto de importação ${CREDITO_NAO_CONFIGURADO}`),
  IPI_DEVOLVIDO: PENDENTE(`IPI devolvido ${CREDITO_NAO_CONFIGURADO}`),
  PIS_ST: PENDENTE(`PIS-ST ${CREDITO_NAO_CONFIGURADO}`),
  COFINS_ST: PENDENTE(`COFINS-ST ${CREDITO_NAO_CONFIGURADO}`),
  ICMS_DESONERADO: PENDENTE(
    "a desoneração pode ou não abater o custo, conforme o motivo e o indicador de dedução",
  ),
  SERVICOS: PENDENTE("serviço da nota não é mercadoria; a apropriação depende da operação"),
};

const MOTIVO_INFORMATIVO: Record<string, string> = {
  ICMS_PROPRIO: "já embutido no preço da mercadoria",
  PIS: "já embutido no preço da mercadoria",
  COFINS: "já embutido no preço da mercadoria",
  FCP: "já embutido no ICMS da operação",
  FCP_ST_RETIDO: "retido em operação anterior",
  ICMS_MONO: "tributação monofásica da operação, não é cobrança adicional",
  ICMS_MONO_RETIDO: "retido em operação anterior",
  ICMS_UF_DEST: "partilha de DIFAL entre estados",
  FCP_UF_DEST: "partilha de DIFAL entre estados",
  ICMS_UF_REMET: "partilha de DIFAL entre estados",
  TOTAL_TRIBUTOS: "estimativa da Lei da Transparência",
  IBS: "grupo da Reforma Tributária que não compõe o total no período",
  CBS: "grupo da Reforma Tributária que não compõe o total no período",
  IS: "grupo da Reforma Tributária que não compõe o total no período",
};

/**
 * Como este componente afeta o custo do produto.
 *
 * O contexto entra na assinatura porque a decisão depende dele. Hoje ele só
 * qualifica o motivo da pendência: nenhuma regra decide por regime ou CST ainda,
 * e é exatamente por isso que os tributos possivelmente recuperáveis saem como
 * `PENDENTE_DE_CLASSIFICACAO` em vez de um "não" silencioso.
 */
export function classificarNoCusto(
  tipo: string,
  contexto: ContextoDeCusto = {},
): ClassificacaoDeCusto {
  const politica = POLITICA[tipo];
  if (!politica) {
    const motivo = MOTIVO_INFORMATIVO[tipo];
    return INFORMATIVO(motivo ?? "valor informativo do XML");
  }

  // O direito a crédito muda com o destino da mercadoria, então o motivo diz
  // para qual destino a classificação está pendente — é a informação que falta
  // para alguém resolver a pendência.
  if (politica.tratamento === "PENDENTE_DE_CLASSIFICACAO" && contexto.destino) {
    const destino =
      contexto.destino === "USOCONSUMO" ? "uso e consumo" : "estoque de revenda";
    return { ...politica, motivo: `${politica.motivo} (destino: ${destino})` };
  }

  return politica;
}

/** Rótulo curto do tratamento, para a tela. */
export const ROTULO_DO_TRATAMENTO: Record<TratamentoNoCusto, string> = {
  INTEGRA_CUSTO: "Integra o custo",
  REDUZ_CUSTO: "Reduz o custo",
  NAO_INTEGRA_CUSTO: "Não integra o custo",
  PENDENTE_DE_CLASSIFICACAO: "Classificação fiscal pendente",
  INFORMATIVO: "Informativo",
};
