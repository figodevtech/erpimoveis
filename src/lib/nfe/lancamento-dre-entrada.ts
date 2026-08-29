/**
 * O que da nota de entrada vai para a DRE agora, e o que fica esperando a baixa.
 *
 * A compra de mercadoria não é despesa: ela aumenta o estoque e só chega ao
 * resultado como CMV quando o item sai por venda ou por OS. Esse caminho não
 * muda, e nada aqui encosta nele.
 *
 * O que estava furado é o resto da nota. ICMS-ST, FCP-ST, imposto de importação,
 * IPI devolvido, PIS-ST e COFINS-ST compõem o `vNF`, são pagos ao fornecedor e
 * NÃO viram mercadoria — logo não têm saída futura para esperar. Antes disto
 * eles saíam do caixa e não chegavam a lugar nenhum: contas a pagar registrava o
 * `vNF` inteiro, o estoque recebia menos que isso, e a diferença evaporava.
 *
 * Aqui essa diferença vira lançamento na competência da nota. A conta que amarra
 * tudo, e que `conferirIdentidade` verifica:
 *
 *     custo de estoque + despesas − recuperações + pendentes = valor fiscal
 *
 * O primeiro termo espera a baixa. Os dois do meio entram na DRE agora. O último
 * é o que a política ainda não sabe classificar — existe, é mostrado, e não é
 * disfarçado de zero.
 */

import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";

import type {
  ComponenteFiscal,
  TipoDeComponente,
  ValorFiscalDaEntrada,
} from "./valor-fiscal-entrada";

/**
 * A origem do evento em `eventos_financeiros`.
 *
 * É ela que `dre_somar_por_linha` casa com `dre_mapeamento` pelo par
 * `origem || ':' || natureza`, então o valor tem de ser exatamente o que a
 * migration semeou.
 */
export const ORIGEM_DO_EVENTO = "ENTRADA_FISCAL" as const;

export type NaturezaDoLancamento = "DESPESA" | "RECEITA";

export interface ItemDoLancamento {
  numeroItem: number | null;
  valor: number;
}

export interface LancamentoDreDaEntrada {
  tipo: TipoDeComponente;
  rotulo: string;
  origemEvento: typeof ORIGEM_DO_EVENTO;
  /** `RECEITA` aqui significa redução de custo do período, não faturamento. */
  natureza: NaturezaDoLancamento;
  /** Sempre positivo: o sinal mora na linha da DRE, não no lançamento. */
  valor: number;
  descricao: string;
  detalhe: string;
  itens: ItemDoLancamento[];
}

export interface OpcoesDoLancamento {
  /**
   * Restringe às linhas indicadas. A NF-e mista grava duas entradas a partir da
   * mesma nota: cada lado leva os seus itens, e só um deles leva os valores sem
   * alocação, senão o mesmo imposto entraria duas vezes na DRE.
   */
  numerosDeItem?: Array<number | null>;
  /** Padrão `true`. */
  incluirNaoAlocados?: boolean;
}

type LinhaDaEntrada = ValorFiscalDaEntrada["linhas"][number];

/**
 * O mínimo de que o lançamento precisa: as linhas com os seus componentes já
 * classificados e o que o total declarou sem `<det>`.
 *
 * É um tipo estrutural, e não `ValorFiscalDaEntrada`, porque a tela monta as
 * linhas a partir da resposta da rota — sem reconstruir a apropriação inteira —
 * e `ValorFiscalDaEntrada` continua satisfazendo esta forma.
 */
export interface FonteDosLancamentos {
  linhas: Array<
    Pick<LinhaDaEntrada, "numeroItem" | "proporcao" | "componentes" | "valorFiscalDoItem" | "custoEstoque">
  >;
  naoAlocados: ComponenteFiscal[];
}

interface ParcelaDoTipo {
  tipo: TipoDeComponente;
  rotulo: string;
  motivo: string;
  natureza: NaturezaDoLancamento;
  numeroItem: number | null;
  centavos: number;
}

/**
 * Um componente que só existe no total da nota nunca chega ao custo de nenhum
 * item — apropriá-lo exigiria um rateio de custo que ninguém decidiu. Então,
 * mesmo quando a política diz "isto seria custo de estoque" (frete de cabeçalho
 * não repartido, por exemplo), ele fica pendente em vez de sumir da conta.
 */
function destinoDoNaoAlocado(componente: ComponenteFiscal) {
  return componente.destinoContabil === "CUSTO_DE_ESTOQUE"
    ? "PENDENTE"
    : componente.destinoContabil;
}

function naturezaDe(componente: ComponenteFiscal): NaturezaDoLancamento {
  return componente.sinalFiscal === -1 ? "RECEITA" : "DESPESA";
}

const sinalDe = (natureza: NaturezaDoLancamento) => (natureza === "RECEITA" ? -1 : 1);

/**
 * As parcelas de uma linha, já proporcionais à quantidade destinada.
 *
 * Numa destinação parcial, escalar cada componente sozinho deixa resíduo de
 * centavo: `round(a×p) + round(b×p)` não é `round((a+b)×p)`. O alvo exato é
 * `valorFiscalDoItem − custoEstoque`, que a linha já calculou; o resíduo vai
 * para a maior parcela, e a identidade fecha no centavo.
 */
function parcelasDaLinha(linha: FonteDosLancamentos["linhas"][number]): ParcelaDoTipo[] {
  const fora = linha.componentes.filter(
    (componente) =>
      componente.compoeValorNFe &&
      (componente.destinoContabil === "RESULTADO" ||
        componente.destinoContabil === "PENDENTE"),
  );
  if (fora.length === 0) return [];

  const parcelas: ParcelaDoTipo[] = fora.map((componente) => ({
    tipo: componente.tipo,
    rotulo: componente.rotulo,
    motivo: componente.motivoDoTratamento,
    natureza: naturezaDe(componente),
    numeroItem: linha.numeroItem,
    centavos:
      linha.proporcao === 1
        ? paraCentavos(componente.valor)
        : Math.round(paraCentavos(componente.valor) * linha.proporcao),
  }));

  if (linha.proporcao !== 1) {
    const alvo = paraCentavos(linha.valorFiscalDoItem) - paraCentavos(linha.custoEstoque);
    const obtido = parcelas.reduce(
      (total, parcela) => total + sinalDe(parcela.natureza) * parcela.centavos,
      0,
    );
    const residuo = alvo - obtido;
    if (residuo !== 0) {
      const maior = parcelas.reduce((a, b) => (b.centavos > a.centavos ? b : a));
      maior.centavos += sinalDe(maior.natureza) * residuo;
    }
  }

  return parcelas.filter((parcela) => parcela.centavos !== 0);
}

/** As parcelas dos componentes que o total declara e nenhum `<det>` informou. */
function parcelasNaoAlocadas(naoAlocados: ComponenteFiscal[]): ParcelaDoTipo[] {
  return naoAlocados
    .filter(
      (componente) =>
        componente.compoeValorNFe && destinoDoNaoAlocado(componente) === "RESULTADO",
    )
    .map((componente) => ({
      tipo: componente.tipo,
      rotulo: componente.rotulo,
      motivo: `${componente.motivoDoTratamento}; informado só no total da NF-e`,
      natureza: naturezaDe(componente),
      numeroItem: null,
      centavos: paraCentavos(componente.valor),
    }))
    .filter((parcela) => parcela.centavos !== 0);
}

function linhasSelecionadas(
  entrada: FonteDosLancamentos,
  numerosDeItem: OpcoesDoLancamento["numerosDeItem"],
) {
  if (!numerosDeItem) return entrada.linhas;
  const escolhidos = new Set(numerosDeItem);
  return entrada.linhas.filter((linha) => escolhidos.has(linha.numeroItem));
}

/**
 * Os lançamentos da DRE desta entrada, um por tipo de componente.
 *
 * Agrupar por tipo, e não por item, é de propósito: a DRE soma por linha, e o
 * detalhamento por item viaja em `itens` para o drill-down. Também é o que faz a
 * chave de idempotência do banco — `(source_type, source_id, origem,
 * chave_origem, natureza)` — funcionar com `chave_origem` = tipo do componente.
 */
export function lancamentosDreDaEntrada(
  entrada: FonteDosLancamentos,
  opcoes: OpcoesDoLancamento = {},
): LancamentoDreDaEntrada[] {
  const linhas = linhasSelecionadas(entrada, opcoes.numerosDeItem);

  // Sem linha destinada não há apropriação: o valor que só existe no total é
  // rateado entre as linhas, e sem elas ele não pertence a esta entrada. Lançá-lo
  // aqui cobraria o imposto de uma entrada que não recebeu mercadoria nenhuma.
  const naoAlocados =
    linhas.length === 0 || opcoes.incluirNaoAlocados === false
      ? []
      : parcelasNaoAlocadas(entrada.naoAlocados);

  const parcelas = [...linhas.flatMap(parcelasDaLinha), ...naoAlocados];

  // Pendente não é lançamento: aparece na conferência, nunca na DRE.
  const aLancar = parcelas.filter((parcela) => tipoVaiParaResultado(entrada, parcela.tipo));

  const porTipo = new Map<TipoDeComponente, LancamentoDreDaEntrada & { centavos: number }>();

  for (const parcela of aLancar) {
    const existente = porTipo.get(parcela.tipo);
    if (existente) {
      existente.centavos += parcela.centavos;
      existente.itens.push({
        numeroItem: parcela.numeroItem,
        valor: paraReais(parcela.centavos),
      });
      continue;
    }
    porTipo.set(parcela.tipo, {
      tipo: parcela.tipo,
      rotulo: parcela.rotulo,
      origemEvento: ORIGEM_DO_EVENTO,
      natureza: parcela.natureza,
      valor: 0,
      descricao: `${parcela.rotulo} na compra`,
      detalhe: parcela.motivo,
      itens: [{ numeroItem: parcela.numeroItem, valor: paraReais(parcela.centavos) }],
      centavos: parcela.centavos,
    });
  }

  return [...porTipo.values()]
    .map(({ centavos, ...lancamento }) => ({ ...lancamento, valor: paraReais(centavos) }))
    .filter((lancamento) => lancamento.valor !== 0);
}

/**
 * O tipo tem destino `RESULTADO` nesta nota?
 *
 * A pergunta é por tipo e não por componente porque o mesmo tipo aparece em
 * várias linhas com a mesma classificação — e porque um valor sem alocação por
 * item cai para pendente mesmo quando a política o mandaria ao custo.
 */
function tipoVaiParaResultado(entrada: FonteDosLancamentos, tipo: TipoDeComponente) {
  const doItem = entrada.linhas
    .flatMap((linha) => linha.componentes)
    .find((componente) => componente.tipo === tipo);
  if (doItem) return doItem.destinoContabil === "RESULTADO";

  const doTotal = entrada.naoAlocados.find((componente) => componente.tipo === tipo);
  return doTotal ? destinoDoNaoAlocado(doTotal) === "RESULTADO" : false;
}

/** A fonte mais os dois totais que a conferencia compara. */
export type FonteDaConferencia = FonteDosLancamentos &
  Pick<ValorFiscalDaEntrada, "custoEstoqueDestinado" | "valorFiscalDestinado">;

export interface ConferenciaDaEntrada {
  custoEstoque: number;
  despesas: number;
  recuperacoes: number;
  /** Líquido do que a política ainda não classifica. Pode ser negativo. */
  pendentes: number;
  valorFiscal: number;
  /** `valorFiscal − (custo + despesas − recuperações + pendentes)`. */
  diferenca: number;
  fecha: boolean;
}

/**
 * A conferência que prova que nada sumiu e nada contou duas vezes.
 *
 * Se `fecha` for falso, algum componente do `vNF` ficou sem destino — e isso é
 * falha de política, não de arredondamento: a conta é toda em centavos inteiros.
 */
export function conferirIdentidade(entrada: FonteDaConferencia): ConferenciaDaEntrada {
  const lancamentos = lancamentosDreDaEntrada(entrada);

  const somar = (natureza: NaturezaDoLancamento) =>
    lancamentos
      .filter((lancamento) => lancamento.natureza === natureza)
      .reduce((total, lancamento) => total + paraCentavos(lancamento.valor), 0);

  const despesas = somar("DESPESA");
  const recuperacoes = somar("RECEITA");
  const pendentes = centavosPendentes(entrada);

  const custoEstoque = paraCentavos(entrada.custoEstoqueDestinado);
  const valorFiscal = paraCentavos(entrada.valorFiscalDestinado);
  const diferenca = valorFiscal - (custoEstoque + despesas - recuperacoes + pendentes);

  return {
    custoEstoque: paraReais(custoEstoque),
    despesas: paraReais(despesas),
    recuperacoes: paraReais(recuperacoes),
    pendentes: paraReais(pendentes),
    valorFiscal: paraReais(valorFiscal),
    diferenca: paraReais(diferenca),
    fecha: diferenca === 0,
  };
}

/**
 * O que pertence à nota e ainda não tem destino, na mesma escala das parcelas —
 * inclusive o resíduo de uma destinação parcial, que pode ter caído aqui.
 */
function centavosPendentes(entrada: FonteDosLancamentos): number {
  const daLinha = entrada.linhas.reduce((total, linha) => {
    const pendentes = new Set(
      linha.componentes
        .filter(
          (componente) =>
            componente.compoeValorNFe && componente.destinoContabil === "PENDENTE",
        )
        .map((componente) => componente.tipo),
    );
    if (pendentes.size === 0) return total;

    return (
      total +
      parcelasDaLinha(linha)
        .filter((parcela) => pendentes.has(parcela.tipo))
        .reduce(
          (soma, parcela) => soma + sinalDe(parcela.natureza) * parcela.centavos,
          0,
        )
    );
  }, 0);

  const doTotal = (entrada.linhas.length === 0 ? [] : entrada.naoAlocados)
    .filter(
      (componente) =>
        componente.compoeValorNFe && destinoDoNaoAlocado(componente) === "PENDENTE",
    )
    .reduce(
      (total, componente) => total + componente.sinalFiscal * paraCentavos(componente.valor),
      0,
    );

  return daLinha + doTotal;
}

/**
 * O lançamento no formato que a rota aceita.
 *
 * `rotulo` e `origemEvento` ficam de fora de propósito: o schema da entrada é
 * `.strict()`, e a origem do evento é decidida pelo banco, não pelo navegador.
 */
export function payloadDosLancamentos(lancamentos: LancamentoDreDaEntrada[]) {
  return lancamentos.map((lancamento) => ({
    tipo: lancamento.tipo,
    natureza: lancamento.natureza,
    valor: lancamento.valor,
    descricao: lancamento.descricao,
    detalhe: lancamento.detalhe,
    itens: lancamento.itens,
  }));
}

/** O total, em reais, que esta entrada vai lançar na DRE. */
export function totalDosLancamentos(lancamentos: LancamentoDreDaEntrada[]): number {
  return paraReais(
    lancamentos.reduce(
      (total, lancamento) => total + sinalDe(lancamento.natureza) * paraCentavos(lancamento.valor),
      0,
    ),
  );
}
