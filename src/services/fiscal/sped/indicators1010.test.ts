import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolve1010Indicators } from "./indicators1010";

describe("SPED Fiscal — Registro 1010: Fonte de Verdade Fiscal e Auditoria", () => {
  it("Demir Diesel (PB): GIAF 1, 3 e 4 são N por REGRA_UF com status CONFIRMADO", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: false,
      },
    });

    assert.equal(res.indicators.IND_GIAF1, "N");
    assert.equal(res.indicators.IND_GIAF3, "N");
    assert.equal(res.indicators.IND_GIAF4, "N");

    assert.equal(res.details.IND_GIAF1.origem, "REGRA_UF");
    assert.equal(res.details.IND_GIAF1.status, "CONFIRMADO");
    assert.match(res.details.IND_GIAF1.motivo, /Pernambuco/);
  });

  it("Empresa em Pernambuco (PE): GIAF fica PENDENTE se não houver decisão fiscal cadastrada", () => {
    const res = resolve1010Indicators({
      uf: "PE",
      config: {
        evidencias: {},
      },
    });

    assert.equal(res.details.IND_GIAF1.status, "PENDENTE");
    assert.equal(res.details.IND_GIAF3.status, "PENDENTE");
    assert.equal(res.details.IND_GIAF4.status, "PENDENTE");
  });

  it("IND_VA respeita a aplicabilidade e confirmação do Registro 1400", () => {
    // 1. Confirmado aplicável -> S
    const resS = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: true,
      },
    });
    assert.equal(resS.indicators.IND_VA, "S");
    assert.equal(resS.details.IND_VA.status, "CONFIRMADO");

    // 2. Confirmado inaplicável -> N
    const resN = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
      },
    });
    assert.equal(resN.indicators.IND_VA, "N");
    assert.equal(resN.details.IND_VA.status, "CONFIRMADO");

    // 3. Pendente -> status PENDENTE
    const resPend = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "PENDENTE",
        registro_1400_aplicavel: false,
      },
    });
    assert.equal(resPend.details.IND_VA.status, "PENDENTE");
  });

  it("IND_CART reflete existência real de operações eletrônicas ou gate 1601", () => {
    // 1. Movimento detectado (mesmo sem gate fechado) -> S
    const resMov = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1601_status: "PENDENTE",
      },
      hasElectronicPayments: true,
    });
    assert.equal(resMov.indicators.IND_CART, "S");
    assert.equal(resMov.details.IND_CART.origem, "FONTES_MOVIMENTO");
    assert.equal(resMov.details.IND_CART.status, "CONFIRMADO");

    // 2. Confirmado aplicável -> S
    const resConf = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: true,
      },
    });
    assert.equal(resConf.indicators.IND_CART, "S");
    assert.equal(resConf.details.IND_CART.status, "CONFIRMADO");

    // 3. Confirmado inaplicável e sem pagamentos -> N
    const resInap = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
      },
      hasElectronicPayments: false,
    });
    assert.equal(resInap.indicators.IND_CART, "N");
    assert.equal(resInap.details.IND_CART.status, "CONFIRMADO");
  });

  it("IND_REST_RESSARC_COMPL_ICMS respeita o gate C176/C179", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: true,
      },
    });
    assert.equal(res.indicators.IND_REST_RESSARC_COMPL_ICMS, "S");
    assert.equal(res.details.IND_REST_RESSARC_COMPL_ICMS.status, "CONFIRMADO");
  });

  it("Indicadores setoriais sem confirmação geram diagnóstico de bloqueio para fechamento", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        evidencias: {}, // sem confirmações setoriais
      },
    });

    assert.ok(res.diagnostics.length > 0);
    assert.equal(res.diagnostics[0].code, "INDICADORES_1010_PENDENTES");
    assert.equal(res.diagnostics[0].severity, "BLOQUEIO");
  });

  it("Indicadores setoriais confirmados pelo contador não geram pendências", () => {
    const res = resolve1010Indicators({
      uf: "PB",
      config: {
        registro_1400_status: "CONFIRMADO",
        registro_1400_aplicavel: false,
        registro_1601_status: "CONFIRMADO",
        registro_1601_aplicavel: false,
        c176_c179_status: "CONFIRMADO",
        c176_c179_aplicavel: false,
        evidencias: {
          indicadores_1010: {
            IND_EXP: "N",
            IND_CCRF: "N",
            IND_COMB: "N",
            IND_USINA: "N",
            IND_EE: "N",
            IND_FORM: "N",
            IND_AER: "N",
          },
        },
      },
    });

    assert.equal(res.diagnostics.length, 0);
    assert.equal(res.indicators.IND_EXP, "N");
    assert.equal(res.indicators.IND_COMB, "N");
    assert.equal(res.details.IND_EXP.status, "CONFIRMADO");
  });
});
