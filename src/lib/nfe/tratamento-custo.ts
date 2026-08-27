/**
 * O que cada componente fiscal faz com o CUSTO do produto — e, quando não é
 * custo, para onde ele vai.
 *
 * É deliberadamente um módulo separado do que compõe o `vNF`. Compor o valor da
 * nota, integrar o custo de estoque e virar resultado no mês são três perguntas
 * diferentes.
 *
 * A regra da casa é que comprar não é despesa: a mercadoria vira estoque e só
 * chega à DRE como CMV quando sai por venda ou por OS. Ela vale para a
 * mercadoria e não vale para o imposto que a mercadoria não carrega — ICMS-ST,
 * FCP-ST, imposto de importação e afins são pagos na compra, nunca viram
 * estoque, e portanto não têm saída futura para esperar. Esses entram no
 * resultado na competência da nota.
 *
 * `PENDENTE_DE_CLASSIFICACAO` continua existindo para o que ainda não tem
 * política. Falta de configuração não é o mesmo que o valor não pertencer a
 * lugar nenhum, e a tela precisa dizer qual dos dois é o caso.
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

/**
 * Onde o valor é reconhecido.
 *
 * `CUSTO_DE_ESTOQUE` fica esperando a baixa do item — é o caminho que já
 * existia. `RESULTADO` entra na DRE na competência da nota. `PENDENTE` é o
 * terceiro estado honesto: pertence à nota, ainda não se sabe onde reconhecer.
 */
export type DestinoContabil = "CUSTO_DE_ESTOQUE" | "RESULTADO" | "PENDENTE" | "NENHUM";

export interface ClassificacaoDeCusto {
  tratamento: TratamentoNoCusto;
  destinoContabil: DestinoContabil;
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
  destinoContabil: "CUSTO_DE_ESTOQUE",
  motivo,
});
const REDUZ = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "REDUZ_CUSTO",
  destinoContabil: "CUSTO_DE_ESTOQUE",
  motivo,
});
const RESULTADO = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "NAO_INTEGRA_CUSTO",
  destinoContabil: "RESULTADO",
  motivo,
});
const PENDENTE = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "PENDENTE_DE_CLASSIFICACAO",
  destinoContabil: "PENDENTE",
  motivo,
});
const INFORMATIVO = (motivo: string): ClassificacaoDeCusto => ({
  tratamento: "INFORMATIVO",
  destinoContabil: "NENHUM",
  motivo,
});

const NAO_VIRA_MERCADORIA =
  "pago na compra e não integra o estoque, então entra no resultado na competência da nota";

/**
 * A política vigente, por tipo de componente.
 *
 * Os seis primeiros são exatamente o que a entrada já somava no custo da linha —
 * a fórmula antiga passou a sair daqui em vez de estar escrita à mão, para não
 * existirem duas versões da mesma regra. Eles seguem esperando a baixa do item.
 *
 * Os tributos abaixo já foram `PENDENTE_DE_CLASSIFICACAO`: eram lidos, exibidos
 * e não reconhecidos em lugar nenhum — saíam do caixa e não chegavam à DRE.
 * A decisão de reconhecê-los como custo do período é do dono do negócio; o que
 * o código faz é registrá-la num lugar só.
 */
const POLITICA: Record<string, ClassificacaoDeCusto> = {
  PRODUTO: INTEGRA("valor da mercadoria"),
  DESCONTO: REDUZ("abatimento concedido na própria linha"),
  FRETE: INTEGRA("despesa de aquisição, informada na linha"),
  SEGURO: INTEGRA("despesa de aquisição, informada na linha"),
  OUTRAS_DESPESAS: INTEGRA("despesa acessória de aquisição, informada na linha"),
  IPI: INTEGRA("não recuperável para quem não é contribuinte de IPI"),

  ICMS_ST: RESULTADO(`ICMS-ST retido pelo fornecedor: ${NAO_VIRA_MERCADORIA}`),
  FCP_ST: RESULTADO(`FCP-ST retido pelo fornecedor: ${NAO_VIRA_MERCADORIA}`),
  ICMS_MONO_RETEN: RESULTADO(`ICMS monofásico retido: ${NAO_VIRA_MERCADORIA}`),
  IMPOSTO_IMPORTACAO: RESULTADO(`imposto de importação: ${NAO_VIRA_MERCADORIA}`),
  IPI_DEVOLVIDO: RESULTADO(`IPI devolvido: ${NAO_VIRA_MERCADORIA}`),
  PIS_ST: RESULTADO(`PIS-ST: ${NAO_VIRA_MERCADORIA}`),
  COFINS_ST: RESULTADO(`COFINS-ST: ${NAO_VIRA_MERCADORIA}`),
  ICMS_DESONERADO: RESULTADO(
    "desoneração concedida na compra: reduz o custo do período, não o preço do item no estoque",
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
 * Como este componente afeta o custo do produto, e onde ele é reconhecido.
 *
 * O contexto entra na assinatura porque a decisão depende dele. Hoje ele só
 * qualifica o motivo da pendência: nenhuma regra decide por regime ou CST ainda,
 * e é exatamente por isso que o que sobra sai como `PENDENTE_DE_CLASSIFICACAO`
 * em vez de um "não" silencioso.
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

  // O destino da mercadoria muda o que ainda falta decidir, então o motivo diz
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
