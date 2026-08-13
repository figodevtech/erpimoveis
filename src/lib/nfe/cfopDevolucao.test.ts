// O CFOP da devolução vem da operação de compra, não do rótulo da natureza.
//
// Caso real que motivou o módulo: a NF-e 744330 trouxe uma bomba d'água com
// CFOP 5.405 e CST 60 — venda com ST na condição de contribuinte substituído. A
// devolução saiu com 5.202 ("devolução de compra para comercialização") quando
// o correto era 5.411, porque a mercadoria tinha ICMS retido.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compraTeveSubstituicaoTributaria,
  destinoDaCompraPorOperacao,
  sugerirCfopDevolucaoDeCompra,
} from "./cfopDevolucao";

describe("substituição tributária na compra de origem", () => {
  it("reconhece pelo CST do fornecedor do regime normal", () => {
    assert.equal(compraTeveSubstituicaoTributaria({ cst: "60" }), true);
    assert.equal(compraTeveSubstituicaoTributaria({ cst: "10" }), true);
    assert.equal(compraTeveSubstituicaoTributaria({ cst: "00" }), false);
    assert.equal(compraTeveSubstituicaoTributaria({ cst: "40" }), false);
  });

  it("reconhece pelo CSOSN quando o fornecedor é do Simples", () => {
    assert.equal(compraTeveSubstituicaoTributaria({ csosn: "500" }), true);
    assert.equal(compraTeveSubstituicaoTributaria({ csosn: "202" }), true);
    assert.equal(compraTeveSubstituicaoTributaria({ csosn: "102" }), false);
  });

  it("cai para o CFOP quando o grupo de ICMS não é reconhecível", () => {
    assert.equal(compraTeveSubstituicaoTributaria({ cfop: "5405" }), true);
    assert.equal(compraTeveSubstituicaoTributaria({ cfop: "1403" }), true);
    assert.equal(compraTeveSubstituicaoTributaria({ cfop: "5102" }), false);
    assert.equal(compraTeveSubstituicaoTributaria({ cfop: "1102" }), false);
  });

  it("não confunde CST de dois dígitos com CSOSN de três", () => {
    // "202" é CSOSN com ST, mas como CST não existe — não pode virar ST por
    // acidente quando o campo chega no lugar errado.
    assert.equal(compraTeveSubstituicaoTributaria({ cst: "202" }), false);
  });
});

describe("CFOP de devolução de compra", () => {
  it("reproduz a NF-e 744330: CFOP 5.405 e CST 60 devolvem com 5.411", () => {
    const sugerido = sugerirCfopDevolucaoDeCompra(
      { cfop: "5405", cst: "60" },
      "COMERCIALIZACAO",
      "PB",
      "PB",
    );

    assert.equal(sugerido?.cfop, "5411");
    assert.equal(sugerido?.comSubstituicaoTributaria, true);
    assert.equal(
      sugerido?.descricao,
      "Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária",
    );
  });

  it("mantém 5.202 na compra comum para comercialização", () => {
    const sugerido = sugerirCfopDevolucaoDeCompra(
      { cfop: "5102", cst: "00" },
      "COMERCIALIZACAO",
      "PB",
      "PB",
    );

    assert.equal(sugerido?.cfop, "5202");
    assert.equal(sugerido?.comSubstituicaoTributaria, false);
  });

  it("usa o prefixo 6 quando a devolução é interestadual", () => {
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "60" }, "COMERCIALIZACAO", "PB", "SP")?.cfop,
      "6411",
    );
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "00" }, "COMERCIALIZACAO", "PB", "SP")?.cfop,
      "6202",
    );
  });

  it("separa industrialização, uso e consumo e ativo imobilizado", () => {
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "00" }, "INDUSTRIALIZACAO", "PB", "PB")?.cfop,
      "5201",
    );
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "60" }, "INDUSTRIALIZACAO", "PB", "PB")?.cfop,
      "5410",
    );
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "00" }, "USO_CONSUMO", "PB", "PB")?.cfop,
      "5556",
    );
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "60" }, "USO_CONSUMO", "PB", "PB")?.cfop,
      "5413",
    );
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "00" }, "ATIVO_IMOBILIZADO", "PB", "PB")?.cfop,
      "5553",
    );
    assert.equal(
      sugerirCfopDevolucaoDeCompra({ cst: "60" }, "ATIVO_IMOBILIZADO", "PB", "PB")?.cfop,
      "5412",
    );
  });
});

describe("destino da compra pela natureza escolhida", () => {
  it("traduz as naturezas de devolução do cadastro", () => {
    assert.equal(destinoDaCompraPorOperacao("DEVOLUCAO_COMPRA_COMERCIALIZACAO"), "COMERCIALIZACAO");
    assert.equal(destinoDaCompraPorOperacao("DEVOLUCAO_COMPRA_INDUSTRIALIZACAO"), "INDUSTRIALIZACAO");
  });

  it("devolve nulo para natureza que não é devolução de compra", () => {
    // Remessa e retorno não têm CFOP de devolução a sugerir: vale o da natureza.
    assert.equal(destinoDaCompraPorOperacao("REMESSA_CONSERTO_REPARO"), null);
    assert.equal(destinoDaCompraPorOperacao("OUTRA"), null);
    assert.equal(destinoDaCompraPorOperacao(null), null);
  });
});
