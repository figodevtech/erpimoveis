import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDetXml } from './xmlItem';
import {
  getRequiredPisCofinsMode,
  NFE_FISCAL_RULE_VERSION,
  PIS_COFINS_CST_OPTIONS,
  rascunhoPrecisaSerRegerado,
  RTC_REGULAR_REQUIRED_FROM,
  validateNFeItemTax,
} from './taxRules';
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

// A matriz de ICMS é anterior à reforma e vale nos dois lados do marco de
// 03/08/2026. Fixamos a data de emissão para o IBS/CBS não poluir as asserções
// de CSOSN/CST; a obrigatoriedade do grupo tem teste próprio abaixo.
const ANTES_DO_MARCO_RTC = new Date("2026-07-01T10:00:00-03:00");

function codes(item: NFeItem, crt: CRT, issueDate = ANTES_DO_MARCO_RTC) {
  return validateNFeItemTax(item, crt, { issueDate }).map((issue) => issue.code);
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

  it('não exige IBS/CBS no regime regular antes do marco de 03/08/2026', () => {
    const vespera = new Date('2026-08-02T23:59:00-03:00');
    const item = { ...baseItem, cst: '00', aliquotaIcms: 18, baseCalculoIcms: 100 };
    assert.deepEqual(codes(item, 3, vespera), []);
  });

  it('exige IBS/CBS no regime regular a partir do marco de 03/08/2026', () => {
    // A orientação operacional prevê rejeição do regime regular sem IBS/CBS a
    // partir dessa data; o motor precisa barrar antes de mandar para a SEFAZ.
    const marco = new Date(`${RTC_REGULAR_REQUIRED_FROM}T00:00:00-03:00`);
    const item = { ...baseItem, cst: '00', aliquotaIcms: 18, baseCalculoIcms: 100 };
    assert.deepEqual(codes(item, 3, marco), ['NFE_IBSCBS_REQUIRED']);

    // Com o grupo preenchido e a classificação vigente, volta a passar.
    const comRtc = validateNFeItemTax(
      {
        ...item,
        rtc: {
          cstIbsCbs: '000',
          cClassTrib: '000001',
          baseCalculo: 100,
          ibsUf: { aliquota: 0.05, valor: 0.05 },
          ibsMunicipio: { aliquota: 0.05, valor: 0.05 },
          valorIbs: 0.1,
          cbs: { aliquota: 0.9, valor: 0.9 },
        },
      },
      3,
      {
        issueDate: marco,
        classificacaoRtc: {
          codigo: '000001',
          cst: '000',
          nome: 'Tributacao integral',
          inicioVigencia: '2026-01-01',
          permiteNfe: true,
          versaoFonte: 'IT2025.002-v1.60-2026-06-22',
        },
      },
    );
    assert.deepEqual(comRtc.map((issue) => issue.code), []);
  });

  it('mantém o Simples fora da obrigatoriedade de IBS/CBS do regime regular', () => {
    // CRT 1, 2 e 4 seguem o cronograma próprio do Simples: o marco do regime
    // regular não pode ser copiado para eles.
    const marco = new Date(`${RTC_REGULAR_REQUIRED_FROM}T00:00:00-03:00`);
    assert.deepEqual(codes({ ...baseItem, csosn: '102' }, 1, marco), []);
    assert.deepEqual(codes({ ...baseItem, csosn: '102' }, 4, marco), []);
    assert.deepEqual(
      codes({ ...baseItem, cst: '00', aliquotaIcms: 18, baseCalculoIcms: 100 }, 2, marco),
      [],
    );
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

describe('rascunho montado com regra fiscal anterior', () => {
  it('exige salvar de novo antes de transmitir', () => {
    assert.equal(rascunhoPrecisaSerRegerado({ status: 'RASCUNHO', versao_regra_fiscal: 'regras_nfe@2026-07-19' }), true);
    assert.equal(rascunhoPrecisaSerRegerado({ status: 'REJEITADA', versao_regra_fiscal: null }), true);
    assert.equal(rascunhoPrecisaSerRegerado({ status: 'RASCUNHO', versao_regra_fiscal: NFE_FISCAL_RULE_VERSION }), false);
  });

  it('não barra o que já foi à SEFAZ ou saiu em contingência', () => {
    for (const status of ['CONTINGENCIA', 'ENVIADA', 'RESULTADO_INCERTO', 'AUTORIZADA']) {
      assert.equal(rascunhoPrecisaSerRegerado({ status, versao_regra_fiscal: 'antiga' }), false, status);
    }
  });
});
