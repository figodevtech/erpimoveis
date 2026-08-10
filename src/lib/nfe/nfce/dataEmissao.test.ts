import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { atualizarDataEmissao, formatarDataEmissao } from "./dataEmissao";

// Chave com AAMM = 2608 (agosto/2026).
const CHAVE = "25260812345678000199" + "65" + "001" + "000000001" + "1" + "12345678" + "9";

function xmlCom(dhEmi: string, chave = CHAVE) {
  return (
    `<NFe><infNFe Id="NFe${chave}" versao="4.00">` +
    `<ide><cUF>25</cUF><dhEmi>${dhEmi}</dhEmi><mod>65</mod></ide>` +
    `<total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>` +
    `</infNFe></NFe>`
  );
}

describe("data de emissão da NFC-e", () => {
  it("formata no padrão do leiaute 4.00", () => {
    const formatada = formatarDataEmissao(new Date(2026, 7, 10, 9, 5, 3));
    assert.match(formatada, /^2026-08-10T09:05:03[-+]\d{2}:\d{2}$/);
  });

  it("substitui o dhEmi antigo pelo instante do envio", () => {
    const agora = new Date(2026, 7, 10, 14, 30, 0);
    const resultado = atualizarDataEmissao(xmlCom("2026-08-10T09:00:00-03:00"), agora);

    assert.ok(resultado.includes(`<dhEmi>${formatarDataEmissao(agora)}</dhEmi>`));
    assert.ok(!resultado.includes("2026-08-10T09:00:00-03:00"));
  });

  it("não mexe em nada além do dhEmi", () => {
    const agora = new Date(2026, 7, 10, 14, 30, 0);
    const resultado = atualizarDataEmissao(xmlCom("2026-08-10T09:00:00-03:00"), agora);

    assert.ok(resultado.includes(`Id="NFe${CHAVE}"`));
    assert.ok(resultado.includes("<vNF>10.00</vNF>"));
    assert.ok(resultado.includes("<mod>65</mod>"));
  });

  it("recusa quando a chave é de outro mês, em vez de emitir documento incoerente", () => {
    // Chave de agosto, envio em setembro: o AAMM da chave ficaria mentindo.
    const setembro = new Date(2026, 8, 1, 0, 1, 0);
    assert.throws(
      () => atualizarDataEmissao(xmlCom("2026-08-31T23:59:00-03:00"), setembro),
      /outro mês/i,
    );
  });

  it("explode se não houver dhEmi", () => {
    assert.throws(() => atualizarDataEmissao("<NFe><infNFe></infNFe></NFe>"), /dhEmi/i);
  });
});
