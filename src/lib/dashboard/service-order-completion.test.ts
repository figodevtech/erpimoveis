import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVICE_ORDER_COMPLETION_COLUMN,
  isServiceOrderCompleted,
  isServiceOrderOpen,
  serviceOrderCompletionDurationHours,
} from "./service-order-completion";

test("usa o fim da execução como marco de conclusão", () => {
  assert.equal(SERVICE_ORDER_COMPLETION_COLUMN, "execucao_fim_em");
  assert.equal(
    isServiceOrderCompleted({
      status: "PAGAMENTO",
      execucao_fim_em: "2026-08-20T15:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    isServiceOrderCompleted({
      status: "CONCLUIDO",
      execucao_fim_em: null,
    }),
    false,
  );
});

test("não usa pagamento nem saída física para concluir a OS", () => {
  const somenteEventosPosteriores = {
    status: "CONCLUIDO",
    execucao_fim_em: null,
    pagamento_concluido_em: "2026-08-20T16:00:00.000Z",
    datasaida: "2026-08-20T17:00:00.000Z",
  };
  assert.equal(
    isServiceOrderCompleted(somenteEventosPosteriores),
    false,
  );
  assert.equal(isServiceOrderOpen("PAGAMENTO"), false);
  assert.equal(isServiceOrderOpen("EM_ANDAMENTO"), true);
});

test("calcula a duração até o fim da execução técnica", () => {
  assert.equal(
    serviceOrderCompletionDurationHours({
      dataentrada: "2026-08-20T12:00:00.000Z",
      execucao_fim_em: "2026-08-20T15:30:00.000Z",
    }),
    3.5,
  );
  assert.equal(
    serviceOrderCompletionDurationHours({
      dataentrada: "2026-08-20T12:00:00.000Z",
      execucao_fim_em: null,
    }),
    null,
  );
});
