import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePeriodo,
  resolverTextosServico,
  STATUS_OS_FINALIZADAS,
  STATUS_VENDAS_REALIZADAS,
} from "./regras";

test("separa o titulo cadastrado da subdescricao da OS", () => {
  assert.deepEqual(
    resolverTextosServico("Troca de óleo", "Inclui limpeza do cárter", "Serviço removido"),
    {
      descricao: "Troca de óleo",
      subdescricao: "Inclui limpeza do cárter",
    },
  );
});

test("omite a subdescricao quando ela repete o titulo", () => {
  assert.deepEqual(
    resolverTextosServico("  Alinhamento 3D ", "alinhamento 3d", "Serviço removido"),
    {
      descricao: "Alinhamento 3D",
      subdescricao: null,
    },
  );
});

test("aceita somente o titulo cadastrado", () => {
  assert.deepEqual(resolverTextosServico("Balanceamento", null, "Serviço removido"), {
    descricao: "Balanceamento",
    subdescricao: null,
  });
});

test("promove a subdescricao a titulo quando o cadastro nao existe", () => {
  assert.deepEqual(resolverTextosServico(null, "Reparo emergencial", "Serviço removido"), {
    descricao: "Reparo emergencial",
    subdescricao: null,
  });
});

test("usa o fallback quando o servico nao possui nenhum texto", () => {
  assert.deepEqual(resolverTextosServico(" ", null, "Serviço removido da OS"), {
    descricao: "Serviço removido da OS",
    subdescricao: null,
  });
});

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

