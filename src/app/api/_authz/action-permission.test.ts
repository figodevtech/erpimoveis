import assert from "node:assert/strict";
import test from "node:test";
import { permissionForAction } from "./action-permission";
import { PERMS, permissionSetHas } from "./permission-constants";

const rule = { read: PERMS.ORDENS, create: PERMS.ORDENS_CRIAR, edit: PERMS.ORDENS_EDITAR, delete: PERMS.ORDENS_EXCLUIR };

for (const action of ["aprovar", "reprovar"]) {
  test(`${action}: editor sem criação pode agir; criador sem edição não pode`, () => {
    const permission = permissionForAction(`/api/ordens/123/${action}`, "POST", rule);
    assert.equal(permissionSetHas([PERMS.ORDENS, PERMS.ORDENS_EDITAR], permission), true);
    assert.equal(permissionSetHas([PERMS.ORDENS, PERMS.ORDENS_CRIAR], permission), false);
    assert.equal(permissionSetHas([PERMS.ORDENS], permission), false);
    assert.equal(permissionSetHas([], permission), false);
    assert.equal(permissionForAction(`/api/ordens/123/${action}/`, "post", rule), permission);
  });
}

test("criação, leitura e exclusão continuam com permissões distintas", () => {
  assert.equal(permissionForAction("/api/ordens/criar", "POST", rule), PERMS.ORDENS_CRIAR);
  assert.equal(permissionForAction("/api/ordens/123", "GET", rule), PERMS.ORDENS);
  assert.equal(permissionForAction("/api/ordens/123", "DELETE", rule), PERMS.ORDENS_EXCLUIR);
  assert.equal(permissionForAction("/api/ordens/123/status", "PUT", rule), PERMS.ORDENS_EDITAR);
});

test("fotos do checklist do aluguel são edição; criar e excluir aluguel seguem distintos", () => {
  const aluguel = { read: PERMS.ALUGUEIS, create: PERMS.ALUGUEIS_CRIAR, edit: PERMS.ALUGUEIS_EDITAR, delete: PERMS.ALUGUEIS_EXCLUIR };
  assert.equal(permissionForAction("/api/alugueis/checklist-itens/9/imagens", "POST", aluguel), PERMS.ALUGUEIS_EDITAR);
  assert.equal(permissionForAction("/api/alugueis/checklist-itens/9/imagens", "DELETE", aluguel), PERMS.ALUGUEIS_EDITAR);
  assert.equal(permissionForAction("/api/alugueis", "POST", aluguel), PERMS.ALUGUEIS_CRIAR);
  assert.equal(permissionForAction("/api/alugueis/5", "DELETE", aluguel), PERMS.ALUGUEIS_EXCLUIR);
  assert.equal(permissionForAction("/api/alugueis/5/encerrar", "PUT", aluguel), PERMS.ALUGUEIS_EDITAR);
});

test("ver perfis de outros usuários e o cadastro de usuários não se implicam", () => {
  assert.equal(permissionSetHas([PERMS.USUARIOS_VER_PERFIS], PERMS.USUARIOS_VER_PERFIS), true);
  assert.equal(permissionSetHas([PERMS.USUARIOS], PERMS.USUARIOS_VER_PERFIS), false);
  assert.equal(permissionSetHas([PERMS.USUARIOS_VER_PERFIS], PERMS.USUARIOS), false);
});
