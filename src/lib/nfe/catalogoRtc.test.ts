import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { classificacaoPermiteModeloRtc, selecionarVersaoCatalogoRtc } from './catalogoRtc';
import { gerarMigracaoCatalogoRtc, lerCatalogoRtc } from '../../../scripts/fiscal/gerar-migracao-catalogo-rtc';

const antiga = 'IT2025.002-v1.60-2026-06-22';
const nova = 'IT2025.002-v1.71-2026-10-30';

describe('edição única do catálogo RTC', () => {
  const linhas = [nova, antiga, 'IT2025.002-v1.72-2026-12-01'].map((versao_fonte) => ({ versao_fonte }));
  it('mantém a edição anterior antes da publicação, mesmo com dIniVig retroativo', () => {
    assert.equal(selecionarVersaoCatalogoRtc(linhas, '2026-10-29'), antiga);
  });
  it('usa a v1.71 a partir da publicação e ignora versão futura', () => {
    assert.equal(selecionarVersaoCatalogoRtc(linhas.reverse(), '2026-10-30'), nova);
    assert.equal(selecionarVersaoCatalogoRtc(linhas, '2026-10-31'), nova);
  });
  it('não inventa uma edição quando não há fonte publicada', () => {
    assert.equal(selecionarVersaoCatalogoRtc(linhas, '2026-01-01'), null);
    assert.equal(selecionarVersaoCatalogoRtc([{ versao_fonte: 'desconhecida' }], '2026-10-31'), null);
  });
  it('distingue indNFe e indNFCe sem presumir permissão do modelo 65', () => {
    const soNfe = { permite_nfe: true, indicadores: { indNFCe: 0 } };
    assert.equal(classificacaoPermiteModeloRtc(soNfe, '55'), true);
    assert.equal(classificacaoPermiteModeloRtc(soNfe, '65'), false);
    assert.equal(classificacaoPermiteModeloRtc({ permite_nfe: true }, '65'), false);
    assert.equal(classificacaoPermiteModeloRtc({ permite_nfe: true, indicadores: { indNFCe: 1 } }, '65'), true);
  });
});

describe('fonte oficial congelada IT2025.002 v1.71', () => {
  const catalogo = lerCatalogoRtc();
  it('confere SHA-256, 18 CST e 173 classificações oficiais', () => {
    assert.equal(catalogo.csts.length, 18);
    assert.equal(catalogo.classificacoes.length, 173);
    assert.equal(catalogo.manifesto.versao, nova);
  });
  it('preserva indicadores de DIR, modelos, doação, créditos e tratamentos', () => {
    const integral = catalogo.classificacoes.find((linha) => linha.codigo === '000001')!;
    assert.equal(integral.indicadores.indDIR, 1);
    assert.equal(integral.indicadores.indNFCe, 1);
    assert.equal(integral.indicadores.tpDoacao, 2);
    assert.equal(integral.inicio_vigencia, '2026-01-01');
    const auto = catalogo.classificacoes.find((linha) => linha.codigo === '000003')!;
    assert.equal(auto.indicadores.ind_gCredPresOper, 1);
    assert.equal(auto.indicadores.indCredPresOper, 1);
    assert.equal(auto.indicadores.indNFCe, 0);
    assert.ok(catalogo.csts.find((linha) => linha.cst === '510')!.indicadores.ind_gDif);
    assert.ok(catalogo.classificacoes.find((linha) => linha.codigo === '200003')!.percentual_reducao_ibs);
  });
  it('reproduz a migração versionada sem sobrescrever edições ou documentos', () => {
    const sql = gerarMigracaoCatalogoRtc();
    const salvo = fs.readFileSync('supabase/migrations/20261031142806_atualizar_catalogo_rtc_it_2025_002_v171.sql', 'utf8');
    assert.equal(sql.replace(/\r\n/g, '\n'), salvo.replace(/\r\n/g, '\n'));
    assert.equal((sql.match(/ON CONFLICT DO NOTHING/g) ?? []).length, 2);
    assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE|ALTER)\b/i);
    assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  });
});
