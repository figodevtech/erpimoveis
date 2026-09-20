// Núcleo de ICMS: a classificação é do usuário; o cálculo e a coerência entre
// XML, totais e banco são do ERP. O caso A é a regressão da NF-e 136 (CRT 3,
// CST 60, alíquota 20% no cadastro, R$ 11.000): o banco gravou ICMS próprio de
// R$ 2.200 enquanto o XML autorizado saiu com vBC/vICMS zerados.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calcularTotaisNFe } from '../fiscal';
import type { CRT, NFeItem } from '../types';
import { buildDetXml } from '../xmlItem';
import {
  calcularIcmsItem,
  freteNaBaseIcms,
  montarDecisaoIcms,
  papelStDoCfop,
  resolverTratamentoIcms,
  serializarIcms,
  validarCoerenciaCfopIcms,
  validarIcmsCanonico,
  type EntradaIcms,
  type IcmsCanonico,
  type ResultadoIcms,
} from '.';
import { stRetidaProporcional } from './stRetida';

function calcular(entrada: Partial<EntradaIcms> & { crt?: CRT }): ResultadoIcms {
  return calcularIcmsItem({ crt: 3, orig: '0', valorOperacao: 11000, ...entrada } as EntradaIcms);
}

function valores(resultado: ResultadoIcms): IcmsCanonico {
  assert.ok(resultado.valores, 'o núcleo deveria ter resolvido o grupo');
  return resultado.valores;
}

function codigos(resultado: ResultadoIcms) {
  return resultado.issues.map((issue) => issue.code);
}

function semBloqueio(resultado: ResultadoIcms) {
  assert.deepEqual(
    resultado.issues.filter((issue) => issue.severidade === 'BLOQUEIO').map((issue) => issue.message),
    [],
  );
  return resultado;
}

const itemBase: NFeItem = {
  numeroItem: 1,
  codigoProduto: '1964',
  descricao: 'UNIDADE DE CONTROLE VALVULA APM',
  ncm: '90328921',
  cest: '0104700',
  cfop: '6403',
  unidade: 'UN',
  quantidade: 1,
  valorUnitario: 11000,
  valorTotal: 11000,
  orig: '0',
  pis: { cst: '04', modo: 'NAO_TRIBUTADO' },
  cofins: { cst: '04', modo: 'NAO_TRIBUTADO' },
  // CRT 3 exige IBS/CBS desde 03/08/2026; o grupo corre em paralelo ao ICMS.
  rtc: {
    cstIbsCbs: '000',
    cClassTrib: '000001',
    baseCalculo: 11000,
    ibsUf: { aliquota: 0.1, valor: 11 },
    ibsMunicipio: { aliquota: 0, valor: 0 },
    valorIbs: 11,
    cbs: { aliquota: 0.9, valor: 99 },
    versaoClassificacao: 'IT2025.002-v1.60-2026-06-22',
    validadoEm: '2026-09-14T14:43:18.561Z',
  },
};

/** Lê de volta o grupo ICMS do <det> gerado: o que a SEFAZ vai receber. */
function lerGrupoIcms(xml: string) {
  const grupo = /<ICMS>(<(ICMS\w+)>([\s\S]*?)<\/\2>)<\/ICMS>/.exec(xml);
  assert.ok(grupo, 'grupo ICMS ausente');
  const campos: Record<string, string> = {};
  for (const [, nome, valor] of grupo[3].matchAll(/<(\w+)>([^<]*)<\/\1>/g)) campos[nome] = valor;
  return { grupo: grupo[2], campos, ordem: [...grupo[3].matchAll(/<(\w+)>/g)].map((m) => m[1]) };
}

function itemComIcms(resultado: ResultadoIcms, extra: Partial<NFeItem> = {}): NFeItem {
  const icms = valores(resultado);
  return {
    ...itemBase,
    cst: icms.cst,
    cstIcms: icms.cst,
    csosn: icms.csosn,
    icms,
    icmsDecisao: montarDecisaoIcms(resultado),
    ...extra,
  };
}

/** XML, totais e canônico precisam dizer a mesma coisa. */
function assertCoerente(resultado: ResultadoIcms, crt: CRT = 3, extra: Partial<NFeItem> = {}) {
  const item = itemComIcms(resultado, extra);
  const icms = valores(resultado);
  const { grupo, campos } = lerGrupoIcms(buildDetXml(item, crt));
  assert.equal(grupo, icms.grupoXml);
  for (const [campo, valor] of Object.entries(icms)) {
    if (['grupoXml', 'orig', 'cst', 'csosn'].includes(campo)) continue;
    if (valor === null) {
      assert.equal(campos[campo], undefined, `${campo} não deveria estar no XML`);
    } else {
      assert.equal(Number(campos[campo] ?? NaN), Number(valor), `${campo} diverge entre XML e canônico`);
    }
  }
  const totais = calcularTotaisNFe([item], crt);
  assert.equal(totais.vBC, Number(campos.vBC ?? 0));
  assert.equal(totais.vICMS, Number(campos.vICMS ?? 0));
  assert.equal(totais.vBCST, Number(campos.vBCST ?? 0));
  assert.equal(totais.vST, Number(campos.vICMSST ?? 0));
  assert.equal(totais.vFCP, Number(campos.vFCP ?? 0));
  assert.equal(totais.vFCPST, Number(campos.vFCPST ?? 0));
  assert.equal(totais.vFCPSTRet, Number(campos.vFCPSTRet ?? 0));
  assert.equal(totais.vICMSDeson, Number(campos.vICMSDeson ?? 0));
  return { item, campos };
}

describe('matriz CST/CSOSN → grupo ICMS', () => {
  const esperadoCst: Record<string, string> = {
    '00': 'ICMS00', '10': 'ICMS10', '20': 'ICMS20', '30': 'ICMS30', '40': 'ICMS40', '41': 'ICMS40',
    '50': 'ICMS40', '51': 'ICMS51', '60': 'ICMS60', '70': 'ICMS70', '90': 'ICMS90',
  };
  const esperadoCsosn: Record<string, string> = {
    '101': 'ICMSSN101', '102': 'ICMSSN102', '103': 'ICMSSN102', '201': 'ICMSSN201', '202': 'ICMSSN202',
    '203': 'ICMSSN202', '300': 'ICMSSN102', '400': 'ICMSSN102', '500': 'ICMSSN500', '900': 'ICMSSN900',
  };

  it('resolve os 11 CST para os CRT 2 e 3', () => {
    for (const crt of [2, 3] as const) {
      for (const [cst, grupo] of Object.entries(esperadoCst)) {
        assert.equal(resolverTratamentoIcms({ crt, cst })?.grupoXml, grupo, `CST ${cst}`);
      }
    }
  });

  it('resolve os 10 CSOSN para o CRT 1', () => {
    for (const [csosn, grupo] of Object.entries(esperadoCsosn)) {
      assert.equal(resolverTratamentoIcms({ crt: 1, csosn })?.grupoXml, grupo, `CSOSN ${csosn}`);
    }
  });

  it('não aceita CST no Simples nem CSOSN no regime normal', () => {
    assert.equal(resolverTratamentoIcms({ crt: 1, cst: '00' }), null);
    assert.equal(resolverTratamentoIcms({ crt: 3, csosn: '102' }), null);
  });

  it('só o grupo com ICMS próprio aceita base e valor próprios', () => {
    for (const [cst, esperado] of [['00', 'OBRIGATORIO'], ['60', 'PROIBIDO'], ['40', 'PROIBIDO'], ['90', 'OPCIONAL'], ['30', 'PROIBIDO']] as const) {
      assert.equal(resolverTratamentoIcms({ crt: 3, cst })?.blocos.proprio, esperado, `CST ${cst}`);
    }
  });
});

describe('caso A — regressão NF-e 136 (CRT 3, CST 60, alíquota 20%)', () => {
  it('não cria ICMS próprio só porque o cadastro tem alíquota', () => {
    const resultado = semBloqueio(calcular({ cst: '60', aliquotaIcms: 20, procedenciaAliquota: 'PRODUTO' }));
    const icms = valores(resultado);
    assert.equal(icms.grupoXml, 'ICMS60');
    assert.equal(icms.vBC, null);
    assert.equal(icms.pICMS, null);
    assert.equal(icms.vICMS, null);
    assert.equal(serializarIcms(icms), '<ICMS60><orig>0</orig><CST>60</CST></ICMS60>');
  });

  it('guarda a alíquota do cadastro como ignorada, com o motivo', () => {
    const resultado = calcular({ cst: '60', aliquotaIcms: 20, procedenciaAliquota: 'PRODUTO' });
    assert.equal(resultado.camposIgnorados.length, 1);
    const [ignorado] = resultado.camposIgnorados;
    assert.equal(ignorado.campo, 'aliquotaicms');
    assert.equal(ignorado.valor, 20);
    assert.equal(ignorado.origem, 'PRODUTO');
    assert.match(ignorado.motivo, /CST 60 \(ICMS60\) não tem ICMS próprio/);

    const decisao = montarDecisaoIcms(resultado);
    assert.equal(decisao?.grupoXmlIcms, 'ICMS60');
    assert.equal(decisao?.tratamentoIcms, 'ST_RETIDA_ANTERIORMENTE');
    assert.equal(decisao?.icmsProprio, false);
    assert.deepEqual(decisao?.camposAplicaveis, ['stRetida', 'fcpStRetido', 'icmsEfetivo']);
  });

  it('XML e totais ficam zerados de ICMS próprio, como no documento autorizado', () => {
    const { campos } = assertCoerente(calcular({ cst: '60', aliquotaIcms: 20 }));
    assert.deepEqual(campos, { orig: '0', CST: '60' });
  });

  it('recusa base ou valor de ICMS próprio informados na emissão, sem trocar o CST', () => {
    const resultado = calcular({ cst: '60', aliquotaIcms: 20, proprio: { vBC: 11000, vICMS: 2200 } });
    const bloqueio = resultado.issues.find((issue) => issue.code === 'NFE_ICMS_BLOCO_PROIBIDO_PROPRIO');
    assert.ok(bloqueio);
    assert.equal(bloqueio.severidade, 'BLOQUEIO');
    assert.match(
      bloqueio.message,
      /^O CST 60 utiliza o grupo de ICMS cobrado anteriormente por substituição tributária \(ICMS60\) e não utiliza estes campos de ICMS próprio\./,
    );
    assert.equal(valores(resultado).cst, '60');
  });

  it('um item antigo com base de ICMS e CST 60 não chega ao XML', () => {
    assert.throws(
      () => buildDetXml({ ...itemBase, cst: '60', aliquotaIcms: 20, baseCalculoIcms: 11000 }, 3),
      /NFE_ICMS_BLOCO_PROIBIDO_PROPRIO/,
    );
  });
});

describe('caso B — CST 00', () => {
  it('calcula BC e ICMS próprios e o XML repete os mesmos valores', () => {
    const resultado = semBloqueio(calcular({ cst: '00', aliquotaIcms: 20 }));
    const icms = valores(resultado);
    assert.equal(icms.vBC, 11000);
    assert.equal(icms.pICMS, 20);
    assert.equal(icms.vICMS, 2200);
    assert.equal(
      serializarIcms(icms),
      '<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>11000.00</vBC><pICMS>20.0000</pICMS><vICMS>2200.00</vICMS></ICMS00>',
    );
    assertCoerente(resultado);
  });

  it('exige a alíquota em vez de gerar pICMS NaN', () => {
    assert.ok(codigos(calcular({ cst: '00' })).includes('NFE_ICMS_ALIQUOTA_REQUIRED'));
  });

  it('usa o valor líquido do desconto como base', () => {
    const icms = valores(calcular({ cst: '00', aliquotaIcms: 18, valorOperacao: 950 }));
    assert.equal(icms.vBC, 950);
    assert.equal(icms.vICMS, 171);
  });

  it('FCP no ICMS00 sai só com pFCP e vFCP, como manda o XSD', () => {
    const resultado = semBloqueio(calcular({ cst: '00', aliquotaIcms: 18, valorOperacao: 1000, fcp: { pFCP: 2 } }));
    assert.match(serializarIcms(valores(resultado)), /<vICMS>180\.00<\/vICMS><pFCP>2\.0000<\/pFCP><vFCP>20\.00<\/vFCP><\/ICMS00>$/);
    assertCoerente(resultado);
  });
});

describe('caso C — CST 10 (ICMS próprio + ICMS-ST)', () => {
  const entrada = {
    cst: '10',
    aliquotaIcms: 18,
    valorOperacao: 1000,
    st: { pMVAST: 40, pICMSST: 18 },
  };

  it('calcula as duas bases sem misturá-las', () => {
    const icms = valores(semBloqueio(calcular(entrada)));
    assert.equal(icms.vBC, 1000);
    assert.equal(icms.vICMS, 180);
    assert.equal(icms.modBCST, '4');
    assert.equal(icms.vBCST, 1400);
    // ST = base ST × alíquota ST − ICMS próprio.
    assert.equal(icms.vICMSST, 72);
  });

  it('XML e totais batem com o canônico', () => {
    const { campos } = assertCoerente(calcular(entrada));
    assert.equal(campos.vBC, '1000.00');
    assert.equal(campos.vBCST, '1400.00');
  });

  it('exige alíquota e base de ST', () => {
    const faltando = codigos(calcular({ cst: '10', aliquotaIcms: 18, valorOperacao: 1000 }));
    assert.ok(faltando.includes('NFE_ICMS_PICMSST_REQUIRED'));
    assert.ok(faltando.includes('NFE_ICMS_VBCST_REQUIRED'));
    assert.ok(faltando.includes('NFE_ICMS_MODBCST_REQUIRED'));
  });
});

describe('caso D — CST 20 (base reduzida)', () => {
  it('reduz a base antes de aplicar a alíquota', () => {
    const resultado = semBloqueio(calcular({ cst: '20', aliquotaIcms: 18, valorOperacao: 1000, proprio: { pRedBC: 33.33 } }));
    const icms = valores(resultado);
    assert.equal(icms.pRedBC, 33.33);
    assert.equal(icms.vBC, 666.7);
    assert.equal(icms.vICMS, 120.01);
    assert.equal(
      serializarIcms(icms),
      '<ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>33.3300</pRedBC><vBC>666.70</vBC><pICMS>18.0000</pICMS><vICMS>120.01</vICMS></ICMS20>',
    );
    assertCoerente(resultado);
  });

  it('exige o percentual de redução', () => {
    assert.ok(codigos(calcular({ cst: '20', aliquotaIcms: 18 })).includes('NFE_ICMS_PREDBC_REQUIRED'));
  });
});

describe('caso E — CST 60 com ST retida anteriormente', () => {
  const stRetida = { vBCSTRet: 800, pST: 18, vICMSSubstituto: 90, vICMSSTRet: 54 };

  it('não calcula ICMS próprio e serializa só o que foi informado', () => {
    const resultado = semBloqueio(calcular({ cst: '60', aliquotaIcms: 20, valorOperacao: 1000, stRetida }));
    const icms = valores(resultado);
    assert.equal(icms.vBC, null);
    assert.equal(icms.vICMS, null);
    assert.equal(
      serializarIcms(icms),
      '<ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>800.00</vBCSTRet><pST>18.0000</pST><vICMSSubstituto>90.00</vICMSSubstituto><vICMSSTRet>54.00</vICMSSTRet></ICMS60>',
    );
    assertCoerente(resultado);
  });

  it('não inventa valor de ST: o grupo incompleto é recusado', () => {
    assert.ok(codigos(calcular({ cst: '60', stRetida: { vBCSTRet: 800 } })).includes('NFE_ICMS_STRET_INCOMPLETO'));
  });

  it('o FCP-ST retido entra no total vFCPSTRet', () => {
    const resultado = semBloqueio(
      calcular({ cst: '60', stRetida, fcpStRetido: { vBCFCPSTRet: 800, pFCPSTRet: 2, vFCPSTRet: 16 } }),
    );
    const { campos } = assertCoerente(resultado);
    assert.equal(campos.vFCPSTRet, '16.00');
  });
});

describe('caso F — CST 40, 41 e 50', () => {
  it('não criam ICMS próprio mesmo com alíquota no cadastro', () => {
    for (const cst of ['40', '41', '50']) {
      const resultado = semBloqueio(calcular({ cst, aliquotaIcms: 18 }));
      assert.equal(serializarIcms(valores(resultado)), `<ICMS40><orig>0</orig><CST>${cst}</CST></ICMS40>`);
      assert.equal(resultado.camposIgnorados[0]?.campo, 'aliquotaicms');
      assertCoerente(resultado);
    }
  });

  it('aceitam desoneração com valor e motivo juntos', () => {
    const resultado = semBloqueio(calcular({ cst: '40', desoneracao: { vICMSDeson: 50, motDesICMS: '7' } }));
    assert.equal(serializarIcms(valores(resultado)), '<ICMS40><orig>0</orig><CST>40</CST><vICMSDeson>50.00</vICMSDeson><motDesICMS>7</motDesICMS></ICMS40>');
    assertCoerente(resultado);
    assert.ok(codigos(calcular({ cst: '40', desoneracao: { vICMSDeson: 50 } })).includes('NFE_ICMS_DESON_INCOMPLETO'));
  });
});

describe('caso G — CST 51 (diferimento)', () => {
  it('diferimento total zera o ICMS devido e mantém o da operação', () => {
    const resultado = semBloqueio(calcular({ cst: '51', aliquotaIcms: 18, valorOperacao: 1000, diferimento: { pDif: 100 } }));
    const icms = valores(resultado);
    assert.equal(icms.vICMSOp, 180);
    assert.equal(icms.vICMSDif, 180);
    assert.equal(icms.vICMS, 0);
    assert.equal(
      serializarIcms(icms),
      '<ICMS51><orig>0</orig><CST>51</CST><modBC>3</modBC><vBC>1000.00</vBC><pICMS>18.0000</pICMS><vICMSOp>180.00</vICMSOp><pDif>100.0000</pDif><vICMSDif>180.00</vICMSDif><vICMS>0.00</vICMS></ICMS51>',
    );
    assertCoerente(resultado);
  });

  it('diferimento parcial: o total soma exatamente o vICMS do item', () => {
    const resultado = semBloqueio(calcular({ cst: '51', aliquotaIcms: 18, valorOperacao: 1000, diferimento: { pDif: 33.3333 } }));
    assert.equal(valores(resultado).vICMS, 120);
    assertCoerente(resultado);
  });

  it('só a alíquota não gera nada no 51', () => {
    const resultado = semBloqueio(calcular({ cst: '51', aliquotaIcms: 18 }));
    assert.equal(serializarIcms(valores(resultado)), '<ICMS51><orig>0</orig><CST>51</CST></ICMS51>');
    assertCoerente(resultado);
  });
});

describe('caso H — CST 70 (base reduzida + ST)', () => {
  const entrada = {
    cst: '70',
    aliquotaIcms: 18,
    valorOperacao: 1000,
    proprio: { pRedBC: 20 },
    fcp: { pFCP: 2 },
    st: { pMVAST: 50, pICMSST: 18 },
  };

  it('reduz a base própria sem reduzir a base de ST', () => {
    const icms = valores(semBloqueio(calcular(entrada)));
    assert.equal(icms.vBC, 800);
    assert.equal(icms.vICMS, 144);
    assert.equal(icms.vBCST, 1500);
    assert.equal(icms.vICMSST, 126);
  });

  it('segue a ordem do XSD: FCP próprio antes do bloco de ST', () => {
    const { ordem } = lerGrupoIcms(buildDetXml(itemComIcms(calcular(entrada)), 3));
    assert.deepEqual(ordem, [
      'orig', 'CST', 'modBC', 'pRedBC', 'vBC', 'pICMS', 'vICMS', 'vBCFCP', 'pFCP', 'vFCP',
      'modBCST', 'pMVAST', 'vBCST', 'pICMSST', 'vICMSST',
    ]);
    assertCoerente(calcular(entrada));
  });
});

describe('caso I — CST 90', () => {
  it('alíquota sozinha não destaca ICMS próprio', () => {
    const resultado = semBloqueio(calcular({ cst: '90', aliquotaIcms: 18 }));
    assert.equal(serializarIcms(valores(resultado)), '<ICMS90><orig>0</orig><CST>90</CST></ICMS90>');
    assert.match(resultado.camposIgnorados[0]?.motivo ?? '', /só é destacado quando a emissão pede/);
    assertCoerente(resultado);
  });

  it('destaca o ICMS próprio quando a emissão pede', () => {
    const resultado = semBloqueio(calcular({ cst: '90', aliquotaIcms: 18, valorOperacao: 1000, proprio: { destacar: true } }));
    assert.equal(valores(resultado).vICMS, 180);
    assertCoerente(resultado);
  });

  it('só ST, informada inteira, sem ICMS próprio', () => {
    const resultado = semBloqueio(
      calcular({ cst: '90', valorOperacao: 1000, st: { modBCST: '6', vBCST: 1000, pICMSST: 18, vICMSST: 180 } }),
    );
    const icms = valores(resultado);
    assert.equal(icms.vBC, null);
    assert.equal(icms.vICMSST, 180);
    assertCoerente(resultado);
  });

  it('ST sem ICMS próprio no item exige o valor: a dedução não é presumida', () => {
    assert.ok(
      codigos(calcular({ cst: '90', st: { modBCST: '6', vBCST: 1000, pICMSST: 18 } })).includes('NFE_ICMS_VICMSST_REQUIRED'),
    );
  });
});

describe('Simples Nacional', () => {
  const sn = (entrada: Partial<EntradaIcms>) => calcular({ crt: 1, valorOperacao: 1000, ...entrada });

  it('CSOSN 101 calcula o crédito a partir da alíquota informada', () => {
    const resultado = semBloqueio(sn({ csosn: '101', creditoSn: { pCredSN: 2.5 } }));
    assert.equal(valores(resultado).vCredICMSSN, 25);
    assertCoerente(resultado, 1);
    assert.ok(codigos(sn({ csosn: '101' })).includes('NFE_ICMS_PCREDSN_REQUIRED'));
  });

  it('CSOSN 102 ignora a alíquota do cadastro', () => {
    const resultado = semBloqueio(sn({ csosn: '102', aliquotaIcms: 18 }));
    assert.equal(serializarIcms(valores(resultado)), '<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>');
    assert.equal(resultado.camposIgnorados.length, 1);
  });

  it('CSOSN 201 e 202 exigem o valor do ICMS-ST informado', () => {
    assert.ok(codigos(sn({ csosn: '202', st: { pMVAST: 40, pICMSST: 18 } })).includes('NFE_ICMS_VICMSST_REQUIRED'));
    const resultado = semBloqueio(sn({ csosn: '201', creditoSn: { pCredSN: 2 }, st: { pMVAST: 40, pICMSST: 18, vICMSST: 72 } }));
    assert.equal(valores(resultado).vBCST, 1400);
    assertCoerente(resultado, 1);
  });

  it('CSOSN 500 serializa a ST retida informada', () => {
    const resultado = semBloqueio(sn({ csosn: '500', stRetida: { vBCSTRet: 800, pST: 18, vICMSSTRet: 54 } }));
    assert.match(serializarIcms(valores(resultado)), /<ICMSSN500><orig>0<\/orig><CSOSN>500<\/CSOSN><vBCSTRet>800\.00/);
    assertCoerente(resultado, 1);
  });

  it('CSOSN 900 com ICMS próprio destacado entra no vBC total', () => {
    const resultado = semBloqueio(sn({ csosn: '900', aliquotaIcms: 18, proprio: { destacar: true } }));
    const { item } = assertCoerente(resultado, 1);
    assert.equal(calcularTotaisNFe([item], 1).vBC, 1000);
  });

  it('MEI não destaca crédito nem no CSOSN 900', () => {
    assert.ok(codigos(calcular({ crt: 4, csosn: '900', creditoSn: { pCredSN: 2 } })).includes('NFE_ICMS_BLOCO_PROIBIDO_CREDITOSN'));
  });
});

describe('estrutura do canônico', () => {
  it('recusa grupo que não corresponde ao CST', () => {
    const icms = valores(calcular({ cst: '00', aliquotaIcms: 18 }));
    const tratamento60 = resolverTratamentoIcms({ crt: 3, cst: '60' });
    assert.ok(validarIcmsCanonico(icms, tratamento60).some((issue) => issue.code === 'NFE_ICMS_GRUPO_DIVERGENTE'));
  });

  it('recusa ICMS próprio dentro do ICMS60', () => {
    const icms = { ...valores(calcular({ cst: '60' })), vBC: 11000, vICMS: 2200 };
    const issues = validarIcmsCanonico(icms, resolverTratamentoIcms({ crt: 3, cst: '60' }));
    assert.deepEqual([...new Set(issues.map((issue) => issue.code))], ['NFE_ICMS_CAMPO_FORA_DO_GRUPO', 'NFE_ICMS_SUBGRUPO_INCOMPLETO']);
  });

  it('recusa subgrupo de ST retida pela metade', () => {
    const icms = { ...valores(calcular({ cst: '60' })), vBCSTRet: 800 };
    const issues = validarIcmsCanonico(icms, resolverTratamentoIcms({ crt: 3, cst: '60' }));
    assert.ok(issues.some((issue) => issue.code === 'NFE_ICMS_SUBGRUPO_INCOMPLETO'));
  });
});

describe('coerência CFOP × CST (aviso, nunca troca)', () => {
  const aviso = (cfop: string, entrada: Partial<EntradaIcms>) => {
    const resultado = calcular({ valorOperacao: 1000, ...entrada });
    return validarCoerenciaCfopIcms({ cfop, tratamento: resultado.tratamento!, valores: valores(resultado) }).map(
      (issue) => issue.code,
    );
  };
  const st10 = { cst: '10', aliquotaIcms: 18, st: { pMVAST: 40, pICMSST: 18 } };

  it('lê o papel da ST na descrição oficial do CFOP', () => {
    assert.equal(papelStDoCfop('5403'), 'SUBSTITUTO');
    assert.equal(papelStDoCfop('6403'), 'SUBSTITUTO');
    assert.equal(papelStDoCfop('5405'), 'SUBSTITUIDO');
    assert.equal(papelStDoCfop('6404'), 'SUBSTITUIDO');
    assert.equal(papelStDoCfop('5402'), 'ST_SEM_PAPEL');
    assert.equal(papelStDoCfop('5411'), 'ST_SEM_PAPEL');
    assert.equal(papelStDoCfop('5102'), 'SEM_ST');
    assert.equal(papelStDoCfop('5915'), 'NEUTRO');
  });

  it('NF-e 136: 6403 (substituto) com CST 60 pede ciência', () => {
    assert.deepEqual(aviso('6403', { cst: '60' }), ['NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO']);
  });

  it('combinações coerentes não geram aviso', () => {
    assert.deepEqual(aviso('5405', { cst: '60' }), []);
    assert.deepEqual(aviso('6404', { cst: '60' }), []);
    assert.deepEqual(aviso('5403', st10), []);
    assert.deepEqual(aviso('6403', st10), []);
    assert.deepEqual(aviso('5102', { cst: '00', aliquotaIcms: 18 }), []);
    assert.deepEqual(aviso('5411', { cst: '60' }), []);
    assert.deepEqual(aviso('5915', { cst: '60' }), []);
  });

  it('venda comum com CST de ST e CFOP de substituído sem ST pedem ciência', () => {
    assert.deepEqual(aviso('5102', { cst: '60' }), ['NFE_CFOP_SEM_ST_COM_CST_DE_ST']);
    assert.deepEqual(aviso('6102', st10), ['NFE_CFOP_SEM_ST_COM_CST_DE_ST']);
    assert.deepEqual(aviso('5405', { cst: '00', aliquotaIcms: 18 }), ['NFE_CFOP_ST_SUBSTITUIDO_SEM_ST_ANTERIOR']);
    assert.deepEqual(aviso('5403', { cst: '00', aliquotaIcms: 18 }), ['NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO']);
  });

  it('vale igual para o Simples', () => {
    assert.deepEqual(aviso('5405', { crt: 1, csosn: '500' }), []);
    assert.deepEqual(aviso('5102', { crt: 1, csosn: '500' }), ['NFE_CFOP_SEM_ST_COM_CST_DE_ST']);
  });
});

describe('ST retida lida da NF-e de compra', () => {
  const daCompra = {
    vBCSTRet: 4200,
    vICMSSTRet: 756,
    pST: 18,
    vICMSSubstituto: 420,
    vBCFCPSTRet: 4200,
    pFCPSTRet: 2,
    vFCPSTRet: 84,
  };

  it('acompanha a quantidade documentada, sem mexer nas alíquotas', () => {
    assert.deepEqual(stRetidaProporcional(daCompra, 1, 4), {
      vBCSTRet: 1050,
      vICMSSTRet: 189,
      pST: 18,
      vICMSSubstituto: 105,
      vBCFCPSTRet: 1050,
      pFCPSTRet: 2,
      vFCPSTRet: 21,
    });
  });

  it('nunca passa da linha inteira da compra', () => {
    assert.equal(stRetidaProporcional(daCompra, 10, 4)?.vICMSSTRet, 756);
  });

  it('sem ST retida na compra não inventa valor', () => {
    assert.equal(stRetidaProporcional({ ...daCompra, vBCSTRet: null, vICMSSTRet: null }, 1, 1), null);
    assert.equal(stRetidaProporcional(null, 1, 1), null);
  });
});

describe('frete na base do ICMS (LC 87/96, art. 13, §1º, II, "b", e art. 8º, II)', () => {
  const comFrete = (freteIntegraBaseIcms: boolean | null | undefined, extra: Partial<EntradaIcms> = {}) =>
    calcular({ valorOperacao: 1000, composicaoBase: { frete: 100, freteIntegraBaseIcms }, ...extra });

  it('decide pela modalidade quando a lei decide, e cobra decisão nas demais', () => {
    assert.deepEqual(
      ['0', '1', '2', '3', '4', '9'].map((modFrete) => freteNaBaseIcms({ modFrete, valorFrete: 100 }).integra),
      [true, null, null, true, null, null],
    );
    assert.equal(freteNaBaseIcms({ modFrete: '1', valorFrete: 100, decisaoUsuario: false }).integra, false);
    assert.equal(freteNaBaseIcms({ modFrete: '0', valorFrete: 100, decisaoUsuario: false }).integra, true);
    assert.equal(freteNaBaseIcms({ modFrete: '9', valorFrete: 0 }).fonte, 'SEM_FRETE');
  });

  it('CST 00: frete que integra a base soma na BC do ICMS próprio', () => {
    const icms = valores(semBloqueio(comFrete(true, { cst: '00', aliquotaIcms: 18 })));
    assert.equal(icms.vBC, 1100);
    assert.equal(icms.vICMS, 198);
    assertCoerente(comFrete(true, { cst: '00', aliquotaIcms: 18 }));
  });

  it('CST 00: frete fora da base quando a decisão foi não integrar', () => {
    assert.equal(valores(semBloqueio(comFrete(false, { cst: '00', aliquotaIcms: 18 }))).vBC, 1000);
  });

  it('sem decisão sobre o frete, o ICMS próprio não é calculado', () => {
    assert.ok(codigos(comFrete(undefined, { cst: '00', aliquotaIcms: 18 })).includes('NFE_ICMS_FRETE_BASE_INDEFINIDA'));
    // Grupo sem ICMS próprio não depende da decisão.
    semBloqueio(comFrete(undefined, { cst: '60', aliquotaIcms: 18 }));
  });

  it('CST 20: a redução incide sobre a base já com o frete', () => {
    const icms = valores(semBloqueio(comFrete(true, { cst: '20', aliquotaIcms: 18, proprio: { pRedBC: 50 } })));
    assert.equal(icms.vBC, 550);
    assert.equal(icms.vICMS, 99);
  });

  it('CST 10: a base da ST leva o frete cobrado mesmo quando ele fica fora da base própria', () => {
    const st = { pMVAST: 40, pICMSST: 18 };
    const integra = valores(semBloqueio(comFrete(true, { cst: '10', aliquotaIcms: 18, st })));
    assert.equal(integra.vBC, 1100);
    assert.equal(integra.vBCST, 1540);
    assert.equal(integra.vICMSST, 79.2);

    const naoIntegra = valores(semBloqueio(comFrete(false, { cst: '10', aliquotaIcms: 18, st })));
    assert.equal(naoIntegra.vBC, 1000);
    assert.equal(naoIntegra.vBCST, 1540);
    assert.equal(naoIntegra.vICMSST, 97.2);
  });

  it('a decisão explica a composição da base', () => {
    const resultado = comFrete(true, { cst: '00', aliquotaIcms: 18 });
    const decisao = montarDecisaoIcms(resultado);
    assert.deepEqual(decisao?.composicaoBase, {
      valorOperacao: 1000,
      frete: 100,
      freteIntegraBaseIcms: true,
      seguro: 0,
      outrasDespesas: 0,
      baseIcmsProprio: 1100,
      baseSt: 1100,
    });
    assert.match(decisao?.motivo ?? '', /Frete de 100\.00 incluído na base do ICMS próprio/);
  });
});

describe('modFrete × frete cobrado (coerência do ERP e LC 87/96, art. 13, §1º, II, "b")', () => {
  const decidir = (modFrete: string, valorFrete: number, decisaoUsuario?: boolean) =>
    freteNaBaseIcms({ modFrete, valorFrete, decisaoUsuario });

  it('modFrete 9 sem frete: nada a decidir', () => {
    assert.deepEqual([decidir('9', 0).fonte, decidir('9', 0).integra], ['SEM_FRETE', false]);
  });

  it('modFrete 9 com frete: incoerente, e a decisão do usuário não a torna válida', () => {
    for (const decisao of [undefined, true, false]) {
      const resultado = decidir('9', 100, decisao);
      assert.equal(resultado.fonte, 'INCONSISTENTE');
      assert.equal(resultado.integra, null);
      assert.match(resultado.motivo, /sem ocorrência de transporte/);
    }
  });

  it('modFrete 0 e 3: integra por lei, sem perguntar', () => {
    for (const modFrete of ['0', '3']) {
      assert.deepEqual([decidir(modFrete, 100).fonte, decidir(modFrete, 100).integra], ['LEI', true], modFrete);
      assert.equal(decidir(modFrete, 100, false).integra, true, `${modFrete}: a lei prevalece`);
    }
  });

  it('modFrete 1, 2 e 4: pendente até o usuário decidir', () => {
    for (const modFrete of ['1', '2', '4']) {
      assert.deepEqual([decidir(modFrete, 100).fonte, decidir(modFrete, 100).integra], ['PENDENTE', null], modFrete);
      assert.deepEqual([decidir(modFrete, 100, false).fonte, decidir(modFrete, 100, false).integra], ['USUARIO', false], modFrete);
    }
  });
});

describe('CST 90 com diferimento (ICMS90 do PL_010e/010f)', () => {
  it('calcula vICMSOp, vICMSDif e o vICMS devido dentro do ICMS próprio', () => {
    const icms = valores(semBloqueio(calcular({ cst: '90', aliquotaIcms: 18, valorOperacao: 1000, proprio: { destacar: true }, diferimento: { pDif: 50 } })));
    assert.deepEqual([icms.vBC, icms.vICMSOp, icms.pDif, icms.vICMSDif, icms.vICMS], [1000, 180, 50, 90, 90]);
  });

  it('diferimento pede ICMS próprio: sem alíquota, bloqueia em vez de inventar', () => {
    assert.ok(codigos(calcular({ cst: '90', diferimento: { pDif: 50 } })).includes('NFE_ICMS_ALIQUOTA_REQUIRED'));
  });

  it('diferimento continua proibido onde o XSD não o prevê (ICMS00, ICMS60, ICMS70)', () => {
    for (const cst of ['00', '60', '70']) {
      assert.ok(
        codigos(calcular({ cst, aliquotaIcms: 18, proprio: { pRedBC: 10 }, diferimento: { pDif: 50 } })).includes('NFE_ICMS_BLOCO_PROIBIDO_DIFERIMENTO'),
        `CST ${cst}`,
      );
    }
  });
});
