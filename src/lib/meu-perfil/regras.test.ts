import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePeriodo,
  STATUS_OS_FINALIZADAS,
  STATUS_VENDAS_REALIZADAS,
} from "./regras";

test("mantem somente os status definidos para OS e vendas realizadas", () => {
  assert.deepEqual(STATUS_OS_FINALIZADAS, ["PAGAMENTO", "CONCLUIDO"]);
  assert.deepEqual(STATUS_VENDAS_REALIZADAS, ["PAGAMENTO", "FINALIZADA"]);
});

test("interpreta o periodo no fuso de Fortaleza e usa fim exclusivo", () => {
  const params = new URLSearchParams({ de: "2026-08-01", ate: "2026-08-20" });

  assert.deepEqual(parsePeriodo(params), {
    inicio: "2026-08-01T00:00:00.000-03:00",
    fimExclusivo: "2026-08-21T00:00:00.000-03:00",
  });
});

test("avanca corretamente o fim do periodo entre meses e anos", () => {
  assert.equal(
    parsePeriodo(new URLSearchParams({ ate: "2026-08-31" })).fimExclusivo,
    "2026-09-01T00:00:00.000-03:00",
  );
  assert.equal(
    parsePeriodo(new URLSearchParams({ ate: "2026-12-31" })).fimExclusivo,
    "2027-01-01T00:00:00.000-03:00",
  );
});

test("ignora datas ausentes, malformadas ou impossiveis", () => {
  assert.deepEqual(parsePeriodo(new URLSearchParams()), { inicio: null, fimExclusivo: null });
  assert.deepEqual(parsePeriodo(new URLSearchParams({ de: "2026-02-30", ate: "20/08/2026" })), {
    inicio: null,
    fimExclusivo: null,
  });
});

