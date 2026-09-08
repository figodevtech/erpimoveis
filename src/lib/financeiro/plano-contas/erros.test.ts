import assert from "node:assert/strict";
import test from "node:test";

import { mensagemDoErro, statusDoErro } from "./erros";

test("conflito de versão vira 409", () => {
  assert.equal(
    statusDoErro({ code: "PT409", message: "O grupo foi alterado por outra pessoa (versao 3 em vez de 2)." }),
    409,
  );
});

test("incompatibilidade semântica vira 422, não 400", () => {
  assert.equal(statusDoErro({ code: "PT422", message: "A classificacao escolhida e de outra familia." }), 422);
});

test("violações do banco viram o status do pedido, não 500", () => {
  assert.equal(statusDoErro({ code: "23505" }), 409);
  assert.equal(statusDoErro({ code: "23503" }), 409);
  assert.equal(statusDoErro({ code: "23514" }), 422);
  assert.equal(statusDoErro({ code: "22023" }), 400);
  assert.equal(statusDoErro({ code: "P0002" }), 404);
});

test("erro desconhecido continua sendo nosso", () => {
  assert.equal(statusDoErro({ code: "XX000", message: "internal error" }), 500);
  assert.equal(statusDoErro(new Error("boom")), 500);
  assert.equal(statusDoErro(null), 500);
});

test("autenticação e permissão continuam sendo reconhecidas pela mensagem", () => {
  assert.equal(statusDoErro(new Error("Usuário não autenticado")), 401);
  assert.equal(statusDoErro(new Error("Sem permissão para editar")), 403);
});

/*
 * O caminho por texto existe só para o INSERT direto, que não passa por RPC.
 * Se ele começasse a capturar erros com SQLSTATE, um PT422 poderia virar 409.
 */
test("o código tem precedência sobre o texto", () => {
  assert.equal(
    statusDoErro({ code: "PT422", message: 'duplicate key value violates unique constraint "x_unique"' }),
    422,
  );
});

test("mensagem do banco chega à tela quando o erro é do pedido", () => {
  assert.equal(
    mensagemDoErro({ code: "PT422", message: "Grupo padrao do sistema nao muda de finalidade." }, "Erro"),
    "Grupo padrao do sistema nao muda de finalidade.",
  );
});

test("erro interno não vaza detalhe do banco", () => {
  assert.equal(
    mensagemDoErro({ code: "XX000", message: "relation pg_temp_37.x does not exist" }, "Erro ao salvar conta"),
    "Erro ao salvar conta",
  );
});

test("colisão sem código vira uma frase que a pessoa entende", () => {
  assert.equal(
    mensagemDoErro(new Error('duplicate key value violates unique constraint "planosdeconta_codigo_unique"'), "Erro"),
    "Já existe um cadastro com este código ou nome.",
  );
});

test("banco sem as migrations diz o que fazer, e não 'erro ao carregar'", () => {
  const erro = { code: "42883", message: 'function public.plano_contas_visao(date) does not exist' };
  assert.equal(statusDoErro(erro), 503);
  assert.match(mensagemDoErro(erro, "Erro ao carregar planos de conta"), /migrations/i);
});

test("PostgREST sem a função no cache também é reconhecido", () => {
  const erro = {
    code: "PGRST202",
    message: "Could not find the function public.plano_contas_salvar_conta in the schema cache",
  };
  assert.equal(statusDoErro(erro), 503);
});

/*
 * Um erro que apenas cita o nome da função — sem dizer que ela não existe — é
 * erro de execução dela, não de schema ausente. Confundir os dois esconderia
 * um defeito real atrás de "publique o schema".
 */
test("erro dentro da função não vira schema ausente", () => {
  const erro = { code: "PT422", message: "plano_contas_salvar_conta: familia incompativel" };
  assert.equal(statusDoErro(erro), 422);
});
