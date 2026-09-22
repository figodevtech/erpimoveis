/**
 * Casamento de regras versionadas de DIFAL/FCP (tabela fiscal_difal_regra).
 *
 * Núcleo puro: recebe as regras já carregadas e o contexto do item, devolve o
 * valor de cada campo com a regra que o determinou. Não conhece banco nem HTTP,
 * então servidor e tela chegam ao mesmo resultado com o mesmo código.
 *
 * Duas decisões estruturam o arquivo inteiro:
 *
 * 1. Resolução POR CAMPO. Uma regra de NCM pode determinar só o FCP e deixar a
 *    alíquota interna para a regra geral da UF. Cada campo guarda a sua própria
 *    origem, que é o que a tela mostra e o que a auditoria lê depois.
 *
 * 2. NULL não é zero. Uma regra com aliquota_fcp NULL não determina o FCP: ela
 *    não entra na disputa por esse campo. Só um 0 explícito responde "não há
 *    FCP". Sem isso, a distinção que o resto do motor mantém morreria aqui.
 */

export type TipoRegraDifal =
  | 'GERAL'
  | 'NCM'
  | 'NCM_PREFIXO'
  | 'CEST'
  | 'NCM_CEST'
  | 'BENEFICIO'
  | 'EXCECAO';

export type RegraDifal = {
  id: number;
  uf: string;
  tipoRegra: TipoRegraDifal;
  descricao: string;
  ncm: string | null;
  ncmPrefixo: string | null;
  cest: string | null;
  /** Percentual. NULL = esta regra não determina a alíquota interna. */
  aliquotaIcmsInterna: number | null;
  /** Percentual. NULL = não determina o FCP; 0 = determina que não há FCP. */
  aliquotaFcp: number | null;
  reducaoBase: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  prioridade: number;
  fonte: string;
  fonteUrl: string | null;
  fundamentoLegal: string | null;
  dataFonte: string | null;
  ativo: boolean;
};

/** De onde veio o valor de um campo do DIFAL. */
export type OrigemValorDifal =
  | 'REGRA_NCM_CEST'
  | 'REGRA_NCM'
  | 'REGRA_CEST'
  | 'REGRA_NCM_PREFIXO'
  | 'REGRA_BENEFICIO'
  | 'REGRA_EXCECAO'
  | 'REGRA_UF'
  | 'ITEM'
  | 'MANUAL'
  | 'TABELA_REFERENCIA'
  | 'NAO_CONFIGURADO';

export type ContextoRegraDifal = {
  ufDestino: string;
  /** Data fiscal do documento, em ISO (YYYY-MM-DD). */
  dataEmissao: string;
  ncm?: string | null;
  cest?: string | null;
};

/** Um campo resolvido, com a regra que respondeu por ele. */
export type CampoResolvido = {
  valor: number;
  origem: OrigemValorDifal;
  regraId: number;
  regraDescricao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  fonte: string;
  fonteUrl: string | null;
  fundamentoLegal: string | null;
  dataFonte: string | null;
};

export type ConflitoRegraDifal = {
  campo: 'aliquotaIcmsInterna' | 'aliquotaFcp' | 'reducaoBase';
  regras: Array<{ id: number; descricao: string; valor: number }>;
};

export type ResultadoCasamentoDifal = {
  aliquotaInterna: CampoResolvido | null;
  aliquotaFcp: CampoResolvido | null;
  reducaoBase: CampoResolvido | null;
  /** Regras candidatas consideradas, em ordem de especificidade. */
  candidatas: RegraDifal[];
  conflitos: ConflitoRegraDifal[];
};

const ORIGEM_POR_TIPO: Record<TipoRegraDifal, OrigemValorDifal> = {
  NCM_CEST: 'REGRA_NCM_CEST',
  CEST: 'REGRA_CEST',
  NCM: 'REGRA_NCM',
  NCM_PREFIXO: 'REGRA_NCM_PREFIXO',
  BENEFICIO: 'REGRA_BENEFICIO',
  EXCECAO: 'REGRA_EXCECAO',
  GERAL: 'REGRA_UF',
};

/**
 * Especificidade de cada tipo. A ordem é a do enunciado fiscal: benefício e
 * exceção falam de um caso nomeado e vencem o resto; depois a combinação
 * NCM+CEST, o CEST, o NCM exato, a faixa de NCM e, por último, a regra geral
 * da UF, que é o que sobra quando nada mais descreve a mercadoria.
 */
const ESPECIFICIDADE: Record<TipoRegraDifal, number> = {
  EXCECAO: 70,
  BENEFICIO: 60,
  NCM_CEST: 50,
  CEST: 40,
  NCM: 30,
  NCM_PREFIXO: 20,
  GERAL: 10,
};

export function normalizarNcm(valor: unknown): string | null {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.length === 8 ? digitos : null;
}

export function normalizarCest(valor: unknown): string | null {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.length === 7 ? digitos : null;
}

function dataValida(valor: unknown): string | null {
  const texto = String(valor ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

/**
 * Vigência é inclusiva nos dois extremos: a regra que começa em 01/04/2025 vale
 * para a nota emitida em 01/04/2025, e a que termina em 31/03/2025 ainda vale
 * naquele dia. Comparação em texto ISO porque a ordem lexicográfica coincide
 * com a cronológica e não envolve fuso.
 */
export function regraVigenteEm(regra: RegraDifal, data: string): boolean {
  if (data < regra.vigenciaInicio) return false;
  if (regra.vigenciaFim && data > regra.vigenciaFim) return false;
  return true;
}

function identificadorCasa(regra: RegraDifal, ncm: string | null, cest: string | null): boolean {
  switch (regra.tipoRegra) {
    case 'GERAL':
      return true;
    case 'NCM':
      return Boolean(regra.ncm && ncm && regra.ncm === ncm);
    case 'NCM_PREFIXO':
      return Boolean(regra.ncmPrefixo && ncm && ncm.startsWith(regra.ncmPrefixo));
    case 'CEST':
      return Boolean(regra.cest && cest && regra.cest === cest);
    case 'NCM_CEST':
      return Boolean(regra.ncm && regra.cest && ncm && cest && regra.ncm === ncm && regra.cest === cest);
    // Benefício e exceção são nomeados por NCM/CEST como qualquer outra regra;
    // sem identificador nenhum, valeriam para a UF inteira, que é o que o
    // cadastro precisa poder dizer quando a norma é mesmo geral.
    case 'BENEFICIO':
    case 'EXCECAO': {
      if (regra.ncm) return Boolean(ncm && regra.ncm === ncm);
      if (regra.ncmPrefixo) return Boolean(ncm && ncm.startsWith(regra.ncmPrefixo));
      if (regra.cest) return Boolean(cest && regra.cest === cest);
      return true;
    }
    default:
      return false;
  }
}

/** Chave de ordenação: especificidade, depois prefixo mais longo, depois prioridade. */
function chaveDeDisputa(regra: RegraDifal): [number, number, number] {
  return [
    ESPECIFICIDADE[regra.tipoRegra] ?? 0,
    regra.ncmPrefixo?.length ?? 0,
    regra.prioridade,
  ];
}

function mesmaChave(a: RegraDifal, b: RegraDifal): boolean {
  const [a1, a2, a3] = chaveDeDisputa(a);
  const [b1, b2, b3] = chaveDeDisputa(b);
  return a1 === b1 && a2 === b2 && a3 === b3;
}

function comparar(a: RegraDifal, b: RegraDifal): number {
  const [a1, a2, a3] = chaveDeDisputa(a);
  const [b1, b2, b3] = chaveDeDisputa(b);
  if (a1 !== b1) return b1 - a1;
  if (a2 !== b2) return b2 - a2;
  if (a3 !== b3) return b3 - a3;
  // Empate real: a mais recente aparece primeiro, mas o empate continua sendo
  // tratado como conflito — isto é só para a listagem ficar estável.
  return b.vigenciaInicio.localeCompare(a.vigenciaInicio);
}

function paraCampo(regra: RegraDifal, valor: number): CampoResolvido {
  return {
    valor,
    origem: ORIGEM_POR_TIPO[regra.tipoRegra] ?? 'REGRA_UF',
    regraId: regra.id,
    regraDescricao: regra.descricao,
    vigenciaInicio: regra.vigenciaInicio,
    vigenciaFim: regra.vigenciaFim,
    fonte: regra.fonte,
    fonteUrl: regra.fonteUrl,
    fundamentoLegal: regra.fundamentoLegal,
    dataFonte: regra.dataFonte,
  };
}

/**
 * Resolve um campo: entre as candidatas que o determinam, a mais específica
 * vence. Se duas empatam na chave de disputa e discordam do valor, ninguém
 * vence — devolve conflito, e quem chamou bloqueia a emissão. Escolher a
 * primeira da lista seria sortear qual imposto o cliente paga.
 */
function resolverCampo(
  candidatas: RegraDifal[],
  campo: 'aliquotaIcmsInterna' | 'aliquotaFcp' | 'reducaoBase',
): { resolvido: CampoResolvido | null; conflito: ConflitoRegraDifal | null } {
  const determinantes = candidatas.filter((r) => r[campo] !== null && r[campo] !== undefined);
  if (determinantes.length === 0) return { resolvido: null, conflito: null };

  const vencedora = determinantes[0];
  const empatadas = determinantes.filter((r) => mesmaChave(r, vencedora));
  const valores = new Set(empatadas.map((r) => Number(r[campo])));

  if (valores.size > 1) {
    return {
      resolvido: null,
      conflito: {
        campo,
        regras: empatadas.map((r) => ({
          id: r.id,
          descricao: r.descricao,
          valor: Number(r[campo]),
        })),
      },
    };
  }

  return { resolvido: paraCampo(vencedora, Number(vencedora[campo])), conflito: null };
}

/**
 * Seleciona as regras aplicáveis e resolve cada campo. Regras inativas ficam de
 * fora: elas existem para histórico e auditoria, não para decidir imposto.
 */
export function casarRegrasDifal(
  regras: RegraDifal[],
  contexto: ContextoRegraDifal,
): ResultadoCasamentoDifal {
  const uf = String(contexto.ufDestino ?? '').trim().toUpperCase();
  const data = dataValida(contexto.dataEmissao);
  if (!uf || !data) {
    return { aliquotaInterna: null, aliquotaFcp: null, reducaoBase: null, candidatas: [], conflitos: [] };
  }

  const ncm = normalizarNcm(contexto.ncm);
  const cest = normalizarCest(contexto.cest);

  const candidatas = regras
    .filter((r) => r.ativo)
    .filter((r) => r.uf.toUpperCase() === uf)
    .filter((r) => regraVigenteEm(r, data))
    .filter((r) => identificadorCasa(r, ncm, cest))
    .sort(comparar);

  const interna = resolverCampo(candidatas, 'aliquotaIcmsInterna');
  const fcp = resolverCampo(candidatas, 'aliquotaFcp');
  const reducao = resolverCampo(candidatas, 'reducaoBase');

  return {
    aliquotaInterna: interna.resolvido,
    aliquotaFcp: fcp.resolvido,
    reducaoBase: reducao.resolvido,
    candidatas,
    conflitos: [interna.conflito, fcp.conflito, reducao.conflito].filter(
      (c): c is ConflitoRegraDifal => c !== null,
    ),
  };
}
