import assert from "node:assert/strict";
import test from "node:test";

import { identificacaoDaEmpresa } from "./empresa";

test("identificação completa, com documento, telefone e endereço formatados", () => {
  assert.deepEqual(
    identificacaoDaEmpresa({
      razaosocial: "Demir Diesel Ltda",
      nomefantasia: "Demir Diesel",
      cnpj: "12345678000190",
      telefone: "83999887766",
      endereco: "Av. Brasil",
      numero: "120",
      complemento: "Galpão 2",
      bairro: "Centro",
      uf: "PB",
      cep: "58000000",
    }),
    {
      nome: "Demir Diesel",
      razaoSocial: "Demir Diesel Ltda",
      cnpj: "12.345.678/0001-90",
      telefone: "(83) 99988-7766",
      endereco: "Av. Brasil, nº 120, Galpão 2 · Centro · PB · CEP 58000-000",
    },
  );
});

test("sem nome fantasia, a razão social vira o nome e não se repete", () => {
  const empresa = identificacaoDaEmpresa({ razaosocial: "Garage Premium", telefone: "8332221100" });
  assert.equal(empresa?.nome, "Garage Premium");
  assert.equal(empresa?.razaoSocial, null);
  assert.equal(empresa?.telefone, "(83) 3222-1100");
  assert.equal(empresa?.cnpj, null);
  assert.equal(empresa?.endereco, null);
});

test("cadastro vazio ou ausente não inventa identificação", () => {
  assert.equal(identificacaoDaEmpresa(null), null);
  assert.equal(identificacaoDaEmpresa({ razaosocial: "  ", nomefantasia: null }), null);
});
