import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFiscalCodes, validateServiceSources, type FiscalSource } from "./nfse-source";

const source: FiscalSource = { tipo: "TAXA_ADMIN", id: 1, proprietario_id: 4, imovel_id: 2, valor: 37.45 };
test("service invoice only totals administration fees and paid brokerage commission", () => {
  assert.deepEqual(validateServiceSources([source, { ...source, tipo: "COMISSAO", id: 9, valor: 12.55, pendente: false }]), { total: 50, proprietarioId: 4 });
  for (const candidate of [{ ...source, tipo: "BRUTO_RECEBIDO" }, { ...source, pendente: true }, { ...source, valor: -37.45 }, { ...source, is_deleted: true }]) assert.throws(() => validateServiceSources([candidate as FiscalSource]));
});
test("service invoice refuses duplicate sources or different owners", () => {
  assert.throws(() => validateServiceSources([source, source]), /repetidas/);
  assert.throws(() => validateServiceSources([source, { ...source, id: 2, proprietario_id: 8 }]), /único proprietário/);
});
test("fiscal configuration normalization preserves significant zeroes and false", () => {
  assert.deepEqual(normalizeFiscalCodes({ issRetido: "false", finalidadeEmissao: "0", aliquotaIss: "2.5", codigoTributacaoNacionalIss: "010101", token: "never expose", codigoNbs: "" }), { iss_retido: false, finalidade_emissao: 0, aliquota_iss: 2.5, codigo_tributacao_nacional_iss: "010101" });
});
