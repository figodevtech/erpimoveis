// Base do IBS/CBS pela composição oficial (NT 2025.002-RTC, RV UB16-10):
// vBC = vProd + vServ + vFrete + vSeg + vOutro + vII − vDesc − vPIS − vCOFINS
//       − vPISST (salvo indSomaPISST=1) − vCOFINSST (salvo indSomaCOFINSST=1)
//       − vICMS − vICMSUFDest − vFCP − vFCPUFDest − vICMSMono − vISSQN + vIS

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { baseIbsCbsDoItem, baseRtcParaEdicao, comporBaseIbsCbs, issuesBaseIbsCbs, resolverRtcDoItem } from './baseIbsCbs';
import type { NFeItem } from './types';

const DATA = '2026-09-18T12:00:00-03:00';

function rtc(): NonNullable<NFeItem['rtc']> {
  return {
    cstIbsCbs: '000',
    cClassTrib: '000001',
    baseCalculo: 0,
    ibsUf: { aliquota: 0.1, valor: 0 },
    ibsMunicipio: { aliquota: 0, valor: 0 },
    valorIbs: 0,
    cbs: { aliquota: 0.9, valor: 0 },
  };
}

function item(extra: Partial<NFeItem> = {}): NFeItem {
  return {
    numeroItem: 1,
    codigoProduto: '1',
    descricao: 'PECA',
    ncm: '87089990',
    cfop: '6102',
    unidade: 'UN',
    quantidade: 1,
    valorUnitario: 1000,
    valorTotal: 1000,
    orig: '0',
    pis: { cst: '01', modo: 'PERCENTUAL', aliquota: 1.65 },
    cofins: { cst: '01', modo: 'PERCENTUAL', aliquota: 7.6 },
    rtc: rtc(),
    ...extra,
  };
}

describe('base IBS/CBS — composição da UB16-10', () => {
  it('desconta desconto, PIS, COFINS, ICMS e FCP próprios e soma frete, seguro e despesas', () => {
    const composicao = comporBaseIbsCbs({
      vProd: 1000, vDesc: 50, vFrete: 100, vSeg: 10, vOutro: 5,
      vPIS: 16.5, vCOFINS: 76, vICMS: 189, vFCP: 21,
      modFrete: '0', dataEmissao: DATA,
    });
    assert.equal(composicao.baseCalculada, 762.5);
    assert.equal(composicao.baseCalculo, 762.5);
    assert.equal(composicao.origem, 'COMPOSICAO');
    assert.equal(composicao.inconsistencia, null);
  });

  it('desconta o DIFAL e o FCP de destino', () => {
    const composicao = comporBaseIbsCbs({ vProd: 1000, vICMSUFDest: 60, vFCPUFDest: 20, modFrete: '9', dataEmissao: DATA });
    assert.equal(composicao.baseCalculada, 920);
  });

  it('subtrai PIS-ST e COFINS-ST quando eles não compõem o total da NF-e', () => {
    const composicao = comporBaseIbsCbs({
      vProd: 1000,
      vPISST: 30,
      vCOFINSST: 70,
      indSomaPISST: false,
      indSomaCOFINSST: false,
      modFrete: '9',
      dataEmissao: DATA,
    });
    assert.equal(composicao.baseCalculada, 900);
  });

  it('não subtrai PIS-ST/COFINS-ST quando indSoma*=1 (exceções 1 e 2)', () => {
    const composicao = comporBaseIbsCbs({
      vProd: 1000,
      vPISST: 30,
      vCOFINSST: 70,
      indSomaPISST: true,
      indSomaCOFINSST: true,
      modFrete: '9',
      dataEmissao: DATA,
    });
    assert.equal(composicao.baseCalculada, 1000);
    assert.equal(composicao.componentes.indSomaPISST, true);
    assert.equal(composicao.componentes.indSomaCOFINSST, true);
  });

  it('frete cobrado na nota entra qualquer que seja a modalidade de transporte', () => {
    for (const modFrete of ['0', '1', '2', '3', '4']) {
      const composicao = comporBaseIbsCbs({ vProd: 1000, vFrete: 100, modFrete, dataEmissao: DATA });
      assert.equal(composicao.baseCalculada, 1100, `modFrete ${modFrete}`);
      assert.equal(composicao.inconsistencia, null, `modFrete ${modFrete}`);
    }
  });

  it('frete pago pelo adquirente fora da nota (vFrete 0) não entra', () => {
    assert.equal(comporBaseIbsCbs({ vProd: 1000, vFrete: 0, modFrete: '1', dataEmissao: DATA }).baseCalculada, 1000);
  });

  it('modFrete 9 com frete é incoerente e bloqueia', () => {
    const composicao = comporBaseIbsCbs({ vProd: 1000, vFrete: 100, modFrete: '9', dataEmissao: DATA });
    assert.match(composicao.inconsistencia ?? '', /modFrete 9/);
    const alvo = item({ valorFrete: 100 });
    resolverRtcDoItem(alvo, { modFrete: '9', dataEmissao: DATA }, {});
    assert.deepEqual(issuesBaseIbsCbs(alvo.rtc).map((issue) => [issue.code, issue.severidade]), [['NFE_IBSCBS_BASE_INVALIDA', 'BLOQUEIO']]);
  });
});

describe('base IBS/CBS — lida do item já resolvido', () => {
  it('CST 00: tira o ICMS próprio e o FCP do grupo canônico', () => {
    const alvo = item({
      icms: {
        grupoXml: 'ICMS00', orig: '0', cst: '00', csosn: null, modBC: '3', pRedBC: null, vBC: 1000, pICMS: 18, vICMS: 180,
        vBCFCP: null, pFCP: 2, vFCP: 20, vICMSOp: null, pDif: null, vICMSDif: null, modBCST: null, pMVAST: null,
        pRedBCST: null, vBCST: null, pICMSST: null, vICMSST: null, vBCFCPST: null, pFCPST: null, vFCPST: null,
        vBCSTRet: null, pST: null, vICMSSubstituto: null, vICMSSTRet: null, vBCFCPSTRet: null, pFCPSTRet: null,
        vFCPSTRet: null, pRedBCEfet: null, vBCEfet: null, pICMSEfet: null, vICMSEfet: null, vICMSDeson: null,
        motDesICMS: null, pCredSN: null, vCredICMSSN: null,
      },
    });
    // 1000 − PIS 16,50 − COFINS 76,00 − ICMS 180 − FCP 20
    assert.equal(baseIbsCbsDoItem(alvo, { modFrete: '9', dataEmissao: DATA }).baseCalculada, 707.5);
  });

  it('CST 60 (sem ICMS próprio) e PIS/COFINS não tributados: base é o valor da operação', () => {
    const alvo = item({
      pis: { cst: '04', modo: 'NAO_TRIBUTADO' },
      cofins: { cst: '04', modo: 'NAO_TRIBUTADO' },
      valorFrete: 100,
    });
    assert.equal(baseIbsCbsDoItem(alvo, { modFrete: '0', dataEmissao: DATA }).baseCalculada, 1100);
  });

  it('com DIFAL resolvido no item, a base desconta vICMSUFDest e vFCPUFDest', () => {
    const alvo = item({
      pis: { cst: '04', modo: 'NAO_TRIBUTADO' },
      cofins: { cst: '04', modo: 'NAO_TRIBUTADO' },
      icmsUfDest: {
        vBCUFDest: 1000, vBCFCPUFDest: 1000, pFCPUFDest: 2, pICMSUFDest: 18, pICMSInter: 12,
        pICMSInterPart: 100, vFCPUFDest: 20, vICMSUFDest: 60, vICMSUFRemet: 0,
      },
    });
    resolverRtcDoItem(alvo, { modFrete: '9', dataEmissao: DATA }, {});
    assert.equal(alvo.rtc?.baseCalculo, 920);
    assert.equal(alvo.rtc?.cbs.valor, 8.28);
    assert.equal(alvo.rtc?.ibsUf.valor, 0.92);
  });

  it('consome PIS-ST/COFINS-ST explícitos do item sem inventar valores', () => {
    const alvo = item({
      pis: { cst: '04', modo: 'NAO_TRIBUTADO' },
      cofins: { cst: '04', modo: 'NAO_TRIBUTADO' },
      pisST: { modo: 'PERCENTUAL', base: 1000, aliquota: 3, valor: 30, compoeTotal: false },
      cofinsST: { modo: 'PERCENTUAL', base: 1000, aliquota: 7, valor: 70, compoeTotal: true },
    });
    const composicao = baseIbsCbsDoItem(alvo, { modFrete: '9', dataEmissao: DATA });
    assert.equal(composicao.baseCalculada, 970);
    assert.equal(composicao.componentes.vPISST, 30);
    assert.equal(composicao.componentes.vCOFINSST, 70);
  });

  it('base digitada diferente da composição vira aviso citando a UB16-10, sem bloquear', () => {
    const alvo = item({ pis: { cst: '04', modo: 'NAO_TRIBUTADO' }, cofins: { cst: '04', modo: 'NAO_TRIBUTADO' } });
    resolverRtcDoItem(alvo, { modFrete: '9', dataEmissao: DATA }, { base: 900 });
    const [aviso] = issuesBaseIbsCbs(alvo.rtc);
    assert.equal(aviso.code, 'NFE_IBSCBS_BASE_MANUAL');
    assert.equal(aviso.severidade, 'AVISO');
    assert.equal(aviso.requerCiencia, true);
    assert.match(aviso.message, /UB16-10/);
    assert.equal(baseRtcParaEdicao(alvo.rtc), '900');
  });

  it('reabrir rascunho não congela como manual uma base que era calculada', () => {
    const alvo = item();
    resolverRtcDoItem(alvo, { modFrete: '9', dataEmissao: DATA }, {});
    assert.equal(baseRtcParaEdicao(alvo.rtc), '');
  });
});
