import assert from 'node:assert/strict';
import test from 'node:test';
import { bloqueioAutorizacaoE16a30 } from './bloqueioAutorizacaoE16a30';

const xmlInterno = '<NFe><infNFe>'
  + '<ide><mod>55</mod><idDest>1</idDest><dhEmi>2026-09-25T10:00:00-03:00</dhEmi><tpAmb>1</tpAmb></ide>'
  + '<dest><enderDest><UF>PB</UF></enderDest><indIEDest>2</indIEDest></dest>'
  + '<det><imposto><ICMS><ICMS60><CST>60</CST></ICMS60></ICMS></imposto></det>'
  + '</infNFe></NFe>';

test('XML salvo interno inválido recebe contrato HTTP 422 antes da autorização', () => {
  const bloqueio = bloqueioAutorizacaoE16a30(xmlInterno);
  assert.equal(bloqueio?.status, 422);
  assert.equal(bloqueio?.body.code, 'NFE_IND_IE_DEST_ISENTO_UF_NAO_PERMITE');
  assert.equal(bloqueio?.body.regra, 'E16a-30');
  assert.equal(bloqueio?.body.cStat, '805');
  assert.match(bloqueio?.body.mensagem ?? '', /PB não permite/);
});

test('XML salvo com idDest=3 não recebe bloqueio 805', () => {
  assert.equal(bloqueioAutorizacaoE16a30(xmlInterno.replace('<idDest>1</idDest>', '<idDest>3</idDest>')), null);
});
