import test from "node:test";
import assert from "node:assert/strict";

import {
  aplicarRecorteDeAutoria,
  decidirRecorte,
  expressaoDeAutoria,
  leApenasMinhas,
} from "./autoria-regra";

const EU = "11111111-1111-1111-1111-111111111111";

test("sem a permissao o recorte e forcado, com ou sem o parametro", () => {
  assert.deepEqual(decidirRecorte(false, false, EU), { restrito: true, usuarioId: EU });
  assert.deepEqual(decidirRecorte(false, true, EU), { restrito: true, usuarioId: EU });
});

test("com a permissao o recorte so existe se a pessoa pediu", () => {
  assert.deepEqual(decidirRecorte(true, false, EU), { restrito: false, usuarioId: null });
  assert.deepEqual(decidirRecorte(true, true, EU), { restrito: true, usuarioId: EU });
});

test("o que nao tem dono continua visivel para quem esta recortado", () => {
  const expressao = expressaoDeAutoria(EU);
  assert.ok(expressao.includes(`created_by.eq.${EU}`));
  assert.ok(expressao.includes("created_by.is.null"));
});

test("sessao sem id fecha em vez de abrir", () => {
  assert.equal(expressaoDeAutoria(null), "created_by.is.null");
});

test("apenasMinhas aceita as formas que o axios e o fetch produzem", () => {
  for (const valor of ["1", "true", "TRUE", " true "]) {
    assert.equal(leApenasMinhas(valor), true, `deveria aceitar ${JSON.stringify(valor)}`);
  }
  for (const valor of [null, "", "0", "false", "sim"]) {
    assert.equal(leApenasMinhas(valor), false, `deveria recusar ${JSON.stringify(valor)}`);
  }
});

test("consulta sem recorte passa intacta; com recorte ganha um or()", () => {
  const chamadas: string[] = [];
  const consulta = { or: (v: string) => { chamadas.push(v); return consulta; } };

  assert.equal(aplicarRecorteDeAutoria(consulta, { restrito: false, usuarioId: null }), consulta);
  assert.deepEqual(chamadas, []);

  aplicarRecorteDeAutoria(consulta, { restrito: true, usuarioId: EU });
  assert.deepEqual(chamadas, [`created_by.eq.${EU},created_by.is.null`]);
});
