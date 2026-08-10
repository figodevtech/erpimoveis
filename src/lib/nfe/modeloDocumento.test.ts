import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  exigirModelo,
  isNfce,
  MODELO_NFCE,
  MODELO_NFE,
  modeloParaCodigo,
  modeloParaDb,
  normalizarModelo,
  rotuloModelo,
} from "./modeloDocumento";

describe("modelo do documento fiscal", () => {
  it("lê as três formas que circulam pelo sistema", () => {
    // banco
    assert.equal(normalizarModelo("NFE"), MODELO_NFE);
    assert.equal(normalizarModelo("NFCE"), MODELO_NFCE);
    // XML / chave de acesso
    assert.equal(normalizarModelo("55"), MODELO_NFE);
    assert.equal(normalizarModelo("65"), MODELO_NFCE);
    // número
    assert.equal(normalizarModelo(55), MODELO_NFE);
    assert.equal(normalizarModelo(65), MODELO_NFCE);
  });

  it("aceita variação de caixa e espaço", () => {
    assert.equal(normalizarModelo(" nfce "), MODELO_NFCE);
    assert.equal(normalizarModelo("NfE"), MODELO_NFE);
  });

  it("devolve null para entrada desconhecida em vez de assumir NF-e", () => {
    // Esta é a garantia central: modelo indefinido NUNCA pode virar 55 por
    // omissão, porque emitir o modelo errado é erro fiscal.
    assert.equal(normalizarModelo(""), null);
    assert.equal(normalizarModelo(null), null);
    assert.equal(normalizarModelo(undefined), null);
    assert.equal(normalizarModelo("57"), null);
    assert.equal(normalizarModelo("CTE"), null);
  });

  it("exigirModelo explode em vez de devolver null", () => {
    assert.equal(exigirModelo("NFCE"), MODELO_NFCE);
    assert.throws(() => exigirModelo("57"), /inválido/i);
    assert.throws(() => exigirModelo(null), /inválido/i);
  });

  it("converte para o formato do banco e do XML", () => {
    assert.equal(modeloParaDb(MODELO_NFE), "NFE");
    assert.equal(modeloParaDb(MODELO_NFCE), "NFCE");
    assert.equal(modeloParaCodigo(MODELO_NFE), "55");
    assert.equal(modeloParaCodigo(MODELO_NFCE), "65");
  });

  it("faz ida e volta sem perder informação", () => {
    for (const modelo of [MODELO_NFE, MODELO_NFCE]) {
      assert.equal(normalizarModelo(modeloParaDb(modelo)), modelo);
      assert.equal(normalizarModelo(modeloParaCodigo(modelo)), modelo);
    }
  });

  it("rotula para a tela", () => {
    assert.equal(rotuloModelo(MODELO_NFE), "NF-e");
    assert.equal(rotuloModelo(MODELO_NFCE), "NFC-e");
    assert.equal(isNfce(MODELO_NFCE), true);
    assert.equal(isNfce(MODELO_NFE), false);
  });
});
