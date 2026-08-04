import assert from "node:assert/strict";
import test from "node:test";

import {
  origemDaTransacao,
  tipoEhEditavel,
  tipoTemValorLiquido,
  valorLiquidoEfetivo,
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
