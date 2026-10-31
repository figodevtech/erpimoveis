import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNFePreviewXml } from './buildNFe';
import { calcularTotaisNFe, valorTotalItemNFe } from './fiscal';
import { calcularIcmsItem } from './icms';
import { destinatario, empresa, item, rtcTeste } from './icms/fixtures/nfe';
import { comAssinaturaXsdTeste, validarNFeContraXsd } from './icms/__xsdOficial';
import { resolverReferenciasNFe } from './referencias-nfe';
import { buildDetXml } from './xmlItem';
import { normalizarNiveisDeReferencia } from './xmlIde';
import type { NFeIde, NFeItem } from './types';

const chave = '35260812345678000199550010000001231000001234';
const outraChave = '35260812345678000199550010000001241000001234';
const ide = (data: string, tpAmb: 1 | 2 = 1): Pick<NFeIde, 'finNFe' | 'tpAmb' | 'dhEmi'> =>
  ({ finNFe: 4, tpAmb, dhEmi: `${data}T12:00:00-03:00` });
const devolvido = (parcial: boolean): NFeItem => ({
  ...item, cfop: '5202', quantidade: parcial ? 0.5 : 1,
  valorTotal: parcial ? 5 : 10, dfeReferenciado: { chaveAcesso: chave },
});

describe('NT 2025.002 v1.53 — alternativas de devolução e vigência', () => {
  for (const parcial of [false, true]) {
    it(`permite devolução ${parcial ? 'parcial' : 'total'} no cabeçalho ou por item com nItem opcional`, () => {
      const origem = { chaveAcesso: chave };
      assert.deepEqual(resolverReferenciasNFe(ide('2026-11-16'), [{ ...devolvido(parcial), dfeReferenciado: undefined }], [origem]), [origem]);
      assert.deepEqual(resolverReferenciasNFe(ide('2026-11-16'), [devolvido(parcial)], []), []);
      assert.match(buildDetXml(devolvido(parcial), 1), /<DFeReferenciado><chaveAcesso>\d{44}<\/chaveAcesso><\/DFeReferenciado>/);
    });
  }
  it('aplica B25-40 em produção em 16/11 e homologação em 09/11', () => {
    const refs = [{ chaveAcesso: chave }, { chaveAcesso: outraChave }];
    for (const [amb, antes, inicio] of [[1, '2026-11-15', '2026-11-16'], [2, '2026-11-08', '2026-11-09']] as const) {
      assert.equal(resolverReferenciasNFe(ide(antes, amb), [item], refs).length, 2);
      assert.throws(() => resolverReferenciasNFe(ide(inicio, amb), [item], refs), /B25-40/);
    }
  });
  it('exige origem em cada item quando não há referência no cabeçalho, preservando exceção CFOP', () => {
    assert.throws(() => resolverReferenciasNFe(ide('2026-11-16'), [devolvido(false), { ...item, numeroItem: 2 }]), /VC02-14/);
    assert.doesNotThrow(() => resolverReferenciasNFe(ide('2026-11-16'), [{ ...item, cfop: '5921' }]));
  });
  it('aceita vários itens da mesma origem sem ativar a rejeição futura de duplicidade', () => {
    assert.deepEqual(resolverReferenciasNFe(ide('2026-11-16'), [devolvido(false), { ...devolvido(true), numeroItem: 2 }]), []);
  });
  it('rejeita origens distintas nos itens e não descarta cabeçalho conflitante', () => {
    assert.throws(() => resolverReferenciasNFe(ide('2026-11-16'), [devolvido(false), { ...devolvido(true), dfeReferenciado: { chaveAcesso: outraChave } }]), /VC02-30/);
    assert.throws(() => resolverReferenciasNFe(ide('2026-11-16'), [devolvido(false)], [{ chaveAcesso: outraChave }]), /CONFLITANTES/);
  });
  it('recusa chave curta e nItem fora do XSD', () => {
    assert.throws(() => buildDetXml({ ...devolvido(false), dfeReferenciado: { chaveAcesso: '123' } }, 1), /DFE_REFERENCIADO_INVALIDO/);
    assert.throws(() => buildDetXml({ ...devolvido(false), dfeReferenciado: { chaveAcesso: chave, nItem: 991 } }, 1), /NITEM_INVALIDO/);
  });
  it('impede descarte de origem diferente na recuperação de rascunho legado', () => {
    const xml = `<NFe><infNFe><ide><NFref><refNFe>${outraChave}</refNFe></NFref></ide><det><DFeReferenciado><chaveAcesso>${chave}</chaveAcesso></DFeReferenciado></det></infNFe></NFe>`;
    assert.throws(() => normalizarNiveisDeReferencia(xml), /CONFLITANTES/);
  });
});

describe('VB01-10 / W60-10 — composição e somatório dos valores emitidos', () => {
  it('soma o diferimento efetivamente destacado nos grupos de IBS/CBS', () => {
    const rtc = rtcTeste(10);
    const comDiferimento = { ...item, rtc: { ...rtc,
      ibsUf: { ...rtc.ibsUf, percentualDiferimento: 10, valorDiferido: 0.01 },
      ibsMunicipio: { ...rtc.ibsMunicipio, percentualDiferimento: 10, valorDiferido: 0.02 },
      cbs: { ...rtc.cbs, percentualDiferimento: 10, valorDiferido: 0.03 },
    } };
    const { xml } = buildNFePreviewXml(empresa, 998, 1, [comDiferimento, { ...comDiferimento, numeroItem: 2 }], destinatario('SP'), { indFinal: 1, nomeMunicipioEmitente: 'SAO PAULO' });
    assert.match(xml, /<IBSCBSTot>.*<gIBSUF><vDif>0\.02<\/vDif>.*<gIBSMun><vDif>0\.04<\/vDif>.*<gCBS><vDif>0\.06<\/vDif>/);
  });
  it('soma frete, ST, FCP-ST, IPI calculado e IPI devolvido sem duplicar impostos', () => {
    const resultado = calcularIcmsItem({ crt: 1, csosn: '202', orig: '0', valorOperacao: 10,
      st: { modBCST: '4', vBCST: 20, pICMSST: 18, vICMSST: 3.6 },
      fcpSt: { vBCFCPST: 20, pFCPST: 2, vFCPST: 0.4 },
    });
    assert.ok(resultado.valores);
    const tributado: NFeItem = { ...item, csosn: '202', icms: resultado.valores, cest: '0100100',
      valorDesconto: 1, valorFrete: 2, cstIpi: '50', baseCalculoIpi: 10, aliquotaIpi: 5,
      percentualDevolucao: 50, valorIpiDevolvido: 0.25, rtc: rtcTeste(9),
    };
    assert.equal(valorTotalItemNFe(tributado, 1, '2026-12-31T12:00:00-03:00'), 15.75);
    assert.equal(calcularTotaisNFe([tributado], 1).vIPI, 0.5);
    assert.match(buildDetXml(tributado, 1), /<vItem>15\.75<\/vItem>/);
  });
  it('exclui IBS/CBS/IS em 2026 e preserva vProd sem incorporá-los em 2027', () => {
    const tributado = { ...item, rtc: rtcTeste(10), impostoSeletivo: { cst: '000', cClassTrib: '000001', baseCalculo: 10, aliquota: 2, valor: 0.2 } };
    assert.equal(valorTotalItemNFe(tributado, 1, '2026-12-31T23:59:59-03:00'), 10);
    assert.equal(valorTotalItemNFe(tributado, 1, '2027-01-01T00:00:00-03:00'), 10);
    assert.equal(valorTotalItemNFe(tributado, 1, '2027-01-01T00:00:00-03:00', 'RTC_2027'), 10.31);
    assert.throws(() => valorTotalItemNFe(tributado, 1, '2026-12-31T23:59:59-03:00', 'RTC_2027'), /VIGENCIA/);
    const xml = buildDetXml(tributado, 1, '2027-01-01T00:00:00-03:00', 'RTC_2027');
    assert.match(xml, /<vProd>10\.00<\/vProd>/);
    assert.match(xml, /<vItem>10\.31<\/vItem>/);
  });
  for (const modelo of [55, 65] as const) {
    it(`totaliza ${modelo} em centavos a partir dos valores serializados e valida XSD`, async () => {
      const itens = [1, 2, 3].map((numeroItem) => ({ ...item, numeroItem,
        valorTotal: 10.004, valorUnitario: 10.004, valorDesconto: 0.004,
        cstIpi: '50', baseCalculoIpi: 10, aliquotaIpi: 0.04,
        pis: { cst: '01', modo: 'PERCENTUAL' as const, base: 10, aliquota: 0.04 },
        cofins: { cst: '01', modo: 'PERCENTUAL' as const, base: 10, aliquota: 0.04 },
        rtc: rtcTeste(10),
      }));
      const { xml } = buildNFePreviewXml(empresa, 999, 1, itens, destinatario('SP'), { modelo, indFinal: 1, nomeMunicipioEmitente: 'SAO PAULO' });
      assert.match(xml, /<vProd>30\.00<\/vProd>/);
      assert.match(xml, /<vNF>30\.00<\/vNF>/);
      assert.match(xml, /<vNFTot>30\.00<\/vNFTot>/);
      assert.equal(calcularTotaisNFe(itens, 1).vPIS, 0);
      assert.equal(calcularTotaisNFe(itens, 1).vCOFINS, 0);
      const validacao = await validarNFeContraXsd(comAssinaturaXsdTeste(xml));
      assert.equal(validacao.valido, true, validacao.erros.join('\n'));
    });
  }
});
