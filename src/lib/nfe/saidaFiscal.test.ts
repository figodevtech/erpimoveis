import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getOperacaoFiscalSaida,
  sugerirCfopSaida,
  validarReferenciaFiscalSaida,
} from "./saidaFiscal";

describe("natureza fiscal da saída de estoque", () => {
  it("sugere CFOP de devolução interno e interestadual sem usar o motivo do estoque", () => {
    assert.equal(
      sugerirCfopSaida("DEVOLUCAO_COMPRA_COMERCIALIZACAO", "PB", "PB"),
      "5202",
    );
    assert.equal(
      sugerirCfopSaida("DEVOLUCAO_COMPRA_COMERCIALIZACAO", "PB", "PE"),
      "6202",
    );
  });

  it("mantém devolução e remessa como naturezas fiscais distintas", () => {
    assert.equal(getOperacaoFiscalSaida("DEVOLUCAO_COMPRA_INDUSTRIALIZACAO")?.finalidade, "DEVOLUCAO");
    assert.equal(getOperacaoFiscalSaida("REMESSA_CONSERTO_REPARO")?.finalidade, "NORMAL");
    assert.equal(getOperacaoFiscalSaida("REMESSA_CONSERTO_REPARO")?.exigeDocumentoReferenciado, false);
    assert.equal(getOperacaoFiscalSaida("REMESSA_GARANTIA")?.cfopInterno, "");
  });

  it("exige chave e número do item original em uma devolução", () => {
    const errors = validarReferenciaFiscalSaida({
      finalidade: "DEVOLUCAO",
      exigeDocumentoReferenciado: true,
      chaveAcesso: "123",
      itens: [{ numeroItemReferenciado: null }],
    });
    assert.equal(errors.length, 2);
  });

  it("aceita referência granular completa", () => {
    const errors = validarReferenciaFiscalSaida({
      finalidade: "DEVOLUCAO",
      exigeDocumentoReferenciado: true,
      chaveAcesso: "1".repeat(44),
      itens: [{ numeroItemReferenciado: 2 }],
    });
    assert.deepEqual(errors, []);
  });
});
