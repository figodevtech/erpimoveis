import type {
  CRT,
  ClassificacaoTributariaRtc,
  ModoCalculoPisCofins,
  NFeItem,
  TributoPisCofins,
} from './types';
import { NFE_ICMS_RULE_VERSION, VERSAO_REGRA_CFOP_ST, resolverIcmsDoItem } from './icms';

// NT 2025.002 v1.51 (04/08/2026): muda o cronograma da UB12-10 (Imposto
// Seletivo) e regras que o ERP não implementa (ZFM, monofásico, devolução). A
// UB16-10 segue "implementação futura", com o mesmo texto da v1.50.
// NT 2020.006: venda não presencial leva <indIntermed> e, com marketplace, o
// <infIntermed>. Rascunho montado antes saía sem o indicador (rejeição 434).
// A troca de versão faz rascunhos antigos serem gerados de novo antes da
// autorização (`rascunhoPrecisaSerRegerado`), e com eles a ciência dos avisos.
export const NFE_FISCAL_RULE_VERSION =
  `regras_nfe@2026-10-31|NT-2025.002-v1.51|IT-2025.002-v1.71-2026-10-30|PL-010f-v1.50|NT-2020.006-intermed|${NFE_ICMS_RULE_VERSION}|${VERSAO_REGRA_CFOP_ST}`;
export const RTC_REGULAR_REQUIRED_FROM = '2026-08-03';

/**
 * A autorização transmite o XML gravado no rascunho. Se ele foi montado com
 * uma regra fiscal anterior, a nota tem de ser salva de novo antes de ir para
 * a SEFAZ — senão sairia com o cálculo que a regra nova corrigiu. Só vale para
 * o que ainda não foi à SEFAZ: contingência e envio em curso seguem como estão.
 */
export function rascunhoPrecisaSerRegerado(nfe: {
  status?: string | null;
  versao_regra_fiscal?: string | null;
}): boolean {
  const status = String(nfe.status ?? '').toUpperCase();
  if (status !== 'RASCUNHO' && status !== 'REJEITADA') return false;
  return (nfe.versao_regra_fiscal ?? '') !== NFE_FISCAL_RULE_VERSION;
}

export type FieldRule ='REQUIRED' | 'OPTIONAL' | 'DERIVED' | 'FORBIDDEN' | 'CONDITIONAL';

export type NFeFiscalFieldRules = {
  modelo: '55';
  crt: CRT;
  icms: {
    csosn: FieldRule;
    cst: FieldRule;
    csosnPermitidos: string[];
    cstPermitidos: string[];
  };
  pisCofins: {
    cst: FieldRule;
    modo: FieldRule;
    modos: ModoCalculoPisCofins[];
  };
  rtc: {
    status: FieldRule;
    obrigatorioAPartirDe?: string;
  };
  versao: string;
};

export type TaxValidationIssue = {
  code: string;
  field: string;
  message: string;
};

export type PisCofinsCstOption = {
  value: string;
  description: string;
  operation: 'SAIDA' | 'ENTRADA' | 'OUTROS';
};

export const PIS_COFINS_CST_OPTIONS: PisCofinsCstOption[] = [
  { value: '01', description: 'Operação tributável com alíquota básica', operation: 'SAIDA' },
  { value: '02', description: 'Operação tributável com alíquota diferenciada', operation: 'SAIDA' },
  { value: '03', description: 'Operação tributável com alíquota por unidade de medida do produto', operation: 'SAIDA' },
  { value: '04', description: 'Operação tributável monofásica — revenda com alíquota zero', operation: 'SAIDA' },
  { value: '05', description: 'Operação tributável por substituição tributária', operation: 'SAIDA' },
  { value: '06', description: 'Operação tributável com alíquota zero', operation: 'SAIDA' },
  { value: '07', description: 'Operação isenta da contribuição', operation: 'SAIDA' },
  { value: '08', description: 'Operação sem incidência da contribuição', operation: 'SAIDA' },
  { value: '09', description: 'Operação com suspensão da contribuição', operation: 'SAIDA' },
  { value: '49', description: 'Outras operações de saída', operation: 'SAIDA' },
  { value: '50', description: 'Crédito vinculado exclusivamente à receita tributada no mercado interno', operation: 'ENTRADA' },
  { value: '51', description: 'Crédito vinculado exclusivamente à receita não tributada no mercado interno', operation: 'ENTRADA' },
  { value: '52', description: 'Crédito vinculado exclusivamente à receita de exportação', operation: 'ENTRADA' },
  { value: '53', description: 'Crédito vinculado a receitas tributadas e não tributadas no mercado interno', operation: 'ENTRADA' },
  { value: '54', description: 'Crédito vinculado a receitas tributadas no mercado interno e de exportação', operation: 'ENTRADA' },
  { value: '55', description: 'Crédito vinculado a receitas não tributadas no mercado interno e de exportação', operation: 'ENTRADA' },
  { value: '56', description: 'Crédito vinculado a receitas tributadas e não tributadas no mercado interno e de exportação', operation: 'ENTRADA' },
  { value: '60', description: 'Crédito presumido vinculado exclusivamente à receita tributada no mercado interno', operation: 'ENTRADA' },
  { value: '61', description: 'Crédito presumido vinculado exclusivamente à receita não tributada no mercado interno', operation: 'ENTRADA' },
  { value: '62', description: 'Crédito presumido vinculado exclusivamente à receita de exportação', operation: 'ENTRADA' },
  { value: '63', description: 'Crédito presumido vinculado a receitas tributadas e não tributadas no mercado interno', operation: 'ENTRADA' },
  { value: '64', description: 'Crédito presumido vinculado a receitas tributadas no mercado interno e de exportação', operation: 'ENTRADA' },
  { value: '65', description: 'Crédito presumido vinculado a receitas não tributadas no mercado interno e de exportação', operation: 'ENTRADA' },
  { value: '66', description: 'Crédito presumido vinculado a receitas tributadas e não tributadas no mercado interno e de exportação', operation: 'ENTRADA' },
  { value: '67', description: 'Crédito presumido — outras operações', operation: 'ENTRADA' },
  { value: '70', description: 'Operação de aquisição sem direito a crédito', operation: 'ENTRADA' },
  { value: '71', description: 'Operação de aquisição com isenção', operation: 'ENTRADA' },
  { value: '72', description: 'Operação de aquisição com suspensão', operation: 'ENTRADA' },
  { value: '73', description: 'Operação de aquisição com alíquota zero', operation: 'ENTRADA' },
  { value: '74', description: 'Operação de aquisição sem incidência da contribuição', operation: 'ENTRADA' },
  { value: '75', description: 'Operação de aquisição por substituição tributária', operation: 'ENTRADA' },
  { value: '98', description: 'Outras operações de entrada', operation: 'ENTRADA' },
  { value: '99', description: 'Outras operações', operation: 'OUTROS' },
];

const CSOSN = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'];
const CSOSN_MEI = ['102', '300', '400', '900'];
const CST_ICMS = ['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90'];
const CST_PIS_COFINS = new Set(PIS_COFINS_CST_OPTIONS.map((option) => option.value));
const CST_NAO_TRIBUTADO = new Set(['04', '05', '06', '07', '08', '09']);

function present(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function numberPresent(value: unknown) {
  return present(value) && Number.isFinite(Number(value));
}

function normalized(value: unknown, size?: number) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return size ? digits.padStart(size, '0').slice(-size) : digits;
}

export function getRequiredPisCofinsMode(cst: unknown): ModoCalculoPisCofins | null {
  const normalizedCst = normalized(cst, 2);
  if (normalizedCst === '01' || normalizedCst === '02') return 'PERCENTUAL';
  if (normalizedCst === '03') return 'QUANTIDADE';
  if (CST_NAO_TRIBUTADO.has(normalizedCst)) return 'NAO_TRIBUTADO';
  return null;
}

export function getNFeFiscalFieldRules(crt: CRT, issueDate = new Date()): NFeFiscalFieldRules {
  const regularRtcRequired = crt === 3 && issueDate >= new Date(`${RTC_REGULAR_REQUIRED_FROM}T00:00:00-03:00`);
  return {
    modelo: '55',
    crt,
    icms: {
      csosn: crt === 1 || crt === 4 ? 'REQUIRED' : 'FORBIDDEN',
      cst: crt === 2 || crt === 3 ? 'REQUIRED' : 'FORBIDDEN',
      csosnPermitidos: crt === 4 ? CSOSN_MEI : crt === 1 ? CSOSN : [],
      cstPermitidos: crt === 2 || crt === 3 ? CST_ICMS : [],
    },
    pisCofins: {
      cst: 'REQUIRED',
      modo: 'REQUIRED',
      modos: ['PERCENTUAL', 'QUANTIDADE', 'NAO_TRIBUTADO'],
    },
    rtc: {
      status: regularRtcRequired ? 'REQUIRED' : 'CONDITIONAL',
      ...(crt === 3 ? { obrigatorioAPartirDe: RTC_REGULAR_REQUIRED_FROM } : {}),
    },
    versao: NFE_FISCAL_RULE_VERSION,
  };
}

function validatePisCofins(
  label: 'PIS' | 'COFINS',
  tributo: TributoPisCofins | undefined,
  legacyCst: unknown,
  legacyRate: unknown,
): TaxValidationIssue[] {
  const issues: TaxValidationIssue[] = [];
  const field = label === 'PIS' ? 'pis' : 'cofins';
  const cst = normalized(tributo?.cst ?? legacyCst, 2);
  if (!cst || !CST_PIS_COFINS.has(cst)) {
    issues.push({ code: `NFE_${label}_CST_REQUIRED`, field: `${field}.cst`, message: `Informe um CST válido de ${label}.` });
    return issues;
  }

  const inferredLegacyMode: ModoCalculoPisCofins | undefined = tributo
    ? undefined
    : CST_NAO_TRIBUTADO.has(cst)
      ? 'NAO_TRIBUTADO'
      : cst === '03'
        ? 'QUANTIDADE'
        : present(legacyRate)
          ? 'PERCENTUAL'
          : undefined;
  const modo = tributo?.modo ?? inferredLegacyMode;
  if (!modo) {
    issues.push({ code: `NFE_${label}_MODE_REQUIRED`, field: `${field}.modo`, message: `Selecione o modo de cálculo de ${label}; ele não é definido pelo CRT.` });
    return issues;
  }

  if (CST_NAO_TRIBUTADO.has(cst) && modo !== 'NAO_TRIBUTADO') {
    issues.push({ code: `NFE_${label}_MODE_FORBIDDEN`, field: `${field}.modo`, message: `CST ${cst} de ${label} deve usar o grupo não tributado.` });
  }
  if (!CST_NAO_TRIBUTADO.has(cst) && modo === 'NAO_TRIBUTADO') {
    issues.push({ code: `NFE_${label}_MODE_MISMATCH`, field: `${field}.modo`, message: `CST ${cst} de ${label} exige cálculo percentual ou por quantidade.` });
  }
  if (cst === '03' && modo !== 'QUANTIDADE') {
    issues.push({ code: `NFE_${label}_QUANTITY_MODE_REQUIRED`, field: `${field}.modo`, message: `CST 03 de ${label} exige cálculo por quantidade.` });
  }
  if ((cst === '01' || cst === '02') && modo !== 'PERCENTUAL') {
    issues.push({ code: `NFE_${label}_PERCENT_MODE_REQUIRED`, field: `${field}.modo`, message: `CST ${cst} de ${label} exige cálculo percentual.` });
  }
  if (modo === 'PERCENTUAL' && !numberPresent(tributo?.aliquota ?? legacyRate)) {
    issues.push({ code: `NFE_${label}_RATE_REQUIRED`, field: `${field}.aliquota`, message: `Informe a alíquota percentual de ${label}.` });
  }
  if (modo === 'QUANTIDADE' && (!numberPresent(tributo?.quantidade) || !numberPresent(tributo?.aliquotaPorUnidade))) {
    issues.push({ code: `NFE_${label}_QUANTITY_REQUIRED`, field, message: `Informe quantidade tributada e alíquota por unidade de ${label}.` });
  }
  if (modo === 'NAO_TRIBUTADO' && tributo && [tributo.base, tributo.aliquota, tributo.quantidade, tributo.aliquotaPorUnidade, tributo.valor].some(present)) {
    issues.push({ code: `NFE_${label}_FIELDS_FORBIDDEN`, field, message: `${label} não tributado não permite base, alíquota ou valor fictício.` });
  }
  return issues;
}

export function validateNFeItemTax(
  item: NFeItem,
  crt: CRT,
  options?: { issueDate?: Date; classificacaoRtc?: ClassificacaoTributariaRtc | null },
): TaxValidationIssue[] {
  const issues: TaxValidationIssue[] = [];
  const rules = getNFeFiscalFieldRules(crt, options?.issueDate);
  const csosn = normalized(item.csosn, 3);
  const cst = normalized(item.cstIcms ?? item.cst, 2);
  const origem = normalized(item.orig);

  if (!/^[0-8]$/.test(origem)) {
    issues.push({ code: 'NFE_ICMS_ORIGIN_REQUIRED', field: 'orig', message: 'Informe a origem da mercadoria (0 a 8).' });
  }
  if (rules.icms.csosn === 'REQUIRED' && !rules.icms.csosnPermitidos.includes(csosn)) {
    issues.push({ code: crt === 4 ? 'NFE_MEI_CSOSN_NOT_ALLOWED' : 'NFE_CSOSN_REQUIRED', field: 'csosn', message: crt === 4 ? 'O CSOSN selecionado não é permitido para emitente MEI (CRT 4).' : 'Informe um CSOSN válido para o CRT 1.' });
  }
  if (rules.icms.csosn === 'FORBIDDEN' && csosn) {
    issues.push({ code: 'NFE_CSOSN_FORBIDDEN', field: 'csosn', message: `CRT ${crt} não permite CSOSN; use CST de ICMS.` });
  }
  if (rules.icms.cst === 'REQUIRED' && !rules.icms.cstPermitidos.includes(cst)) {
    issues.push({ code: 'NFE_ICMS_CST_REQUIRED', field: 'cst', message: `CRT ${crt} exige um CST de ICMS suportado.` });
  }
  if (rules.icms.cst === 'FORBIDDEN' && cst) {
    issues.push({ code: 'NFE_ICMS_CST_FORBIDDEN', field: 'cst', message: `CRT ${crt} não permite CST comum de ICMS.` });
  }
  if (crt === 4 && (present(item.pCredSN) || present(item.vCredICMSSN) || item.icms?.pCredSN != null)) {
    issues.push({ code: 'NFE_MEI_CREDIT_FORBIDDEN', field: 'pCredSN', message: 'Crédito do Simples é proibido para MEI.' });
  }

  // Com o código válido para o regime, o núcleo de ICMS confere os campos que
  // o grupo escolhido aceita e exige. Avisos de coerência (CFOP × CST) ficam
  // fora daqui: eles pedem ciência do usuário, não bloqueiam.
  const codigoIcmsValido = !issues.some((issue) =>
    ['NFE_ICMS_CST_REQUIRED', 'NFE_CSOSN_REQUIRED', 'NFE_MEI_CSOSN_NOT_ALLOWED'].includes(issue.code),
  );
  if (codigoIcmsValido) {
    for (const issue of resolverIcmsDoItem(item, crt).issues) {
      if (issue.severidade === 'BLOQUEIO') {
        issues.push({ code: issue.code, field: issue.field, message: issue.message });
      }
    }
  }

  issues.push(...validatePisCofins('PIS', item.pis, item.cstPis, item.aliquotaPis));
  issues.push(...validatePisCofins('COFINS', item.cofins, item.cstCofins, item.aliquotaCofins));

  if (rules.rtc.status === 'REQUIRED' && !item.rtc) {
    issues.push({ code: 'NFE_IBSCBS_REQUIRED', field: 'rtc', message: `IBS/CBS é obrigatório para CRT 3 em emissões a partir de ${RTC_REGULAR_REQUIRED_FROM}.` });
  }
  if (item.rtc) {
    const classification = options?.classificacaoRtc;
    if (!classification) {
      issues.push({ code: 'NFE_IBSCBS_CLASS_NOT_FOUND', field: 'rtc.cClassTrib', message: 'cClassTrib não localizado na tabela oficial vigente para NF-e.' });
    } else {
      if (classification.codigo !== item.rtc.cClassTrib || classification.cst !== item.rtc.cstIbsCbs) {
        issues.push({ code: 'NFE_IBSCBS_CLASS_MISMATCH', field: 'rtc.cClassTrib', message: 'O cClassTrib não é compatível com o CST IBS/CBS na data de emissão.' });
      }
      if (!classification.permiteNfe) {
        issues.push({ code: 'NFE_IBSCBS_CLASS_DOCUMENT', field: 'rtc.cClassTrib', message: 'A classificação tributária escolhida não permite NF-e modelo 55.' });
      }
    }
  }

  return issues;
}

export function assertNFeItemTax(item: NFeItem, crt: CRT) {
  if (item.rtc && (!item.rtc.versaoClassificacao || !item.rtc.validadoEm)) {
    throw new Error('NFE_IBSCBS_CLASS_NOT_VALIDATED: valide o cClassTrib na tabela oficial vigente antes de gerar o XML.');
  }
  const issues = validateNFeItemTax(item, crt, { classificacaoRtc: item.rtc ? {
    codigo: item.rtc.cClassTrib,
    cst: item.rtc.cstIbsCbs,
    nome: 'Validação previamente realizada pelo serviço',
    inicioVigencia: '2000-01-01',
    permiteNfe: true,
    versaoFonte: item.rtc.versaoClassificacao!,
  } : null });
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join(' '));
}
