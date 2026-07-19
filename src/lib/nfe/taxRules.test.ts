import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDetXml } from './xmlItem';
import { getRequiredPisCofinsMode, PIS_COFINS_CST_OPTIONS, validateNFeItemTax } from './taxRules';
import type { CRT, NFeItem } from './types';

const baseItem: NFeItem = {
  numeroItem: 1,
  codigoProduto: '1',
  descricao: 'PECA',
  ncm: '87089990',
  cfop: '5102',
  unidade: 'UN',
  quantidade: 1,
  valorUnitario: 100,
  valorTotal: 100,
  orig: '0',
  pis: { cst: '07', modo: 'NAO_TRIBUTADO' },
  cofins: { cst: '07', modo: 'NAO_TRIBUTADO' },
};

function codes(item: NFeItem, crt: CRT) {
  return validateNFeItemTax(item, crt).map((issue) => issue.code);
}

describe('matriz CRT da NF-e modelo 55', () => {
  it('aceita CSOSN no CRT 1 e rejeita CST comum', () => {
    assert.deepEqual(codes({ ...baseItem, csosn: '102' }, 1), []);
    assert.ok(codes({ ...baseItem, csosn: '102', cst: '00' }, 1).includes('NFE_ICMS_CST_FORBIDDEN'));
  });

  it('exige CST e proíbe CSOSN nos CRT 2 e 3', () => {
    for (const crt of [2, 3] as const) {
      assert.ok(codes({ ...baseItem, csosn: '102' }, crt).includes('NFE_CSOSN_FORBIDDEN'));
      assert.deepEqual(codes({ ...baseItem, cst: '00', aliquotaIcms: 18, baseCalculoIcms: 100 }, crt), []);
    }
  });

  it('restringe CSOSN e crédito do Simples no CRT 4', () => {
    assert.deepEqual(codes({ ...baseItem, csosn: '102' }, 4), []);
    assert.ok(codes({ ...baseItem, csosn: '101' }, 4).includes('NFE_MEI_CSOSN_NOT_ALLOWED'));
    assert.ok(codes({ ...baseItem, csosn: '102', pCredSN: 1 }, 4).includes('NFE_MEI_CREDIT_FORBIDDEN'));
  });
});

describe('grupos do XML', () => {
  it('não cria base zero no grupo PIS/COFINS não tributado', () => {
    const xml = buildDetXml({ ...baseItem, csosn: '102' }, 1);
    assert.match(xml, /<PISNT><CST>07<\/CST><\/PISNT>/);
    assert.doesNotMatch(xml, /<PISNT>[\s\S]*<vBC>/);
  });

  it('mantém ICMS atual e RTC em camadas paralelas', () => {
    const xml = buildDetXml({
      ...baseItem,
      cst: '00',
      aliquotaIcms: 18,
      baseCalculoIcms: 100,
      rtc: {
        cstIbsCbs: '000',
        cClassTrib: '000001',
        baseCalculo: 100,
        ibsUf: { aliquota: 0.1, valor: 0.1 },
        ibsMunicipio: { aliquota: 0, valor: 0 },
        valorIbs: 0.1,
        cbs: { aliquota: 0.9, valor: 0.9 },
        versaoClassificacao: 'IT2025.002-v1.60-2026-06-22',
        validadoEm: '2026-07-19T12:00:00.000Z',
      },
    }, 3);
    assert.match(xml, /<ICMS00>/);
    assert.match(xml, /<IBSCBS>/);
    assert.match(xml, /<gIBSUF>/);
    assert.match(xml, /<gIBSMun>/);
    assert.match(xml, /<gCBS>/);
  });
});

describe('CST de PIS e COFINS', () => {
  it('mantém a lista sem códigos duplicados', () => {
    const values = PIS_COFINS_CST_OPTIONS.map((option) => option.value);
    assert.equal(values.length, 33);
    assert.equal(new Set(values).size, values.length);
  });

  it('determina somente os modos impostos pelo CST', () => {
    assert.equal(getRequiredPisCofinsMode('01'), 'PERCENTUAL');
    assert.equal(getRequiredPisCofinsMode('03'), 'QUANTIDADE');
    assert.equal(getRequiredPisCofinsMode('07'), 'NAO_TRIBUTADO');
    assert.equal(getRequiredPisCofinsMode('49'), null);
    assert.equal(getRequiredPisCofinsMode('99'), null);
  });
});
