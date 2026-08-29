import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATIONAL_EVENT_MODULES,
  OPERATIONAL_EVENT_TYPES,
  OPERATIONAL_MODULES,
  OPERATIONAL_NODE_MODULES,
  operationalEventSchema,
  operationalRealtimeCredentialsSchema,
} from "./contracts";

test("o contrato separa categorias de evento e os seis nós visíveis", () => {
  assert.deepEqual(OPERATIONAL_MODULES, [
    "VENDAS",
    "ORDENS",
    "FINANCEIRO",
    "CONTAS_RECEBER",
    "CONTAS_PAGAR",
    "ESTOQUE",
    "FISCAL",
  ]);
  assert.deepEqual(OPERATIONAL_EVENT_MODULES, [
    "VENDAS",
    "ORDENS",
    "FINANCEIRO",
    "CONTAS_PAGAR",
    "ESTOQUE",
    "FISCAL",
  ]);
  assert.deepEqual(OPERATIONAL_NODE_MODULES, [
    "VENDAS",
    "ORDENS",
    "CONTAS_RECEBER",
    "CONTAS_PAGAR",
    "FINANCEIRO",
    "FISCAL",
  ]);
  assert.equal(OPERATIONAL_EVENT_TYPES.length, 24);
});

test("o evento operacional aceita somente o payload publico estrito", () => {
  const event = operationalEventSchema.parse({
    id: "aa000000-0000-4000-8000-000000000001",
    tipo: "PIX_RECEBIDO",
    modulo: "FINANCEIRO",
    entidadeTipo: "TRANSACAO",
    entidadeId: "42",
    titulo: "PIX recebido",
    descricao: null,
    valor: 125.5,
    quantidade: null,
    prioridade: "INFO",
    metadata: {},
    ocorridoEm: "2026-08-27T12:00:00.000Z",
  });
  assert.equal(event.valor, 125.5);
  assert.throws(() => operationalEventSchema.parse({ ...event, tipo: "EVENTO_DESCONHECIDO" }));
});

test("credencial Realtime restringe o nome do topico ao tenant numerico", () => {
  const base = {
    token: "token-assinado",
    expiresAt: "2026-08-27T12:10:00.000Z",
    tenantId: 7,
  };
  assert.equal(
    operationalRealtimeCredentialsSchema.parse({ ...base, topic: "operational:tenant:7" }).tenantId,
    7,
  );
  assert.throws(() => operationalRealtimeCredentialsSchema.parse({ ...base, topic: "operational:tenant:8:extra" }));
});
