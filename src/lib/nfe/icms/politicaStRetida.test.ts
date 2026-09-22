import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classificarIssuesFiscais } from "../issuesFiscais";
import { calcularIcmsItem } from "./calculo";
import { montarDecisaoIcms } from "./index";
import {
  POLITICAS_ST_RETIDA,
  validarPoliticaStRetida,
  type ContextoStRetida,
  type PoliticaStRetida,
} from "./politicaStRetida";

const contexto: ContextoStRetida = {
  ufEmitente: "PB",
  ufDestino: "MG",
  dataEmissao: "2026-09-20",
};

function icms60() {
  const resultado = calcularIcmsItem({ crt: 3, cst: "60", orig: "0", valorOperacao: 1000 });
  assert.ok(resultado.valores);
  return resultado.valores;
}

function icmsSn500() {
  const resultado = calcularIcmsItem({ crt: 1, csosn: "500", orig: "0", valorOperacao: 1000 });
  assert.ok(resultado.valores);
  return resultado.valores;
}

describe("política estadual para ST retida e ICMS efetivo", () => {
  it("CST 60 sem política gera INFO sem ciência e não tira a prontidão", () => {
    const [stRetida] = validarPoliticaStRetida(icms60(), { ...contexto, indFinal: 0 });
    const [icmsEfetivo] = validarPoliticaStRetida(icms60(), { ...contexto, indFinal: 1 });

    for (const issue of [stRetida, icmsEfetivo]) {
      assert.equal(issue.severidade, "INFO");
      assert.equal(issue.requerCiencia, false);
      assert.equal(classificarIssuesFiscais([issue]).pronto, true);
      assert.doesNotMatch(issue.message, /faltam/i);
    }
  });

  it("CSOSN 500 segue a mesma classificação informativa", () => {
    const issues = [
      ...validarPoliticaStRetida(icmsSn500(), { ...contexto, indFinal: 0 }),
      ...validarPoliticaStRetida(icmsSn500(), { ...contexto, indFinal: 1 }),
    ];

    assert.deepEqual(issues.map((issue) => issue.severidade), ["INFO", "INFO"]);
    assert.ok(issues.every((issue) => issue.requerCiencia === false));
  });

  it("política vigente obrigatória gera BLOQUEIO que ciência não libera", () => {
    const politica: PoliticaStRetida = {
      ufEmitente: "PB",
      ufDestino: "MG",
      inicio: "2026-01-01",
      regra: "ICMS_EFETIVO",
      fonte: "Regra estadual de teste",
      obrigatoria: true,
    };
    const [issue] = validarPoliticaStRetida(
      icms60(),
      { ...contexto, indFinal: 1 },
      [politica],
    );
    const classificadas = classificarIssuesFiscais([{ ...issue, requerCiencia: true }]);

    assert.equal(issue.severidade, "BLOQUEIO");
    assert.equal(issue.requerCiencia, false);
    assert.deepEqual(classificadas.bloqueios.map((item) => item.code), [issue.code]);
    assert.deepEqual(classificadas.avisosComCiencia, []);
    assert.equal(classificadas.pronto, false);
  });

  it("política cadastrada como facultativa continua INFO", () => {
    const politica: PoliticaStRetida = {
      ufEmitente: "PB",
      inicio: "2026-01-01",
      regra: "ST_RETIDA",
      fonte: "Orientação estadual facultativa",
      obrigatoria: false,
    };
    const [issue] = validarPoliticaStRetida(
      icms60(),
      { ...contexto, indFinal: 0 },
      [politica],
    );

    assert.equal(issue.severidade, "INFO");
    assert.equal(issue.requerCiencia, false);
  });

  it("UF sem política cadastrada: CST 60 com indFinal 0 e 1 é INFO sem ciência", () => {
    const semPolitica = { ufEmitente: "SP", ufDestino: "MG", dataEmissao: "2026-09-20" };
    for (const indFinal of [0, 1]) {
      const [issue] = validarPoliticaStRetida(icms60(), { ...semPolitica, indFinal });
      assert.equal(issue.severidade, "INFO");
      assert.equal(issue.requerCiencia, false);
      assert.match(issue.message, /Não há política estadual obrigatória configurada/);
      assert.equal(issue.fontes?.[0]?.jurisdicao, "NACIONAL");
    }
  });

  it("PB: a orientação de 08/04/2019 torna o preenchimento facultativo e é citada como fonte", () => {
    const [issue] = validarPoliticaStRetida(icms60(), { ...contexto, indFinal: 0 });
    assert.equal(issue.severidade, "INFO");
    assert.match(issue.message, /PB conferida em/);
    assert.deepEqual(issue.fontes?.map((fonte) => fonte.jurisdicao), ["NACIONAL", "PB"]);
    assert.ok(POLITICAS_ST_RETIDA.every((politica) => politica.fonteUrl && politica.revisadaEm && politica.regrasMoc?.length));
  });

  const obrigatoria = (extra: Partial<PoliticaStRetida>): PoliticaStRetida => ({
    ufEmitente: "PB",
    inicio: "2026-01-01",
    regra: "ST_RETIDA",
    fonte: "Regra estadual de teste",
    obrigatoria: true,
    ...extra,
  });

  it("política obrigatória expirada não bloqueia", () => {
    const [issue] = validarPoliticaStRetida(icms60(), { ...contexto, indFinal: 0 }, [
      obrigatoria({ inicio: "2025-01-01", fim: "2025-12-31" }),
    ]);
    assert.equal(issue.severidade, "INFO");
  });

  it("política obrigatória futura não bloqueia hoje", () => {
    const [issue] = validarPoliticaStRetida(icms60(), { ...contexto, indFinal: 0 }, [
      obrigatoria({ inicio: "2027-01-01" }),
    ]);
    assert.equal(issue.severidade, "INFO");
  });

  it("a política mais recente vigente prevalece sobre a anterior da mesma UF", () => {
    const antiga: PoliticaStRetida = { ...obrigatoria({ inicio: "2019-04-08" }), obrigatoria: false };
    const nova = obrigatoria({ inicio: "2026-06-01" });
    const [bloqueio] = validarPoliticaStRetida(icms60(), { ...contexto, indFinal: 0 }, [antiga, nova]);
    assert.equal(bloqueio.severidade, "BLOQUEIO");
    const [antes] = validarPoliticaStRetida(
      icms60(),
      { ...contexto, indFinal: 0, dataEmissao: "2026-05-31" },
      [antiga, nova],
    );
    assert.equal(antes.severidade, "INFO");
  });

  it("política obrigatória com os campos preenchidos não gera issue; nunca estima valores", () => {
    const resultado = calcularIcmsItem({
      crt: 3,
      cst: "60",
      orig: "0",
      valorOperacao: 1000,
      stRetida: { vBCSTRet: 1000, pST: 18, vICMSSubstituto: 100, vICMSSTRet: 80 },
    });
    assert.ok(resultado.valores);
    assert.deepEqual(validarPoliticaStRetida(resultado.valores, { ...contexto, indFinal: 0 }, [obrigatoria({})]), []);
    const vazio = icms60();
    validarPoliticaStRetida(vazio, { ...contexto, indFinal: 0 }, [obrigatoria({})]);
    assert.equal(vazio.vBCSTRet, null);
    assert.equal(vazio.vICMSSTRet, null);
  });

  it("INFO não entra em avisosConfirmados mesmo se o cliente enviar o código", () => {
    const resultado = calcularIcmsItem({ crt: 3, cst: "60", orig: "0", valorOperacao: 1000 });
    assert.ok(resultado.valores);
    const informativos = validarPoliticaStRetida(
      resultado.valores,
      { ...contexto, indFinal: 0 },
    );
    const decisao = montarDecisaoIcms(resultado, informativos);

    assert.deepEqual(decisao?.avisosConfirmados, []);
  });
});
