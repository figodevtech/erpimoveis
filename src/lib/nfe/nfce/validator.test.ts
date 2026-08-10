import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validarNfce, type ContextoNfce } from "./validator";
import type { NFeItem } from "../types";

function item(overrides: Partial<NFeItem> = {}): NFeItem {
  return {
    numeroItem: 1,
    codigoProduto: "1",
    descricao: "PECA",
    ncm: "84819090",
    cfop: "5102",
    unidade: "UN",
    quantidade: 1,
    valorUnitario: 100,
    valorTotal: 100,
    ...overrides,
  };
}

function contexto(overrides: Partial<ContextoNfce> = {}): ContextoNfce {
  return {
    uf: "PB",
    ambiente: "HOMOLOGACAO",
    tpEmis: 1,
    indPres: 1,
    finNFe: 1,
    tipoOperacao: "SAIDA",
    consumidor: null,
    itens: [item()],
    totalPago: 100,
    totalDocumento: 100,
    ...overrides,
  };
}

const codigos = (contextoNfce: ContextoNfce) => validarNfce(contextoNfce).map((v) => v.code);

describe("validação da NFC-e", () => {
  it("aceita venda simples sem consumidor identificado", () => {
    assert.deepEqual(validarNfce(contexto()), []);
  });

  it("recusa finalidade diferente de normal", () => {
    assert.ok(codigos(contexto({ finNFe: 4 })).includes("NFCE_FINALIDADE_INVALIDA"));
  });

  it("recusa operação de entrada", () => {
    assert.ok(codigos(contexto({ tipoOperacao: "ENTRADA" })).includes("NFCE_SOMENTE_SAIDA"));
  });

  it("recusa indicador de presença que não descreve venda ao consumidor", () => {
    assert.ok(codigos(contexto({ indPres: 0 })).includes("NFCE_IND_PRES_INVALIDO"));
    assert.ok(codigos(contexto({ indPres: 9 })).includes("NFCE_IND_PRES_INVALIDO"));
    assert.deepEqual(codigos(contexto({ indPres: 4 })), []);
  });

  it("recusa DIFAL: NFC-e é operação interna", () => {
    const comDifal = item({
      icmsUfDest: {
        vBCUFDest: 100,
        pFCPUFDest: 0,
        pICMSUFDest: 18,
        pICMSInter: 12,
        pICMSInterPart: 100,
        vFCPUFDest: 0,
        vICMSUFDest: 6,
        vICMSUFRemet: 0,
      } as NFeItem["icmsUfDest"],
    });
    assert.ok(codigos(contexto({ itens: [comDifal] })).includes("NFCE_DIFAL_NAO_APLICAVEL"));
  });

  it("recusa pagamento menor que o total da nota", () => {
    assert.ok(
      codigos(contexto({ totalPago: 90, totalDocumento: 100 })).includes(
        "NFCE_PAGAMENTO_INSUFICIENTE",
      ),
    );
  });

  it("aceita troco: pagamento maior que o total não é erro", () => {
    assert.deepEqual(codigos(contexto({ totalPago: 100, totalDocumento: 90 })), []);
  });

  it("recusa CPF inválido, mas aceita ausência de documento", () => {
    assert.ok(
      codigos(contexto({ consumidor: { cpf: "11111111111" } })).includes("NFCE_CPF_INVALIDO"),
    );
    assert.deepEqual(codigos(contexto({ consumidor: { cpf: "111.444.777-35" } })), []);
  });

  it("recusa CPF e CNPJ juntos", () => {
    const violacoes = codigos(
      contexto({ consumidor: { cpf: "111.444.777-35", cnpj: "19.131.243/0001-97" } }),
    );
    assert.ok(violacoes.includes("NFCE_DOCUMENTO_DUPLICADO"));
  });
});

describe("regra estadual da Paraíba", () => {
  it("exige CPF ou CNPJ a partir de R$ 500", () => {
    const violacoes = validarNfce(
      contexto({ totalDocumento: 500, totalPago: 500, consumidor: null }),
    );

    const pb = violacoes.find((v) => v.code === "NFCE_PB_CPF_OBRIGATORIO");
    assert.ok(pb, "esperava a violação da regra da PB");
    assert.equal(pb?.rejeicaoEsperada, "750");
  });

  it("libera abaixo de R$ 500 sem identificação", () => {
    assert.deepEqual(
      codigos(contexto({ totalDocumento: 499.99, totalPago: 499.99, consumidor: null })),
      [],
    );
  });

  it("libera acima de R$ 500 com CPF informado", () => {
    assert.deepEqual(
      codigos(
        contexto({
          totalDocumento: 1200,
          totalPago: 1200,
          consumidor: { cpf: "111.444.777-35" },
        }),
      ),
      [],
    );
  });

  it("libera acima de R$ 500 com CNPJ informado", () => {
    assert.deepEqual(
      codigos(
        contexto({
          totalDocumento: 1200,
          totalPago: 1200,
          consumidor: { cnpj: "19.131.243/0001-97" },
        }),
      ),
      [],
    );
  });

  it("não aplica a regra da PB em outra UF", () => {
    assert.deepEqual(
      codigos(contexto({ uf: "PE", totalDocumento: 1200, totalPago: 1200, consumidor: null })),
      [],
    );
  });
});
