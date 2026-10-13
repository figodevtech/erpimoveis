import assert from "node:assert/strict";
import test from "node:test";

import {
  datasAoReiniciar,
  diasRestantes,
  filtroDaAba,
  hojeAluguel,
  politicaAluguel,
  rotuloDias,
  statusExibicao,
} from "./status";

const HOJE = "2026-10-13";

test("hoje é o dia de Fortaleza, não o do UTC", () => {
  // 01:30 UTC do dia 14 ainda é 22:30 do dia 13 em Fortaleza.
  assert.equal(hojeAluguel(new Date("2026-10-14T01:30:00Z")), "2026-10-13");
  assert.equal(hojeAluguel(new Date("2026-10-14T03:30:00Z")), "2026-10-14");
});

test("status de exibição sai das datas", () => {
  const base = { status: "ATIVO" as const, data_inicio: "2026-10-10" };
  assert.equal(statusExibicao({ ...base, data_limite: "2026-10-20" }, HOJE), "EM_ANDAMENTO");
  assert.equal(statusExibicao({ ...base, data_limite: HOJE }, HOJE), "VENCE_HOJE");
  assert.equal(statusExibicao({ ...base, data_limite: "2026-10-12" }, HOJE), "ATRASADO");
  assert.equal(
    statusExibicao({ status: "ATIVO", data_inicio: "2026-10-15", data_limite: "2026-10-20" }, HOJE),
    "AGENDADO",
  );
  assert.equal(statusExibicao({ ...base, status: "PAUSADO", data_limite: "2026-10-01" }, HOJE), "PAUSADO");
  assert.equal(statusExibicao({ ...base, status: "ENCERRADO", data_limite: "2026-10-01" }, HOJE), "ENCERRADO");
});

test("dias restantes: negativo é atraso, pausado congela, encerrado não conta", () => {
  const ativo = { status: "ATIVO" as const, data_inicio: "2026-10-01", data_limite: "2026-10-20" };
  assert.equal(diasRestantes(ativo, HOJE), 7);
  assert.equal(diasRestantes({ ...ativo, data_limite: "2026-10-10" }, HOJE), -3);
  assert.equal(
    diasRestantes({ ...ativo, status: "PAUSADO", pausado_em: "2026-10-05T15:00:00Z" }, HOJE),
    15,
  );
  assert.equal(diasRestantes({ ...ativo, status: "ENCERRADO" }, HOJE), null);
});

test("reiniciar conta a mesma duração a partir de hoje", () => {
  assert.deepEqual(datasAoReiniciar({ data_inicio: "2026-09-01", data_limite: "2026-09-11" }, HOJE), {
    data_inicio: HOJE,
    data_limite: "2026-10-23",
  });
  assert.deepEqual(datasAoReiniciar({ data_inicio: "2026-12-30", data_limite: "2027-01-02" }, "2026-12-30"), {
    data_inicio: "2026-12-30",
    data_limite: "2027-01-02",
  });
});

test("rótulo dos dias", () => {
  assert.equal(rotuloDias(1, "EM_ANDAMENTO"), "1 dia restante");
  assert.equal(rotuloDias(5, "EM_ANDAMENTO"), "5 dias restantes");
  assert.equal(rotuloDias(0, "VENCE_HOJE"), "Vence hoje");
  assert.equal(rotuloDias(-2, "ATRASADO"), "2 dias de atraso");
  assert.equal(rotuloDias(null, "ENCERRADO"), "—");
});

test("ações por status", () => {
  assert.deepEqual(politicaAluguel("ATIVO"), {
    podeEditar: true,
    podeChecklistSaida: true,
    podeChecklistRetorno: false,
    podePausar: true,
    podeReiniciar: true,
    podeEncerrar: true,
    podeExcluir: true,
  });
  assert.equal(politicaAluguel("PAUSADO").podePausar, false);
  assert.equal(politicaAluguel("PAUSADO").podeReiniciar, true);
  const encerrado = politicaAluguel("ENCERRADO");
  assert.equal(encerrado.podeEditar || encerrado.podeReiniciar || encerrado.podeEncerrar, false);
  assert.equal(encerrado.podeChecklistRetorno, true);
});

test("abas: atrasado é ativo com limite antes de hoje", () => {
  assert.deepEqual(filtroDaAba("ATRASADOS", HOJE), { status: "ATIVO", limiteAntesDe: HOJE });
  assert.deepEqual(filtroDaAba("EM_ANDAMENTO", HOJE), { status: "ATIVO", limiteDesde: HOJE });
  assert.deepEqual(filtroDaAba("TODOS", HOJE), {});
});
