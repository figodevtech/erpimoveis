import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aplicarAlteracoesComCienciaFiscal,
  classificarIssuesFiscais,
  confirmarAvisosFiscais,
} from "./issuesFiscais";

describe("classificação visual das issues fiscais", () => {
  it("mantém somente BLOQUEIO na categoria de pendências", () => {
    const bloqueio = { code: "CAMPO_OBRIGATORIO", severidade: "BLOQUEIO" };
    const resultado = classificarIssuesFiscais([bloqueio]);

    assert.deepEqual(resultado.bloqueios, [bloqueio]);
    assert.deepEqual(resultado.avisos, []);
    assert.equal(resultado.pronto, false);
  });

  it("trata AVISO sem requerCiencia como informativo e mantém o item pronto", () => {
    const aviso = { code: "NFE_ST_RETIDA_POLITICA_UF", severidade: "AVISO" };
    const resultado = classificarIssuesFiscais([aviso]);

    assert.deepEqual(resultado.bloqueios, []);
    assert.deepEqual(resultado.avisosComCiencia, []);
    assert.deepEqual(resultado.informativos, [aviso]);
    assert.equal(resultado.pronto, true);
  });

  it("trata requerCiencia legado como aviso, não como erro", () => {
    const aviso = { code: "NFE_CFOP_CST", requerCiencia: true };
    const resultado = classificarIssuesFiscais([aviso]);

    assert.deepEqual(resultado.bloqueios, []);
    assert.deepEqual(resultado.avisos, [aviso]);
  });

  it("preserva BLOQUEIO explícito mesmo se a issue também pedir ciência", () => {
    const bloqueio = { code: "NAO_LIBERAVEL", severidade: "BLOQUEIO", requerCiencia: true };
    const resultado = classificarIssuesFiscais([bloqueio]);

    assert.deepEqual(resultado.bloqueios, [bloqueio]);
    assert.deepEqual(resultado.avisos, []);
  });

  it("separa um BLOQUEIO, dois AVISOS e uma INFO", () => {
    const issues = [
      { code: "B", severidade: "BLOQUEIO" },
      { code: "A1", severidade: "AVISO", requerCiencia: true },
      { code: "A2", requerCiencia: true },
      { code: "I", severidade: "INFO" },
    ];
    const resultado = classificarIssuesFiscais(issues);

    assert.deepEqual(resultado.bloqueios.map((issue) => issue.code), ["B"]);
    assert.deepEqual(resultado.avisos.map((issue) => issue.code), ["A1", "A2"]);
    assert.deepEqual(resultado.informativos.map((issue) => issue.code), ["I"]);
  });

  it("INFO sozinho não bloqueia a prontidão", () => {
    const resultado = classificarIssuesFiscais([
      { code: "ORIENTACAO", severidade: "INFO", requerCiencia: false },
    ]);

    assert.equal(resultado.pronto, true);
    assert.equal(resultado.informativos.length, 1);
  });
});

describe("ciência de avisos fiscais", () => {
  const item = {
    cfop: "6404",
    cst: "60",
    csosn: "",
    descricao: "Produto",
    avisosFiscaisConfirmados: ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"],
  };

  it("preserva a ciência quando muda um campo não tributário", () => {
    const atualizado = aplicarAlteracoesComCienciaFiscal(item, { descricao: "Produto revisado" });
    assert.deepEqual(atualizado.avisosFiscaisConfirmados, ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"]);
  });

  it("invalida a ciência anterior quando muda CFOP ou CST", () => {
    const novoCfop = aplicarAlteracoesComCienciaFiscal(item, { cfop: "6403" });
    const novoCst = aplicarAlteracoesComCienciaFiscal(item, { cst: "00" });

    assert.deepEqual(novoCfop.avisosFiscaisConfirmados, []);
    assert.deepEqual(novoCst.avisosFiscaisConfirmados, []);
  });

  it("aceita em lote somente avisos com ciência e remove códigos informativos legados", () => {
    const atualizado = confirmarAvisosFiscais(item, [
      "NFE_ST_RETIDA_POLITICA_UF",
      "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO",
      "",
    ]);

    assert.deepEqual(atualizado.avisosFiscaisConfirmados, ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"]);
    assert.equal(confirmarAvisosFiscais(atualizado, atualizado.avisosFiscaisConfirmados), atualizado);
  });
});
