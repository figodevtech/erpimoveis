import test from "node:test";
import assert from "node:assert/strict";

import { traduzirErroExclusao } from "./erros-exclusao";

test("recusa do banco ao excluir transação", async (t) => {
  await t.test("movimento do extrato conciliado vira 409 explicando o caminho", () => {
    const recusa = traduzirErroExclusao({
      code: "23514",
      message:
        'new row for relation "ofx_movimento" violates check constraint "ofx_movimento_conciliado_tem_transacao_check"',
    });

    assert.equal(recusa.status, 409);
    assert.match(recusa.mensagem, /conciliada com um movimento do extrato/);
    assert.match(recusa.mensagem, /desfazer a conciliação/);
  });

  await t.test("a constraint pode vir em details, não em message", () => {
    const recusa = traduzirErroExclusao({
      code: "23514",
      message: "violates check constraint",
      details: 'Failing row contains ... ofx_movimento_conciliado_tem_transacao_check',
    });

    assert.equal(recusa.status, 409);
    assert.match(recusa.mensagem, /extrato bancário/);
  });

  await t.test("estorno apontando para a transação vira 409", () => {
    const recusa = traduzirErroExclusao({
      code: "23503",
      message:
        'update or delete on table "transacao" violates foreign key constraint "transacao_estorno_transacao_id_fkey" on table "transacao"',
    });

    assert.equal(recusa.status, 409);
    assert.match(recusa.mensagem, /já foi estornada/);
    assert.match(recusa.mensagem, /Exclua o estorno primeiro/);
  });

  await t.test("outra chave estrangeira ainda diz que há vínculo", () => {
    const recusa = traduzirErroExclusao({
      code: "23503",
      message: 'violates foreign key constraint "alguma_outra_fkey"',
    });

    assert.equal(recusa.status, 409);
    assert.match(recusa.mensagem, /registros ligados a esta transação/);
  });

  await t.test("código desconhecido continua 500 com a mensagem do banco", () => {
    const recusa = traduzirErroExclusao({
      code: "40001",
      message: "could not serialize access due to concurrent update",
    });

    assert.equal(recusa.status, 500);
    assert.equal(recusa.mensagem, "could not serialize access due to concurrent update");
  });

  await t.test("erro sem nada dentro não quebra", () => {
    assert.deepEqual(traduzirErroExclusao(null), {
      status: 500,
      mensagem: "Erro ao deletar transação.",
    });
    assert.equal(traduzirErroExclusao({}).status, 500);
  });
});
