import assert from "node:assert/strict";
import { test } from "node:test";
import { cepDigitos, documentoCanonico, exibirDocumento, exibirTelefone, mascaraCep, mascaraDocumento, mascaraTelefone, telefoneDigitos } from "./format-contato";

test("máscara de CEP acompanha a digitação e grava só os 8 dígitos", () => {
  assert.deepEqual(["5", "58030", "580301", "58030190"].map(mascaraCep), ["5", "58030", "58030-1", "58030-190"]);
  assert.equal(mascaraCep("58030-190 "), "58030-190");
  assert.equal(cepDigitos("58030-1909"), "58030190");
  assert.equal(mascaraCep(null), "");
});

test("máscara de telefone acompanha a digitação sem separador sobrando no fim", () => {
  const passos = ["8", "83", "839", "839999", "8399999", "8333334444", "83999994444"].map(mascaraTelefone);
  assert.deepEqual(passos, ["(8", "(83", "(83) 9", "(83) 9999", "(83) 9999-9", "(83) 3333-4444", "(83) 99999-4444"]);
  assert.equal(mascaraTelefone(""), "");
  // Colado já formatado, com código do país ou dígitos a mais: fica com DDD + número.
  assert.equal(mascaraTelefone("(83) 99999-4444 ramal 2"), "(83) 99999-4444");
  assert.equal(telefoneDigitos("(83) 99999-4444"), "83999994444");
});

test("exibição só formata telefone completo", () => {
  assert.equal(exibirTelefone("83999994444"), "(83) 99999-4444");
  assert.equal(exibirTelefone("(83) 3333-4444"), "(83) 3333-4444");
  assert.equal(exibirTelefone("3333-4444"), "3333-4444");
  assert.equal(exibirTelefone(null), "");
});

test("documento: máscara progressiva por tipo e valor gravado canônico", () => {
  assert.equal(mascaraDocumento("1234", "FISICA"), "123.4");
  assert.equal(mascaraDocumento("52998224725", "FISICA"), "529.982.247-25");
  assert.equal(mascaraDocumento("11222333", "JURIDICA"), "11.222.333");
  assert.equal(mascaraDocumento("11222333000181", "JURIDICA"), "11.222.333/0001-81");
  // CNPJ alfanumérico: letras ficam maiúsculas.
  assert.equal(mascaraDocumento("12abc34501de35", "JURIDICA"), "12.ABC.345/01DE-35");
  assert.equal(documentoCanonico("529.982.247-25", "FISICA"), "52998224725");
  assert.equal(documentoCanonico("11.222.333/0001-81", "JURIDICA"), "11222333000181");
  assert.equal(documentoCanonico("5299822472599", "FISICA"), "52998224725");
  assert.equal(documentoCanonico("11#222(333)0001@81", "JURIDICA"), "11222333000181");
});

test("exibição de documento formata CPF e CNPJ completos e preserva o resto", () => {
  assert.equal(exibirDocumento("52998224725"), "529.982.247-25");
  assert.equal(exibirDocumento("11222333000181"), "11.222.333/0001-81");
  assert.equal(exibirDocumento("12ABC34501DE35"), "12.ABC.345/01DE-35");
  assert.equal(exibirDocumento("123"), "123");
  assert.equal(exibirDocumento(""), "");
});
