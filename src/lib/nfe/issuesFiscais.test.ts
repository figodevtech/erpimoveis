import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alternarCienciaFiscal,
  aplicarAlteracoesComCienciaFiscal,
  avisoFiscalConfirmado,
  chaveCiencia,
  classificarIssuesFiscais,
  confirmarAvisosFiscais,
  fingerprintFiscal,
  pedidosDeCiencia,
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
  const aviso = {
    code: "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO",
    severidade: "AVISO",
    requerCiencia: true,
    fingerprint: fingerprintFiscal({ cfop: "6404", cst: "60" }),
  };
  const chave = chaveCiencia(aviso)!;
  const item = {
    cfop: "6404",
    cst: "60",
    csosn: "",
    descricao: "Produto",
    avisosFiscaisConfirmados: [chave],
  };

  it("a chave é code@fingerprint; sem fingerprint, INFO ou BLOQUEIO não há chave", () => {
    assert.equal(chave, `NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO@${aviso.fingerprint}`);
    assert.equal(chaveCiencia({ ...aviso, fingerprint: undefined }), null);
    assert.equal(chaveCiencia({ ...aviso, severidade: "INFO", requerCiencia: false }), null);
    assert.equal(chaveCiencia({ ...aviso, severidade: "BLOQUEIO" }), null);
  });

  it("o fingerprint não depende da ordem das chaves e muda com qualquer dado", () => {
    assert.equal(fingerprintFiscal({ a: 1, b: [1, { c: 2, d: null }] }), fingerprintFiscal({ b: [1, { d: undefined, c: 2 }], a: 1 }));
    assert.notEqual(fingerprintFiscal({ a: 1 }), fingerprintFiscal({ a: 2 }));
    assert.notEqual(fingerprintFiscal({ base: 100 }), fingerprintFiscal({ base: 100.01 }));
  });

  it("ciência vale com o mesmo fingerprint e não vale para outra situação", () => {
    assert.equal(avisoFiscalConfirmado(aviso, item.avisosFiscaisConfirmados), true);
    const outraSituacao = { ...aviso, fingerprint: fingerprintFiscal({ cfop: "6404", cst: "00" }) };
    assert.equal(avisoFiscalConfirmado(outraSituacao, item.avisosFiscaisConfirmados), false);
  });

  it("confirmação antiga, só com o código, não libera o aviso", () => {
    assert.equal(avisoFiscalConfirmado(aviso, ["NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO"]), false);
  });

  it("preserva a ciência quando muda um campo não tributário", () => {
    const atualizado = aplicarAlteracoesComCienciaFiscal(item, { descricao: "Produto revisado" });
    assert.deepEqual(atualizado.avisosFiscaisConfirmados, [chave]);
  });

  it("invalida a ciência anterior quando muda CFOP ou CST", () => {
    const novoCfop = aplicarAlteracoesComCienciaFiscal(item, { cfop: "6403" });
    const novoCst = aplicarAlteracoesComCienciaFiscal(item, { cst: "00" });

    assert.deepEqual(novoCfop.avisosFiscaisConfirmados, []);
    assert.deepEqual(novoCst.avisosFiscaisConfirmados, []);
  });

  it("aceita em lote somente avisos com ciência: INFO nunca entra em avisosFiscaisConfirmados", () => {
    const limpo = { ...item, avisosFiscaisConfirmados: [] as string[] };
    const atualizado = confirmarAvisosFiscais(limpo, [
      { code: "NFE_ST_RETIDA_POLITICA_UF", severidade: "INFO", requerCiencia: false, fingerprint: "fp1.x" },
      { code: "NFE_ICMS_BLOQUEIO", severidade: "BLOQUEIO", requerCiencia: true, fingerprint: "fp1.y" },
      { code: "NFE_SEM_FINGERPRINT", severidade: "AVISO", requerCiencia: true },
      aviso,
    ]);

    assert.deepEqual(atualizado.avisosFiscaisConfirmados, [chave]);
    assert.equal(confirmarAvisosFiscais(atualizado, [aviso]), atualizado);
  });

  it("alternar marca e desmarca só a situação do aviso", () => {
    const marcado = alternarCienciaFiscal(["OUTRO@fp1.z"], aviso, true);
    assert.deepEqual(marcado, ["OUTRO@fp1.z", chave]);
    assert.deepEqual(alternarCienciaFiscal(marcado, aviso, false), ["OUTRO@fp1.z"]);
  });

  it("pedidos para o servidor saem do estado da tela, por item, e ignoram chave malformada", () => {
    assert.deepEqual(
      pedidosDeCiencia([
        { avisosFiscaisConfirmados: [chave, "SO_CODIGO", "@fp1.x", "X@"] },
        { avisosFiscaisConfirmados: [] },
        { avisosFiscaisConfirmados: ["NFE_IBSCBS_BASE_MANUAL@fp1.abc"] },
      ]),
      [
        { itemIndex: 0, code: "NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO", fingerprint: aviso.fingerprint },
        { itemIndex: 2, code: "NFE_IBSCBS_BASE_MANUAL", fingerprint: "fp1.abc" },
      ],
    );
  });
});
