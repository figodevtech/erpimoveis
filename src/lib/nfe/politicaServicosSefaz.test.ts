import assert from "node:assert/strict";
import test from "node:test";
import { dataServicoSefaz, motivoInutilizacaoDesativada } from "./politicaServicosSefaz";

test("desativação de inutilização tem UF, modelo, ambiente e data próprios", () => {
  for (const modelo of [55, 65] as const) for (const ambiente of ["PRODUCAO", "HOMOLOGACAO"] as const) {
    for (const uf of ["AC", "BA", "SP"]) {
      assert.equal(motivoInutilizacaoDesativada({ uf, modelo, ambiente, data: "2026-11-10" }), null);
      assert.match(motivoInutilizacaoDesativada({ uf, modelo, ambiente, data: "2026-11-11" })!, /I01a/);
    }
    for (const uf of ["PB", "PE", "RS"]) {
      assert.equal(motivoInutilizacaoDesativada({ uf, modelo, ambiente, data: "2027-04-05" }), null);
    }
  }
});

test("data de solicitação respeita o fuso da UF e não o UTC do servidor", () => {
  const instante = new Date("2026-11-11T03:30:00Z");
  assert.equal(dataServicoSefaz("SP", instante), "2026-11-11");
  assert.equal(dataServicoSefaz("AC", instante), "2026-11-10");
});
