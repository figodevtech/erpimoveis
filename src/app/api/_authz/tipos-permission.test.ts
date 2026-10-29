import assert from "node:assert/strict";
import test from "node:test";
import { PERMS, permissionSetHas, TIPO_IDS, tipoPermission } from "./permission-constants";
import { tipoMutationPermission } from "./tipos-permission";

const routes = {
  grupos: "grupos-produto",
  grupos_usoconsumo: "grupos-usoconsumo",
  unidades: "unidades-medida",
  servicos: "servicos",
  fornecedores: "fornecedores",
  setores: "setores",
  bancos: "bancos",
  categorias: "categorias-transacao",
  bandeiras: "bandeiras",
  planos_conta: "planos-de-conta",
  centros_custo: "centros-de-custo",
  categorias_venda: "categorias-venda",
  tipos_entrada: "tipos-entrada",
  motivos_saida: "motivos-saida",
} as const;

test("cada Tipo exige sua própria permissão para cada mutação", () => {
  for (const id of TIPO_IDS) {
    const path = `/api/tipos/${routes[id]}`;
    assert.equal(tipoMutationPermission(path, "POST"), tipoPermission(id, "criar"));
    assert.equal(tipoMutationPermission(`${path}/123`, "PUT"), tipoPermission(id, "editar"));
    assert.equal(tipoMutationPermission(`${path}/123`, "PATCH"), tipoPermission(id, "editar"));
    assert.equal(tipoMutationPermission(`${path}/123`, "DELETE"), tipoPermission(id, "excluir"));
    assert.equal(tipoMutationPermission(path, "GET"), null);
  }
  assert.equal(tipoMutationPermission("/api/tipos/grupos-planos-de-conta/1", "PUT"), tipoPermission("planos_conta", "editar"));
  assert.equal(tipoMutationPermission("/api/tipos/desconhecido", "POST"), PERMS.CONFIG_EDITAR);
});

test("fornecedores abre Tipos sem abrir Configurações gerais ou outros cadastros", () => {
  const perms = [tipoPermission("fornecedores", "visualizar"), tipoPermission("fornecedores", "criar")];
  assert.equal(permissionSetHas(perms, PERMS.TIPOS), true);
  assert.equal(permissionSetHas(perms, PERMS.CONFIG), false);
  assert.equal(permissionSetHas(perms, tipoPermission("grupos", "visualizar")), false);
  assert.equal(permissionSetHas(perms, tipoPermission("fornecedores", "editar")), false);
});
