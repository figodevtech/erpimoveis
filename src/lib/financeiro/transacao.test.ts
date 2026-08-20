import assert from "node:assert/strict";
import test from "node:test";

import {
  antecipadoComLancamento,
  ehBaixaParcial,
  saldoEmAberto,
  ehTituloAntecipado,
  origemDaTransacao,
  tipoEhEditavel,
  tipoTemValorLiquido,
  taxaEhOUnicoDesconto,
  valorDeFace,
  valorLiquidoEfetivo,
  valorLiquidoEmEdicao,
} from "./transacao";

test("identifica a origem de cada vínculo", () => {
  assert.equal(origemDaTransacao({ ordemservicoid: 12 }), "OS");
  assert.equal(origemDaTransacao({ vendaid: 7 }), "VENDA");
  assert.equal(origemDaTransacao({ entrada_id: 3 }), "ENTRADA");
  assert.equal(origemDaTransacao({ usoconsumo_entrada_id: 9 }), "USOCONSUMO");
});

test("transação avulsa não tem origem", () => {
  assert.equal(origemDaTransacao({}), null);
  assert.equal(origemDaTransacao(null), null);
  assert.equal(
    origemDaTransacao({ ordemservicoid: null, vendaid: null, entrada_id: null }),
    null,
  );
});

test("id zero ainda conta como vínculo, id nulo não", () => {
  // Postgres não gera id 0, mas `0 != null` — o teste trava a regra em "!= null"
  // para ninguém trocar por um truthy check e destravar o tipo sem querer.
  assert.equal(origemDaTransacao({ entrada_id: 0 }), "ENTRADA");
  assert.equal(origemDaTransacao({ entrada_id: undefined }), null);
});

test("só transação avulsa pode trocar de tipo", () => {
  assert.equal(tipoEhEditavel({}), true);
  assert.equal(tipoEhEditavel({ ordemservicoid: 1 }), false);
  assert.equal(tipoEhEditavel({ vendaid: 1 }), false);
  assert.equal(tipoEhEditavel({ entrada_id: 1 }), false);
  assert.equal(tipoEhEditavel({ usoconsumo_entrada_id: 1 }), false);
});

test("valor líquido só existe em recebimento e saque", () => {
  assert.equal(tipoTemValorLiquido("RECEITA"), true);
  assert.equal(tipoTemValorLiquido("SAQUE"), true);
  assert.equal(tipoTemValorLiquido("DESPESA"), false);
  assert.equal(tipoTemValorLiquido("DEPOSITO"), false);
  assert.equal(tipoTemValorLiquido(null), false);
});

test("despesa vale o bruto mesmo com líquido gravado", () => {
  // Uma conta a pagar não passa por maquineta: ignora qualquer líquido residual.
  assert.equal(valorLiquidoEfetivo({ valor: 250, valorLiquido: 0, tipo: "DESPESA" }), 250);
  assert.equal(valorLiquidoEfetivo({ valor: 250, valorLiquido: 99, tipo: "DESPESA" }), 250);
});

test("despesa com desconto lançado sai pelo valor abatido", () => {
  // Conta a pagar quitada com abatimento por antecipação: sai 900, não 1.000.
  assert.equal(
    valorLiquidoEfetivo({
      valor: 1000,
      valorLiquido: 900,
      valor_descontos: 100,
      tipo: "DESPESA",
    }),
    900,
  );
});

test("desconto lançado sem líquido gravado cai na subtração", () => {
  assert.equal(
    valorLiquidoEfetivo({ valor: 1000, valor_descontos: 100, tipo: "DESPESA" }),
    900,
  );
});

test("desconto zerado não muda a regra antiga", () => {
  // Sem linha de desconto, despesa continua valendo o bruto — o estado de tudo
  // que existia antes dos ajustes.
  assert.equal(
    valorLiquidoEfetivo({ valor: 250, valorLiquido: 99, valor_descontos: 0, tipo: "DESPESA" }),
    250,
  );
});

test("receita sem líquido gravado cai no bruto", () => {
  // Registro antigo, ou criado fora do fluxo de caixa: exibir R$ 0,00 era o bug.
  assert.equal(valorLiquidoEfetivo({ valor: 850, valorLiquido: null, tipo: "RECEITA" }), 850);
  assert.equal(valorLiquidoEfetivo({ valor: 850, valorLiquido: 0, tipo: "RECEITA" }), 850);
});

test("receita com taxa devolve o líquido", () => {
  assert.equal(
    valorLiquidoEfetivo({ valor: 850, valorLiquido: 823.45, tipo: "RECEITA" }),
    823.45,
  );
});

test("valores em texto e lixo não viram NaN", () => {
  assert.equal(valorLiquidoEfetivo({ valor: "100", tipo: "DESPESA" }), 100);
  assert.equal(valorLiquidoEfetivo({ valor: undefined, tipo: "RECEITA" }), 0);
  assert.equal(valorLiquidoEfetivo({ valor: "abc", tipo: "RECEITA" }), 0);
});

test("face desconta os acréscimos do bruto", () => {
  // OS de 1.000 paga com 30 de juros: o documento continua vendo 1.000.
  assert.equal(valorDeFace({ valor: 1030, valor_acrescimos: 30 }), 1000);
});

test("transação sem acréscimo tem face igual ao bruto", () => {
  // Estado de tudo que existia antes da coluna: não pode mudar de valor.
  assert.equal(valorDeFace({ valor: 1000 }), 1000);
  assert.equal(valorDeFace({ valor: 1000, valor_acrescimos: null }), 1000);
  assert.equal(valorDeFace({ valor: 1000, valor_acrescimos: 0 }), 1000);
});

test("desconto não entra na face", () => {
  // Desconto mexe só no líquido: para o documento, o cliente pagou o cheio.
  assert.equal(valorDeFace({ valor: 1000, valor_acrescimos: 0 }), 1000);
});

test("face em texto e lixo não vira NaN", () => {
  assert.equal(valorDeFace({ valor: "1030", valor_acrescimos: "30" }), 1000);
  assert.equal(valorDeFace({ valor: undefined }), 0);
  assert.equal(valorDeFace({ valor: "abc", valor_acrescimos: "xyz" }), 0);
});

test("face não sofre com ponto flutuante", () => {
  assert.equal(valorDeFace({ valor: 1030.1, valor_acrescimos: 30.1 }), 1000);
});

const TAXA = { tipo: { codigo_sistema: "TAXA_RECEBIMENTO" } };
const COMERCIAL = { tipo: { codigo_sistema: null } };

test("sem desconto, o líquido continua sendo campo", () => {
  assert.equal(taxaEhOUnicoDesconto([]), true);
  assert.equal(taxaEhOUnicoDesconto(null), true);
  assert.equal(
    taxaEhOUnicoDesconto([{ natureza: "ACRESCIMO", ...COMERCIAL }]),
    true,
  );
});

test("só a taxa sozinha deixa o líquido editável", () => {
  assert.equal(taxaEhOUnicoDesconto([{ natureza: "DESCONTO", ...TAXA }]), true);
  assert.equal(
    taxaEhOUnicoDesconto([{ natureza: "ACRESCIMO", ...COMERCIAL }, { natureza: "DESCONTO", ...TAXA }]),
    true,
  );
});

test("um desconto que não é a taxa já trava o líquido", () => {
  // O caso que a tela deixava passar: com uma linha só ela achava que o campo
  // valia, e o servidor recusava. Um desconto comercial não é taxa de maquineta.
  assert.equal(taxaEhOUnicoDesconto([{ natureza: "DESCONTO", ...COMERCIAL }]), false);
  assert.equal(
    taxaEhOUnicoDesconto([{ natureza: "DESCONTO", ...TAXA }, { natureza: "DESCONTO", ...COMERCIAL }]),
    false,
  );
});

test("líquido travado é sempre o bruto menos os descontos", () => {
  // O bruto subiu na tela e ainda não foi salvo: o líquido guardado é o do bruto
  // anterior, e é justamente ele que não pode ser usado.
  assert.equal(
    valorLiquidoEmEdicao(
      { valor: 200, valorLiquido: 90, valor_descontos: 10, tipo: "RECEITA" },
      true,
    ),
    190,
  );
  assert.equal(
    valorLiquidoEmEdicao({ valor: 100, valor_descontos: 100, tipo: "RECEITA" }, true),
    0,
  );
});

test("líquido destravado mantém a regra de sempre", () => {
  const transacao = { valor: 100, valorLiquido: 90, valor_descontos: 10, tipo: "RECEITA" };
  assert.equal(valorLiquidoEmEdicao(transacao, false), valorLiquidoEfetivo(transacao));
  assert.equal(valorLiquidoEmEdicao(transacao, false), 90);
});

test("líquido em edição não sofre com ponto flutuante nem com lixo", () => {
  assert.equal(
    valorLiquidoEmEdicao({ valor: "1030.10", valor_descontos: "30.10" }, true),
    1000,
  );
  assert.equal(valorLiquidoEmEdicao({ valor: "abc", valor_descontos: "x" }, true), 0);
});

test("reconhece o título que faz parte de uma antecipação", () => {
  assert.equal(ehTituloAntecipado({ adiantamento_id: 42 }), true);
  assert.equal(ehTituloAntecipado({ adiantamento_id: null }), false);
  assert.equal(ehTituloAntecipado(null), false);
  assert.equal(ehTituloAntecipado(undefined), false);
});

test("título antecipado em aberto nunca conta como lançado no caixa", () => {
  // É o estado em que a antecipação o deixa: o dinheiro entrou por ela.
  assert.equal(
    antecipadoComLancamento({ adiantamento_id: 42, pendente: true, valor_baixado: 0 }),
    false,
  );
});

test("a baixa sem lançamento não move a conta; a com repasse move", () => {
  // Boleto honrado: o caixa já recebeu pela antecipação, e não nasce filha.
  assert.equal(
    antecipadoComLancamento({ adiantamento_id: 42, pendente: false, valor_baixado: 0 }),
    false,
  );
  // O banco devolveu tudo e o pagador quitou: entrou o valor inteiro.
  assert.equal(
    antecipadoComLancamento({ adiantamento_id: 42, pendente: false, valor_baixado: 1000 }),
    true,
  );
  // O banco reteve o principal e repassou só o juros: entrou uma fração.
  assert.equal(
    antecipadoComLancamento({ adiantamento_id: 42, pendente: false, valor_baixado: 50 }),
    true,
  );
});

test("banco no título não decide mais se houve lançamento", () => {
  // Título antecipado nunca carrega banco — o gatilho recusa. Se aparecer um por
  // dado antigo, o que vale é a existência da transação filha.
  assert.equal(
    antecipadoComLancamento({ adiantamento_id: 42, pendente: false, banco_id: 3, valor_baixado: 0 }),
    false,
  );
});

test("título comum nunca é antecipado com lançamento", () => {
  // A pergunta só existe dentro de uma antecipação; fora dela o banco é sempre
  // gravado e a linha sempre soma, sem nada a decidir.
  assert.equal(
    antecipadoComLancamento({ adiantamento_id: null, pendente: false, valor_baixado: 400 }),
    false,
  );
});

test("título sem baixa parcial tem o líquido inteiro em aberto", () => {
  assert.equal(saldoEmAberto({ valor: 1000, valorLiquido: 1000, pendente: true }), 1000);
  assert.equal(saldoEmAberto({ valor: 1000, valorLiquido: 1000, valor_baixado: 0 }), 1000);
  assert.equal(saldoEmAberto(null), 0);
});

test("a baixa parcial abate o saldo", () => {
  assert.equal(
    saldoEmAberto({ valor: 1000, valorLiquido: 1000, valor_baixado: 400, pendente: true }),
    600,
  );
  // Coberto por completo não deixa resto, nem negativo.
  assert.equal(
    saldoEmAberto({ valor: 1000, valorLiquido: 1000, valor_baixado: 1000 }),
    0,
  );
  assert.equal(
    saldoEmAberto({ valor: 1000, valorLiquido: 1000, valor_baixado: 1200 }),
    0,
  );
});

test("o saldo é contra o líquido, não contra o bruto", () => {
  // Desconto abate o que a pessoa deve; cobrar o cheio seria cobrar o perdoado.
  assert.equal(
    saldoEmAberto({
      valor: 1000,
      valorLiquido: 900,
      valor_descontos: 100,
      valor_baixado: 400,
      tipo: "RECEITA",
    }),
    500,
  );
});

test("saldo em centavos não sofre com ponto flutuante", () => {
  assert.equal(
    saldoEmAberto({ valor: "1030.10", valorLiquido: "1030.10", valor_baixado: "30.10" }),
    1000,
  );
});

test("só é baixa parcial o título que ainda tem saldo", () => {
  assert.equal(ehBaixaParcial({ valor_baixado: 400, pendente: true }), true);
  // Coberto e fechado deixa de ser parcial: virou um título pago.
  assert.equal(ehBaixaParcial({ valor_baixado: 1000, pendente: false }), false);
  assert.equal(ehBaixaParcial({ valor_baixado: 0, pendente: true }), false);
  assert.equal(ehBaixaParcial(null), false);
});
