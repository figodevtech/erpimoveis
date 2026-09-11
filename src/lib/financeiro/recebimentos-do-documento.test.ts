import test from "node:test";
import assert from "node:assert/strict";

import { somarRecebimentosDeFace } from "./recebimentos-do-documento";

test("soma dos recebimentos de um documento", async (t) => {
  await t.test("pagamento com juros abate só a face", () => {
    // R$ 1.030,00 cobrados, dos quais R$ 30,00 são juros do atraso: o que abate
    // a venda são os R$ 1.000,00 de face.
    assert.equal(
      somarRecebimentosDeFace([{ valor: 1030, valor_acrescimos: 30 }]),
      100000,
    );
  });

  await t.test("sem acréscimo, a face é o próprio bruto", () => {
    assert.equal(somarRecebimentosDeFace([{ valor: 1000 }]), 100000);
    assert.equal(
      somarRecebimentosDeFace([{ valor: 1000, valor_acrescimos: null }]),
      100000,
    );
  });

  await t.test("acréscimo negativo é lixo de registro antigo e não vira desconto", () => {
    assert.equal(
      somarRecebimentosDeFace([{ valor: 1000, valor_acrescimos: -50 }]),
      100000,
    );
  });

  await t.test("soma em centavos não escorrega no ponto flutuante", () => {
    // 1030.10 - 30.10 dá 999.9999999999999 em float; em centavos dá 1000.
    assert.equal(
      somarRecebimentosDeFace([
        { valor: 1030.1, valor_acrescimos: 30.1 },
        { valor: 0.1 },
        { valor: 0.2 },
      ]),
      100030,
    );
  });

  await t.test("valores em texto, como vêm do PostgREST", () => {
    assert.equal(
      somarRecebimentosDeFace([{ valor: "1030.00", valor_acrescimos: "30.00" }]),
      100000,
    );
  });

  await t.test("lista vazia e ausente valem zero", () => {
    assert.equal(somarRecebimentosDeFace([]), 0);
    assert.equal(somarRecebimentosDeFace(null), 0);
    assert.equal(somarRecebimentosDeFace(undefined), 0);
  });
});
