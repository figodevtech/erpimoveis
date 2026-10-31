import './__testEnv';
import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import { BancoFalso } from './__bancoFalso';
import { carregarEdicaoCatalogoRtc } from './catalogoRtcService';

afterEach(() => mock.restoreAll());

it('CST usa a mesma edição publicada para classificação e grupo, sem hardcode v1.60', async () => {
  new BancoFalso({ fiscal_nfe_cst_ibscbs: [
    { cst: '000', indicadores: { ind_gIBSCBS: 1, ind_gDif: 0 }, versao_fonte: 'IT2025.002-v1.60-2026-06-22' },
    { cst: '000', indicadores: { ind_gIBSCBS: 1, ind_gDif: 1 }, versao_fonte: 'IT2025.002-v1.71-2026-10-30' },
    { cst: '200', indicadores: { ind_gIBSCBS: 1, ind_gDif: 0 }, versao_fonte: 'IT2025.002-v1.71-2026-10-30' },
  ] }).instalar();
  const anterior = await carregarEdicaoCatalogoRtc('2026-10-29');
  assert.equal(anterior.versao, 'IT2025.002-v1.60-2026-06-22');
  assert.deepEqual([...anterior.cstsPadrao], ['000']);
  const atual = await carregarEdicaoCatalogoRtc('2026-10-31');
  assert.equal(atual.versao, 'IT2025.002-v1.71-2026-10-30');
  assert.deepEqual([...atual.cstsPadrao], ['200']);
});
