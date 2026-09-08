import assert from "node:assert/strict";
import test from "node:test";

import { metodoCompativel, sugerirMetodoPagamento } from "./payment-method";

const METODOS = [
  "PIX",
  "CREDITO",
  "DEBITO",
  "BOLETO",
  "TRANSFERENCIA",
  "TED",
  "DOC",
  "DINHEIRO",
  "DEBITO AUTOMATICO",
  "CHEQUE",
];

const como = (memo: string) => ({ tipoOfx: "DEBIT", nome: null, memo });

test("reconhece as formas escritas pelo banco", () => {
  assert.equal(sugerirMetodoPagamento(como("DEB PIX ENVIADO"), METODOS), "PIX");
  assert.equal(sugerirMetodoPagamento(como("CRED PIX RECEBIDO"), METODOS), "PIX");
  assert.equal(sugerirMetodoPagamento(como("PAGAMENTO DE BOLETO"), METODOS), "BOLETO");
  assert.equal(sugerirMetodoPagamento(como("TED ENVIADA"), METODOS), "TED");
  assert.equal(sugerirMetodoPagamento(como("DOC RECEBIDO"), METODOS), "DOC");
  assert.equal(sugerirMetodoPagamento(como("TRANSFERENCIA ENTRE CONTAS"), METODOS), "TRANSFERENCIA");
});

test("tarifa, IOF, juros e conta de água não viram cartão de débito", () => {
  // Todos são débitos no extrato, e é justamente por isso que a tradução
  // ingênua "débito -> DEBITO" estragaria o cadastro.
  for (const memo of [
    "TARIFA BANCARIA",
    "DEBITO DE IOF",
    "COBRANCA DE JUROS",
    "PAGAMENTO AGUA CAGEPA",
    "DEBITO AUTOMATICO ENERGISA",
  ]) {
    assert.equal(sugerirMetodoPagamento(como(memo), METODOS), "DEBITO AUTOMATICO", memo);
  }
});

test("não inventa método que não existe no banco desta empresa", () => {
  const semDebitoAutomatico = METODOS.filter((metodo) => metodo !== "DEBITO AUTOMATICO");
  assert.equal(sugerirMetodoPagamento(como("TARIFA BANCARIA"), semDebitoAutomatico), null);
});

test("texto que não diz nada não vira sugestão", () => {
  assert.equal(sugerirMetodoPagamento(como("LANCAMENTO 4471"), METODOS), null);
  assert.equal(sugerirMetodoPagamento(como(""), METODOS), null);
});

test("acento e caixa não atrapalham", () => {
  assert.equal(sugerirMetodoPagamento(como("pagamento de bolêto"), METODOS), "BOLETO");
});

test("compatibilidade de método é ingrediente de score, não filtro", () => {
  assert.equal(metodoCompativel(como("PAGAMENTO DE BOLETO"), "BOLETO"), true);
  assert.equal(metodoCompativel(como("PAGAMENTO DE BOLETO"), "PIX"), false);
  assert.equal(metodoCompativel(como("DEB PIX ENVIADO"), null), false);
});
