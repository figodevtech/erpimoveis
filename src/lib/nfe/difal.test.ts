import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aliquotaInterestadual,
  buildIcmsUFDestXml,
  calcularDifal,
  calcularIdDest,
  cfopDispensaDifal,
  deveGerarICMSUFDest,
  montarICMSUFDest,
  resolverAliquotaInternaDestino,
} from "./difal";

const PB_MS = { ufEmitente: "PB", ufDestinatario: "MS", indFinal: 1, indIEDest: 9, tpNF: 1 };

describe("idDest", () => {
  it("distingue interna, interestadual e exterior", () => {
    assert.equal(calcularIdDest("PB", "PB"), 1);
    assert.equal(calcularIdDest("PB", "MS"), 2);
    assert.equal(calcularIdDest("PB", "EX"), 3);
  });

  it("lança erro quando a UF não foi informada, em vez de assumir operação interna", () => {
    assert.throws(() => calcularIdDest("", "MS"), /UF do emitente não informada/);
    assert.throws(() => calcularIdDest("PB", ""), /UF do destinatário não informada/);
  });
});

describe("obrigatoriedade do ICMSUFDest", () => {
  it("exige o grupo na saída interestadual a consumidor final não contribuinte", () => {
    assert.equal(deveGerarICMSUFDest(PB_MS), true);
  });

  it("não exige em operação interna", () => {
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, ufDestinatario: "PB" }), false);
  });

  it("não exige quando o destinatário é contribuinte", () => {
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, indIEDest: 1 }), false);
  });

  it("não exige quando não é consumidor final", () => {
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, indFinal: 0 }), false);
  });

  it("não exige em exportação", () => {
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, ufDestinatario: "EX" }), false);
  });

  it("não exige em nota de entrada", () => {
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, tpNF: 0 }), false);
  });

  it("não exige em item tributado por ISSQN", () => {
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, possuiISSQN: true }), false);
  });

  it("exige em CFOP de venda", () => {
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, cfop: "6102" }), true);
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, cfop: "6108" }), true);
  });

  it("não exige em devolução, remessa, retorno ou transferência", () => {
    for (const cfop of ["6201", "6202", "6552", "6152", "6913"]) {
      assert.equal(deveGerarICMSUFDest({ ...PB_MS, cfop }), false, `CFOP ${cfop}`);
    }
  });

  it("mantém a exigência em CFOP genérico de outra saída", () => {
    // 6949 é catch-all. Suprimir o DIFAL aqui omitiria imposto devido em vendas
    // lançadas com CFOP genérico; o excesso é corrigível na revisão, a omissão não.
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, cfop: "6949" }), true);
  });

  it("ignora CFOP ausente ou malformado, deixando a validação para o ponto próprio", () => {
    assert.equal(cfopDispensaDifal(""), false);
    assert.equal(cfopDispensaDifal(null), false);
    assert.equal(cfopDispensaDifal("62"), false);
    assert.equal(deveGerarICMSUFDest({ ...PB_MS, cfop: null }), true);
  });
});

describe("alíquota interestadual", () => {
  it("aplica 4% às origens da Resolução 13/2012", () => {
    for (const origem of ["1", "2", "3", "8"]) {
      assert.equal(aliquotaInterestadual("PB", "MS", origem), 4, `origem ${origem}`);
    }
  });

  it("não aplica 4% às origens 6 e 7, excluídas por serem sem similar nacional", () => {
    assert.equal(aliquotaInterestadual("PB", "MS", "6"), 12);
    assert.equal(aliquotaInterestadual("PB", "MS", "7"), 12);
    assert.equal(aliquotaInterestadual("SP", "PB", "6"), 7);
  });

  it("aplica 7% de Sul/Sudeste exceto ES para as demais regiões", () => {
    assert.equal(aliquotaInterestadual("SP", "PB", "0"), 7);
    assert.equal(aliquotaInterestadual("SP", "MS", "0"), 7);
  });

  it("aplica 12% nos demais casos", () => {
    assert.equal(aliquotaInterestadual("PB", "MS", "0"), 12);
    assert.equal(aliquotaInterestadual("SP", "RJ", "0"), 12);
    assert.equal(aliquotaInterestadual("ES", "MG", "0"), 12);
  });
});

describe("alíquota interna do destino", () => {
  it("prioriza a alíquota do cadastro fiscal do item", () => {
    const resolvido = resolverAliquotaInternaDestino("MS", 19);
    assert.deepEqual(resolvido, { aliquota: 19, origem: "ITEM" });
  });

  it("recorre à tabela por UF sinalizando que é padrão", () => {
    const resolvido = resolverAliquotaInternaDestino("MS", null);
    assert.deepEqual(resolvido, { aliquota: 17, origem: "TABELA" });
  });

  it("lança erro para UF desconhecida em vez de assumir 17%", () => {
    assert.throws(() => resolverAliquotaInternaDestino("ZZ", null), /UF de destino desconhecida/);
  });

  it("lança erro quando a UF não foi informada", () => {
    assert.throws(() => resolverAliquotaInternaDestino("", null), /UF do destinatário não informada/);
  });
});

describe("cálculo do DIFAL", () => {
  it("reproduz o caso PB → MS da NF-e rejeitada", () => {
    const resultado = montarICMSUFDest({
      baseCalculo: 2000,
      baseCalculoFcp: 2000,
      ufEmitente: "PB",
      ufDestinatario: "MS",
      origemMercadoria: "0",
      aliquotaInternaDestino: 17,
      aliquotaInterestadual: 12,
      aliquotaFcpDestino: 0,
      percentualPartilhaDestino: 100,
    });

    assert.deepEqual(resultado, {
      vBCUFDest: 2000,
      vBCFCPUFDest: 2000,
      pFCPUFDest: 0,
      pICMSUFDest: 17,
      pICMSInter: 12,
      pICMSInterPart: 100,
      vFCPUFDest: 0,
      vICMSUFDest: 100,
      vICMSUFRemet: 0,
    });
  });

  it("gera o XML do caso na ordem exigida pelo leiaute", () => {
    const xml = buildIcmsUFDestXml(
      montarICMSUFDest({
        baseCalculo: 2000,
        ufEmitente: "PB",
        ufDestinatario: "MS",
        aliquotaInternaDestino: 17,
        aliquotaInterestadual: 12,
      }),
    );

    assert.equal(
      xml,
      "<ICMSUFDest>"
        + "<vBCUFDest>2000.00</vBCUFDest>"
        + "<vBCFCPUFDest>2000.00</vBCFCPUFDest>"
        + "<pFCPUFDest>0.00</pFCPUFDest>"
        + "<pICMSUFDest>17.00</pICMSUFDest>"
        + "<pICMSInter>12.00</pICMSInter>"
        + "<pICMSInterPart>100.00</pICMSInterPart>"
        + "<vFCPUFDest>0.00</vFCPUFDest>"
        + "<vICMSUFDest>100.00</vICMSUFDest>"
        + "<vICMSUFRemet>0.00</vICMSUFRemet>"
        + "</ICMSUFDest>",
    );
  });

  it("aceita base do FCP diferente da base do DIFAL", () => {
    const resultado = calcularDifal({
      baseCalculo: 1000,
      baseCalculoFcp: 600,
      aliquotaInternaDestino: 20,
      aliquotaInterestadual: 12,
      aliquotaFcpDestino: 2,
    });

    assert.equal(resultado.vBCUFDest, 1000);
    assert.equal(resultado.vBCFCPUFDest, 600);
    assert.equal(resultado.vICMSUFDest, 80);
    assert.equal(resultado.vFCPUFDest, 12);
  });

  it("usa a base do DIFAL quando a base do FCP não é informada", () => {
    const resultado = calcularDifal({
      baseCalculo: 1000,
      aliquotaInternaDestino: 20,
      aliquotaInterestadual: 12,
      aliquotaFcpDestino: 2,
    });
    assert.equal(resultado.vBCFCPUFDest, 1000);
    assert.equal(resultado.vFCPUFDest, 20);
  });

  it("reparte entre destino e remetente conforme o percentual", () => {
    const resultado = calcularDifal({
      baseCalculo: 1000,
      aliquotaInternaDestino: 20,
      aliquotaInterestadual: 12,
      percentualPartilhaDestino: 60,
    });
    assert.equal(resultado.vICMSUFDest, 48);
    assert.equal(resultado.vICMSUFRemet, 32);
  });

  it("não gera DIFAL negativo quando a interna é menor que a interestadual", () => {
    const resultado = calcularDifal({
      baseCalculo: 1000,
      aliquotaInternaDestino: 10,
      aliquotaInterestadual: 12,
    });
    assert.equal(resultado.vICMSUFDest, 0);
    assert.equal(resultado.vICMSUFRemet, 0);
  });
});

describe("validação de entradas", () => {
  const base = { baseCalculo: 1000, aliquotaInternaDestino: 17, aliquotaInterestadual: 12 };

  it("recusa percentual fora da faixa", () => {
    assert.throws(() => calcularDifal({ ...base, aliquotaInternaDestino: 120 }), /deve estar entre 0 e 100/);
    assert.throws(() => calcularDifal({ ...base, aliquotaInterestadual: -1 }), /deve estar entre 0 e 100/);
    assert.throws(() => calcularDifal({ ...base, percentualPartilhaDestino: 101 }), /deve estar entre 0 e 100/);
    assert.throws(() => calcularDifal({ ...base, aliquotaFcpDestino: 150 }), /deve estar entre 0 e 100/);
  });

  it("recusa interestadual fora do leiaute (só 4, 7 ou 12)", () => {
    for (const pInter of [0, 5, 18]) {
      assert.throws(() => calcularDifal({ ...base, aliquotaInterestadual: pInter }), /4%, 7% ou 12%/);
    }
    for (const pInter of [4, 7, 12]) {
      assert.doesNotThrow(() => calcularDifal({ ...base, aliquotaInterestadual: pInter }));
    }
  });

  it("recusa percentual não numérico", () => {
    assert.throws(
      () => calcularDifal({ ...base, aliquotaInternaDestino: Number.NaN }),
      /não informado ou inválido/,
    );
  });

  it("recusa base monetária negativa ou inválida", () => {
    assert.throws(() => calcularDifal({ ...base, baseCalculo: -1 }), /Base de cálculo do DIFAL inválida/);
    assert.throws(() => calcularDifal({ ...base, baseCalculoFcp: -5 }), /Base de cálculo do FCP inválida/);
  });
});
