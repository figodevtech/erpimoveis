// Matriz CST/CSOSN → grupo ICMS do XML e blocos que ele aceita.
//
// Fonte: leiaute NF-e 4.00, schema PL_010_V1.30 (leiauteNFe_v4.00.xsd), grupos
// ICMS00..ICMS90 e ICMSSN101..ICMSSN900. Cada bloco aqui corresponde a uma
// sequência do XSD. `OPCIONAL` quer dizer que o bloco só entra quando a emissão
// o informa — nunca porque um campo do cadastro está preenchido.
//
// O CST/CSOSN é decisão do usuário. Esta tabela não escolhe o código: só diz o
// que ele permite e exige.

import type { CRT } from '../types';
import { CSOSN_DESCRICOES, CST_ICMS_DESCRICOES } from '../rotulosFiscais';
import type { BlocoIcms, NaturezaIcms, RegraBloco, TratamentoIcms, GrupoIcmsXml } from './tipos';

export const NFE_ICMS_RULE_VERSION = 'icms-tratamento@2026-09-18|PL_010_V1.30';

export const BLOCOS_ICMS: BlocoIcms[] = [
  'proprio',
  'reducaoBase',
  'fcp',
  'diferimento',
  'st',
  'fcpSt',
  'stRetida',
  'fcpStRetido',
  'icmsEfetivo',
  'desoneracao',
  'creditoSn',
];

const O: RegraBloco = 'OBRIGATORIO';
const Op: RegraBloco = 'OPCIONAL';

function blocos(regras: Partial<Record<BlocoIcms, RegraBloco>>): Record<BlocoIcms, RegraBloco> {
  const todos = Object.fromEntries(BLOCOS_ICMS.map((bloco) => [bloco, 'PROIBIDO'])) as Record<
    BlocoIcms,
    RegraBloco
  >;
  return { ...todos, ...regras };
}

type Linha = { grupoXml: GrupoIcmsXml; natureza: NaturezaIcms; blocos: Record<BlocoIcms, RegraBloco> };

const MATRIZ_CST: Record<string, Linha> = {
  '00': { grupoXml: 'ICMS00', natureza: 'TRIBUTADA_INTEGRALMENTE', blocos: blocos({ proprio: O, fcp: Op }) },
  '10': {
    grupoXml: 'ICMS10',
    natureza: 'TRIBUTADA_COM_ST',
    blocos: blocos({ proprio: O, fcp: Op, st: O, fcpSt: Op }),
  },
  '20': {
    grupoXml: 'ICMS20',
    natureza: 'BASE_REDUZIDA',
    blocos: blocos({ proprio: O, reducaoBase: O, fcp: Op, desoneracao: Op }),
  },
  '30': {
    grupoXml: 'ICMS30',
    natureza: 'ISENTA_OU_NAO_TRIBUTADA_COM_ST',
    blocos: blocos({ st: O, fcpSt: Op, desoneracao: Op }),
  },
  '40': { grupoXml: 'ICMS40', natureza: 'ISENTA', blocos: blocos({ desoneracao: Op }) },
  '41': { grupoXml: 'ICMS40', natureza: 'NAO_TRIBUTADA', blocos: blocos({ desoneracao: Op }) },
  '50': { grupoXml: 'ICMS40', natureza: 'SUSPENSAO', blocos: blocos({ desoneracao: Op }) },
  '51': {
    grupoXml: 'ICMS51',
    natureza: 'DIFERIMENTO',
    blocos: blocos({ proprio: Op, reducaoBase: Op, diferimento: Op, fcp: Op }),
  },
  '60': {
    grupoXml: 'ICMS60',
    natureza: 'ST_RETIDA_ANTERIORMENTE',
    blocos: blocos({ stRetida: Op, fcpStRetido: Op, icmsEfetivo: Op }),
  },
  '70': {
    grupoXml: 'ICMS70',
    natureza: 'BASE_REDUZIDA_COM_ST',
    blocos: blocos({ proprio: O, reducaoBase: O, fcp: Op, st: O, fcpSt: Op, desoneracao: Op }),
  },
  '90': {
    grupoXml: 'ICMS90',
    natureza: 'OUTRAS',
    blocos: blocos({
      proprio: Op,
      reducaoBase: Op,
      diferimento: Op,
      fcp: Op,
      st: Op,
      fcpSt: Op,
      desoneracao: Op,
    }),
  },
};

const MATRIZ_CSOSN: Record<string, Linha> = {
  '101': { grupoXml: 'ICMSSN101', natureza: 'SN_COM_CREDITO', blocos: blocos({ creditoSn: O }) },
  '102': { grupoXml: 'ICMSSN102', natureza: 'SN_SEM_CREDITO', blocos: blocos({}) },
  '103': { grupoXml: 'ICMSSN102', natureza: 'SN_ISENCAO_FAIXA', blocos: blocos({}) },
  '201': {
    grupoXml: 'ICMSSN201',
    natureza: 'SN_COM_CREDITO_E_ST',
    blocos: blocos({ st: O, fcpSt: Op, creditoSn: O }),
  },
  '202': { grupoXml: 'ICMSSN202', natureza: 'SN_SEM_CREDITO_COM_ST', blocos: blocos({ st: O, fcpSt: Op }) },
  '203': { grupoXml: 'ICMSSN202', natureza: 'SN_ISENCAO_FAIXA_COM_ST', blocos: blocos({ st: O, fcpSt: Op }) },
  '300': { grupoXml: 'ICMSSN102', natureza: 'SN_IMUNE', blocos: blocos({}) },
  '400': { grupoXml: 'ICMSSN102', natureza: 'SN_NAO_TRIBUTADA', blocos: blocos({}) },
  '500': {
    grupoXml: 'ICMSSN500',
    natureza: 'SN_ST_RETIDA_ANTERIORMENTE',
    blocos: blocos({ stRetida: Op, fcpStRetido: Op, icmsEfetivo: Op }),
  },
  '900': {
    grupoXml: 'ICMSSN900',
    natureza: 'SN_OUTRAS',
    blocos: blocos({ proprio: Op, reducaoBase: Op, st: Op, fcpSt: Op, creditoSn: Op }),
  },
};

function codigo(value: unknown, size: number) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(size, '0').slice(-size) : '';
}

/** CST (CRT 2 e 3) ou CSOSN (CRT 1 e 4) normalizado para o regime do emitente. */
export function codigoIcmsDoRegime(crt: CRT, cst: unknown, csosn: unknown) {
  return crt === 1 || crt === 4 ? codigo(csosn, 3) : codigo(cst, 2);
}

/**
 * Tratamento do ICMS para o código escolhido. `null` quando o código não existe
 * para o regime do emitente — a validação de classificação (`taxRules`) é quem
 * explica esse erro ao usuário.
 */
export function resolverTratamentoIcms(input: {
  crt: CRT;
  cst?: unknown;
  csosn?: unknown;
}): TratamentoIcms | null {
  const simples = input.crt === 1 || input.crt === 4;
  const code = codigoIcmsDoRegime(input.crt, input.cst, input.csosn);
  const linha = simples ? MATRIZ_CSOSN[code] : MATRIZ_CST[code];
  if (!linha) return null;
  return {
    regime: simples ? 'SIMPLES' : 'NORMAL',
    codigo: code,
    grupoXml: linha.grupoXml,
    natureza: linha.natureza,
    descricao: (simples ? CSOSN_DESCRICOES : CST_ICMS_DESCRICOES)[code] ?? code,
    blocos: { ...linha.blocos },
  };
}

export function blocoPermitido(tratamento: TratamentoIcms, bloco: BlocoIcms) {
  return tratamento.blocos[bloco] !== 'PROIBIDO';
}

/** O grupo nunca tem ICMS próprio (60, 40, 30, SN102...). */
export function semIcmsProprio(tratamento: TratamentoIcms) {
  return tratamento.blocos.proprio === 'PROIBIDO';
}
