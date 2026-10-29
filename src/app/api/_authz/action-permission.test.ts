import assert from "node:assert/strict";
import test from "node:test";
import { permissionForAction } from "./action-permission";
import { PERMS, permissionSetHas } from "./permission-constants";

const rule = { read: PERMS.VENDAS, create: PERMS.VENDAS_CRIAR, edit: PERMS.VENDAS_EDITAR, delete: PERMS.VENDAS_EXCLUIR };

test("criação, leitura e exclusão continuam com permissões distintas", () => {
  assert.equal(permissionForAction("/api/venda", "POST", rule), PERMS.VENDAS_CRIAR);
  assert.equal(permissionForAction("/api/venda/123", "GET", rule), PERMS.VENDAS);
  assert.equal(permissionForAction("/api/venda/123", "DELETE", rule), PERMS.VENDAS_EXCLUIR);
  assert.equal(permissionForAction("/api/venda/123/status", "PUT", rule), PERMS.VENDAS_EDITAR);
});

test("sem permissão própria, a ação cai para a de edição e depois para a de leitura", () => {
  assert.equal(permissionForAction("/api/x", "POST", { read: PERMS.VENDAS, edit: PERMS.VENDAS_EDITAR }), PERMS.VENDAS_EDITAR);
  assert.equal(permissionForAction("/api/x", "DELETE", { read: PERMS.VENDAS }), PERMS.VENDAS);
});

test("ver perfis de outros usuários e o cadastro de usuários não se implicam", () => {
  assert.equal(permissionSetHas([PERMS.USUARIOS_VER_PERFIS], PERMS.USUARIOS_VER_PERFIS), true);
  assert.equal(permissionSetHas([PERMS.USUARIOS], PERMS.USUARIOS_VER_PERFIS), false);
  assert.equal(permissionSetHas([PERMS.USUARIOS_VER_PERFIS], PERMS.USUARIOS), false);
});
