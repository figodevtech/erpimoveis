// Serialização do grupo ICMS a partir do canônico. Não calcula nada: escreve
// os campos preenchidos na ordem da `xs:sequence` de cada grupo do
// leiauteNFe_v4.00.xsd do pacote vigente (schemas/nfe/PL_010f_NT2025_002_v1.50,
// "versão oficial em uso" no Portal da NF-e). Fora dessa ordem a SEFAZ devolve
// a rejeição 225. A conformidade é provada contra o XSD em icms/xsd.test.ts.

import { escapeXml } from '../xmlUtils';
import type { GrupoIcmsXml, IcmsCanonico, IcmsIssue, TratamentoIcms } from './tipos';

type Campo = Exclude<keyof IcmsCanonico, 'grupoXml' | 'cst' | 'csosn' | 'orig'>;

const PROPRIO: Campo[] = ['modBC', 'vBC', 'pICMS', 'vICMS'];
const PROPRIO_REDUZIDO: Campo[] = ['modBC', 'pRedBC', 'vBC', 'pICMS', 'vICMS'];
const FCP: Campo[] = ['vBCFCP', 'pFCP', 'vFCP'];
const ST: Campo[] = ['modBCST', 'pMVAST', 'pRedBCST', 'vBCST', 'pICMSST', 'vICMSST'];
const FCP_ST: Campo[] = ['vBCFCPST', 'pFCPST', 'vFCPST'];
const DESONERACAO: Campo[] = ['vICMSDeson', 'motDesICMS'];
const ST_RETIDA: Campo[] = [
  'vBCSTRet',
  'pST',
  'vICMSSubstituto',
  'vICMSSTRet',
  'vBCFCPSTRet',
  'pFCPSTRet',
  'vFCPSTRet',
  'pRedBCEfet',
  'vBCEfet',
  'pICMSEfet',
  'vICMSEfet',
];
const CREDITO_SN: Campo[] = ['pCredSN', 'vCredICMSSN'];

/** Ordem dos elementos de cada grupo, depois de orig e CST/CSOSN. */
export const ORDEM_XSD_ICMS: Record<GrupoIcmsXml, Campo[]> = {
  ICMS00: [...PROPRIO, 'pFCP', 'vFCP'],
  ICMS10: [...PROPRIO, ...FCP, ...ST, ...FCP_ST],
  ICMS20: [...PROPRIO_REDUZIDO, ...FCP, ...DESONERACAO],
  ICMS30: [...ST, ...FCP_ST, ...DESONERACAO],
  ICMS40: [...DESONERACAO],
  ICMS51: ['modBC', 'pRedBC', 'vBC', 'pICMS', 'vICMSOp', 'pDif', 'vICMSDif', 'vICMS', ...FCP],
  ICMS60: ST_RETIDA,
  ICMS70: [...PROPRIO_REDUZIDO, ...FCP, ...ST, ...FCP_ST, ...DESONERACAO],
  // Desde o PL_010e (NT 2025.002 v1.40) o ICMS90 tem o bloco de diferimento
  // dentro do ICMS próprio, entre pICMS e vICMS. O PL_010b não tinha.
  ICMS90: [
    'modBC',
    'vBC',
    'pRedBC',
    'pICMS',
    'vICMSOp',
    'pDif',
    'vICMSDif',
    'vICMS',
    ...FCP,
    ...ST,
    ...FCP_ST,
    ...DESONERACAO,
  ],
  ICMSSN101: CREDITO_SN,
  ICMSSN102: [],
  ICMSSN201: [...ST, ...FCP_ST, ...CREDITO_SN],
  ICMSSN202: [...ST, ...FCP_ST],
  ICMSSN500: ST_RETIDA,
  ICMSSN900: ['modBC', 'vBC', 'pRedBC', 'pICMS', 'vICMS', ...ST, ...FCP_ST, ...CREDITO_SN],
};

/** Campos sem os quais o grupo não passa no schema. */
export const OBRIGATORIOS_XSD_ICMS: Record<GrupoIcmsXml, Campo[]> = {
  ICMS00: PROPRIO,
  ICMS10: [...PROPRIO, 'modBCST', 'vBCST', 'pICMSST', 'vICMSST'],
  ICMS20: PROPRIO_REDUZIDO,
  ICMS30: ['modBCST', 'vBCST', 'pICMSST', 'vICMSST'],
  ICMS40: [],
  ICMS51: [],
  ICMS60: [],
  ICMS70: [...PROPRIO_REDUZIDO, 'modBCST', 'vBCST', 'pICMSST', 'vICMSST'],
  ICMS90: [],
  ICMSSN101: CREDITO_SN,
  ICMSSN102: [],
  ICMSSN201: ['modBCST', 'vBCST', 'pICMSST', 'vICMSST', ...CREDITO_SN],
  ICMSSN202: ['modBCST', 'vBCST', 'pICMSST', 'vICMSST'],
  ICMSSN500: [],
  ICMSSN900: [],
};

/**
 * Sequências opcionais do XSD que entram inteiras ou não entram. O primeiro
 * item de cada lista é opcional dentro dela (vICMSSubstituto, pMVAST...).
 */
const SUBGRUPOS_COMPLETOS: Array<{ campos: Campo[]; opcionais?: Campo[] }> = [
  { campos: ['vBCSTRet', 'pST', 'vICMSSubstituto', 'vICMSSTRet'], opcionais: ['vICMSSubstituto'] },
  { campos: ['vBCFCPSTRet', 'pFCPSTRet', 'vFCPSTRet'] },
  { campos: ['pRedBCEfet', 'vBCEfet', 'pICMSEfet', 'vICMSEfet'] },
  { campos: ['vICMSDeson', 'motDesICMS'] },
  { campos: ['vBCFCP', 'pFCP', 'vFCP'] },
  { campos: ['vBCFCPST', 'pFCPST', 'vFCPST'] },
  { campos: ['pCredSN', 'vCredICMSSN'] },
  { campos: ['vICMSOp', 'pDif', 'vICMSDif'] },
  { campos: ['modBCST', 'pMVAST', 'pRedBCST', 'vBCST', 'pICMSST', 'vICMSST'], opcionais: ['pMVAST', 'pRedBCST'] },
];

const TEXTO = new Set<Campo>(['modBC', 'modBCST', 'motDesICMS']);
const PERCENTUAL = new Set<Campo>([
  'pRedBC',
  'pICMS',
  'pFCP',
  'pDif',
  'pMVAST',
  'pRedBCST',
  'pICMSST',
  'pFCPST',
  'pST',
  'pFCPSTRet',
  'pRedBCEfet',
  'pICMSEfet',
  'pCredSN',
]);

function formatar(campo: Campo, valor: string | number) {
  if (TEXTO.has(campo)) return String(valor);
  return Number(valor).toFixed(PERCENTUAL.has(campo) ? 4 : 2);
}

/** Problemas estruturais do canônico frente ao grupo — devem ser impossíveis. */
export function validarIcmsCanonico(valores: IcmsCanonico, tratamento: TratamentoIcms | null): IcmsIssue[] {
  const issues: IcmsIssue[] = [];
  const bloquear = (code: string, field: string, message: string) =>
    issues.push({ code, severidade: 'BLOQUEIO', field, message });

  if (!tratamento) {
    bloquear('NFE_ICMS_CST_UNSUPPORTED', 'cst', `Grupo ICMS ${valores.grupoXml} sem CST/CSOSN válido para o regime do emitente.`);
    return issues;
  }
  if (tratamento.grupoXml !== valores.grupoXml) {
    bloquear(
      'NFE_ICMS_GRUPO_DIVERGENTE',
      'cst',
      `O ${tratamento.regime === 'SIMPLES' ? 'CSOSN' : 'CST'} ${tratamento.codigo} usa o grupo ${tratamento.grupoXml}, mas o item traz ${valores.grupoXml}.`,
    );
    return issues;
  }
  const permitidos = new Set(ORDEM_XSD_ICMS[valores.grupoXml]);
  for (const campo of Object.keys(valores) as Array<keyof IcmsCanonico>) {
    if (['grupoXml', 'cst', 'csosn', 'orig'].includes(campo)) continue;
    if (valores[campo] !== null && !permitidos.has(campo as Campo)) {
      bloquear('NFE_ICMS_CAMPO_FORA_DO_GRUPO', campo, `O grupo ${valores.grupoXml} não tem o campo ${campo}.`);
    }
  }
  for (const campo of OBRIGATORIOS_XSD_ICMS[valores.grupoXml]) {
    const valor = valores[campo];
    if (valor === null || (typeof valor === 'number' && !Number.isFinite(valor))) {
      bloquear('NFE_ICMS_CAMPO_OBRIGATORIO', campo, `O grupo ${valores.grupoXml} exige ${campo}.`);
    }
  }
  for (const subgrupo of SUBGRUPOS_COMPLETOS) {
    const exigidos = subgrupo.campos.filter((campo) => permitidos.has(campo) && !subgrupo.opcionais?.includes(campo));
    const preenchidos = exigidos.filter((campo) => valores[campo] != null);
    const informado = subgrupo.campos.some((campo) => permitidos.has(campo) && valores[campo] != null);
    if (informado && preenchidos.length < exigidos.length) {
      bloquear(
        'NFE_ICMS_SUBGRUPO_INCOMPLETO',
        exigidos.find((campo) => valores[campo] === null) ?? exigidos[0],
        `No grupo ${valores.grupoXml}, ${exigidos.join(', ')} devem ser informados juntos.`,
      );
    }
  }
  // Base e valor do ICMS próprio andam juntos em todos os grupos que os têm.
  const proprio: Campo[] = ['vBC', 'pICMS', 'vICMS'];
  const proprioPreenchido = proprio.filter((campo) => valores[campo] !== null);
  if (proprioPreenchido.length > 0 && (proprioPreenchido.length < 3 || valores.modBC === null)) {
    bloquear('NFE_ICMS_SUBGRUPO_INCOMPLETO', 'vBC', `No grupo ${valores.grupoXml}, modBC, vBC, pICMS e vICMS devem ser informados juntos.`);
  }
  return issues;
}

export function serializarIcms(valores: IcmsCanonico): string {
  const codigo = valores.cst !== null ? `<CST>${valores.cst}</CST>` : `<CSOSN>${valores.csosn}</CSOSN>`;
  const campos = ORDEM_XSD_ICMS[valores.grupoXml]
    .filter((campo) => valores[campo] !== null)
    .map((campo) => `<${campo}>${escapeXml(formatar(campo, valores[campo] as string | number))}</${campo}>`)
    .join('');
  return `<${valores.grupoXml}><orig>${escapeXml(valores.orig)}</orig>${codigo}${campos}</${valores.grupoXml}>`;
}
