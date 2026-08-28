import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { identificarEmitente } from "./identificacao-emitente";
import { lerNFeDoXml } from "./totais-nfe";

function emitenteDoXml(conteudo: string) {
  const { infNFe } = lerNFeDoXml(
    `<nfeProc><NFe><infNFe><emit>${conteudo}</emit></infNFe></NFe></nfeProc>`,
  );
  return identificarEmitente(
    (infNFe?.emit ?? null) as Record<string, unknown> | null,
  );
}

describe("identificarEmitente", () => {
  it("reconhece fornecedor pessoa física pelo CPF do XML", () => {
    assert.deepEqual(emitenteDoXml("<CPF>50867741287</CPF>"), {
      cnpj: null,
      cpf: "50867741287",
      documento: "50867741287",
      tipoDocumento: "CPF",
    });
  });

  it("mantém o reconhecimento existente por CNPJ", () => {
    assert.deepEqual(emitenteDoXml("<CNPJ>12260723000109</CNPJ>"), {
      cnpj: "12260723000109",
      cpf: null,
      documento: "12260723000109",
      tipoDocumento: "CNPJ",
    });
  });

  it("preserva zero à esquerda no documento", () => {
    assert.equal(emitenteDoXml("<CPF>00867741287</CPF>").documento, "00867741287");
  });
});
