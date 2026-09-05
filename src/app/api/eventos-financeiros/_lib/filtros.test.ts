import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aplicarElegibilidadeDePagamento,
  aplicarFiltrosDeEventos,
  lerFiltrosDeEventos,
} from "./filtros";

type Chamada = [metodo: string, coluna?: unknown, valor?: unknown];

class ConsultaFalsa {
  chamadas: Chamada[] = [];

  private registrar(metodo: string, coluna?: unknown, valor?: unknown) {
    this.chamadas.push([metodo, coluna, valor]);
    return this;
  }

  eq(coluna: unknown, valor: unknown) { return this.registrar("eq", coluna, valor); }
  is(coluna: unknown, valor: unknown) { return this.registrar("is", coluna, valor); }
  neq(coluna: unknown, valor: unknown) { return this.registrar("neq", coluna, valor); }
  not(coluna: unknown, operador: unknown, valor: unknown) {
    this.chamadas.push(["not", coluna, `${operador}:${valor}`]);
    return this;
  }
  gte(coluna: unknown, valor: unknown) { return this.registrar("gte", coluna, valor); }
  lt(coluna: unknown, valor: unknown) { return this.registrar("lt", coluna, valor); }
  or(valor: unknown) { return this.registrar("or", valor); }
}

const USUARIO_ID = "83d3fe33-95f5-4463-987d-258a95fc5f91";

test("lê usuário e seleção global dos parâmetros", () => {
  const filtros = lerFiltrosDeEventos(
    new URLSearchParams({
      usuarioId: USUARIO_ID,
      selecionaveis: "1",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    }),
  );

  assert.equal(filtros.usuarioId, USUARIO_ID);
  assert.equal(filtros.selecionarTodos, true);
});

test("rejeita usuarioId inválido em vez de remover silenciosamente o filtro", () => {
  assert.throws(
    () => lerFiltrosDeEventos(new URLSearchParams({ usuarioId: "invalido" })),
    (error: unknown) => {
      assert.equal((error as Error).message, "O usuário informado é inválido.");
      assert.equal((error as Error & { statusCode?: number }).statusCode, 400);
      return true;
    },
  );
});

test("filtra pelo beneficiário do evento e continua usando data_evento", () => {
  const filtros = lerFiltrosDeEventos(
    new URLSearchParams({
      usuarioId: USUARIO_ID,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      situacao: "TODOS",
    }),
  );
  const consulta = aplicarFiltrosDeEventos(new ConsultaFalsa(), filtros) as ConsultaFalsa;

  assert.ok(consulta.chamadas.some((chamada) =>
    chamada[0] === "eq" && chamada[1] === "usuarioid" && chamada[2] === USUARIO_ID));
  assert.ok(!consulta.chamadas.some((chamada) => chamada[1] === "created_by"));
  assert.ok(consulta.chamadas.some((chamada) =>
    chamada[0] === "gte"
    && chamada[1] === "data_evento"
    && chamada[2] === "2026-08-01T03:00:00.000Z"));
  assert.ok(consulta.chamadas.some((chamada) =>
    chamada[0] === "lt"
    && chamada[1] === "data_evento"
    && chamada[2] === "2026-09-01T03:00:00.000Z"));
});

test("seleção global aceita somente despesas ativas ainda não lançadas", () => {
  const consulta = aplicarElegibilidadeDePagamento(new ConsultaFalsa()) as ConsultaFalsa;

  assert.deepEqual(consulta.chamadas, [
    ["eq", "natureza", "DESPESA"],
    ["eq", "status", "ATIVO"],
    ["eq", "pode_gerar_transacao", true],
    ["is", "transacaoid", null],
    ["is", "lancamento_id", null],
  ]);
});
