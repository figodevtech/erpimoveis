// Resolve o perfil tributário de um item de NF-e/NFC-e a partir de várias
// fontes, da mais específica para a menos.
//
// Motivo: o cadastro fiscal do produto vive quase todo vazio, e o operador
// acaba redigitando CSOSN, origem e CST de PIS/COFINS em cada item de cada
// nota. O padrão gravado em `nfe_config.padroes_emissao` preenche esse vão.
//
// A precedência é deliberada e foi decidida com o usuário:
//
//   fonte mais específica → ... → produto → padrão da empresa → vazio
//
// O padrão NÃO sobrescreve. Campo preenchido na fonte vence, campo vazio
// (`null`, `undefined` ou `""`) recebe o padrão. Isso preserva a exceção
// fiscal legítima — autopeça monofásica sai com PIS/COFINS CST 04/06, e não
// com a alíquota básica que serve para o resto do estoque.
//
// NCM e CEST não entram aqui de propósito: são do item, não do perfil.
import {
  getNFeFiscalFieldRules,
  getRequiredPisCofinsMode,
  PIS_COFINS_CST_OPTIONS,
} from './taxRules';
import type { CRT, ClassificacaoTributariaRtc, ModoCalculoPisCofins } from './types';

/** De onde saiu o valor final de cada campo. */
export const ORIGEM_PADRAO = 'PADRAO';
export const ORIGEM_VAZIO = 'VAZIO';
/** Valor imposto pela regra fiscal, não por cadastro (modo exigido pelo CST). */
export const ORIGEM_REGRA = 'REGRA';

export type ValoresFiscaisParciais = {
  origem_mercadoria?: string | number | null;
  cfop?: string | number | null;
  csosn?: string | number | null;
  cst?: string | number | null;
  aliquotaicms?: string | number | null;
  cst_pis?: string | number | null;
  modo_pis?: string | null;
  aliquota_pis?: string | number | null;
  aliquota_por_unidade_pis?: string | number | null;
  cst_cofins?: string | number | null;
  modo_cofins?: string | null;
  aliquota_cofins?: string | number | null;
  aliquota_por_unidade_cofins?: string | number | null;
  rtc_habilitado?: boolean | null;
  cst_ibscbs?: string | number | null;
  cclass_trib?: string | number | null;
  aliquota_ibs_uf?: string | number | null;
  aliquota_ibs_municipio?: string | number | null;
  aliquota_cbs?: string | number | null;
};

/** O que fica gravado em `nfe_config.padroes_emissao.{SAIDA,ENTRADA}`. */
export type PadraoFiscalItem = ValoresFiscaisParciais;

export type FonteValoresFiscais = {
  /** Rótulo que aparece na procedência: 'PRODUTO', 'ENTRADA', … */
  origem: string;
  valores: ValoresFiscaisParciais | null | undefined;
};

export type CamposFiscaisResolvidos = {
  origem_mercadoria: string | null;
  cfop: string | null;
  csosn: string | null;
  cst: string | null;
  aliquotaicms: number | null;
  cst_pis: string | null;
  modo_pis: ModoCalculoPisCofins | null;
  aliquota_pis: number | null;
  aliquota_por_unidade_pis: number | null;
  cst_cofins: string | null;
  modo_cofins: ModoCalculoPisCofins | null;
  aliquota_cofins: number | null;
  aliquota_por_unidade_cofins: number | null;
  rtc_habilitado: boolean;
  cst_ibscbs: string | null;
  cclass_trib: string | null;
  aliquota_ibs_uf: number | null;
  aliquota_ibs_municipio: number | null;
  aliquota_cbs: number | null;
};

export type CampoFiscal = keyof CamposFiscaisResolvidos;

export type ProcedenciaFiscal = Record<CampoFiscal, string>;

export type PadraoFiscalResolvido = {
  campos: CamposFiscaisResolvidos;
  procedencia: ProcedenciaFiscal;
};

const MODOS_PIS_COFINS: ModoCalculoPisCofins[] = ['PERCENTUAL', 'QUANTIDADE', 'NAO_TRIBUTADO'];

function vazio(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

function digitos(value: unknown, tamanho?: number): string | null {
  const limpo = String(value ?? '').replace(/\D/g, '');
  if (!limpo) return null;
  return tamanho ? limpo.padStart(tamanho, '0').slice(-tamanho) : limpo;
}

function numero(value: unknown): number | null {
  if (vazio(value)) return null;
  // Aceita "17,50" tanto quanto "17.50": o padrão pode ter sido digitado na tela.
  const bruto = String(value).trim().replace(/\./g, '').replace(',', '.');
  const convertido = Number(/,/.test(String(value)) ? bruto : String(value).trim());
  return Number.isFinite(convertido) ? convertido : null;
}

function modo(value: unknown): ModoCalculoPisCofins | null {
  const texto = String(value ?? '').trim().toUpperCase();
  return (MODOS_PIS_COFINS as string[]).includes(texto) ? (texto as ModoCalculoPisCofins) : null;
}

/**
 * Primeiro valor não vazio na ordem das fontes, com o padrão por último.
 * Devolve junto o rótulo de quem venceu, para a tela poder explicar.
 */
function primeiro(
  fontes: FonteValoresFiscais[],
  padrao: PadraoFiscalItem | null | undefined,
  campo: keyof ValoresFiscaisParciais,
): { valor: unknown; origem: string } {
  for (const fonte of fontes) {
    const valor = fonte.valores?.[campo];
    if (!vazio(valor)) return { valor, origem: fonte.origem };
  }
  const doPadrao = padrao?.[campo];
  if (!vazio(doPadrao)) return { valor: doPadrao, origem: ORIGEM_PADRAO };
  return { valor: null, origem: ORIGEM_VAZIO };
}

export type ResolverPadraoFiscalArgs = {
  /** Da mais específica para a menos. Ex.: [item da entrada, produto]. */
  fontes: FonteValoresFiscais[];
  padrao?: PadraoFiscalItem | null;
  /** Regime tributário do emitente. Decide entre CSOSN e CST de ICMS. */
  crt?: CRT | number | null;
};

/**
 * Monta o perfil tributário final do item.
 *
 * O CRT filtra o grupo de ICMS: emitente do Simples usa CSOSN e nunca CST
 * comum, e o inverso para o regime normal. É a mesma regra que
 * `getNFeFiscalFieldRules` aplica na validação — aplicá-la aqui evita mandar
 * para a tela um campo que a validação vai recusar depois.
 */
export function resolverPadraoFiscalItem({
  fontes,
  padrao,
  crt,
}: ResolverPadraoFiscalArgs): PadraoFiscalResolvido {
  const regime = Number(crt ?? 0);
  const usaCsosn = regime === 1 || regime === 4;
  const usaCstIcms = regime === 2 || regime === 3;

  const campos = {} as CamposFiscaisResolvidos;
  const procedencia = {} as ProcedenciaFiscal;

  const definir = <K extends CampoFiscal>(
    campo: K,
    valor: CamposFiscaisResolvidos[K],
    origem: string,
  ) => {
    campos[campo] = valor;
    // Campo que terminou vazio não tem procedência a exibir, mesmo que alguma
    // fonte tenha "vencido" com um valor que a normalização descartou.
    procedencia[campo] =
      valor === null || valor === false || valor === '' ? ORIGEM_VAZIO : origem;
  };

  const texto = <K extends CampoFiscal>(
    campo: K & keyof ValoresFiscaisParciais,
    tamanho?: number,
  ) => {
    const { valor, origem } = primeiro(fontes, padrao, campo);
    definir(campo, digitos(valor, tamanho) as CamposFiscaisResolvidos[K], origem);
  };

  const decimal = <K extends CampoFiscal>(campo: K & keyof ValoresFiscaisParciais) => {
    const { valor, origem } = primeiro(fontes, padrao, campo);
    definir(campo, numero(valor) as CamposFiscaisResolvidos[K], origem);
  };

  texto('origem_mercadoria', 1);
  texto('cfop', 4);

  // ---- ICMS ---------------------------------------------------------------
  const icmsSn = primeiro(fontes, padrao, 'csosn');
  const icmsNormal = primeiro(fontes, padrao, 'cst');
  definir('csosn', usaCsosn ? digitos(icmsSn.valor, 3) : null, icmsSn.origem);
  definir('cst', usaCstIcms ? digitos(icmsNormal.valor, 2) : null, icmsNormal.origem);
  decimal('aliquotaicms');

  // ---- PIS e COFINS -------------------------------------------------------
  for (const tributo of ['pis', 'cofins'] as const) {
    const campoCst = `cst_${tributo}` as const;
    const campoModo = `modo_${tributo}` as const;
    const campoAliquota = `aliquota_${tributo}` as const;
    const campoUnidade = `aliquota_por_unidade_${tributo}` as const;

    texto(campoCst, 2);
    const cst = campos[campoCst];

    // O CST manda no modo. Quando ele exige um modo específico, nem o cadastro
    // nem o padrão podem contrariar — a validação recusaria a combinação.
    const exigido = getRequiredPisCofinsMode(cst);
    const escolhido = primeiro(fontes, padrao, campoModo);
    const modoFinal = exigido ?? modo(escolhido.valor);
    definir(campoModo, modoFinal, exigido ? ORIGEM_REGRA : escolhido.origem);

    decimal(campoAliquota);
    decimal(campoUnidade);

    // Não tributado não admite base, alíquota nem valor: `validateNFeItemTax`
    // acusa `FIELDS_FORBIDDEN` se algum deles sobreviver.
    if (modoFinal === 'NAO_TRIBUTADO') {
      definir(campoAliquota, null, ORIGEM_VAZIO);
      definir(campoUnidade, null, ORIGEM_VAZIO);
    }
  }

  // ---- IBS/CBS (reforma tributária) ---------------------------------------
  const rtc = primeiro(fontes, padrao, 'rtc_habilitado');
  definir('rtc_habilitado', rtc.valor === true || String(rtc.valor) === 'true', rtc.origem);
  texto('cst_ibscbs', 3);
  texto('cclass_trib', 6);
  decimal('aliquota_ibs_uf');
  decimal('aliquota_ibs_municipio');
  decimal('aliquota_cbs');

  return { campos, procedencia };
}

/**
 * Campos que o padrão pode guardar. NCM e CEST não estão aqui de propósito:
 * são do item, e deixá-los entrar transformaria o padrão num cadastro de
 * produto disfarçado.
 */
export const CAMPOS_DO_PADRAO = [
  'origem_mercadoria',
  'cfop',
  'csosn',
  'cst',
  'aliquotaicms',
  'cst_pis',
  'modo_pis',
  'aliquota_pis',
  'aliquota_por_unidade_pis',
  'cst_cofins',
  'modo_cofins',
  'aliquota_cofins',
  'aliquota_por_unidade_cofins',
  'rtc_habilitado',
  'cst_ibscbs',
  'cclass_trib',
  'aliquota_ibs_uf',
  'aliquota_ibs_municipio',
  'aliquota_cbs',
] as const satisfies readonly (keyof ValoresFiscaisParciais)[];

/**
 * Peneira o que veio da tela: só os campos conhecidos, sem os vazios.
 *
 * Guardar `""` no jsonb faria o padrão parecer preenchido para quem lê o
 * registro, ainda que o resolvedor os trate como ausentes.
 */
export function normalizarPadraoFiscalItem(entrada: unknown): PadraoFiscalItem {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return {};

  const bruto = entrada as Record<string, unknown>;
  const limpo: Record<string, unknown> = {};

  for (const campo of CAMPOS_DO_PADRAO) {
    const valor = bruto[campo];
    if (campo === 'rtc_habilitado') {
      if (valor === true || String(valor) === 'true') limpo[campo] = true;
      continue;
    }
    if (vazio(valor)) continue;
    limpo[campo] = typeof valor === 'string' ? valor.trim() : valor;
  }

  return limpo as PadraoFiscalItem;
}

export type PadraoFiscalIssue = {
  campo: string;
  mensagem: string;
};

export type ValidarPadraoFiscalArgs = {
  padrao: PadraoFiscalItem | null | undefined;
  crt?: CRT | number | null;
  /**
   * Classificações IBS/CBS vigentes na data, indexadas por `cClassTrib`. Quem
   * carrega é o serviço — aqui só se confere o que foi entregue.
   */
  classificacoes?: Map<string, ClassificacaoTributariaRtc> | null;
};

/**
 * Confere o padrão fiscal antes de ele ser gravado em Configurações.
 *
 * Vale a pena ser rígido aqui: um padrão inválido não erra uma nota, erra
 * todas as notas emitidas depois — e o erro só aparece como rejeição da SEFAZ,
 * longe de onde foi cadastrado.
 *
 * Campo vazio nunca é erro: o padrão é opcional por definição, e o que ele não
 * preencher continua vindo do produto ou sendo digitado na emissão.
 */
export function validarPadraoFiscalItem({
  padrao,
  crt,
  classificacoes,
}: ValidarPadraoFiscalArgs): PadraoFiscalIssue[] {
  if (!padrao) return [];

  const issues: PadraoFiscalIssue[] = [];
  const regime = Number(crt ?? 0);
  const regras = [1, 2, 3, 4].includes(regime)
    ? getNFeFiscalFieldRules(regime as CRT)
    : null;

  if (!regras) {
    return [
      {
        campo: 'crt',
        mensagem:
          'Defina o regime tributário da empresa antes de cadastrar o padrão fiscal: é ele que decide entre CSOSN e CST de ICMS.',
      },
    ];
  }

  const origem = digitos(padrao.origem_mercadoria, 1);
  if (!vazio(padrao.origem_mercadoria) && (origem === null || !/^[0-8]$/.test(origem))) {
    issues.push({ campo: 'origem_mercadoria', mensagem: 'Origem da mercadoria deve ser de 0 a 8.' });
  }

  const cfop = digitos(padrao.cfop);
  if (!vazio(padrao.cfop) && (cfop === null || cfop.length !== 4)) {
    issues.push({ campo: 'cfop', mensagem: 'CFOP deve ter 4 dígitos.' });
  }

  // ---- ICMS: CSOSN e CST se excluem pelo regime ---------------------------
  const csosn = digitos(padrao.csosn, 3);
  if (csosn) {
    if (regras.icms.csosn !== 'REQUIRED') {
      issues.push({
        campo: 'csosn',
        mensagem: `CRT ${regime} não usa CSOSN. Informe o CST de ICMS.`,
      });
    } else if (!regras.icms.csosnPermitidos.includes(csosn)) {
      issues.push({ campo: 'csosn', mensagem: `CSOSN ${csosn} não é permitido para o CRT ${regime}.` });
    }
  }

  const cstIcms = digitos(padrao.cst, 2);
  if (cstIcms) {
    if (regras.icms.cst !== 'REQUIRED') {
      issues.push({
        campo: 'cst',
        mensagem: `CRT ${regime} não usa CST comum de ICMS. Informe o CSOSN.`,
      });
    } else if (!regras.icms.cstPermitidos.includes(cstIcms)) {
      issues.push({ campo: 'cst', mensagem: `CST de ICMS ${cstIcms} não é suportado.` });
    }
  }

  for (const campo of [
    'aliquotaicms',
    'aliquota_pis',
    'aliquota_por_unidade_pis',
    'aliquota_cofins',
    'aliquota_por_unidade_cofins',
    'aliquota_ibs_uf',
    'aliquota_ibs_municipio',
    'aliquota_cbs',
  ] as const) {
    const valor = padrao[campo];
    if (vazio(valor)) continue;
    const convertido = numero(valor);
    if (convertido === null || convertido < 0) {
      issues.push({ campo, mensagem: 'Informe um percentual válido, maior ou igual a zero.' });
    }
  }

  // ---- PIS e COFINS -------------------------------------------------------
  const cstsValidos = new Set(PIS_COFINS_CST_OPTIONS.map((opcao) => opcao.value));
  for (const tributo of ['pis', 'cofins'] as const) {
    const rotulo = tributo.toUpperCase();
    const campoCst = `cst_${tributo}` as const;
    const campoModo = `modo_${tributo}` as const;
    const campoAliquota = `aliquota_${tributo}` as const;
    const campoUnidade = `aliquota_por_unidade_${tributo}` as const;

    const cst = digitos(padrao[campoCst], 2);
    if (!cst) {
      if (!vazio(padrao[campoCst])) {
        issues.push({ campo: campoCst, mensagem: `Informe um CST de ${rotulo} válido.` });
      }
      continue;
    }
    if (!cstsValidos.has(cst)) {
      issues.push({ campo: campoCst, mensagem: `CST ${cst} não existe na tabela de ${rotulo}.` });
      continue;
    }

    const exigido = getRequiredPisCofinsMode(cst);
    const escolhido = modo(padrao[campoModo]);
    if (exigido && escolhido && escolhido !== exigido) {
      issues.push({
        campo: campoModo,
        mensagem: `CST ${cst} de ${rotulo} exige cálculo ${exigido === 'QUANTIDADE' ? 'por quantidade' : exigido === 'PERCENTUAL' ? 'percentual' : 'não tributado'}.`,
      });
    }

    const modoFinal = exigido ?? escolhido;
    if (!modoFinal) {
      issues.push({
        campo: campoModo,
        mensagem: `Escolha o modo de cálculo de ${rotulo}: o CST ${cst} não define um sozinho.`,
      });
      continue;
    }

    if (modoFinal === 'PERCENTUAL' && vazio(padrao[campoAliquota])) {
      issues.push({ campo: campoAliquota, mensagem: `Informe a alíquota de ${rotulo}.` });
    }
    if (modoFinal === 'QUANTIDADE' && vazio(padrao[campoUnidade])) {
      issues.push({
        campo: campoUnidade,
        mensagem: `Informe a alíquota por unidade de ${rotulo}.`,
      });
    }
    if (modoFinal === 'NAO_TRIBUTADO' && !vazio(padrao[campoAliquota])) {
      issues.push({
        campo: campoAliquota,
        mensagem: `CST ${cst} de ${rotulo} não é tributado: remova a alíquota.`,
      });
    }
  }

  // ---- IBS/CBS ------------------------------------------------------------
  const cstIbsCbs = digitos(padrao.cst_ibscbs, 3);
  const cClassTrib = digitos(padrao.cclass_trib, 6);
  const rtcLigado = padrao.rtc_habilitado === true;

  if (rtcLigado && (!cstIbsCbs || !cClassTrib)) {
    issues.push({
      campo: 'cclass_trib',
      mensagem: 'Com IBS/CBS habilitado, informe o CST e a classificação tributária.',
    });
  }

  if (cClassTrib && classificacoes) {
    const classificacao = classificacoes.get(cClassTrib);
    if (!classificacao) {
      issues.push({
        campo: 'cclass_trib',
        mensagem: `cClassTrib ${cClassTrib} não consta na tabela oficial vigente.`,
      });
    } else if (cstIbsCbs && classificacao.cst !== cstIbsCbs) {
      issues.push({
        campo: 'cclass_trib',
        mensagem: `cClassTrib ${cClassTrib} pertence ao CST ${classificacao.cst}, não ao ${cstIbsCbs}.`,
      });
    } else if (!classificacao.permiteNfe) {
      issues.push({
        campo: 'cclass_trib',
        mensagem: `cClassTrib ${cClassTrib} não é aceito em NF-e/NFC-e.`,
      });
    }
  }

  return issues;
}

/** Ramo do padrão que vale para a operação. */
export function padraoDaOperacao(
  padroes: unknown,
  operacao: 'SAIDA' | 'ENTRADA',
): PadraoFiscalItem | null {
  if (!padroes || typeof padroes !== 'object' || Array.isArray(padroes)) return null;
  const ramo = (padroes as Record<string, unknown>)[operacao];
  if (!ramo || typeof ramo !== 'object' || Array.isArray(ramo)) return null;
  return ramo as PadraoFiscalItem;
}
