import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getOperacaoFiscalSaida,
  montarReferenciasFiscaisSaida,
  normalizarNumeroItemReferenciado,
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

describe("nItem da nota de origem", () => {
  it("prefere o nItem canônico da linha de entrada ao valor salvo na saída", () => {
    assert.equal(normalizarNumeroItemReferenciado(2, 1), 2);
  });

  it("mantém o valor informado para entradas antigas ainda sem reconciliação", () => {
    assert.equal(normalizarNumeroItemReferenciado(null, 3), 3);
  });

  it("rejeita números ausentes ou fora do limite do leiaute da NF-e", () => {
    assert.equal(normalizarNumeroItemReferenciado(null, null), null);
    assert.equal(normalizarNumeroItemReferenciado(null, 0), null);
    assert.equal(normalizarNumeroItemReferenciado(null, 991), null);
  });
});

describe("referência de cabeçalho da NF-e de saída", () => {
  const chave = "1".repeat(44);

  it("cita a nota de origem no NFref de uma devolução", () => {
    assert.deepEqual(
      montarReferenciasFiscaisSaida({
        finalidade: "DEVOLUCAO",
        exigeDocumentoReferenciado: false,
        chaveAcesso: chave,
      }),
      [{ chaveAcesso: chave }],
    );
  });

  it("cita a origem em operação que exige documento mesmo fora da devolução", () => {
    assert.deepEqual(
      montarReferenciasFiscaisSaida({
        finalidade: "NORMAL",
        exigeDocumentoReferenciado: true,
        chaveAcesso: chave,
      }),
      [{ chaveAcesso: chave }],
    );
  });

  it("limpa a máscara da chave digitada", () => {
    const mascarada = chave.replace(/(\d{4})/g, "$1 ");
    assert.deepEqual(
      montarReferenciasFiscaisSaida({
        finalidade: "DEVOLUCAO",
        exigeDocumentoReferenciado: true,
        chaveAcesso: mascarada,
      }),
      [{ chaveAcesso: chave }],
    );
  });

  it("não cita nada numa remessa que dispensa documento de origem", () => {
    assert.deepEqual(
      montarReferenciasFiscaisSaida({
        finalidade: "NORMAL",
        exigeDocumentoReferenciado: false,
        chaveAcesso: chave,
      }),
      [],
    );
  });

  it("não inventa referência com chave incompleta", () => {
    assert.deepEqual(
      montarReferenciasFiscaisSaida({
        finalidade: "DEVOLUCAO",
        exigeDocumentoReferenciado: true,
        chaveAcesso: "123",
      }),
      [],
    );
  });
});

describe("níveis de referenciamento são excludentes", () => {
  const chave = "1".repeat(44);

  it("não cita a origem no cabeçalho quando os itens já citam", () => {
    // Rejeição 1010: NFref no <ide> junto com DFeReferenciado no item derruba a
    // nota. O nível de item é o mais específico e é o exigido em devolução a
    // partir de 01/09/2026, então é ele que fica.
    assert.deepEqual(
      montarReferenciasFiscaisSaida({
        finalidade: "DEVOLUCAO",
        exigeDocumentoReferenciado: true,
        chaveAcesso: chave,
        temReferenciaPorItem: true,
      }),
      [],
    );
  });

  it("usa o cabeçalho quando nenhum item referencia a origem", () => {
    assert.deepEqual(
      montarReferenciasFiscaisSaida({
        finalidade: "DEVOLUCAO",
        exigeDocumentoReferenciado: true,
        chaveAcesso: chave,
        temReferenciaPorItem: false,
      }),
      [{ chaveAcesso: chave }],
    );
  });
});
