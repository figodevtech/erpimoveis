import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCpfCnpj,
  hasValidCpfCnpjLength,
  isValidCnpj,
  isValidCpf,
  normalizeFiscalRecipient,
} from "./recipientNormalization";

test("aceita somente documentos com 11 ou 14 dígitos", () => {
  assert.equal(hasValidCpfCnpjLength("529.982.247-25"), true);
  assert.equal(hasValidCpfCnpjLength("04.252.011/0001-10"), true);
  assert.equal(hasValidCpfCnpjLength("1234567890"), false);
  assert.equal(hasValidCpfCnpjLength("1234567890123"), false);
  assert.equal(hasValidCpfCnpjLength("123456789012345"), false);
});

test("valida os dígitos verificadores de CPF e CNPJ", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("529.982.247-24"), false);
  assert.equal(isValidCnpj("04.252.011/0001-10"), true);
  assert.equal(isValidCnpj("04.252.011/0001-11"), false);
});

test("formata CPF e CNPJ durante a digitação", () => {
  assert.equal(formatCpfCnpj("52998224725"), "529.982.247-25");
  assert.equal(formatCpfCnpj("04252011000110"), "04.252.011/0001-10");
});

test("normaliza o destinatário antes de construir a NF-e", () => {
  const normalized = normalizeFiscalRecipient({
    tipoPessoa: "JURIDICA",
    cpfCnpj: "04.252.011/0001-10",
    nomeRazaoSocial: "  Oficina   Exemplo  ",
    indicadorIe: "1",
    inscricaoEstadual: "12.345.678-9",
    cidade: "João Pessoa",
    estado: "pb",
    cep: "58.000-000",
    codigoMunicipio: "2507507",
  });

  assert.equal(normalized.cpfCnpj, "04252011000110");
  assert.equal(normalized.nomeRazaoSocial, "Oficina Exemplo");
  assert.equal(normalized.inscricaoEstadual, "123456789");
  assert.equal(normalized.cidade, "JOAO PESSOA");
  assert.equal(normalized.estado, "PB");
  assert.equal(normalized.cep, "58000000");
});
