import assert from "node:assert/strict";
import test from "node:test";

import { MODELO_NFCE, MODELO_NFE } from "./modeloDocumento";
import {
  expectedCfopPrefix,
  isCfopCompatibleWithOperation,
  listCfopsForEmission,
  normalizeCfopForOperation,
  resolveCfopForEmission,
  validateCfopForEmission,
} from "./cfopOperation";

test("resolve o primeiro dígito do CFOP conforme direção e UF", () => {
  assert.equal(expectedCfopPrefix("SAIDA", "PB", "PB"), "5");
  assert.equal(expectedCfopPrefix("SAIDA", "PB", "AL"), "6");
  assert.equal(expectedCfopPrefix("ENTRADA", "PB", "PB"), "1");
  assert.equal(expectedCfopPrefix("ENTRADA", "PB", "AL"), "2");
  assert.equal(expectedCfopPrefix("ENTRADA", "PB", "EX"), "3");
  assert.equal(expectedCfopPrefix("SAIDA", "PB", "EX"), "7");
});

test("reproduz a OS #20: descarta 6405 inexistente e aplica 6401 do padrão", () => {
  const resolution = resolveCfopForEmission({
    candidates: [
      { value: "5405", origin: "PRODUTO" },
      { value: "5401", origin: "PADRAO" },
    ],
    modelo: MODELO_NFE,
    operation: "SAIDA",
    emitterUf: "PB",
    partnerUf: "AL",
  });

  assert.equal(resolution.cfop, "6401");
  assert.equal(resolution.selectedOrigin, "PADRAO");
  assert.equal(resolution.substituted, true);
  assert.equal(
    resolution.warning,
    "CFOP 6405, derivado do produto, não existe; aplicado 6401 do padrão fiscal.",
  );
  assert.equal(resolution.attempts[0].validation.code, "NOT_FOUND");
});

test("mantém um mapeamento interestadual existente sem aviso", () => {
  const resolution = resolveCfopForEmission({
    candidates: [
      { value: "5102", origin: "PRODUTO" },
      { value: "5401", origin: "PADRAO" },
    ],
    modelo: MODELO_NFE,
    operation: "SAIDA",
    emitterUf: "PB",
    partnerUf: "AL",
  });

  assert.equal(resolution.cfop, "6102");
  assert.equal(resolution.warning, null);
  assert.equal(resolution.substituted, false);
});

test("deixa o item pendente quando produto e padrão são inválidos", () => {
  const resolution = resolveCfopForEmission({
    candidates: [
      { value: "5405", origin: "PRODUTO" },
      { value: "5999", origin: "PADRAO" },
    ],
    modelo: MODELO_NFE,
    operation: "SAIDA",
    emitterUf: "PB",
    partnerUf: "AL",
  });

  assert.equal(resolution.cfop, "");
  assert.equal(resolution.selectedOrigin, null);
  assert.match(resolution.warning ?? "", /Selecione um CFOP válido/);
});

test("só normaliza o prefixo quando o resultado existe e é permitido", () => {
  assert.equal(normalizeCfopForOperation("5102", "ENTRADA", "PB", "PB"), "1102");
  assert.equal(normalizeCfopForOperation("6102", "ENTRADA", "PB", "AL"), "2102");
  assert.equal(normalizeCfopForOperation("5102", "SAIDA", "PB", "EX"), "7102");
  assert.equal(normalizeCfopForOperation("5405", "SAIDA", "PB", "AL"), "");
  assert.equal(normalizeCfopForOperation(null, "ENTRADA", "PB", "PB"), "");
});

test("valida existência e compatibilidade antes de gravar", () => {
  assert.equal(
    validateCfopForEmission({
      value: "6405",
      modelo: MODELO_NFE,
      operation: "SAIDA",
      emitterUf: "PB",
      partnerUf: "AL",
    }).code,
    "NOT_FOUND",
  );
  assert.equal(
    validateCfopForEmission({
      value: "5102",
      modelo: MODELO_NFE,
      operation: "SAIDA",
      emitterUf: "PB",
      partnerUf: "AL",
    }).code,
    "OPERATION_MISMATCH",
  );
  assert.equal(isCfopCompatibleWithOperation("6102", "SAIDA", "PB", "AL"), true);
});

test("NFC-e admite somente a lista do modelo 65 e operações internas", () => {
  assert.equal(
    validateCfopForEmission({
      value: "5405",
      modelo: MODELO_NFCE,
      operation: "SAIDA",
      emitterUf: "PB",
      partnerUf: "PB",
    }).valid,
    true,
  );
  assert.equal(
    validateCfopForEmission({
      value: "6102",
      modelo: MODELO_NFCE,
      operation: "SAIDA",
      emitterUf: "PB",
      partnerUf: "AL",
    }).code,
    "NOT_ALLOWED_MODEL",
  );

  const options = listCfopsForEmission({
    modelo: MODELO_NFCE,
    operation: "SAIDA",
    emitterUf: "PB",
    partnerUf: "PB",
  });
  assert.ok(options.some((entry) => entry.codigo === "5405"));
  assert.ok(options.every((entry) => entry.codigo.startsWith("5")));
  assert.ok(!options.some((entry) => entry.codigo === "6405"));
});

test("a busca da interface nunca oferece 6405", () => {
  const options = listCfopsForEmission({
    modelo: MODELO_NFE,
    operation: "SAIDA",
    emitterUf: "PB",
    partnerUf: "AL",
  });
  assert.ok(options.some((entry) => entry.codigo === "6401"));
  assert.ok(options.some((entry) => entry.codigo === "6102"));
  assert.ok(!options.some((entry) => entry.codigo === "6405"));
});
