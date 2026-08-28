import assert from "node:assert/strict";
import test from "node:test";

import { PERMS } from "@/app/api/_authz/permission-constants";
import { OPERATIONAL_EVENT_MODULES } from "./contracts";
import {
  allowedOperationalModules,
  canOpenOperationalEvent,
  canViewClientName,
} from "./permissions";

test("a Central revela apenas os modulos permitidos ao perfil", () => {
  assert.deepEqual(
    allowedOperationalModules([PERMS.ACOMPANHAMENTO, PERMS.VENDAS]),
    ["VENDAS", "ORDENS"],
  );
  assert.deepEqual(allowedOperationalModules([PERMS.ACOMPANHAMENTO]), ["ORDENS"]);
});

test("financeiro habilita fluxo de caixa, contas a receber e contas a pagar", () => {
  assert.deepEqual(
    allowedOperationalModules([PERMS.ACOMPANHAMENTO, PERMS.FINANCEIRO]),
    ["ORDENS", "FINANCEIRO", "CONTAS_RECEBER", "CONTAS_PAGAR"],
  );
});

test("permissao fiscal preserva a implicacao existente de financeiro", () => {
  assert.deepEqual(
    allowedOperationalModules([PERMS.ACOMPANHAMENTO, PERMS.FINANCEIRO_NOTAS_FISCAIS]),
    ["ORDENS", "FINANCEIRO", "CONTAS_RECEBER", "CONTAS_PAGAR", "FISCAL"],
  );
});

test("acompanhamento nao e chave-mestra para abrir o detalhe de um evento", () => {
  const abertos = OPERATIONAL_EVENT_MODULES.filter((modulo) =>
    canOpenOperationalEvent([PERMS.ACOMPANHAMENTO], modulo),
  );
  assert.deepEqual(abertos, ["ORDENS"]);
});

test("a implicacao fiscal tambem vale para abrir o detalhe", () => {
  const abertos = OPERATIONAL_EVENT_MODULES.filter((modulo) =>
    canOpenOperationalEvent([PERMS.ACOMPANHAMENTO, PERMS.FINANCEIRO_NOTAS_FISCAIS], modulo),
  );
  assert.deepEqual(abertos, ["ORDENS", "FINANCEIRO", "CONTAS_PAGAR", "FISCAL"]);
});

test("o nome do cliente exige a permissao de clientes", () => {
  assert.equal(canViewClientName([PERMS.ACOMPANHAMENTO]), false);
  assert.equal(canViewClientName([PERMS.ACOMPANHAMENTO, PERMS.FINANCEIRO]), false);
  assert.equal(canViewClientName([PERMS.CLIENTES]), true);
});
