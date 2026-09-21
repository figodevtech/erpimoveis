import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTINO_MERCADORIA_OPCOES,
  destinoMercadoriaInicial,
  indFinalDoDestino,
} from "./destinoMercadoria";

test("Venda e OS novas abrem em uso e consumo", () => {
  assert.equal(destinoMercadoriaInicial("VENDA"), "USO_CONSUMO");
  assert.equal(destinoMercadoriaInicial("OS"), "USO_CONSUMO");
  assert.equal(indFinalDoDestino(destinoMercadoriaInicial("VENDA")), 1);
});

test("destino já gravado prevalece sobre o padrão da origem", () => {
  assert.equal(
    destinoMercadoriaInicial("VENDA", "REVENDA_INDUSTRIALIZACAO"),
    "REVENDA_INDUSTRIALIZACAO",
  );
  assert.equal(destinoMercadoriaInicial("OS", "ATIVO_IMOBILIZADO"), "ATIVO_IMOBILIZADO");
});

test("saída de estoque e entrada continuam sem destino presumido", () => {
  assert.equal(destinoMercadoriaInicial("SAIDA"), "");
  assert.equal(destinoMercadoriaInicial("ENTRADA"), "");
});

test("as quatro opções trazem explicação objetiva e o indFinal correspondente", () => {
  assert.deepEqual(
    DESTINO_MERCADORIA_OPCOES.map(({ value, indFinal }) => [value, indFinal]),
    [
      ["REVENDA_INDUSTRIALIZACAO", 0],
      ["USO_CONSUMO", 1],
      ["ATIVO_IMOBILIZADO", 1],
      ["OUTRO", null],
    ],
  );
  for (const opcao of DESTINO_MERCADORIA_OPCOES) {
    assert.ok(opcao.descricao.length >= 40, `${opcao.value} precisa explicar quando usar`);
  }
});
