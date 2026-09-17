import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isConfirmedFiscalDateInCompetence,
  isPendingFiscalDateCandidateForCompetence,
  isSpedFiscalEntryCandidate,
} from "./entryScope";

describe("SPED Fiscal — Escopo e Delimitação das Entradas Fiscais", () => {
  const compAgosto = { start: "2026-08-01", end: "2026-08-31" };
  const compSetembro = { start: "2026-09-01", end: "2026-09-30" };
  const timeZonePB = "America/Fortaleza";
  const validKey = "25260812260723000109550010000001001000001001";

  it("Cenário 1 — Entrada avulsa/manual sem documento fiscal: fora do SPED e sem diagnóstico de data", () => {
    // 1.1 fiscal=false, origem=AVULSA, sem chave, sem DFe
    const avulsa1 = {
      id: 1,
      fiscal: false,
      status: "CONFIRMADA",
      origem: "AVULSA",
      tipo: "COMPRA_FORNECEDOR",
      notachave: null,
      fiscal_dfe_documento_id: null,
      created_at: "2026-08-15T12:00:00Z",
      data_entrada_fiscal: null,
    };
    assert.equal(isSpedFiscalEntryCandidate(avulsa1), false);
    assert.equal(isPendingFiscalDateCandidateForCompetence(avulsa1, compAgosto, timeZonePB), false);
    assert.equal(isConfirmedFiscalDateInCompetence(avulsa1, compAgosto), false);

    // 1.2 fiscal=false, origem=AJUSTE_RAPIDO
    const ajusteRapido = {
      id: 2,
      fiscal: false,
      status: "CONFIRMADA",
      origem: "AJUSTE_RAPIDO",
      tipo: "AJUSTE_RAPIDO",
      notachave: null,
      created_at: "2026-08-15T12:00:00Z",
      data_entrada_fiscal: null,
    };
    assert.equal(isSpedFiscalEntryCandidate(ajusteRapido), false);
    assert.equal(isPendingFiscalDateCandidateForCompetence(ajusteRapido, compAgosto, timeZonePB), false);

    // 1.3 fiscal=true acidental sem chave nem DFe (manual sem documento)
    const manualSemDoc = {
      id: 3,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "MANUAL",
      tipo: "COMPRA_FORNECEDOR",
      notachave: "",
      fiscal_dfe_documento_id: null,
      created_at: "2026-08-15T12:00:00Z",
      data_entrada_fiscal: null,
    };
    assert.equal(isSpedFiscalEntryCandidate(manualSemDoc), false);
    assert.equal(isPendingFiscalDateCandidateForCompetence(manualSemDoc, compAgosto, timeZonePB), false);
  });

  it("Cenário 2 — NF agosto + criada agosto + sem data: gera bloqueio DATA_ENTRADA_FISCAL_NAO_CONFIRMADA", () => {
    const entrada = {
      id: 101,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 50,
      data_emissao: "2026-08-20T10:00:00Z",
      created_at: "2026-08-25T14:00:00Z",
      data_entrada_fiscal: null,
    };

    assert.equal(isSpedFiscalEntryCandidate(entrada), true);
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), true);
    assert.equal(isConfirmedFiscalDateInCompetence(entrada, compAgosto), false);
  });

  it("Cenário 3 — NF julho + criada agosto + sem data: gera bloqueio em agosto pois precisa ser classificada", () => {
    const entrada = {
      id: 102,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 51,
      data_emissao: "2026-07-28T10:00:00Z",
      created_at: "2026-08-03T09:00:00Z",
      data_entrada_fiscal: null,
    };

    assert.equal(isSpedFiscalEntryCandidate(entrada), true);
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), true);
  });

  it("Cenário 4 — NF setembro + criada setembro: validando agosto, fica fora dos diagnósticos de agosto", () => {
    const entrada = {
      id: 103,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 52,
      data_emissao: "2026-09-10T11:00:00Z",
      created_at: "2026-09-10T15:00:00Z",
      data_entrada_fiscal: null,
    };

    assert.equal(isSpedFiscalEntryCandidate(entrada), true);
    // Validando agosto: NÃO bloqueia
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), false);
    // Validando setembro: bloqueia
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compSetembro, timeZonePB), true);
  });

  it("Cenário 5 — NF agosto + criada setembro: validando agosto, não bloqueia automaticamente agosto", () => {
    const entrada = {
      id: 104,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 53,
      data_emissao: "2026-08-28T18:00:00Z",
      created_at: "2026-09-03T10:00:00Z",
      data_entrada_fiscal: null,
    };

    assert.equal(isSpedFiscalEntryCandidate(entrada), true);
    // Operador registrou a entrada apenas em setembro: não bloqueia agosto antecipadamente
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), false);
  });

  it("Cenário 6 — NF julho + criada julho: validando agosto, não bloqueia automaticamente agosto", () => {
    const entrada = {
      id: 105,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 54,
      data_emissao: "2026-07-20T10:00:00Z",
      created_at: "2026-07-22T11:00:00Z",
      data_entrada_fiscal: null,
    };

    assert.equal(isSpedFiscalEntryCandidate(entrada), true);
    // Pendência de julho não contamina eternamente a competência de agosto
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), false);
  });

  it("Cenário 7 — NF julho + data_entrada_fiscal confirmada = 05/08: incluída no SPED de agosto", () => {
    const entrada = {
      id: 106,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 55,
      data_emissao: "2026-07-20T10:00:00Z",
      created_at: "2026-07-22T11:00:00Z",
      data_entrada_fiscal: "2026-08-05",
    };

    assert.equal(isSpedFiscalEntryCandidate(entrada), true);
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), false);
    assert.equal(isConfirmedFiscalDateInCompetence(entrada, compAgosto), true);
  });

  it("Cenário 8 — NF agosto + data_entrada_fiscal confirmada = 02/09: não pertence ao SPED de agosto, pertence a setembro", () => {
    const entrada = {
      id: 107,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 56,
      data_emissao: "2026-08-28T10:00:00Z",
      created_at: "2026-08-30T11:00:00Z",
      data_entrada_fiscal: "2026-09-02",
    };

    assert.equal(isSpedFiscalEntryCandidate(entrada), true);
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), false);
    // Não pertence a agosto
    assert.equal(isConfirmedFiscalDateInCompetence(entrada, compAgosto), false);
    // Pertence a setembro
    assert.equal(isConfirmedFiscalDateInCompetence(entrada, compSetembro), true);
  });

  it("Cenário 9 — Entrada fiscal com chave válida mas sem DFe associado: é candidata documental", () => {
    const entradaSemDfeId = {
      id: 141,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: null,
      data_emissao: "2026-08-10T10:00:00Z",
      created_at: "2026-08-12T11:00:00Z",
      data_entrada_fiscal: null,
    };

    // Possui chave de 44 dígitos válida -> é candidata documental
    assert.equal(isSpedFiscalEntryCandidate(entradaSemDfeId), true);
    // Se criada em agosto sem data -> gera pendência em agosto
    assert.equal(isPendingFiscalDateCandidateForCompetence(entradaSemDfeId, compAgosto, timeZonePB), true);
  });

  it("Cenário 10 — Documento emitido posterior ao fim da competência: nunca pode bloquear competência anterior", () => {
    const entrada = {
      id: 108,
      fiscal: true,
      status: "CONFIRMADA",
      origem: "NFE_TERCEIRO",
      tipo: "COMPRA_FORNECEDOR",
      notachave: validKey,
      fiscal_dfe_documento_id: 57,
      data_emissao: "2026-09-05T10:00:00Z",
      // Mesmo se por anomalia created_at estivesse no fim de agosto
      created_at: "2026-08-31T23:50:00Z",
      data_entrada_fiscal: null,
    };

    // Emissão posterior (setembro) nunca bloqueia competência anterior (agosto)
    assert.equal(isPendingFiscalDateCandidateForCompetence(entrada, compAgosto, timeZonePB), false);
  });
});
