import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultRouteForPerms } from "./default-route";
import {
  PERMS,
  PERMS_TELAS_FINANCEIRO,
  VERSAO_PERMISSOES_TOKEN,
  permissionSetHas,
  permissoesDoToken,
} from "./permission-constants";

test("cada tela do financeiro inclui o acesso base, e so a propria tela", () => {
  for (const tela of PERMS_TELAS_FINANCEIRO) {
    assert.equal(permissionSetHas([tela], PERMS.FINANCEIRO), true, tela);
    for (const outra of PERMS_TELAS_FINANCEIRO.filter((p) => p !== tela)) {
      assert.equal(permissionSetHas([tela], outra), false, `${tela} abriu ${outra}`);
    }
  }
});

test("o acesso base sozinho nao abre tela nenhuma do financeiro", () => {
  for (const tela of PERMS_TELAS_FINANCEIRO) {
    assert.equal(permissionSetHas([PERMS.FINANCEIRO], tela), false, tela);
  }
});

test("tela do financeiro nao vale como criar, editar ou excluir", () => {
  for (const acao of [PERMS.FINANCEIRO_CRIAR, PERMS.FINANCEIRO_EDITAR, PERMS.FINANCEIRO_EXCLUIR]) {
    assert.equal(permissionSetHas([PERMS.FINANCEIRO_BANCOS], acao), false, acao);
  }
});

test("token de antes da versao le financeiro:visualizar como o menu inteiro", () => {
  const legado = permissoesDoToken(["FINANCEIRO:VISUALIZAR"], undefined);
  for (const tela of PERMS_TELAS_FINANCEIRO) {
    assert.equal(permissionSetHas(legado, tela), true, tela);
  }
});

test("token da versao atual vale como esta", () => {
  const atual = permissoesDoToken(["FINANCEIRO:VISUALIZAR"], VERSAO_PERMISSOES_TOKEN);
  assert.deepEqual(atual, ["FINANCEIRO:VISUALIZAR"]);
  assert.equal(permissionSetHas(atual, PERMS.FINANCEIRO_FLUXO_DE_CAIXA), false);
});

test("token antigo sem o financeiro nao ganha nada", () => {
  assert.deepEqual(permissoesDoToken(["ORDENS:VISUALIZAR"], undefined), ["ORDENS:VISUALIZAR"]);
  assert.deepEqual(permissoesDoToken(undefined, undefined), []);
});

test("a entrada no sistema segue a primeira tela do financeiro que a pessoa abre", () => {
  assert.equal(getDefaultRouteForPerms([PERMS.FINANCEIRO_BANCOS]), "/bancos");
  assert.equal(getDefaultRouteForPerms([PERMS.FINANCEIRO_FLUXO_DE_CAIXA]), "/fluxodecaixa");
  assert.equal(getDefaultRouteForPerms([PERMS.FINANCEIRO_NOTAS_FISCAIS]), "/fiscal");
  assert.equal(getDefaultRouteForPerms([PERMS.FINANCEIRO]), "/nao-autorizado");
});
