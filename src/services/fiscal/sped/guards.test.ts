import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { closedMonthsAffectedByDateChange, singleCompanyId } from "./guards";

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
