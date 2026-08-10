import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  converterParaContingencia,
  horasRestantesParaTransmitir,
  PRAZO_TRANSMISSAO_CONTINGENCIA_HORAS,
  TP_EMIS_CONTINGENCIA,
} from "./contingencia";
import { decomporChaveAcesso } from "../chaveAcesso";

// cUF(25) AAMM(2608) CNPJ(14) mod serie(001) nNF(9) tpEmis cNF(8) dv
function chave(mod: string, tpEmis: string) {
  const base = "25260812345678000199" + mod + "001" + "000000001" + tpEmis + "12345678";
  return base + "9";
}

function xmlCom(mod = "65", tpEmis = "1") {
  return (
    `<NFe><infNFe Id="NFe${chave(mod, tpEmis)}" versao="4.00">` +
    `<ide><cUF>25</cUF><cNF>12345678</cNF><mod>${mod}</mod><serie>1</serie><nNF>1</nNF>` +
    `<dhEmi>2026-08-10T09:00:00-03:00</dhEmi><tpEmis>${tpEmis}</tpEmis><cDV>9</cDV></ide>` +
    `<total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>` +
    `</infNFe></NFe>`
  );
}

const agosto = new Date(2026, 7, 10, 14, 30, 0);

describe("conversão para contingência offline", () => {
  it("troca tpEmis para 9 no XML e na chave de acesso", () => {
    const { xml, chave: nova } = converterParaContingencia(xmlCom(), agosto);

    assert.ok(xml.includes("<tpEmis>9</tpEmis>"));
    // tpEmis é a 35ª posição da chave.
    assert.equal(nova.slice(34, 35), String(TP_EMIS_CONTINGENCIA));
    assert.equal(decomporChaveAcesso(nova).tpEmis, "9");
  });

  it("recalcula o dígito verificador e o Id do infNFe", () => {
    const original = decomporChaveAcesso(chave("65", "1"));
    const { xml, chave: nova, id } = converterParaContingencia(xmlCom(), agosto);

    assert.equal(id, `NFe${nova}`);
    assert.ok(xml.includes(`Id="NFe${nova}"`));
    assert.ok(xml.includes(`<cDV>${nova.slice(43)}</cDV>`));
    // O DV muda porque o tpEmis mudou.
    assert.notEqual(nova.slice(43), original.dv);
  });

  it("congela a data de emissão no instante da emissão offline", () => {
    const { xml, dhEmi } = converterParaContingencia(xmlCom(), agosto);

    assert.match(dhEmi, /^2026-08-10T14:30:00/);
    assert.ok(xml.includes(`<dhEmi>${dhEmi}</dhEmi>`));
    assert.ok(!xml.includes("2026-08-10T09:00:00-03:00"));
  });

  it("preserva número, série e o resto do documento", () => {
    const { xml, chave: nova } = converterParaContingencia(xmlCom(), agosto);
    const partes = decomporChaveAcesso(nova);

    assert.equal(partes.nNF, "000000001");
    assert.equal(partes.serie, "001");
    assert.equal(partes.cNF, "12345678");
    assert.ok(xml.includes("<vNF>10.00</vNF>"));
  });

  it("recusa modelo 55: contingência tpEmis 9 é só da NFC-e", () => {
    assert.throws(() => converterParaContingencia(xmlCom("55", "1"), agosto), /modelo 65/i);
  });

  it("recusa documento que já está em contingência", () => {
    assert.throws(() => converterParaContingencia(xmlCom("65", "9"), agosto), /já está em contingência/i);
  });

  it("recusa quando o rascunho é de outro mês", () => {
    const setembro = new Date(2026, 8, 1, 10, 0, 0);
    assert.throws(() => converterParaContingencia(xmlCom(), setembro), /outro mês/i);
  });
});

describe("prazo de transmissão da contingência", () => {
  const emissao = "2026-08-10T09:00:00-03:00";

  it("conta as horas restantes dentro das 24h", () => {
    const seisHorasDepois = new Date("2026-08-10T15:00:00-03:00");
    assert.equal(horasRestantesParaTransmitir(emissao, seisHorasDepois), 18);
  });

  it("fica negativo quando o prazo estoura", () => {
    const doisDiasDepois = new Date("2026-08-12T09:00:00-03:00");
    assert.ok(horasRestantesParaTransmitir(emissao, doisDiasDepois) < 0);
  });

  it("parte de 24 horas no instante da emissão", () => {
    assert.equal(
      horasRestantesParaTransmitir(emissao, new Date(emissao)),
      PRAZO_TRANSMISSAO_CONTINGENCIA_HORAS,
    );
  });
});
