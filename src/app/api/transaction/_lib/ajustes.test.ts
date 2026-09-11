import test from "node:test";
import assert from "node:assert/strict";

import { normalizarAjustes } from "./ajustes";

const ok = (r: ReturnType<typeof normalizarAjustes>) => {
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("esperava ok");
  return r.ajustes;
};

const erro = (r: ReturnType<typeof normalizarAjustes>) => {
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("esperava erro");
  return r.erro;
};

test("forma dos ajustes vindos do cliente", async (t) => {
  await t.test("ausente e vazio são baixa sem ajuste, não erro", () => {
    assert.deepEqual(ok(normalizarAjustes(undefined)), []);
    assert.deepEqual(ok(normalizarAjustes(null)), []);
    assert.deepEqual(ok(normalizarAjustes([])), []);
  });

  await t.test("linha completa passa e normaliza o modo", () => {
    const [linha] = ok(
      normalizarAjustes([{ tipoId: 1, modo: "fixo", valorInformado: 30, observacao: " atraso " }]),
    );
    assert.deepEqual(linha, {
      tipoId: 1,
      modo: "FIXO",
      valorInformado: 30,
      observacao: "atraso",
    });
  });

  await t.test("observação vazia vira nula e a longa é cortada em 500", () => {
    const [semObs] = ok(normalizarAjustes([{ tipoId: 1, modo: "FIXO", valorInformado: 1 }]));
    assert.equal(semObs.observacao, null);

    const [comObs] = ok(
      normalizarAjustes([
        { tipoId: 1, modo: "FIXO", valorInformado: 1, observacao: "x".repeat(700) },
      ]),
    );
    assert.equal(comObs.observacao?.length, 500);
  });

  await t.test("não é lista", () => {
    assert.match(erro(normalizarAjustes({ tipoId: 1 })), /lista/);
  });

  await t.test("recusa tipo inválido", () => {
    assert.match(erro(normalizarAjustes([{ modo: "FIXO", valorInformado: 1 }])), /tipo do ajuste/);
    assert.match(
      erro(normalizarAjustes([{ tipoId: 0, modo: "FIXO", valorInformado: 1 }])),
      /tipo do ajuste/,
    );
  });

  await t.test("recusa modo desconhecido", () => {
    assert.match(
      erro(normalizarAjustes([{ tipoId: 1, modo: "METADE", valorInformado: 1 }])),
      /FIXO ou PORCENTAGEM/,
    );
  });

  await t.test("recusa valor zero, negativo ou não numérico", () => {
    for (const valorInformado of [0, -5, Number.NaN, "abc"]) {
      assert.match(
        erro(normalizarAjustes([{ tipoId: 1, modo: "FIXO", valorInformado }])),
        /maior que zero/,
      );
    }
  });

  await t.test("recusa percentual acima de 100, e aceita exatamente 100", () => {
    assert.match(
      erro(normalizarAjustes([{ tipoId: 1, modo: "PORCENTAGEM", valorInformado: 100.01 }])),
      /não pode passar de 100/,
    );
    assert.equal(
      ok(normalizarAjustes([{ tipoId: 1, modo: "PORCENTAGEM", valorInformado: 100 }])).length,
      1,
    );
  });

  await t.test("recusa mais linhas que o teto", () => {
    const muitas = Array.from({ length: 9 }, () => ({
      tipoId: 1,
      modo: "FIXO",
      valorInformado: 1,
    }));
    assert.match(erro(normalizarAjustes(muitas)), /no máximo 8/);
  });

  await t.test("com mais de uma linha, o erro diz qual", () => {
    const mensagem = erro(
      normalizarAjustes([
        { tipoId: 1, modo: "FIXO", valorInformado: 10 },
        { tipoId: 2, modo: "FIXO", valorInformado: 0 },
      ]),
    );
    assert.match(mensagem, /^Ajuste 2:/);
  });

  await t.test("com uma linha só, o erro não numera", () => {
    const mensagem = erro(normalizarAjustes([{ tipoId: 1, modo: "FIXO", valorInformado: 0 }]));
    assert.doesNotMatch(mensagem, /^Ajuste/);
  });
});
