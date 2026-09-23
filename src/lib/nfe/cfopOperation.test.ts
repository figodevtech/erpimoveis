import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe, it } from "node:test";

import { CFOP_CATALOG, CFOP_CATALOG_SOURCE } from "./cfopCatalog.generated";
import { CFOPS_PERMITIDOS_NFCE } from "./cfopCatalog";

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

describe("catálogo CFOP — IT 2023.002 v2.10 (04/09/2026)", () => {
  it("registra a fonte oficial reproduzível", () => {
    assert.equal(CFOP_CATALOG_SOURCE.versao, "IT-2023.002-v2.10");
    assert.equal(CFOP_CATALOG_SOURCE.vigencia, "2026-09-04");
    assert.equal(CFOP_CATALOG_SOURCE.sha256, "C95C91ED1644FDD1C2E6ADA24498D8B68B1897F9C9A0665E07EF5EED6A75FF6F");
    assert.equal(CFOP_CATALOG.length, 619);
  });

  it("usa o título oficial da tabela, com as correções da v2.10", () => {
    assert.equal(
      CFOP_CATALOG.find((entry) => entry.codigo === "5605")?.descricao,
      "Transferência de saldo devedor de ICMS para outro estabelecimento da mesma empresa.",
    );
    assert.equal(
      CFOP_CATALOG.find((entry) => entry.codigo === "1255")?.descricao,
      "Compra de energia elétrica por estabelecimento prestador de serviço de comunicação.",
    );
  });

  it("traz o indicador indExcIBSCBS da tabela oficial", () => {
    assert.equal(CFOP_CATALOG.find((entry) => entry.codigo === "5915")?.indExcIBSCBS, true);
    assert.equal(CFOP_CATALOG.find((entry) => entry.codigo === "5102")?.indExcIBSCBS, false);
  });

  it("direção, geografia e CFOP da NFC-e continuam resolvendo", () => {
    assert.equal(validateCfopForEmission({ value: "5102", modelo: MODELO_NFE, operation: "SAIDA", emitterUf: "PB", partnerUf: "PB" }).valid, true);
    assert.equal(validateCfopForEmission({ value: "6102", modelo: MODELO_NFE, operation: "SAIDA", emitterUf: "PB", partnerUf: "MG" }).valid, true);
    assert.equal(validateCfopForEmission({ value: "6102", modelo: MODELO_NFE, operation: "SAIDA", emitterUf: "PB", partnerUf: "PB" }).valid, false);
    assert.equal(validateCfopForEmission({ value: "1102", modelo: MODELO_NFE, operation: "SAIDA", emitterUf: "PB", partnerUf: "PB" }).valid, false);
    for (const cfop of CFOPS_PERMITIDOS_NFCE) {
      assert.equal(validateCfopForEmission({ value: cfop, modelo: MODELO_NFCE, operation: "SAIDA", emitterUf: "PB", partnerUf: "PB" }).valid, true, cfop);
    }
  });
});

describe("catálogo CFOP — fonte versionada e geração reproduzível", () => {
  const FONTE = "docs/fiscal/fontes/cfop/IT_2023_002_v2_10_Tabela_CFOP_Descricao.xlsx";

  it("o arquivo oficial versionado tem o hash registrado no catálogo e no SHA256.txt", () => {
    const hash = createHash("sha256").update(readFileSync(FONTE)).digest("hex");
    assert.equal(hash.toUpperCase(), CFOP_CATALOG_SOURCE.sha256);
    assert.equal(CFOP_CATALOG_SOURCE.arquivo, FONTE);
    assert.match(readFileSync("docs/fiscal/fontes/cfop/SHA256.txt", "utf8"), new RegExp(`^${hash}  `));
  });

  it("gerar de novo a partir da fonte versionada reproduz o catálogo byte a byte", () => {
    const destino = join(mkdtempSync(join(tmpdir(), "cfop-")), "catalogo.ts");
    execFileSync(process.execPath, [
      "scripts/nfe/generate-cfop-catalog.mjs",
      "--xlsx", FONTE,
      "--versao", CFOP_CATALOG_SOURCE.versao,
      "--publicacao", CFOP_CATALOG_SOURCE.vigencia,
      "--output", destino,
    ]);
    const normalizar = (texto: string) => texto.replace(/\r\n/g, "\n");
    assert.equal(
      normalizar(readFileSync(destino, "utf8")),
      normalizar(readFileSync("src/lib/nfe/cfopCatalog.generated.ts", "utf8")),
    );
  });
});
