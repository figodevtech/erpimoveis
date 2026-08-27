import assert from "node:assert/strict";
import test from "node:test";

import {
  isOperationalEventEligibleForGlobalAttention,
  overdueAccountAttentionCopy,
} from "./attention-rules";

test("estoque baixo e notas rejeitadas nao entram na Atencao global", () => {
  assert.equal(
    isOperationalEventEligibleForGlobalAttention({ tipo: "ESTOQUE_BAIXO", prioridade: "CRITICO" }),
    false,
  );
  assert.equal(
    isOperationalEventEligibleForGlobalAttention({ tipo: "NFE_REJEITADA", prioridade: "CRITICO" }),
    false,
  );
  assert.equal(
    isOperationalEventEligibleForGlobalAttention({ tipo: "NFSE_REJEITADA", prioridade: "CRITICO" }),
    false,
  );
});

test("outro evento critico continua elegivel", () => {
  assert.equal(
    isOperationalEventEligibleForGlobalAttention({ tipo: "CONTA_VENCIDA", prioridade: "CRITICO" }),
    true,
  );
});

test("conta vencida informa natureza, descricao e cliente relacionado", () => {
  assert.deepEqual(
    overdueAccountAttentionCopy({
      id: 42,
      tipo: "RECEITA",
      descricao: "Parcela da revisão",
      clienteNome: "Cliente Demonstração",
      vencimentoEm: "2026-08-26T12:00:00.000Z",
    }),
    {
      titulo: "Conta a receber #42 vencida",
      detalhe: "Parcela da revisão · Cliente: Cliente Demonstração · Venceu em 26/08/2026",
    },
  );
});

test("conta sem cliente preserva a descricao sem criar rotulo vazio", () => {
  assert.deepEqual(
    overdueAccountAttentionCopy({
      id: 7,
      tipo: "DESPESA",
      descricao: "Aluguel",
      clienteNome: null,
      vencimentoEm: "2026-08-25T12:00:00.000Z",
    }),
    {
      titulo: "Conta a pagar #7 vencida",
      detalhe: "Aluguel · Venceu em 25/08/2026",
    },
  );
});
