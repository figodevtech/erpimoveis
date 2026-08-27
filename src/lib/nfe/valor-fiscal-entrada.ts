/**
 * O valor fiscal da entrada, item a item — e o custo de estoque, separado dele.
 *
 * A entrada por NF-e calculava um número só, com a fórmula
 * `qtd × unitário − desconto + frete + seguro + outras despesas + IPI`, e o usava
 * como "a destinar". Numa nota com ICMS-ST, II ou PIS-ST isso ficava abaixo do
 * `vNF`, e a tela concluía que a diferença "não pertencia aos itens" — quando na
 * verdade os valores estavam dentro de cada `<det>`, só fora daquela fórmula.
 *
 * Aqui existem três respostas diferentes, e elas não se confundem:
 *
 *   VALOR FISCAL DO ITEM   quanto do `vNF` pertence àquele `<det>`.
 *   VALOR FISCAL DESTINADO quanto do `vNF` esta entrada está apropriando.
 *   CUSTO DE ESTOQUE       quanto entra no preço de compra do produto.
 *
 * Com todos os itens destinados, o valor fiscal destinado é o `vNF` — inclusive
 * a parcela que só existe em `ICMSTot`, que é apropriada por rateio proporcional
 * em vez de sumir. O custo continua saindo da regra do ERP, que é outra conta.
 */

import { distribuirPorPesos, paraCentavos, paraReais } from "@/lib/financeiro/rateio";

import {
  classificarNoCusto,
  type ContextoDeCusto,
  type DestinoContabil,
  type TratamentoNoCusto,
} from "./tratamento-custo";
import { alocacaoPorItem, componentesDoTotal } from "./totais-nfe";
import type { ItemFiscalDaNota, TotaisDaNota } from "./totais-nfe";

export type DestinoDaEntrada = "ESTOQUE" | "USOCONSUMO";

export type TipoDeComponente =
  // Compõem o `vNF`
  | "PRODUTO"
  | "DESCONTO"
  | "ICMS_DESONERADO"
  | "FRETE"
  | "SEGURO"
  | "OUTRAS_DESPESAS"
  | "ICMS_ST"
  | "FCP_ST"
  | "ICMS_MONO_RETEN"
  | "IMPOSTO_IMPORTACAO"
  | "IPI"
  | "IPI_DEVOLVIDO"
  | "PIS_ST"
  | "COFINS_ST"
  | "SERVICOS"
  // Informativos: existem no XML, não compõem o `vNF`
  | "ICMS_PROPRIO"
  | "PIS"
  | "COFINS"
  | "FCP"
  | "FCP_ST_RETIDO"
  | "ICMS_MONO"
  | "ICMS_MONO_RETIDO"
  | "TOTAL_TRIBUTOS";

export const ROTULO_DO_COMPONENTE: Record<TipoDeComponente, string> = {
  PRODUTO: "Produtos",
  DESCONTO: "Desconto",
  ICMS_DESONERADO: "ICMS desonerado",
  FRETE: "Frete",
  SEGURO: "Seguro",
  OUTRAS_DESPESAS: "Outras despesas",
  ICMS_ST: "ICMS-ST",
  FCP_ST: "FCP-ST",
  ICMS_MONO_RETEN: "ICMS mono. retido",
  IMPOSTO_IMPORTACAO: "Imposto de importação",
  IPI: "IPI",
  IPI_DEVOLVIDO: "IPI devolvido",
  PIS_ST: "PIS-ST",
  COFINS_ST: "COFINS-ST",
  SERVICOS: "Serviços",
  ICMS_PROPRIO: "ICMS próprio",
  PIS: "PIS",
  COFINS: "COFINS",
  FCP: "FCP",
  FCP_ST_RETIDO: "FCP-ST retido",
  ICMS_MONO: "ICMS monofásico",
  ICMS_MONO_RETIDO: "ICMS mono. retido em operação anterior",
  TOTAL_TRIBUTOS: "Tributos aproximados",
};

export interface ComponenteFiscal {
  tipo: TipoDeComponente;
  rotulo: string;
  valor: number;
  /** `ITEM` quando saiu de um `<det>`; `TOTAL_NFE` quando só existe em `ICMSTot`. */
  origem: "ITEM" | "TOTAL_NFE";
  numeroItem: number | null;
  /** A classificação que o parser já fez ao reconciliar o `vNF`. */
  compoeValorNFe: boolean;
  /** +1 acréscimo, −1 redutor, 0 informativo. */
  sinalFiscal: 1 | -1 | 0;
  tratamentoCusto: TratamentoNoCusto;
  /** Onde o valor é reconhecido: estoque, resultado, ou ainda indefinido. */
  destinoContabil: DestinoContabil;
  motivoDoTratamento: string;
}

/* ------------------------------------------------------------------ *
 * Componentes por item
 * ------------------------------------------------------------------ */

/**
 * Quais tipos a regra escolhida realmente somou no `vNF`.
 *
 * Sai de `componentesDoTotal`, e não de uma segunda lista, porque parser e
 * entrada precisam concordar. Duas listas divergem no primeiro leiaute novo.
 */
function tiposQueCompoem(totais: TotaisDaNota): Set<TipoDeComponente> {
  const doTotal = componentesDoTotal(totais);
  const compoe = new Set<TipoDeComponente>(["PRODUTO", "DESCONTO"]);

  const ligar = (tipo: TipoDeComponente, ativo: boolean) => {
    if (ativo) compoe.add(tipo);
  };

  // Valor zero não impede o tipo de compor: o que decide é a regra, não a nota.
  ligar("ICMS_DESONERADO", totais.regra !== "CLASSICA_SEM_DESONERACAO");
  ligar("FRETE", true);
  ligar("SEGURO", true);
  ligar("OUTRAS_DESPESAS", true);
  ligar("ICMS_ST", doTotal.icmsST > 0 || !totais.indicadores.veiculoNovo);
  ligar("FCP_ST", doTotal.fcpST > 0 || !totais.indicadores.veiculoNovo);
  ligar("ICMS_MONO_RETEN", true);
  ligar("IMPOSTO_IMPORTACAO", true);
  ligar("IPI", true);
  ligar("IPI_DEVOLVIDO", totais.regra !== "VEICULO_NOVO_SEM_IPI_DEVOLVIDO");
  ligar("PIS_ST", true);
  ligar("COFINS_ST", true);
  ligar("SERVICOS", true);

  return compoe;
}

const REDUTORES: ReadonlySet<TipoDeComponente> = new Set<TipoDeComponente>([
  "DESCONTO",
  "ICMS_DESONERADO",
]);

/**
 * Tipos que compõem o `vNF` em alguma regra. Quando um deles chega com
 * `compoeValorNFe: false`, foi a regra da nota que o deixou de fora (veículo
 * novo, desoneração não deduzida) — e o motivo mostrado precisa dizer isso, não
 * repetir a explicação de campo informativo.
 */
const POSSIVEL_COMPONENTE: ReadonlySet<TipoDeComponente> = new Set<TipoDeComponente>([
  "PRODUTO",
  "DESCONTO",
  "ICMS_DESONERADO",
  "FRETE",
  "SEGURO",
  "OUTRAS_DESPESAS",
  "ICMS_ST",
  "FCP_ST",
  "ICMS_MONO_RETEN",
  "IMPOSTO_IMPORTACAO",
  "IPI",
  "IPI_DEVOLVIDO",
  "PIS_ST",
  "COFINS_ST",
  "SERVICOS",
]);

function montarComponente(
  tipo: TipoDeComponente,
  valor: number,
  opcoes: {
    origem: "ITEM" | "TOTAL_NFE";
    numeroItem: number | null;
    compoeValorNFe: boolean;
    contexto: ContextoDeCusto;
  },
): ComponenteFiscal {
  const { tratamento, destinoContabil, motivo } = classificarNoCusto(tipo, opcoes.contexto);
  const sinalFiscal: 1 | -1 | 0 = !opcoes.compoeValorNFe
    ? 0
    : REDUTORES.has(tipo)
      ? -1
      : 1;

  // O que não compõe o `vNF` não pode integrar custo por esta via: ou já está
  // embutido no preço, ou é de outra regra tributária.
  const foraDaComposicao = !opcoes.compoeValorNFe;

  return {
    tipo,
    rotulo: ROTULO_DO_COMPONENTE[tipo],
    valor,
    origem: opcoes.origem,
    numeroItem: opcoes.numeroItem,
    compoeValorNFe: opcoes.compoeValorNFe,
    sinalFiscal,
    tratamentoCusto: foraDaComposicao ? "INFORMATIVO" : tratamento,
    destinoContabil: foraDaComposicao ? "NENHUM" : destinoContabil,
    motivoDoTratamento:
      foraDaComposicao && POSSIVEL_COMPONENTE.has(tipo)
        ? "a regra desta nota não soma este valor no total"
        : motivo,
  };
}

/**
 * Todos os componentes fiscais de um item, na ordem em que se lê uma nota.
 *
 * Inclui os informativos com `compoeValorNFe: false` de propósito: a tela precisa
 * poder mostrar que o ICMS próprio de R$ 13,36 foi lido e NÃO somado, em vez de
 * o número simplesmente não existir.
 */
export function componentesDoItem(
  item: ItemFiscalDaNota,
  totais: TotaisDaNota,
  contexto: ContextoDeCusto = {},
): ComponenteFiscal[] {
  const compoe = tiposQueCompoem(totais);
  const numeroItem = item.numeroItem;

  const fiscal = (tipo: TipoDeComponente, valor: number) =>
    montarComponente(tipo, valor, {
      origem: "ITEM",
      numeroItem,
      compoeValorNFe: compoe.has(tipo),
      contexto,
    });
  const informativo = (tipo: TipoDeComponente, valor: number) =>
    montarComponente(tipo, valor, {
      origem: "ITEM",
      numeroItem,
      compoeValorNFe: false,
      contexto,
    });

  return [
    // `indTot = 0` diz que o item não entra no total da nota: nem o produto nem
    // seus acréscimos podem ser apropriados como valor fiscal.
    fiscal("PRODUTO", item.compoeTotal ? item.valorProdutos : 0),
    fiscal("DESCONTO", item.valorDesconto),
    fiscal("ICMS_DESONERADO", item.valorIcmsDesonerado),
    fiscal("FRETE", item.valorFrete),
    fiscal("SEGURO", item.valorSeguro),
    fiscal("OUTRAS_DESPESAS", item.outrasDespesas),
    fiscal("ICMS_ST", item.valorIcmsST),
    fiscal("FCP_ST", item.valorFcpST),
    fiscal("ICMS_MONO_RETEN", item.valorIcmsMonoReten),
    fiscal("IMPOSTO_IMPORTACAO", item.valorII),
    fiscal("IPI", item.valorIpi),
    fiscal("IPI_DEVOLVIDO", item.valorIpiDevolvido),
    fiscal("PIS_ST", item.pisST.compoeTotal ? item.pisST.valor : 0),
    fiscal("COFINS_ST", item.cofinsST.compoeTotal ? item.cofinsST.valor : 0),
    informativo("ICMS_PROPRIO", item.informativos.icms),
    informativo("PIS", item.informativos.pis),
    informativo("COFINS", item.informativos.cofins),
    informativo("FCP", item.informativos.fcp),
    informativo("FCP_ST_RETIDO", item.informativos.fcpSTRet),
    informativo("ICMS_MONO", item.informativos.icmsMono),
    informativo("ICMS_MONO_RETIDO", item.informativos.icmsMonoRet),
    informativo("TOTAL_TRIBUTOS", item.informativos.totalTributos),
  ].filter((componente) => componente.valor !== 0);
}

/**
 * Apropriação a partir dos componentes já prontos — o caminho da tela.
 *
 * A entrada recebe os componentes do parser dentro de cada linha e não precisa
 * reconstruir nada: soma o que compõe o `vNF` e rateia, proporcionalmente, os
 * componentes que o total declarou sem `<det>`. Com todas as linhas presentes, o
 * resultado é o `vNF`.
 */
export function apropriarValorFiscal(
  linhas: Array<{ componentes: ComponenteFiscal[] }>,
  naoAlocados: ComponenteFiscal[],
): { cotas: number[]; valorFiscalPorLinha: number[]; valorFiscalTotal: number } {
  const proprios = linhas.map((linha) => valorFiscalEmCentavos(linha.componentes));
  const aRatear = valorFiscalEmCentavos(naoAlocados);

  const pesos = proprios.map((valor) => Math.max(0, valor));
  const somaDosPesos = pesos.reduce((total, peso) => total + peso, 0);
  const cotas =
    linhas.length === 0 || aRatear === 0
      ? linhas.map(() => 0)
      : somaDosPesos > 0
        ? distribuirPorPesos(pesos, aRatear)
        : distribuirPorPesos(
            linhas.map(() => 1),
            aRatear,
          );

  const porLinha = proprios.map((valor, indice) => valor + (cotas[indice] ?? 0));

  return {
    cotas: cotas.map(paraReais),
    valorFiscalPorLinha: porLinha.map(paraReais),
    valorFiscalTotal: paraReais(porLinha.reduce((total, valor) => total + valor, 0)),
  };
}

/** Só o que soma ou abate: informativo entra na lista, mas não na conta. */
function valorFiscalEmCentavos(componentes: ComponenteFiscal[]): number {
  return componentes.reduce(
    (total, parte) => total + parte.sinalFiscal * paraCentavos(parte.valor),
    0,
  );
}

/**
 * Custo de entrada da linha, pela política de `tratamento-custo.ts`.
 *
 * Deliberadamente NÃO é o valor fiscal. Hoje reproduz exatamente a fórmula que as
 * RPCs de entrada já gravam — produto, desconto, frete, seguro, outras despesas e
 * IPI — porque a política começa marcando só esses como `INTEGRA_CUSTO`. Mudar a
 * política muda o custo; nenhuma fórmula precisa ser reescrita aqui.
 *
 * O produto sai de `quantidade × unitário`, e não de `vProd`, porque é assim que a
 * entrada sempre calculou: trocar a base mexeria em `entradaitens.valor_total` de
 * toda nota em que o emitente arredonda `vProd` de forma diferente.
 */
export function calcularCustoEstoque(
  item: ItemFiscalDaNota,
  componentes: ComponenteFiscal[],
): number {
  const centavos = componentes.reduce((total, parte) => {
    if (parte.tipo === "PRODUTO") {
      return total + paraCentavos(item.quantidade * item.valorUnitario);
    }
    if (parte.tratamentoCusto === "INTEGRA_CUSTO") return total + paraCentavos(parte.valor);
    if (parte.tratamentoCusto === "REDUZ_CUSTO") return total - paraCentavos(parte.valor);
    return total;
  }, 0);

  return paraReais(centavos);
}

/* ------------------------------------------------------------------ *
 * Valor fiscal da entrada
 * ------------------------------------------------------------------ */

export interface LinhaDestinada {
  numeroItem: number | null;
  /** Ausente = o item inteiro. A tela hoje só destina itens inteiros. */
  quantidadeDestinada?: number;
}

export interface LinhaFiscalDaEntrada {
  numeroItem: number | null;
  quantidadeDoItem: number;
  quantidadeDestinada: number;
  /** Fração do item apropriada nesta entrada, de 0 a 1. */
  proporcao: number;
  componentes: ComponenteFiscal[];
  /** Valor fiscal do item, já proporcional à quantidade destinada. */
  valorFiscalDoItem: number;
  /** Parcela dos valores que só existem em `ICMSTot`, rateada até aqui. */
  cotaNaoAlocada: number;
  /** `valorFiscalDoItem + cotaNaoAlocada`. */
  valorFiscal: number;
  custoEstoque: number;
}

export interface ValorFiscalDaEntrada {
  linhas: LinhaFiscalDaEntrada[];
  /** Componentes do `vNF` sem `<det>` correspondente, já rateados nas linhas. */
  naoAlocados: ComponenteFiscal[];
  valorFiscalDestinado: number;
  custoEstoqueDestinado: number;
  /** `ICMSTot/vNF`. A referência, nunca recalculada. */
  totalDaNota: number;
  /** Todos os itens, em quantidade integral, estão nesta entrada. */
  notaInteira: boolean;
  /**
   * `totalDaNota − valorFiscalDestinado` quando a nota inteira está aqui. Zero
   * quando a apropriação fecha; qualquer outro número é divergência a mostrar.
   */
  diferencaParaONota: number;
}

/** Os componentes que o total declara e nenhum `<det>` informou. */
export function componentesNaoAlocados(
  totais: TotaisDaNota,
  contexto: ContextoDeCusto = {},
): ComponenteFiscal[] {
  const porCampo: Record<string, TipoDeComponente> = {
    vProd: "PRODUTO",
    vDesc: "DESCONTO",
    vFrete: "FRETE",
    vSeg: "SEGURO",
    vOutro: "OUTRAS_DESPESAS",
    vST: "ICMS_ST",
    vFCPST: "FCP_ST",
    vICMSMonoReten: "ICMS_MONO_RETEN",
    vICMSDeson: "ICMS_DESONERADO",
    vII: "IMPOSTO_IMPORTACAO",
    vIPI: "IPI",
    vIPIDevol: "IPI_DEVOLVIDO",
    "PISST/vPIS": "PIS_ST",
    "COFINSST/vCOFINS": "COFINS_ST",
  };
  const compoe = tiposQueCompoem(totais);

  const naoAlocados = alocacaoPorItem(totais)
    .filter((campo) => campo.naoAlocado > 0)
    .map((campo) => {
      const tipo = porCampo[campo.campo];
      if (!tipo) return null;
      return montarComponente(tipo, campo.naoAlocado, {
        origem: "TOTAL_NFE",
        numeroItem: null,
        compoeValorNFe: compoe.has(tipo),
        contexto,
      });
    })
    .filter((componente): componente is ComponenteFiscal => componente != null);

  // Serviços do ISSQNtot nunca têm `<det>` próprio nesta leitura.
  const servicos = componentesDoTotal(totais).servicos;
  if (servicos > 0) {
    naoAlocados.push(
      montarComponente("SERVICOS", servicos, {
        origem: "TOTAL_NFE",
        numeroItem: null,
        compoeValorNFe: compoe.has("SERVICOS"),
        contexto,
      }),
    );
  }

  return naoAlocados;
}

/**
 * O valor fiscal que esta entrada está apropriando, e o custo que ela vai gravar.
 *
 * Quando todas as linhas entram inteiras, `valorFiscalDestinado` é o `vNF` — os
 * valores que só existem no total são rateados proporcionalmente ao valor fiscal
 * de cada linha, e o resíduo dos centavos vai para a última, então a soma fecha
 * exatamente. Esse rateio serve para RECONCILIAR O VALOR FISCAL; ele não decide
 * nada sobre custo, que sai da política de `tratamento-custo.ts`.
 */
export function calcularValorFiscalDaEntrada(
  totais: TotaisDaNota,
  itens: ItemFiscalDaNota[],
  destinadas: LinhaDestinada[],
  contexto: ContextoDeCusto = {},
): ValorFiscalDaEntrada {
  const porNumero = new Map(itens.map((item) => [item.numeroItem, item]));

  const base = destinadas
    .map((destino) => {
      const item = porNumero.get(destino.numeroItem);
      if (!item) return null;

      const quantidadeDoItem = item.quantidade;
      const quantidadeDestinada = destino.quantidadeDestinada ?? quantidadeDoItem;
      // Item com quantidade zero (ou ausente) é apropriado por inteiro: não há o
      // que proporcionalizar, e dividir por zero produziria NaN silencioso.
      const proporcao =
        quantidadeDoItem > 0
          ? Math.min(1, Math.max(0, quantidadeDestinada / quantidadeDoItem))
          : 1;

      const componentes = componentesDoItem(item, totais, contexto);
      const inteiroEmCentavos = valorFiscalEmCentavos(componentes);
      const destinadoEmCentavos =
        proporcao === 1 ? inteiroEmCentavos : Math.round(inteiroEmCentavos * proporcao);

      return {
        item,
        quantidadeDoItem,
        quantidadeDestinada,
        proporcao,
        componentes,
        destinadoEmCentavos,
        custoInteiro: calcularCustoEstoque(item, componentes),
      };
    })
    .filter((linha): linha is NonNullable<typeof linha> => linha != null);

  const naoAlocados = componentesNaoAlocados(totais, contexto);
  const naoAlocadoEmCentavos = valorFiscalEmCentavos(naoAlocados);

  // Rateio proporcional ao valor fiscal de cada linha, com o resíduo na última.
  // Peso zero em toda parte (nota só de valores de cabeçalho) cai na divisão
  // igual, para o valor não sumir.
  const pesos = base.map((linha) => Math.max(0, linha.destinadoEmCentavos));
  const somaDosPesos = pesos.reduce((total, peso) => total + peso, 0);
  const cotas =
    base.length === 0 || naoAlocadoEmCentavos === 0
      ? base.map(() => 0)
      : somaDosPesos > 0
        ? distribuirPorPesos(pesos, naoAlocadoEmCentavos)
        : distribuirPorPesos(
            base.map(() => 1),
            naoAlocadoEmCentavos,
          );

  const linhas: LinhaFiscalDaEntrada[] = base.map((linha, indice) => {
    const cota = cotas[indice] ?? 0;
    return {
      numeroItem: linha.item.numeroItem,
      quantidadeDoItem: linha.quantidadeDoItem,
      quantidadeDestinada: linha.quantidadeDestinada,
      proporcao: linha.proporcao,
      componentes: linha.componentes,
      valorFiscalDoItem: paraReais(linha.destinadoEmCentavos),
      cotaNaoAlocada: paraReais(cota),
      valorFiscal: paraReais(linha.destinadoEmCentavos + cota),
      custoEstoque:
        linha.proporcao === 1
          ? linha.custoInteiro
          : paraReais(Math.round(paraCentavos(linha.custoInteiro) * linha.proporcao)),
    };
  });

  const valorFiscalEmCentavosDestinado = linhas.reduce(
    (total, linha) => total + paraCentavos(linha.valorFiscal),
    0,
  );
  const custoEmCentavos = linhas.reduce(
    (total, linha) => total + paraCentavos(linha.custoEstoque),
    0,
  );

  const notaInteira =
    itens.length > 0 &&
    linhas.length === itens.length &&
    linhas.every((linha) => linha.proporcao === 1);

  return {
    linhas,
    naoAlocados,
    valorFiscalDestinado: paraReais(valorFiscalEmCentavosDestinado),
    custoEstoqueDestinado: paraReais(custoEmCentavos),
    totalDaNota: totais.totalNota,
    notaInteira,
    diferencaParaONota: notaInteira
      ? paraReais(paraCentavos(totais.totalNota) - valorFiscalEmCentavosDestinado)
      : 0,
  };
}

/**
 * A distância entre o valor fiscal apropriado e o custo gravado, por componente.
 *
 * Substitui o aviso que dizia "estes valores ficam fora da fórmula de custo".
 * Cada linha agora diz o tipo, onde o valor foi encontrado, se compõe o `vNF` e
 * qual tratamento a política de custo aplicou — inclusive quando o tratamento é
 * "ainda não sei classificar", que é uma resposta honesta e diferente de "não".
 */
export function componentesForaDoCusto(entrada: ValorFiscalDaEntrada): ComponenteFiscal[] {
  const relevantes = [
    ...entrada.linhas.flatMap((linha) => linha.componentes),
    ...entrada.naoAlocados,
  ];

  return relevantes.filter(
    (componente) =>
      componente.compoeValorNFe &&
      componente.tratamentoCusto !== "INTEGRA_CUSTO" &&
      componente.tratamentoCusto !== "REDUZ_CUSTO",
  );
}
