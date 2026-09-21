import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classificarIssuesFiscais } from "../issuesFiscais";
import { calcularIcmsItem } from "./calculo";
import { montarDecisaoIcms } from "./index";
import {
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
