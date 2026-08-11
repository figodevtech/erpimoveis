import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizarPadraoFiscalItem,
  ORIGEM_PADRAO,
  ORIGEM_PADRAO_HERDADO,
  ORIGEM_REGRA,
  ORIGEM_VAZIO,
  padraoDaOperacao,
  resolverPadraoFiscalItem,
  validarPadraoFiscalItem,
  type PadraoFiscalItem,
} from './padraoFiscalItem';
import type { ClassificacaoTributariaRtc } from './types';

const PADRAO_SIMPLES: PadraoFiscalItem = {
  origem_mercadoria: '0',
  cfop: '5102',
  csosn: '102',
  cst: '00',
  aliquotaicms: 18,
  cst_pis: '01',
  modo_pis: 'PERCENTUAL',
  aliquota_pis: 1.65,
  cst_cofins: '01',
  modo_cofins: 'PERCENTUAL',
  aliquota_cofins: 7.6,
};

function produto(valores: Record<string, unknown> = {}) {
  return [{ origem: 'PRODUTO', valores }];
}

test('produto vazio recebe o padrão inteiro', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: PADRAO_SIMPLES,
    crt: 1,
  });

  assert.equal(campos.origem_mercadoria, '0');
  assert.equal(campos.cfop, '5102');
  assert.equal(campos.csosn, '102');
  assert.equal(campos.cst_pis, '01');
  assert.equal(campos.aliquota_pis, 1.65);
  assert.equal(campos.cst_cofins, '01');
  assert.equal(campos.aliquota_cofins, 7.6);
  assert.equal(procedencia.csosn, ORIGEM_PADRAO);
  assert.equal(procedencia.cst_pis, ORIGEM_PADRAO);
});

test('produto preenchido vence o padrão: autopeça monofásica', () => {
  // A razão de a precedência ser esta: PIS/COFINS monofásico (CST 04) não pode
  // sair com a alíquota básica que serve para o resto do estoque.
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ cst_pis: '04', cst_cofins: '04' }),
    padrao: PADRAO_SIMPLES,
    crt: 1,
  });

  assert.equal(campos.cst_pis, '04');
  assert.equal(campos.cst_cofins, '04');
  assert.equal(procedencia.cst_pis, 'PRODUTO');
  // CST 04 é não tributado: o modo vem da regra e as alíquotas do padrão caem.
  assert.equal(campos.modo_pis, 'NAO_TRIBUTADO');
  assert.equal(procedencia.modo_pis, ORIGEM_REGRA);
  assert.equal(campos.aliquota_pis, null);
  assert.equal(campos.aliquota_cofins, null);
  // O resto do padrão continua valendo.
  assert.equal(campos.csosn, '102');
});

test('string vazia no produto conta como ausente', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ csosn: '', cst_pis: '   ', origem_mercadoria: null }),
    padrao: PADRAO_SIMPLES,
    crt: 1,
  });

  assert.equal(campos.csosn, '102');
  assert.equal(campos.cst_pis, '01');
  assert.equal(campos.origem_mercadoria, '0');
  assert.equal(procedencia.csosn, ORIGEM_PADRAO);
});

test('CRT do Simples fica só com CSOSN; regime normal, só com CST', () => {
  const simples = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: PADRAO_SIMPLES,
    crt: 1,
  });
  assert.equal(simples.campos.csosn, '102');
  assert.equal(simples.campos.cst, null);
  assert.equal(simples.procedencia.cst, ORIGEM_VAZIO);

  const normal = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: PADRAO_SIMPLES,
    crt: 3,
  });
  assert.equal(normal.campos.cst, '00');
  assert.equal(normal.campos.csosn, null);

  const mei = resolverPadraoFiscalItem({ fontes: produto(), padrao: PADRAO_SIMPLES, crt: 4 });
  assert.equal(mei.campos.csosn, '102');
  assert.equal(mei.campos.cst, null);
});

test('sem origem no produto e sem origem no padrão, o campo fica vazio', () => {
  // Nunca inventar `0` (nacional): origem errada é informação fiscal falsa.
  // Melhor o campo vazio e a validação cobrando.
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: { ...PADRAO_SIMPLES, origem_mercadoria: null },
    crt: 1,
  });

  assert.equal(campos.origem_mercadoria, null);
  assert.equal(procedencia.origem_mercadoria, ORIGEM_VAZIO);
});

test('entrada: item da entrada vence o produto, que vence o padrão', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: [
      { origem: 'ENTRADA', valores: { cst: '60' } },
      { origem: 'PRODUTO', valores: { cst: '00', origem_mercadoria: '1' } },
    ],
    padrao: { cst: '90', origem_mercadoria: '0', cfop: '1102' },
    crt: 3,
  });

  assert.equal(campos.cst, '60');
  assert.equal(procedencia.cst, 'ENTRADA');
  assert.equal(campos.origem_mercadoria, '1');
  assert.equal(procedencia.origem_mercadoria, 'PRODUTO');
  assert.equal(campos.cfop, '1102');
  assert.equal(procedencia.cfop, ORIGEM_PADRAO);
});

test('sem padrão nenhum, devolve só o que o produto tem', () => {
  const { campos } = resolverPadraoFiscalItem({
    fontes: produto({ csosn: '102' }),
    padrao: null,
    crt: 1,
  });

  assert.equal(campos.csosn, '102');
  assert.equal(campos.cst_pis, null);
  assert.equal(campos.aliquotaicms, null);
});

test('códigos são normalizados no tamanho do leiaute', () => {
  const { campos } = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: {
      csosn: '2',
      cst_pis: '1',
      cst_ibscbs: '0',
      cclass_trib: '1',
      origem_mercadoria: '0',
    },
    crt: 1,
  });

  assert.equal(campos.csosn, '002');
  assert.equal(campos.cst_pis, '01');
  assert.equal(campos.cst_ibscbs, '000');
  assert.equal(campos.cclass_trib, '000001');
});

test('alíquota aceita vírgula decimal vinda da tela', () => {
  const { campos } = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: { aliquotaicms: '18,00', aliquota_pis: '1,65', aliquota_cofins: '7,60' },
    crt: 1,
  });

  assert.equal(campos.aliquotaicms, 18);
  assert.equal(campos.aliquota_pis, 1.65);
  assert.equal(campos.aliquota_cofins, 7.6);
});

test('CST 03 exige cálculo por quantidade, mesmo com o padrão dizendo percentual', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ cst_pis: '03' }),
    padrao: { ...PADRAO_SIMPLES, aliquota_por_unidade_pis: 0.05 },
    crt: 1,
  });

  assert.equal(campos.modo_pis, 'QUANTIDADE');
  assert.equal(procedencia.modo_pis, ORIGEM_REGRA);
  assert.equal(campos.aliquota_por_unidade_pis, 0.05);
});

test('rtc_habilitado do padrão liga o grupo IBS/CBS', () => {
  const { campos } = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: { rtc_habilitado: true, cst_ibscbs: '000', cclass_trib: '000001', aliquota_cbs: 0.9 },
    crt: 3,
  });

  assert.equal(campos.rtc_habilitado, true);
  assert.equal(campos.cst_ibscbs, '000');
  assert.equal(campos.cclass_trib, '000001');
  assert.equal(campos.aliquota_cbs, 0.9);
});

test('o false do produto não impede o padrão de ligar IBS/CBS', () => {
  // `produto.rtc_habilitado` é NOT NULL DEFAULT false: todo produto chega aqui
  // com `false`. Se isso contasse como decisão, o padrão nunca ligaria o grupo.
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ rtc_habilitado: false }),
    padrao: { rtc_habilitado: true, cst_ibscbs: '000', cclass_trib: '000001' },
    crt: 3,
  });

  assert.equal(campos.rtc_habilitado, true);
  assert.equal(procedencia.rtc_habilitado, ORIGEM_PADRAO);
  assert.equal(campos.cst_ibscbs, '000');
});

test('produto com IBS/CBS ligado vence padrão desligado', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ rtc_habilitado: true, cst_ibscbs: '200' }),
    padrao: { rtc_habilitado: false },
    crt: 3,
  });

  assert.equal(campos.rtc_habilitado, true);
  assert.equal(procedencia.rtc_habilitado, 'PRODUTO');
  assert.equal(campos.cst_ibscbs, '200');
});

test('sem ninguém pedindo, IBS/CBS fica desligado', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ rtc_habilitado: false }),
    padrao: { csosn: '102' },
    crt: 1,
  });

  assert.equal(campos.rtc_habilitado, false);
  assert.equal(procedencia.rtc_habilitado, ORIGEM_VAZIO);
});

test('IBS/CBS herdado da NF-e liga na NFC-e e sai marcado', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ rtc_habilitado: false }),
    padrao: { rtc_habilitado: true, cst_ibscbs: '000', cclass_trib: '000001' },
    crt: 1,
    rotuloPadrao: ORIGEM_PADRAO_HERDADO,
  });

  assert.equal(campos.rtc_habilitado, true);
  assert.equal(procedencia.rtc_habilitado, ORIGEM_PADRAO_HERDADO);
});

test('NCM e CEST nunca saem do padrão', () => {
  const resolvido = resolverPadraoFiscalItem({
    fontes: produto(),
    padrao: { ...PADRAO_SIMPLES, ncm: '87089990', cest: '0100100' } as PadraoFiscalItem,
    crt: 1,
  });

  assert.equal('ncm' in resolvido.campos, false);
  assert.equal('cest' in resolvido.campos, false);
});

// ---------------------------------------------------------------------------
// Validação do padrão antes de gravar em Configurações
// ---------------------------------------------------------------------------

function campos(issues: ReturnType<typeof validarPadraoFiscalItem>) {
  return issues.map((issue) => issue.campo);
}

test('padrão coerente com o CRT passa sem apontamento', () => {
  // Sem `cst`: o cadastro real de uma empresa do Simples só tem CSOSN. O
  // fixture do resolvedor traz os dois de propósito, para provar que o filtro
  // por CRT funciona lá — aqui os dois juntos são erro de cadastro.
  const padraoSimples = { ...PADRAO_SIMPLES };
  delete padraoSimples.cst;
  assert.deepEqual(validarPadraoFiscalItem({ padrao: padraoSimples, crt: 1 }), []);
});

test('padrão com CSOSN e CST ao mesmo tempo é recusado', () => {
  assert.deepEqual(campos(validarPadraoFiscalItem({ padrao: PADRAO_SIMPLES, crt: 1 })), ['cst']);
});

test('CSOSN é recusado para regime normal, e CST para o Simples', () => {
  const normal = validarPadraoFiscalItem({ padrao: { csosn: '102' }, crt: 3 });
  assert.deepEqual(campos(normal), ['csosn']);

  const simples = validarPadraoFiscalItem({ padrao: { cst: '00' }, crt: 1 });
  assert.deepEqual(campos(simples), ['cst']);
});

test('MEI só aceita os CSOSN da sua lista', () => {
  assert.deepEqual(campos(validarPadraoFiscalItem({ padrao: { csosn: '101' }, crt: 4 })), [
    'csosn',
  ]);
  assert.deepEqual(validarPadraoFiscalItem({ padrao: { csosn: '102' }, crt: 4 }), []);
});

test('CST 03 de PIS com modo percentual é recusado', () => {
  const issues = validarPadraoFiscalItem({
    padrao: { cst_pis: '03', modo_pis: 'PERCENTUAL', aliquota_pis: 1.65 },
    crt: 1,
  });
  assert.equal(campos(issues).includes('modo_pis'), true);
});

test('modo percentual sem alíquota é recusado', () => {
  const issues = validarPadraoFiscalItem({ padrao: { cst_pis: '01' }, crt: 1 });
  assert.deepEqual(campos(issues), ['aliquota_pis']);
});

test('CST não tributado com alíquota é recusado', () => {
  const issues = validarPadraoFiscalItem({
    padrao: { cst_cofins: '06', aliquota_cofins: 7.6 },
    crt: 1,
  });
  assert.deepEqual(campos(issues), ['aliquota_cofins']);
});

test('origem fora de 0..8 e CFOP curto são recusados', () => {
  const issues = validarPadraoFiscalItem({
    padrao: { origem_mercadoria: '9', cfop: '51' },
    crt: 1,
  });
  assert.deepEqual(campos(issues).sort(), ['cfop', 'origem_mercadoria']);
});

test('alíquota negativa é recusada', () => {
  const issues = validarPadraoFiscalItem({ padrao: { aliquotaicms: -1 }, crt: 1 });
  assert.deepEqual(campos(issues), ['aliquotaicms']);
});

test('sem CRT definido, o padrão nem chega a ser avaliado', () => {
  const issues = validarPadraoFiscalItem({ padrao: PADRAO_SIMPLES, crt: null });
  assert.deepEqual(campos(issues), ['crt']);
});

test('cClassTrib fora da tabela vigente é recusado', () => {
  const vigentes = new Map<string, ClassificacaoTributariaRtc>([
    [
      '000001',
      {
        codigo: '000001',
        cst: '000',
        nome: 'Tributação integral',
        inicioVigencia: '2026-01-01',
        permiteNfe: true,
        versaoFonte: 'teste',
      },
    ],
  ]);

  const desconhecido = validarPadraoFiscalItem({
    padrao: { rtc_habilitado: true, cst_ibscbs: '000', cclass_trib: '999999' },
    crt: 3,
    classificacoes: vigentes,
  });
  assert.deepEqual(campos(desconhecido), ['cclass_trib']);

  const cstTrocado = validarPadraoFiscalItem({
    padrao: { rtc_habilitado: true, cst_ibscbs: '200', cclass_trib: '000001' },
    crt: 3,
    classificacoes: vigentes,
  });
  assert.deepEqual(campos(cstTrocado), ['cclass_trib']);

  const certo = validarPadraoFiscalItem({
    padrao: { rtc_habilitado: true, cst_ibscbs: '000', cclass_trib: '000001' },
    crt: 3,
    classificacoes: vigentes,
  });
  assert.deepEqual(certo, []);
});

test('IBS/CBS habilitado sem classificação é recusado', () => {
  const issues = validarPadraoFiscalItem({ padrao: { rtc_habilitado: true }, crt: 3 });
  assert.deepEqual(campos(issues), ['cclass_trib']);
});

test('normalizarPadraoFiscalItem descarta vazios e campos estranhos', () => {
  const limpo = normalizarPadraoFiscalItem({
    csosn: ' 102 ',
    cst_pis: '',
    aliquota_pis: 1.65,
    rtc_habilitado: false,
    ncm: '87089990',
    cest: '0100100',
    campo_inventado: 'x',
  });

  assert.deepEqual(limpo, { csosn: '102', aliquota_pis: 1.65 });
});

test('normalizarPadraoFiscalItem tolera entrada que não é objeto', () => {
  assert.deepEqual(normalizarPadraoFiscalItem(null), {});
  assert.deepEqual(normalizarPadraoFiscalItem('texto'), {});
  assert.deepEqual(normalizarPadraoFiscalItem([1]), {});
});

test('padraoDaOperacao separa saída de entrada e tolera lixo', () => {
  const padroes = { SAIDA: { cfop: '5102' }, ENTRADA: { cfop: '1102' } };

  assert.deepEqual(padraoDaOperacao(padroes, 'SAIDA'), { cfop: '5102' });
  assert.deepEqual(padraoDaOperacao(padroes, 'ENTRADA'), { cfop: '1102' });
  assert.equal(padraoDaOperacao({}, 'SAIDA'), null);
  assert.equal(padraoDaOperacao(null, 'SAIDA'), null);
  assert.equal(padraoDaOperacao('texto', 'SAIDA'), null);
  assert.equal(padraoDaOperacao([1, 2], 'SAIDA'), null);
  assert.equal(padraoDaOperacao({ SAIDA: 'x' }, 'SAIDA'), null);
});

test('ramo sem chave nenhuma conta como ausente', () => {
  // É este `null` que faz a NFC-e cair para o padrão herdado da NF-e em vez de
  // emitir com todos os campos em branco.
  assert.equal(padraoDaOperacao({ SAIDA: {} }, 'SAIDA'), null);
});

test('padrão herdado da NF-e sai marcado como tal', () => {
  const { campos, procedencia } = resolverPadraoFiscalItem({
    fontes: produto({ csosn: '102' }),
    padrao: PADRAO_SIMPLES,
    crt: 1,
    rotuloPadrao: ORIGEM_PADRAO_HERDADO,
  });

  // O que veio do produto continua marcado como do produto.
  assert.equal(procedencia.csosn, 'PRODUTO');
  // O que veio do padrão da NF-e é distinguível do padrão do próprio modelo.
  assert.equal(campos.cst_pis, '01');
  assert.equal(procedencia.cst_pis, ORIGEM_PADRAO_HERDADO);
  assert.equal(procedencia.origem_mercadoria, ORIGEM_PADRAO_HERDADO);
  // Campo vazio segue sem procedência, independente do rótulo.
  assert.equal(procedencia.cst, ORIGEM_VAZIO);
});
