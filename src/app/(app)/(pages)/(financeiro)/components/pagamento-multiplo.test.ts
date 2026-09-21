import assert from "node:assert/strict";
import test from "node:test";

import { clienteUnicoDoPagamento, somarSaldos, type DocumentoSelecionavel } from "./pagamento-multiplo";

function documento(
  id: number,
  clienteId: number | null,
  saldo = 100,
): DocumentoSelecionavel {
  return { id, rotulo: `OS #${id}`, cliente: clienteId ? `Cliente ${clienteId}` : null, clienteId, saldo };
}

test("um documento identificado tem pagador óbvio", () => {
  assert.equal(clienteUnicoDoPagamento([documento(1, 7)]), 7);
});

/*
 * O caso que estava quebrado: a condição comparava `ids.size` com o total de
 * documentos, então dois documentos do mesmo cliente davam 1 === 2 e o pagador
 * nunca era proposto fora do caso de um documento só.
 */
test("vários documentos do mesmo cliente também têm pagador único", () => {
  assert.equal(clienteUnicoDoPagamento([documento(1, 7), documento(2, 7)]), 7);
  assert.equal(
    clienteUnicoDoPagamento([documento(1, 7), documento(2, 7), documento(3, 7)]),
    7,
  );
});

test("clientes diferentes não têm pagador único", () => {
  assert.equal(clienteUnicoDoPagamento([documento(1, 7), documento(2, 8)]), null);
});

test("documento sem cliente impede o pagador único", () => {
  assert.equal(clienteUnicoDoPagamento([documento(1, 7), documento(2, null)]), null);
  assert.equal(clienteUnicoDoPagamento([documento(1, null)]), null);
});

test("seleção vazia não tem pagador", () => {
  assert.equal(clienteUnicoDoPagamento([]), null);
});

test("o total soma os saldos em aberto da seleção", () => {
  assert.equal(somarSaldos([documento(1, 7, 100), documento(2, 7, 50.5)]), 150.5);
  assert.equal(somarSaldos([]), 0);
});
