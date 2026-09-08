import assert from "node:assert/strict";
import test from "node:test";
import { prepararConfigParaSalvar, validarAlteracaoFaturamento } from "./faturamento-patch";

test("editar outra configuração numa tela antiga não desliga faturamento", () => {
  const payload = prepararConfigParaSalvar({ habilitar_faturamento_os: false, impressao_cor_primaria: "#112233" }, false, false);
  assert.deepEqual(payload, { impressao_cor_primaria: "#112233" });
  assert.equal(validarAlteracaoFaturamento(undefined, undefined, true), "omitir");
});
test("mudança explícita envia o valor original para comparação atômica", () => {
  const payload = prepararConfigParaSalvar({ habilitar_faturamento_os: false }, true, true);
  assert.deepEqual(payload, { habilitar_faturamento_os: false, habilitar_faturamento_os_anterior: true });
  assert.equal(validarAlteracaoFaturamento(false, true, true), "comparar");
  assert.equal(validarAlteracaoFaturamento(false, true, false), "conflito");
});
test("tela sem controle de conflito só pode manter a flag atual", () => {
  assert.equal(validarAlteracaoFaturamento(false, undefined, true), "conflito");
  assert.equal(validarAlteracaoFaturamento(true, undefined, false), "conflito");
  assert.equal(validarAlteracaoFaturamento(false, undefined, false), "omitir");
});
