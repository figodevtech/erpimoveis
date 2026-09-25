import assert from 'node:assert/strict';
import test from 'node:test';
import { aplicarClassificacaoAtualAoRascunho } from './revisarDestinatarioRejeitado';
import { indFinalDoDestino } from './destinoMercadoria';

const snapshot = {
  nfeId: 203,
  operacao: { destinoMercadoria: 'REVENDA_INDUSTRIALIZACAO', consumidorFinal: false },
  destinatario: { indicadorIe: '2', inscricaoEstadual: '' },
};

test('abrir a nota preserva o snapshot; aplicar cadastro 9 ajusta indFinal sem criar outra NF-e', () => {
  const atualizado = aplicarClassificacaoAtualAoRascunho(snapshot, { indicador: 9, inscricaoEstadual: '123' });
  assert.equal(snapshot.destinatario.indicadorIe, '2');
  assert.equal(atualizado.nfeId, 203);
  assert.equal(atualizado.destinatario.indicadorIe, '9');
  assert.equal(atualizado.destinatario.inscricaoEstadual, '');
  assert.equal(indFinalDoDestino(atualizado.operacao.destinoMercadoria, atualizado.operacao.consumidorFinal), 1);
});

test('aplicar cadastro 1 leva IE ativa informada pelo operador', () => {
  const atualizado = aplicarClassificacaoAtualAoRascunho(snapshot, { indicador: 1, inscricaoEstadual: '123' });
  assert.equal(atualizado.destinatario.indicadorIe, '1');
  assert.equal(atualizado.destinatario.inscricaoEstadual, '123');
});
