import test from "node:test";
import assert from "node:assert/strict";
import { idDeBusca } from "./busca-numerica";

test("aceita numero de OS dentro do int4", () => {
  assert.equal(idDeBusca("1423"), 1423);
  assert.equal(idDeBusca("OS-1423"), 1423);
  assert.equal(idDeBusca("2147483647"), 2147483647);
});

test("recusa CNPJ e qualquer coisa acima do int4", () => {
  assert.equal(idDeBusca("11337394000194"), null);
  assert.equal(idDeBusca("11.337.394/0001-94"), null);
  assert.equal(idDeBusca("11337394000"), null);
  assert.equal(idDeBusca("2147483648"), null);
});

test("recusa termo sem digito util", () => {
  assert.equal(idDeBusca(""), null);
  assert.equal(idDeBusca("bomba d'agua"), null);
  assert.equal(idDeBusca("0"), null);
});
