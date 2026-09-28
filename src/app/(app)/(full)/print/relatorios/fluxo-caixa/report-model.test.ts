import assert from "node:assert/strict";
import test from "node:test";

import {
  agruparPorBanco,
  filtroDeSituacao,
  paginarAgrupado,
  saldosDoBanco,
  totalizarFluxo,
  valorDaLinha,
  type LinhaDoFluxo,
  type MovimentoDoBanco,
} from "./report-model";

function linha(valores: Partial<LinhaDoFluxo>): LinhaDoFluxo {
  return {
    tipo: "RECEITA",
    pendente: false,
    banco_id: 1,
    valor: 100,
    valorLiquido: null,
    valor_descontos: null,
    valor_baixado: null,
    baixa_de_transacao_id: null,
    adiantamento_id: null,
    ...valores,
  };
}

test("entradas e saídas somam só o que passou por conta, pelo líquido", () => {
  const totais = totalizarFluxo([
    linha({ valor: 100, valorLiquido: 95 }), // cartão: entra o líquido
    linha({ tipo: "DEPOSITO", valor: 40 }),
    linha({ valor: 300, banco_id: null }), // quitado por antecipação
    linha({ tipo: "DESPESA", valor: 80 }),
    linha({ tipo: "SAQUE", valor: 20 }),
    linha({ tipo: "RECEITA", valor: 500, pendente: true }), // título: fica no em aberto
  ]);

  assert.equal(totais.entradas, 135);
  assert.equal(totais.saidas, 100);
  assert.equal(totais.saldo, 35);
});

test("título pago em partes: a baixa entra no realizado e o título só pelo que falta", () => {
  const titulo = linha({ id: 1, valor: 1000, pendente: true, valor_baixado: 400 } as Partial<LinhaDoFluxo>);
  const baixa = linha({ valor: 400, baixa_de_transacao_id: 1 });

  assert.equal(valorDaLinha(titulo), 600);
  const totais = totalizarFluxo([titulo, baixa]);
  assert.equal(totais.entradas, 400);
  assert.equal(totais.aReceber, 600);
});

test("em aberto separa receber de pagar e ignora título antecipado", () => {
  const totais = totalizarFluxo([
    linha({ valor: 200, pendente: true }),
    linha({ valor: 900, pendente: true, adiantamento_id: 7 }),
    linha({ tipo: "DESPESA", valor: 150, pendente: true }),
  ]);

  assert.equal(totais.aReceber, 200);
  assert.equal(totais.aPagar, 150);
  assert.equal(totais.entradas, 0);
  assert.equal(totais.saidas, 0);
});

test("despesa ignora líquido sem desconto lançado, como o dashboard", () => {
  assert.equal(totalizarFluxo([linha({ tipo: "DESPESA", valor: 80, valorLiquido: 1 })]).saidas, 80);
});

test("a situação do diálogo vira o mesmo recorte da lista", () => {
  assert.equal(filtroDeSituacao("false"), "and(pendente.eq.false,banco_id.not.is.null)");
  assert.equal(filtroDeSituacao("true"), "and(pendente.eq.true,baixa_de_transacao_id.is.null)");
  assert.equal(
    filtroDeSituacao(undefined),
    "and(pendente.eq.false,banco_id.not.is.null),and(pendente.eq.true,baixa_de_transacao_id.is.null)",
  );
});

function movimento(id: number, tipo: string, valor: number, valorLiquido: number | null = null): MovimentoDoBanco {
  return { id, tipo, valor, valorLiquido, valor_descontos: null };
}

function lancamento(id: number, valores: Partial<LinhaDoFluxo>) {
  return { ...linha(valores), id };
}

test("o saldo do banco acumula pelo mesmo valor da coluna, a partir do valor inicial", () => {
  const saldos = saldosDoBanco(1000, [
    movimento(1, "RECEITA", 100, 95), // cartão: entra o líquido
    movimento(2, "DESPESA", 80, 1), // líquido sem desconto lançado não vale
    movimento(3, "SAQUE", 15.1),
  ]);

  assert.equal(saldos.get(1), 1095);
  assert.equal(saldos.get(2), 1015);
  assert.equal(saldos.get(3), 999.9);
});

test("agrupado por banco, o saldo anterior sai da história da conta, e não do recorte", () => {
  // O movimento 10 é anterior ao período e não está na folha, mas o saldo o conhece.
  const saldos = new Map([
    [1, saldosDoBanco(500, [movimento(10, "RECEITA", 200), movimento(11, "DESPESA", 50), movimento(12, "RECEITA", 30)])],
    [2, saldosDoBanco(0, [movimento(20, "DEPOSITO", 70)])],
  ]);
  const contas = new Map([
    [1, { titulo: "Caixa" }],
    [2, { titulo: "Banco do Brasil" }],
  ]);

  const grupos = agruparPorBanco(
    [
      lancamento(11, { tipo: "DESPESA", valor: 50, banco_id: 1 }),
      lancamento(20, { tipo: "DEPOSITO", valor: 70, banco_id: 2 }),
      lancamento(12, { valor: 30, banco_id: 1 }),
      lancamento(30, { valor: 400, pendente: true, banco_id: null }),
    ],
    contas,
    saldos,
  );

  assert.deepEqual(grupos.map((grupo) => grupo.titulo), ["Banco do Brasil", "Caixa", "Sem banco"]);

  const caixa = grupos[1];
  assert.equal(caixa.saldoAnterior, 700);
  assert.deepEqual(caixa.linhas.map((item) => item.saldoApos), [650, 680]);
  assert.equal(caixa.saldoFinal, 680);
  assert.equal(caixa.totais.entradas, 30);
  assert.equal(caixa.totais.saidas, 50);

  // Título em aberto não mexeu no dinheiro: sem saldo nenhum.
  const semBanco = grupos[2];
  assert.equal(semBanco.saldoAnterior, null);
  assert.deepEqual(semBanco.linhas.map((item) => item.saldoApos), [null]);
});

test("folha agrupada: não passa da capacidade, não abre conta no pé e continua crua na virada", () => {
  const saldos = new Map([[1, saldosDoBanco(0, Array.from({ length: 9 }, (_, i) => movimento(i + 1, "RECEITA", 10)))]]);
  const grupos = agruparPorBanco(
    [
      ...Array.from({ length: 9 }, (_, i) => lancamento(i + 1, { valor: 10, banco_id: 1 })),
      lancamento(99, { valor: 5, pendente: true, banco_id: null }),
    ],
    new Map([[1, { titulo: "Caixa" }]]),
    saldos,
  );
  const folhas = paginarAgrupado(grupos, 5, 6);

  folhas.forEach((folha, indice) => {
    assert.ok(folha.length <= (indice === 0 ? 5 : 6), `folha ${indice + 1} passou da capacidade`);
    assert.ok(!["banco", "espaco"].includes(folha.at(-1)?.tipo ?? ""), `folha ${indice + 1} abriu uma conta no pé`);
    assert.notEqual(folha[0]?.tipo, "espaco", `folha ${indice + 1} começou com um respiro`);
  });

  const itens = folhas.flat();
  assert.deepEqual(
    itens.flatMap((item) => (item.tipo === "linha" ? [item.linha.id] : [])),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 99],
  );
  assert.equal(itens.filter((item) => item.tipo === "subtotal").length, 2);

  // A Caixa atravessa a virada e a segunda folha começa direto nas linhas.
  assert.equal(folhas[1][0].tipo, "linha");
  assert.equal(itens.filter((item) => item.tipo === "banco").length, grupos.length, "um cabeçalho por conta");

  // Na mesma folha, uma conta fica separada da seguinte por um respiro.
  assert.deepEqual(
    paginarAgrupado(grupos, 30, 30)[0].map((item) => item.tipo),
    ["banco", ...Array<string>(9).fill("linha"), "subtotal", "espaco", "banco", "linha", "subtotal"],
  );
});

test("folha agrupada reserva a altura das descrições antes da virada", () => {
  const grupos = agruparPorBanco(
    [1, 2, 3].map((id) => lancamento(id, { banco_id: 1 })),
    new Map([[1, { titulo: "Caixa" }]]),
    new Map(),
  );
  const folhas = paginarAgrupado(
    grupos,
    30,
    30,
    (item) => item.tipo === "linha" ? 12 : 9,
  );

  assert.deepEqual(folhas.map((folha) => folha.map((item) => item.tipo)), [
    ["banco", "linha"],
    ["linha", "linha"],
    ["subtotal"],
  ]);
  assert.deepEqual(
    folhas.flatMap((folha) => folha.flatMap((item) => item.tipo === "linha" ? [item.linha.id] : [])),
    [1, 2, 3],
  );
  assert.ok(folhas.every((folha) => folha.reduce((height, item) => height + (item.tipo === "linha" ? 12 : 9), 0) <= 30));
});
