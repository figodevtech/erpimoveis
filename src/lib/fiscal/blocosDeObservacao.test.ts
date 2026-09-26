import assert from "node:assert/strict";
import test from "node:test";

import { blocoDaNotaFiscalReferencia, blocoDasNotasFiscaisReferencia, concatenarBloco } from "./blocosDeObservacao";

const chave = "25260912345678000199550010000123451000000019";

test("formata somente os campos reais da NF-e de referência", () => {
  assert.equal(blocoDaNotaFiscalReferencia({
    chaveAcesso: chave, numeroNota: "12345", serieNota: "1",
    dataEmissao: "2026-09-25T10:00:00-03:00", fornecedor: "EMPRESA X",
  }), `NF-e de referência: nº 12345; série 1; emissão 25/09/2026; fornecedor EMPRESA X; chave ${chave}`);
  const parcial = blocoDaNotaFiscalReferencia({ chaveAcesso: chave, numeroNota: null, fornecedor: undefined });
  assert.equal(parcial, `NF-e de referência: chave ${chave}`);
  assert.doesNotMatch(parcial, /undefined|null|;;/);
  assert.match(blocoDaNotaFiscalReferencia({
    chaveAcesso: chave, dataEmissao: "2026-09-26T01:30:00Z",
  }), /emissão 25\/09\/2026/);
});

test("não oferece bloco sem documento e deduplica pela chave", () => {
  assert.equal(blocoDaNotaFiscalReferencia(null), "");
  assert.equal(blocoDasNotasFiscaisReferencia([{ numeroNota: "12345" }]), null);
  const outraChave = `3${chave.slice(1)}`;
  const bloco = blocoDasNotasFiscaisReferencia([
    { chaveAcesso: chave, numeroNota: "12345" },
    { chaveAcesso: chave, numeroNota: "12345" },
    { chaveAcesso: outraChave, numeroNota: "67890" },
  ]);
  assert.equal(bloco?.rotulo, "Dados da NF-e de referência");
  assert.equal(bloco?.texto.split("\n").length, 2);
  assert.equal(bloco?.texto.match(new RegExp(chave, "g"))?.length, 1);
});

test("botão acrescenta somente texto às observações, respeitando o limite", () => {
  const bloco = blocoDasNotasFiscaisReferencia([{ chaveAcesso: chave }]);
  assert.ok(bloco);
  const resultado = concatenarBloco("Observação anterior", bloco.texto, 500);
  assert.equal(resultado.texto, `Observação anterior\nNF-e de referência: chave ${chave}`);
  assert.equal(resultado.truncado, false);
});

test("concatena em nova linha sem alterar o texto existente", () => {
  assert.deepEqual(concatenarBloco("Observação", "Garantia: 90 dias", 500), {
    texto: "Observação\nGarantia: 90 dias",
    truncado: false,
  });
});

test("preserva o conteúdo integral quando ultrapassa o limite", () => {
  const base = "x".repeat(495);
  const resultado = concatenarBloco(base, "Garantia: 90 dias", 500);
  assert.equal(resultado.texto, `${base}\nGarantia: 90 dias`);
  assert.equal(resultado.truncado, true);
});
