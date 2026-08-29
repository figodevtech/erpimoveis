import assert from "node:assert/strict";
import test from "node:test";

import { PERMS } from "@/app/api/_authz/permission-constants";
import { allowedOperationalModules } from "./permissions";

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
