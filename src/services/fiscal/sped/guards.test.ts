import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { civilDateInTimezone, closedMonthsAffectedByDateChange, isDfeCancelledOrDenied, singleCompanyId } from "./guards";

describe("empresa da competência SPED", () => {
  it("usa a única empresa do banco", () => {
    assert.deepEqual(singleCompanyId([1]), { id: 1 });
    assert.deepEqual(singleCompanyId([3, 3]), { id: 3 });
  });

  it("não escolhe quando não há empresa ou há mais de uma", () => {
    assert.deepEqual(singleCompanyId([]), { error: "NENHUMA" });
    assert.deepEqual(singleCompanyId([1, 2]), { error: "VARIAS" });
  });
});

describe("data fiscal de entrada e competência fechada", () => {
  const closed = new Set(["2026-07"]);

  it("confirmar data em mês aberto passa", () => {
    assert.deepEqual(closedMonthsAffectedByDateChange(null, "2026-08-05", closed), []);
  });

  it("confirmar data que entra em mês fechado bloqueia", () => {
    assert.deepEqual(closedMonthsAffectedByDateChange(null, "2026-07-31", closed), ["2026-07"]);
  });

  it("tirar entrada de mês fechado bloqueia", () => {
    assert.deepEqual(closedMonthsAffectedByDateChange("2026-07-30", "2026-08-01", closed), ["2026-07"]);
  });

  it("mudar o dia dentro do mês fechado bloqueia", () => {
    assert.deepEqual(closedMonthsAffectedByDateChange("2026-07-10", "2026-07-11", closed), ["2026-07"]);
  });

  it("repetir a mesma data não é mudança", () => {
    assert.deepEqual(closedMonthsAffectedByDateChange("2026-07-10", "2026-07-10", closed), []);
  });
});

describe("data civil do lançamento no fuso do estabelecimento", () => {
  it("lançamento à noite em Fortaleza não vira o dia seguinte", () => {
    assert.equal(civilDateInTimezone("2026-08-01T01:30:00Z", "America/Fortaleza"), "2026-07-31");
  });

  it("sem fuso ou instante válido não sugere data", () => {
    assert.equal(civilDateInTimezone("2026-08-01T01:30:00Z", null), null);
    assert.equal(civilDateInTimezone("ontem", "America/Fortaleza"), null);
    assert.equal(civilDateInTimezone("2026-08-01T01:30:00Z", "Lua/Base"), null);
  });
});

it("DF-e cancelado ou denegado pelo código da SEFAZ, não só pelo texto", () => {
  // Resumo (resNFe): cSitNFe 1 autorizada, 2 denegada, 3 cancelada. Ex.: Ekko Parts 141872.
  assert.equal(isDfeCancelledOrDenied({ schema: "resNFe_v1.01.xsd", status: "3" }), true);
  assert.equal(isDfeCancelledOrDenied({ schema: "resNFe_v1.01.xsd", status: "2" }), true);
  assert.equal(isDfeCancelledOrDenied({ schema: "resNFe_v1.01.xsd", status: "1" }), false);
  // Nota completa (procNFe): cStat do protocolo.
  assert.equal(isDfeCancelledOrDenied({ schema: "procNFe_v4.00.xsd", status: "100" }), false);
  assert.equal(isDfeCancelledOrDenied({ schema: "procNFe_v4.00.xsd", status: "101" }), true);
  assert.equal(isDfeCancelledOrDenied({ schema: "procNFe_v4.00.xsd", status: "302" }), true);
  assert.equal(isDfeCancelledOrDenied({ status: "CANCELADA" }), true);
  assert.equal(isDfeCancelledOrDenied(null), false);
});
