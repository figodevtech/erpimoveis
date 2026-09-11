/**
 * Regras de domínio de uma transação financeira, sem dependência de React nem
 * de Supabase — servem igual no cliente e nas rotas de API.
 */

/** Colunas que ligam a transação ao documento que a gerou. */
export interface VinculoDeTransacao {
  ordemservicoid?: number | string | null;
  vendaid?: number | string | null;
  entrada_id?: number | string | null;
  usoconsumo_entrada_id?: number | string | null;
}

export type OrigemDeTransacao = "OS" | "VENDA" | "ENTRADA" | "USOCONSUMO";

/**
 * De onde a transação nasceu.
 *
 * É o mesmo conjunto que o DRE já usa para decidir que um lançamento não é
 * resultado novo (`dre_eventos_de_transacao`): liquidação de algo já
 * reconhecido, ou compra que virou estoque.
 */
export function origemDaTransacao(
  transacao: VinculoDeTransacao | null | undefined,
): OrigemDeTransacao | null {
  if (!transacao) return null;
  if (transacao.ordemservicoid != null) return "OS";
  if (transacao.vendaid != null) return "VENDA";
  if (transacao.entrada_id != null) return "ENTRADA";
  if (transacao.usoconsumo_entrada_id != null) return "USOCONSUMO";
  return null;
}

export function rotuloDaOrigem(origem: OrigemDeTransacao): string {
  switch (origem) {
    case "OS":
      return "ordem de serviço";
    case "VENDA":
      return "venda";
    case "ENTRADA":
      return "entrada de estoque";
    case "USOCONSUMO":
      return "entrada de uso e consumo";
  }
}

/**
 * Transação gerada por um documento não pode ter o tipo trocado.
 *
 * Uma receita de OS que vira despesa deixa de abater o documento, e a OS fica
 * CONCLUIDO com saldo em aberto — a rota de edição não revalida status (só o
 * DELETE faz isso). O mesmo vale para uma despesa de entrada virando receita:
 * o custo da compra sumiria do resultado.
 */
export function tipoEhEditavel(transacao: VinculoDeTransacao | null | undefined): boolean {
  return origemDaTransacao(transacao) == null;
}

/**
 * Só saída de dinheiro por maquineta tem taxa, e portanto valor líquido:
 * uma despesa a pagar ou um depósito valem exatamente o que está no bruto.
 *
 * Mesma regra que o cadastro usa para mostrar o switch "Taxa de recebimento".
 */
export function tipoTemValorLiquido(tipo: string | null | undefined): boolean {
  const normalizado = String(tipo ?? "").toUpperCase();
  return normalizado === "RECEITA" || normalizado === "SAQUE";
}

/**
 * O tipo representa dinheiro entrando numa conta?
 *
 * Receita e deposito entram no caixa; despesa e saque saem. Centralizar essa
 * regra evita que consumidores deduzam o sentido de uma transferencia apenas
 * pelo tipo antigo RECEITA.
 */
export function tipoEhEntradaDeCaixa(tipo: string | null | undefined): boolean {
  const normalizado = String(tipo ?? "").toUpperCase();
  return normalizado === "RECEITA" || normalizado === "DEPOSITO";
}

/**
 * Valor de face: o que a transação valia antes de juros, multa e afins.
 *
 * `valor` é o que o cliente paga, já com os acréscimos aplicados. Para abater um
 * documento, porém, o que conta é a face — acréscimo e desconto são do
 * pagamento, não da OS nem da venda. Somar o bruto faria a OS parecer paga a
 * mais só porque o cliente atrasou e pagou juros.
 *
 * É a mesma separação que o sistema já faz em `acrescimo_financeiro`, que por
 * definição "não altera itens ou valores fiscais".
 *
 * Transação sem ajuste nenhum tem face igual ao bruto, que é o estado de tudo
 * que existia antes desta coluna.
 */
export function valorDeFace(transacao: {
  valor?: number | string | null;
  valor_acrescimos?: number | string | null;
}): number {
  const bruto = Number(transacao.valor ?? 0);
  const brutoSeguro = Number.isFinite(bruto) ? bruto : 0;

  const acrescimos = Number(transacao.valor_acrescimos ?? 0);
  const acrescimosSeguros =
    Number.isFinite(acrescimos) && acrescimos > 0 ? acrescimos : 0;

  // Centavos para não deixar 1030.1 - 30.1 virar 999.9999999999999.
  return Math.round((brutoSeguro - acrescimosSeguros) * 100) / 100;
}

/**
 * Líquido efetivo de uma transação.
 *
 * Registros antigos (e os criados fora do fluxo de caixa, como entrada fiscal)
 * têm `valorLiquido` nulo ou zerado — nesses casos o líquido é o próprio bruto,
 * não R$ 0,00.
 */
export function valorLiquidoEfetivo(transacao: {
  valor?: number | string | null;
  valorLiquido?: number | string | null;
  valor_descontos?: number | string | null;
  tipo?: string | null;
}): number {
  const bruto = Number(transacao.valor ?? 0);
  const brutoSeguro = Number.isFinite(bruto) ? bruto : 0;

  const liquido = Number(transacao.valorLiquido ?? 0);
  const liquidoValido = Number.isFinite(liquido) && liquido > 0;

  // Desconto lançado vale para qualquer tipo: uma conta a pagar quitada com
  // abatimento por antecipação sai da conta pelo valor abatido, não pelo cheio.
  // A regra de ignorar o líquido em despesa e depósito nasceu de registro antigo
  // com lixo nesse campo — com linha de desconto não há dúvida sobre o número.
  const descontos = Number(transacao.valor_descontos ?? 0);
  if (Number.isFinite(descontos) && descontos > 0) {
    return liquidoValido ? liquido : Math.round((brutoSeguro - descontos) * 100) / 100;
  }

  if (!tipoTemValorLiquido(transacao.tipo)) return brutoSeguro;

  return liquidoValido ? liquido : brutoSeguro;
}

/**
 * A taxa de recebimento é o único desconto lançado?
 *
 * É a pergunta que decide se "Líquido recebido" ainda é um campo. Sendo a taxa
 * sozinha — ou não havendo desconto nenhum —, o número que a pessoa digita vira
 * a taxa, e o servidor sabe traduzir isso em criar, atualizar ou remover a
 * linha. Havendo qualquer outro desconto, não dá para saber qual delas ela quis
 * mexer, e escolher uma transformaria desconto comercial em taxa de maquineta.
 *
 * `sincronizarTaxaRecebimento` aplica exatamente esta regra no servidor. A tela
 * precisa da mesma para não oferecer uma edição que só voltaria como erro.
 */
export function taxaEhOUnicoDesconto(
  linhas: Array<{
    natureza?: string | null;
    tipo?: { codigo_sistema?: string | null } | null;
  }> | null | undefined,
): boolean {
  const descontos = (linhas ?? []).filter(
    (linha) => String(linha.natureza ?? "").toUpperCase() === "DESCONTO",
  );

  if (descontos.length === 0) return true;
  if (descontos.length > 1) return false;
  return descontos[0]?.tipo?.codigo_sistema === "TAXA_RECEBIMENTO";
}

/**
 * Líquido de uma transação que está aberta para edição.
 *
 * `travado` é o contrário de `taxaEhOUnicoDesconto`: há desconto lançado que a
 * tela não controla, e o líquido deixou de ser entrada para virar resultado.
 * Nesse caso ele é sempre `valor - descontos` — que é como
 * `tg_transacao_valor_coerente` o reescreve a cada gravação.
 *
 * A diferença para `valorLiquidoEfetivo` só aparece com o bruto digitado e ainda
 * não salvo: lá o líquido guardado tem preferência, e ele ainda é o do bruto
 * anterior. Mostrar esse número velho seria feio; mandá-lo ao servidor pedia uma
 * taxa que não existe, e o salvamento voltava como "o líquido não pôde ser
 * ajustado" depois de os brutos já terem sido gravados.
 */
export function valorLiquidoEmEdicao(
  transacao: {
    valor?: number | string | null;
    valorLiquido?: number | string | null;
    valor_descontos?: number | string | null;
    tipo?: string | null;
  },
  travado: boolean,
): number {
  if (!travado) return valorLiquidoEfetivo(transacao);

  const bruto = Number(transacao.valor ?? 0);
  const brutoSeguro = Number.isFinite(bruto) ? bruto : 0;

  const descontos = Number(transacao.valor_descontos ?? 0);
  const descontosSeguros =
    Number.isFinite(descontos) && descontos > 0 ? descontos : 0;

  return Math.round((brutoSeguro - descontosSeguros) * 100) / 100;
}

/** As colunas que dizem em que ponto da antecipação um título está. */
export interface TituloAntecipado {
  adiantamento_id?: number | string | null;
  banco_id?: number | string | null;
  valor_baixado?: number | string | null;
  pendente?: boolean | null;
}

/**
 * O título faz parte de uma antecipação?
 *
 * Vale para os dois modos: o que liquidou os títulos no ato e o que os manteve
 * em aberto para a cobrança acompanhar.
 */
export function ehTituloAntecipado(transacao: TituloAntecipado | null | undefined): boolean {
  return transacao?.adiantamento_id != null;
}

/**
 * A baixa deste título antecipado trouxe dinheiro para a conta?
 *
 * Acontece de dois jeitos, e os dois têm a mesma forma: o banco devolveu o valor
 * inteiro e o pagador quitou depois, ou o banco reteve o principal que havia
 * adiantado e repassou só o juros do atraso. Nos dois o dinheiro entra por uma
 * transação própria, ligada ao título — nunca pelo título, que é antecipado e
 * por isso jamais carrega banco (`transacao_antecipado_sem_banco_trg`).
 *
 * `valor_baixado` é a soma dessas transações filhas, mantida pelo gatilho
 * `transacao_baixa_parcial_trg`. Perguntar por ela é perguntar o que existe, em
 * vez de deduzir de `banco_id` — que foi o que essa função fazia antes de o
 * repasse existir, e que deixaria de valer agora.
 *
 * Quem chama isto está quase sempre perguntando o contrário do que parece: se a
 * resposta é `false`, a linha NÃO deve ser somada no extrato, porque o dinheiro
 * dela entrou pela antecipação.
 */
export function antecipadoComLancamento(
  transacao: TituloAntecipado | null | undefined,
): boolean {
  if (!ehTituloAntecipado(transacao)) return false;
  if (transacao?.pendente === true) return false;
  const baixado = Number(transacao?.valor_baixado ?? 0);
  return Number.isFinite(baixado) && baixado > 0;
}

/** As colunas que dizem quanto de um título já foi pago. */
export interface TituloComSaldo {
  valor?: number | string | null;
  valorLiquido?: number | string | null;
  valor_descontos?: number | string | null;
  valor_baixado?: number | string | null;
  tipo?: string | null;
  pendente?: boolean | null;
}

/**
 * Quanto ainda falta receber ou pagar num título.
 *
 * É contra o líquido, não contra o bruto: desconto concedido abate o que a
 * pessoa deve, e cobrar o cheio depois de um abatimento seria cobrar o que já
 * foi perdoado.
 *
 * Título sem baixa parcial devolve o líquido inteiro, que é o comportamento de
 * sempre — `valor_baixado` nasce em zero e só sai disso pelo gatilho
 * `transacao_baixa_parcial_trg`.
 */
export function saldoEmAberto(transacao: TituloComSaldo | null | undefined): number {
  if (!transacao) return 0;

  const liquido = valorLiquidoEfetivo(transacao);
  const baixado = Number(transacao.valor_baixado ?? 0);
  const baixadoSeguro = Number.isFinite(baixado) && baixado > 0 ? baixado : 0;

  const saldo = Math.round((liquido - baixadoSeguro) * 100) / 100;
  return saldo > 0 ? saldo : 0;
}

/**
 * O título foi pago em partes e ainda tem saldo?
 *
 * Serve para a lista mostrar o restante em vez do valor cheio, e para os
 * agregados de "a receber"/"a pagar" não somarem dinheiro que já entrou.
 */
export function ehBaixaParcial(transacao: TituloComSaldo | null | undefined): boolean {
  if (!transacao) return false;
  const baixado = Number(transacao.valor_baixado ?? 0);
  return Number.isFinite(baixado) && baixado > 0 && transacao.pendente === true;
}

/**
 * A linha é uma das duas pernas de uma transferência entre contas próprias?
 *
 * As duas pernas são movimento de conta de verdade — aparecem no extrato e mexem
 * no saldo de cada banco —, mas não são fato econômico: a empresa não ficou mais
 * rica por receber o próprio dinheiro na outra conta. Daí a pergunta ter valor
 * em vários lugares ao mesmo tempo: a tabela marca a linha, o dialog de edição
 * trava o valor, e a exclusão avisa que vão embora duas.
 */
export function ehTransferencia(
  transacao: { transferencia_id?: number | string | null } | null | undefined,
): boolean {
  return transacao?.transferencia_id != null;
}

/** Uma linha de ajuste que ainda está na tela, sem ter sido gravada. */
export interface AjusteEmEspera {
  natureza: "ACRESCIMO" | "DESCONTO";
  modo: "FIXO" | "PORCENTAGEM";
  valorInformado: number;
}

/**
 * Quanto esta baixa passa a valer com os ajustes que estão na tela.
 *
 * O diálogo de baixa deixou de só exibir acréscimo e desconto e passou a
 * lançá-los, e aí o número que ele mostra precisa ser o mesmo que a RPC vai
 * gravar. Esta função é a metade cliente dessa conta: percentual sobre a BASE —
 * nunca sobre o acumulado nem sobre o saldo —, e centavos inteiros, igual a
 * `recalcular_valores_transacao`. Divergindo dela, a tela promete um valor e o
 * banco grava outro.
 *
 * O total sai do SALDO, e não do bruto: é ele que responde "quanto falta pagar
 * neste título", já descontando baixa parcial anterior. Acréscimo sobe o saldo,
 * desconto desce.
 *
 * Isso importa mais do que parece: `parcial` na tela é `valor pago < total`, e
 * se a comparação continuasse contra o saldo guardado, lançar juros faria toda
 * quitação integral virar baixa parcial — o título perderia o banco e nasceria
 * uma transação filha que ninguém pediu.
 */
export function totalDaBaixaComAjustes(entrada: {
  saldo: number;
  valorBase: number;
  ajustes: AjusteEmEspera[];
}): { acrescimos: number; descontos: number; total: number } {
  const emCentavos = (valor: number) => {
    const numero = Number(valor ?? 0);
    return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
  };

  const base = emCentavos(entrada.valorBase);
  let acrescimos = 0;
  let descontos = 0;

  // Decimal exato, como numeric do PostgreSQL: 1,005% de R$ 100 deve
  // arredondar para R$ 1,01, mesmo que o float produza 100,499999 centavos.
  const calcularCentavos = (informado: number, percentual: boolean) => {
    const [mantissa, expoente = "0"] = String(informado).split("e");
    const [inteiro, fracao = ""] = mantissa.split(".");
    const escala = fracao.length - Number(expoente);
    let numerador = BigInt(inteiro + fracao) * BigInt(percentual ? base : 100);
    let denominador = BigInt(percentual ? 100 : 1);
    if (escala >= 0) denominador *= BigInt(10) ** BigInt(escala);
    else numerador *= BigInt(10) ** BigInt(-escala);
    return Number((numerador * BigInt(2) + denominador) / (denominador * BigInt(2)));
  };

  for (const ajuste of entrada.ajustes ?? []) {
    const informado = Number(ajuste?.valorInformado);
    if (!Number.isFinite(informado) || informado <= 0) continue;

    // Arredonda POR LINHA, como o banco: somar antes e arredondar depois daria
    // um centavo de diferença em percentuais quebrados.
    const centavos = calcularCentavos(informado, ajuste.modo === "PORCENTAGEM");

    if (ajuste.natureza === "ACRESCIMO") acrescimos += centavos;
    else descontos += centavos;
  }

  const total = emCentavos(entrada.saldo) + acrescimos - descontos;

  return {
    acrescimos: acrescimos / 100,
    descontos: descontos / 100,
    // Um desconto maior que o saldo zera a baixa em vez de virar negativo; quem
    // recusa de verdade é `recalcular_valores_transacao`, com a mensagem dela.
    total: Math.max(total, 0) / 100,
  };
}
