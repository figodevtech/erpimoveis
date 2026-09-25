import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarRegraE16a30, issueE16a30, mensagemBloqueioE16a30, REGRA_E16A30 } from './regraE16a30';
import { avaliarRegraE16a30Xml } from './regraE16a30Xml';

const caso203 = {
  modelo: 55,
  idDest: 2,
  ufDestino: 'AL',
  indIEDest: 2,
  ambiente: 'PRODUCAO',
  dataEmissao: '2026-09-25T23:30:00-03:00',
  itens: [{ cst: '60' }],
};

test('NF-e 203: PB para AL, CST 60 sem valores ST bloqueia com E16a-30 / 805', () => {
  const resultado = avaliarRegraE16a30(caso203);
  assert.equal(resultado.bloqueia, true);
  assert.equal(resultado.regra, 'E16a-30');
  assert.equal(resultado.cStat, '805');
  assert.equal(issueE16a30(caso203)?.severidade, 'BLOQUEIO');
  assert.equal(issueE16a30(caso203)?.fontes?.[0].regra, 'E16a-30');
});

test('operação interna em PB também bloqueia pela E16a-30 vigente', () => {
  const interna = { ...caso203, idDest: 1, ufDestino: 'PB' };
  const resultado = avaliarRegraE16a30(interna);
  assert.equal(resultado.aplica, true);
  assert.equal(resultado.bloqueia, true);
  assert.equal(resultado.regra, 'E16a-30');
  assert.equal(resultado.cStat, '805');
  assert.equal(issueE16a30(interna)?.severidade, 'BLOQUEIO');
  assert.equal(REGRA_E16A30.fonte.versao, 'NT 2025.001 v1.03');
  assert.match(REGRA_E16A30.fonte.url, /NvuzQGYd6E8/);
  assert.doesNotMatch(mensagemBloqueioE16a30('PB'), /interestadual/);
});

test('exceções por valor transmitido de ICMS-ST e ST retido', () => {
  for (const campo of ['vICMSST', 'vICMSSTRet'] as const) {
    const resultado = avaliarRegraE16a30({ ...caso203, itens: [{ cst: '60', [campo]: 25 }] });
    assert.equal(resultado.bloqueia, false, campo);
    assert.equal(resultado.excecaoAplicada, campo);
  }
  assert.equal(avaliarRegraE16a30({ ...caso203, itens: [{ cst: '10' }] }).bloqueia, true);
  assert.equal(avaliarRegraE16a30({ ...caso203, itens: [{ cst: '30' }] }).bloqueia, true);
});

test('exceções tributárias limitadas a CST 40/41 e CSOSN 103/300/400', () => {
  for (const cst of ['40', '41']) {
    assert.equal(avaliarRegraE16a30({ ...caso203, itens: [{ cst }] }).excecaoAplicada, 'tributacaoIsenta');
  }
  for (const csosn of ['103', '300', '400']) {
    assert.equal(avaliarRegraE16a30({ ...caso203, itens: [{ csosn }] }).excecaoAplicada, 'tributacaoIsenta');
  }
  assert.equal(avaliarRegraE16a30({ ...caso203, itens: [{ cst: '40' }, { cst: '60' }] }).bloqueia, true);
});

test('data histórica compara o dia fiscal civil somente em produção', () => {
  const historico = { ...caso203, dataEmissao: '2016-06-30T23:30:00-03:00' };
  assert.equal(avaliarRegraE16a30(historico).excecaoAplicada, 'dataHistorica');
  assert.equal(avaliarRegraE16a30({ ...historico, ambiente: 'HOMOLOGACAO' }).bloqueia, true);
  assert.equal(avaliarRegraE16a30({ ...historico, dataEmissao: '2016-07-01T00:00:00-03:00' }).bloqueia, true);
});

test('escopo restrito a modelo 55, idDest 1 ou 2, indicador 2 e UFs configuradas', () => {
  for (const alteracao of [
    { modelo: 65 }, { idDest: 3 }, { indIEDest: 1 }, { indIEDest: 9 }, { ufDestino: 'AC' },
  ]) {
    assert.equal(avaliarRegraE16a30({ ...caso203, ...alteracao }).aplica, false, JSON.stringify(alteracao));
  }
});

test('operações internas preservam as exceções de ST retido e CST 40', () => {
  const interna = { ...caso203, idDest: 1, ufDestino: 'PB' };
  assert.equal(avaliarRegraE16a30({ ...interna, itens: [{ cst: '60', vICMSSTRet: 25 }] }).excecaoAplicada, 'vICMSSTRet');
  assert.equal(avaliarRegraE16a30({ ...interna, itens: [{ cst: '40' }] }).excecaoAplicada, 'tributacaoIsenta');
});

function xmlDoCaso(icms: string, idDest = 2, uf = 'AL') {
  return `<NFe><infNFe><ide><mod>55</mod><idDest>${idDest}</idDest><dhEmi>2026-09-25T23:30:00-03:00</dhEmi><tpAmb>1</tpAmb></ide><dest><enderDest><UF>${uf}</UF></enderDest><indIEDest>2</indIEDest></dest><det><imposto><ICMS>${icms}</ICMS></imposto></det></infNFe></NFe>`;
}

test('barreira do XML salvo/editado lê tags realmente transmitidas', () => {
  assert.equal(avaliarRegraE16a30Xml(xmlDoCaso('<ICMS60><CST>60</CST></ICMS60>')).bloqueia, true);
  assert.equal(avaliarRegraE16a30Xml(xmlDoCaso('<ICMS60><CST>60</CST><vICMSSTRet>80.00</vICMSSTRet></ICMS60>')).bloqueia, false);
  assert.equal(avaliarRegraE16a30Xml(xmlDoCaso('<ICMS10><CST>10</CST><vICMSST>12.00</vICMSST></ICMS10>')).bloqueia, false);
  const interna = xmlDoCaso('<ICMS60><CST>60</CST></ICMS60>', 1, 'PB');
  assert.equal(avaliarRegraE16a30Xml(interna).bloqueia, true);
  assert.equal(avaliarRegraE16a30Xml(xmlDoCaso('<ICMS60><CST>60</CST></ICMS60>', 3, 'PB')).aplica, false);
  assert.equal(avaliarRegraE16a30Xml(xmlDoCaso('<ICMS60><CST>60</CST><vICMSSTRet>80.00</vICMSSTRet></ICMS60>', 1, 'PB')).bloqueia, false);
});
