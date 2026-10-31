// Conformidade estrutural com o XSD OFICIAL da NF-e, independente do modelo
// interno do ERP. Dois tipos de prova:
//
// 1. A ordem de campos do serializador (ORDEM_XSD_ICMS) é comparada com a
//    sequência lida do próprio leiauteNFe_v4.00.xsd: nenhum campo fora do
//    grupo, nenhuma inversão de ordem.
// 2. Uma NF-e completa, montada pelo motor para cada grupo ICMS suportado, é
//    validada pelo libxml2 contra o pacote vigente. Casos negativos provam que
//    a validação recusa campo inexistente e tipo inválido.
//
// Pacote: schemas/nfe/PL_010f_NT2025_002_v1.50 (ver __xsdOficial.ts).
// Regra do motor: NFE_ICMS_RULE_VERSION (tratamento.ts).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildNFePreviewXml } from '../buildNFe';
import { calcularIcmsItem, montarDecisaoIcms, NFE_ICMS_RULE_VERSION, ORDEM_XSD_ICMS, type EntradaIcms } from '.';
import {
  comAssinaturaXsdTeste,
  elementosDoGrupoNoXsd,
  PACOTE_XSD_VIGENTE,
  sha256XsdCanonico,
  validarIntegridadeXsd,
  validarNFeContraXsd,
} from './__xsdOficial';
import { destinatario, empresa, item, rtcTeste } from './fixtures/nfe';

const XSD_INTEGRIDADE_LF = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
  '  <xs:element name="raiz" type="xs:string"/>',
  '</xs:schema>',
  '',
].join('\n');

describe('integridade canônica dos arquivos XSD', () => {
  const hashEsperado = sha256XsdCanonico(XSD_INTEGRIDADE_LF);
  const validar = (conteudo: string, hash = hashEsperado) =>
    validarIntegridadeXsd(Buffer.from(conteudo, 'utf8'), hash, 'fixture.xsd');

  it('aceita o conteúdo canônico com LF', () => {
    assert.doesNotThrow(() => validar(XSD_INTEGRIDADE_LF));
  });

  it('aceita exatamente o mesmo conteúdo com CRLF', () => {
    assert.doesNotThrow(() => validar(XSD_INTEGRIDADE_LF.replace(/\n/g, '\r\n')));
  });

  it('aceita exatamente o mesmo conteúdo com CR isolado', () => {
    assert.doesNotThrow(() => validar(XSD_INTEGRIDADE_LF.replace(/\n/g, '\r')));
  });

  it('rejeita a mudança de um caractere real', () => {
    assert.throws(() => validar(XSD_INTEGRIDADE_LF.replace('UTF-8', 'UTF-9')), /XSD alterado/);
  });

  it('rejeita a mudança de uma tag', () => {
    assert.throws(() => validar(XSD_INTEGRIDADE_LF.replace('xs:element', 'xs:attribute')), /XSD alterado/);
  });

  it('rejeita a remoção de um elemento', () => {
    assert.throws(
      () => validar(XSD_INTEGRIDADE_LF.replace('  <xs:element name="raiz" type="xs:string"/>\n', '')),
      /XSD alterado/,
    );
  });

  it('rejeita hash incorreto vindo do manifesto', () => {
    assert.throws(() => validar(XSD_INTEGRIDADE_LF, '0'.repeat(64)), /XSD alterado/);
  });
});

const st = { modBCST: '4', pMVAST: 40, pICMSST: 18, vICMSST: 72 };
const creditoSn = { pCredSN: 2 };
const stRetida = { vBCSTRet: 1000, pST: 18, vICMSSubstituto: 100, vICMSSTRet: 80 };

/** Um caso por grupo e pelas variações de bloco que o motor sabe montar. */
const CASOS: Array<{ nome: string; entrada: Partial<EntradaIcms> }> = [
  { nome: 'ICMS00 com FCP', entrada: { cst: '00', fcp: { pFCP: 2 } } },
  { nome: 'ICMS10 com FCP e FCP-ST', entrada: { cst: '10', st, fcp: { pFCP: 2 }, fcpSt: { pFCPST: 2 } } },
  { nome: 'ICMS20 com desoneração', entrada: { cst: '20', proprio: { pRedBC: 20 }, desoneracao: { vICMSDeson: 36, motDesICMS: '9' } } },
  { nome: 'ICMS30', entrada: { cst: '30', st, fcpSt: { pFCPST: 2 } } },
  { nome: 'ICMS40 com desoneração', entrada: { cst: '40', desoneracao: { vICMSDeson: 180, motDesICMS: '9' } } },
  { nome: 'ICMS40 (CST 41) vazio', entrada: { cst: '41' } },
  { nome: 'ICMS51 diferimento parcial com FCP', entrada: { cst: '51', diferimento: { pDif: 50 }, fcp: { pFCP: 2 } } },
  { nome: 'ICMS51 diferimento total', entrada: { cst: '51', diferimento: { pDif: 100 } } },
  { nome: 'ICMS51 só orig/CST', entrada: { cst: '51' } },
  { nome: 'ICMS60 sem ST retida', entrada: { cst: '60' } },
  {
    nome: 'ICMS60 com ST retida, FCP-ST retido e ICMS efetivo',
    entrada: {
      cst: '60',
      stRetida,
      fcpStRetido: { vBCFCPSTRet: 1000, pFCPSTRet: 2, vFCPSTRet: 20 },
      icmsEfetivo: { pRedBCEfet: 0, vBCEfet: 1000, pICMSEfet: 18, vICMSEfet: 180 },
    },
  },
  { nome: 'ICMS70', entrada: { cst: '70', proprio: { pRedBC: 20 }, st, fcp: { pFCP: 2 }, fcpSt: { pFCPST: 2 } } },
  { nome: 'ICMS90 só orig/CST', entrada: { cst: '90' } },
  {
    nome: 'ICMS90 com próprio, redução, FCP, ST e desoneração',
    entrada: { cst: '90', proprio: { destacar: true, pRedBC: 20 }, st, fcp: { pFCP: 2 }, fcpSt: { pFCPST: 2 }, desoneracao: { vICMSDeson: 36, motDesICMS: '9' } },
  },
  { nome: 'ICMS90 com diferimento', entrada: { cst: '90', proprio: { destacar: true }, diferimento: { pDif: 50 } } },
  { nome: 'ICMSSN101', entrada: { crt: 1, csosn: '101', creditoSn } },
  { nome: 'ICMSSN102', entrada: { crt: 1, csosn: '102' } },
  { nome: 'ICMSSN102 (CSOSN 400)', entrada: { crt: 1, csosn: '400' } },
  { nome: 'ICMSSN201', entrada: { crt: 1, csosn: '201', st, creditoSn, fcpSt: { pFCPST: 2 } } },
  { nome: 'ICMSSN202', entrada: { crt: 1, csosn: '202', st, fcpSt: { pFCPST: 2 } } },
  { nome: 'ICMSSN202 (CSOSN 203)', entrada: { crt: 1, csosn: '203', st } },
  { nome: 'ICMSSN500 com ST retida', entrada: { crt: 1, csosn: '500', stRetida } },
  { nome: 'ICMSSN900 com próprio, ST e crédito', entrada: { crt: 1, csosn: '900', proprio: { destacar: true, pRedBC: 20 }, st, creditoSn } },
];

function nfeCompleta(entrada: Partial<EntradaIcms>) {
  const crt = entrada.crt ?? 3;
  const resultado = calcularIcmsItem({ crt, orig: '0', valorOperacao: 1000, aliquotaIcms: 18, ...entrada } as EntradaIcms);
  assert.deepEqual(resultado.issues, [], 'o motor recusou o caso antes de chegar ao XML');
  assert.ok(resultado.valores);
  const { xml } = buildNFePreviewXml(
    { ...empresa, regimetributario: crt },
    1,
    1,
    [{
      ...item,
      valorTotal: 1000,
      valorUnitario: 1000,
      cest: '0104700',
      cst: entrada.cst,
      cstIcms: entrada.cst,
      csosn: entrada.csosn,
      icms: resultado.valores,
      icmsDecisao: montarDecisaoIcms(resultado),
      rtc: rtcTeste(1000),
    }],
    destinatario('SP'),
    { nomeMunicipioEmitente: 'SAO PAULO', indFinal: 1 },
  );
  return comAssinaturaXsdTeste(xml);
}

describe(`XSD oficial ${PACOTE_XSD_VIGENTE} — ordem do serializador (${NFE_ICMS_RULE_VERSION})`, () => {
  for (const [grupo, campos] of Object.entries(ORDEM_XSD_ICMS)) {
    it(`${grupo}: todo campo existe no grupo e na ordem do XSD`, () => {
      const doXsd = elementosDoGrupoNoXsd(grupo).filter((nome) => !['orig', 'CST', 'CSOSN'].includes(nome));
      const fora = campos.filter((campo) => !doXsd.includes(campo));
      assert.deepEqual(fora, [], `${grupo}: campos que o XSD não tem`);
      const posicoes = campos.map((campo) => doXsd.indexOf(campo));
      assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b), `${grupo}: ordem diferente da do XSD`);
    });
  }
});

describe(`XSD oficial ${PACOTE_XSD_VIGENTE} — NF-e completa por grupo ICMS`, () => {
  for (const caso of CASOS) {
    it(`válida: ${caso.nome}`, async () => {
      const { valido, erros } = await validarNFeContraXsd(nfeCompleta(caso.entrada));
      assert.ok(valido, erros.join('\n'));
    });
  }

  it('o ICMS90 com diferimento sai com vICMSOp, pDif e vICMSDif entre pICMS e vICMS', () => {
    const xml = nfeCompleta({ cst: '90', proprio: { destacar: true }, diferimento: { pDif: 50 } });
    assert.match(xml, /<pICMS>18\.0000<\/pICMS><vICMSOp>180\.00<\/vICMSOp><pDif>50\.0000<\/pDif><vICMSDif>90\.00<\/vICMSDif><vICMS>90\.00<\/vICMS>/);
  });

  it('recusa campo inexistente no ICMS90', async () => {
    const xml = nfeCompleta({ cst: '90', proprio: { destacar: true } }).replace('</ICMS90>', '<campoInventado>1</campoInventado></ICMS90>');
    assert.equal((await validarNFeContraXsd(xml)).valido, false);
  });

  it('recusa campo de outro grupo dentro do ICMS90 (vBCSTRet é do ICMS60)', async () => {
    const xml = nfeCompleta({ cst: '90', proprio: { destacar: true } }).replace('</ICMS90>', '<vBCSTRet>10.00</vBCSTRet></ICMS90>');
    assert.equal((await validarNFeContraXsd(xml)).valido, false);
  });

  it('verifica tipo, não só a ordem', async () => {
    const xml = nfeCompleta({ cst: '00' }).replace('<vBC>1000.00</vBC>', '<vBC>abc</vBC>');
    assert.equal((await validarNFeContraXsd(xml)).valido, false);
  });
});

describe(`XSD oficial ${PACOTE_XSD_VIGENTE} — NFC-e modelo 65`, () => {
  for (const identificado of [false, true]) {
    it(`valida NFC-e com consumidor ${identificado ? 'identificado' : 'não identificado'}`, async () => {
      const { xml } = buildNFePreviewXml(
        empresa, 1, 1, [item], identificado ? destinatario('SP') : undefined,
        { modelo: 65, nomeMunicipioEmitente: 'SAO PAULO', indFinal: 1, indPres: 1 },
      );
      assert.match(xml, /<mod>65<\/mod>/);
      const resultado = await validarNFeContraXsd(comAssinaturaXsdTeste(xml));
      assert.ok(resultado.valido, resultado.erros.join('\n'));
    });
  }
});
