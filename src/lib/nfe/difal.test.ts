import assert from "node:assert/strict";
import test from "node:test";
import {
  aliquotaInterestadual,
  calcularDifal,
  calcularIdDest,
  deveGerarICMSUFDest,
  montarICMSUFDest,
} from "./difal";

test("idDest distingue interna, interestadual e exterior", () => {
  assert.equal(calcularIdDest("PB", "PB"), 1);
  assert.equal(calcularIdDest("PB", "MS"), 2);
  assert.equal(calcularIdDest("PB", "EX"), 3);
});

test("exige ICMSUFDest apenas na venda interestadual a consumidor final nao contribuinte", () => {
  const base = { ufEmitente: "PB", ufDestinatario: "MS", indFinal: 1, indIEDest: 9 };

  assert.equal(deveGerarICMSUFDest(base), true);
  // Mesma UF: operacao interna, sem partilha.
  assert.equal(deveGerarICMSUFDest({ ...base, ufDestinatario: "PB" }), false);
  // Revenda, nao consumidor final.
  assert.equal(deveGerarICMSUFDest({ ...base, indFinal: 0 }), false);
  // Destinatario contribuinte recolhe o proprio ICMS.
  assert.equal(deveGerarICMSUFDest({ ...base, indIEDest: 1 }), false);
  // Exportacao nao gera DIFAL.
  assert.equal(deveGerarICMSUFDest({ ...base, ufDestinatario: "EX" }), false);
});

test("aliquota interestadual segue origem da mercadoria e regiao", () => {
  // Importado: 4% em qualquer rota.
  assert.equal(aliquotaInterestadual("SP", "MS", "1"), 4);
  assert.equal(aliquotaInterestadual("PB", "SP", "6"), 4);
  // Sul/Sudeste (exceto ES) para as demais regioes: 7%.
  assert.equal(aliquotaInterestadual("SP", "MS", "0"), 7);
  // Nordeste para Centro-Oeste: 12%.
  assert.equal(aliquotaInterestadual("PB", "MS", "0"), 12);
  // Entre Sul/Sudeste: 12%.
  assert.equal(aliquotaInterestadual("SP", "RJ", "0"), 12);
});

test("calcula o DIFAL do caso PB para MS da NF 30", () => {
  const resultado = calcularDifal({
    baseCalculo: 2000,
    aliquotaInternaDestino: 17,
    aliquotaInterestadual: 12,
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

test("resolve aliquotas sozinho a partir das UFs", () => {
  const resultado = montarICMSUFDest({
    baseCalculo: 2000,
    ufEmitente: "PB",
    ufDestinatario: "MS",
    origemMercadoria: "0",
  });

  assert.equal(resultado.pICMSInter, 12);
  assert.equal(resultado.pICMSUFDest, 17);
  assert.equal(resultado.vICMSUFDest, 100);
});

test("aliquota interna menor que a interestadual nao gera DIFAL negativo", () => {
  const resultado = calcularDifal({
    baseCalculo: 1000,
    aliquotaInternaDestino: 10,
    aliquotaInterestadual: 12,
  });

  assert.equal(resultado.vICMSUFDest, 0);
  assert.equal(resultado.vICMSUFRemet, 0);
});

test("FCP entra separado do DIFAL", () => {
  const resultado = calcularDifal({
    baseCalculo: 1000,
    aliquotaInternaDestino: 20,
    aliquotaInterestadual: 12,
    aliquotaFcpDestino: 2,
  });

  assert.equal(resultado.vICMSUFDest, 80);
  assert.equal(resultado.vFCPUFDest, 20);
});
