import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { configureSpedPoliciesFixture } from "./configPolicies.test-helpers";
import { entryPurposeFor, resolveEntryCfop } from "./entryCfop";
import { deriveTimezoneFromAddress, effectiveSpedConfig, normalizePolicyPatch, readSpedPolicies } from "./configPolicies";

describe("CFOP de entrada", () => {
  it("compra para revenda: interna, interestadual e com ST", () => {
    assert.deepEqual(resolveEntryCfop("5102", "REVENDA"), { cfop: "1102", reason: null });
    assert.deepEqual(resolveEntryCfop("6102", "REVENDA"), { cfop: "2102", reason: null });
    assert.deepEqual(resolveEntryCfop("5405", "REVENDA"), { cfop: "1403", reason: null });
    assert.deepEqual(resolveEntryCfop("6403", "REVENDA"), { cfop: "2403", reason: null });
    // NT Comércio e Emiteco: ST já retido anteriormente, venda interestadual.
    assert.deepEqual(resolveEntryCfop("6404", "REVENDA"), { cfop: "2403", reason: null });
    assert.equal(resolveEntryCfop("6404", "USO_CONSUMO").cfop, "2407");
  });

  it("uso e consumo e ativo imobilizado", () => {
    assert.equal(resolveEntryCfop("5102", "USO_CONSUMO").cfop, "1556");
    assert.equal(resolveEntryCfop("6102", "ATIVO_IMOBILIZADO").cfop, "2551");
    assert.equal(resolveEntryCfop("5405", "USO_CONSUMO").cfop, "1407");
  });

  it("combustível ou lubrificante: x652 para revenda, x653 para consumo", () => {
    assert.equal(resolveEntryCfop("5655", "REVENDA").cfop, "1652");
    assert.equal(resolveEntryCfop("6656", "USO_CONSUMO").cfop, "2653");
  });

  it("operações espelhadas não dependem da destinação", () => {
    assert.equal(resolveEntryCfop("5910", null).cfop, "1910");
    assert.equal(resolveEntryCfop("6949", null).cfop, "2949");
    assert.equal(resolveEntryCfop("5915", null).cfop, "1915");
  });

  it("não adivinha: sem destinação, sem regra ou CFOP que não é de saída", () => {
    assert.deepEqual(resolveEntryCfop("5102", null), { cfop: null, reason: "DESTINACAO_DESCONHECIDA" });
    assert.deepEqual(resolveEntryCfop("5929", "REVENDA"), { cfop: null, reason: "SEM_REGRA" });
    assert.deepEqual(resolveEntryCfop("1102", "REVENDA"), { cfop: null, reason: "CFOP_NAO_E_SAIDA" });
    assert.deepEqual(resolveEntryCfop("51", "REVENDA"), { cfop: null, reason: "CFOP_INVALIDO" });
  });

  it("destinação vem da decisão de crédito ou do tipo do item", () => {
    assert.equal(entryPurposeFor({ creditTreatment: "USO_CONSUMO", itemType: "00" }), "USO_CONSUMO");
    assert.equal(entryPurposeFor({ creditTreatment: "CREDITAVEL", itemType: "00" }), "REVENDA");
    assert.equal(entryPurposeFor({ itemType: "08" }), "ATIVO_IMOBILIZADO");
    assert.equal(entryPurposeFor({ itemType: "99" }), null);
  });
});

describe("configuração inteligente", () => {
  it("deriva o fuso só em UF de fuso único", () => {
    assert.equal(deriveTimezoneFromAddress("PB", "2507507")?.timezone, "America/Fortaleza");
    assert.equal(deriveTimezoneFromAddress("sp", null)?.timezone, "America/Sao_Paulo");
    assert.equal(deriveTimezoneFromAddress("PE", "2611606")?.timezone, "America/Recife");
    assert.equal(deriveTimezoneFromAddress("PE", "2605459")?.timezone, "America/Noronha");
    assert.equal(deriveTimezoneFromAddress("AM", "1302603"), null);
    assert.equal(deriveTimezoneFromAddress("", null), null);
  });

  it("lê apenas políticas confirmadas", () => {
    assert.deepEqual(readSpedPolicies(null), { resaleCreditConfirmed: false, resaleCredit: null, csosnToCst: null });
    const config = configureSpedPoliciesFixture();
    assert.deepEqual(readSpedPolicies(config), { resaleCreditConfirmed: true, resaleCredit: true, csosnToCst: { "102": "90", "500": "60" } });
    const semCredito = readSpedPolicies({ evidencias: { politica_credito_revenda: { status: "CONFIRMADO", aplicavel: false } } });
    assert.equal(semCredito.resaleCreditConfirmed, false);
    assert.equal(semCredito.resaleCredit, false);
  });

  it("valida políticas antes de gravar", () => {
    assert.throws(() => normalizePolicyPatch({ creditoRevenda: { aplicavel: true } }, "u"), /evidência/);
    assert.throws(() => normalizePolicyPatch({ creditoRevenda: { descricao: "x" } }, "u"), /geram crédito/);
    assert.throws(() => normalizePolicyPatch({ csosnEntrada: { mapa: { "999": "90" }, descricao: "x" } }, "u"), /999/);
    const ok = normalizePolicyPatch({ creditoRevenda: { aplicavel: true, descricao: "Regime normal" } }, "u1");
    assert.equal(ok.politica_credito_revenda.status, "CONFIRMADO");
    assert.equal(ok.politica_credito_revenda.confirmadoPor, "u1");
  });

  it("aplica a configuração vigente em cada competência", () => {
    const vigencias = [
      { vigencia_inicio: "2000-01-01", payload: { perfil_efd: "B" } },
      { vigencia_inicio: "2027-01-01", payload: { perfil_efd: "A" } },
    ];
    assert.equal(effectiveSpedConfig("2026-08-01", vigencias, null)?.perfil_efd, "B");
    assert.equal(effectiveSpedConfig("2027-03-01", vigencias, null)?.perfil_efd, "A");
    assert.equal(effectiveSpedConfig("1999-01-01", vigencias, null)?.perfil_efd, "B");
    assert.equal(effectiveSpedConfig("2026-08-01", [], { perfil_efd: "C" })?.perfil_efd, "C");
  });
});
