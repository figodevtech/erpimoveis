import { normalizarIndIEDest } from './indIEDest';
import type { FonteIssueFiscal, IcmsIssue } from './icms/tipos';

/** Configuração publicada no Portal Nacional; revisar quando uma UF mudar sua adesão. */
export const REGRA_E16A30 = {
  code: 'E16a-30',
  cStat: '805',
  modelo: 55,
  ufs: ['AL', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MG', 'MS', 'MT', 'PB', 'PE', 'RJ', 'RN', 'RS', 'SE', 'SP'],
  fonte: {
    titulo: 'Portal Nacional da NF-e — NT 2020.004, identificação do destinatário',
    versao: 'E16a-30 atualizada pela NT 2025.001 v1.03',
    url: 'https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=uE+fQh6OuYw%3D',
    regra: 'E16a-30',
    cStat: '805',
    revisadaEm: '2026-09-25',
    jurisdicao: 'NACIONAL',
  } satisfies FonteIssueFiscal,
} as const;

export const CODE_E16A30 = 'NFE_IND_IE_DEST_ISENTO_UF_NAO_PERMITE';

export type ItemE16a30 = {
  cst?: string | null;
  cstIcms?: string | null;
  csosn?: string | null;
  /** Apenas valores que efetivamente serão serializados no XML. */
  vICMSST?: number | string | null;
  vICMSSTRet?: number | string | null;
};

export type ContextoE16a30 = {
  modelo: number | string;
  idDest: number | string;
  ufDestino: string;
  indIEDest: number | string;
  ambiente: string | number;
  /** Data fiscal civil, com ou sem hora e offset. */
  dataEmissao: string;
  itens: readonly ItemE16a30[];
};

export type ExcecaoE16a30 = 'vICMSST' | 'vICMSSTRet' | 'dataHistorica' | 'tributacaoIsenta';

const CST_EXCECAO = new Set(['40', '41']);
const CSOSN_EXCECAO = new Set(['103', '300', '400']);

function valorInformado(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === '') return false;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0;
}

function valorDestacado(valor: unknown): boolean {
  return valorInformado(valor) && Number(valor) > 0;
}

export function avaliarRegraE16a30(contexto: ContextoE16a30) {
  const uf = String(contexto.ufDestino ?? '').trim().toUpperCase();
  const aplica = Number(contexto.modelo) === REGRA_E16A30.modelo
    && Number(contexto.idDest) === 2
    && normalizarIndIEDest(contexto.indIEDest) === 2
    && (REGRA_E16A30.ufs as readonly string[]).includes(uf);
  let excecaoAplicada: ExcecaoE16a30 | null = null;
  if (aplica) {
    const itens = contexto.itens ?? [];
    if (itens.some((item) => valorDestacado(item.vICMSST))) excecaoAplicada = 'vICMSST';
    else if (itens.some((item) => valorInformado(item.vICMSSTRet))) excecaoAplicada = 'vICMSSTRet';
    else if ((contexto.ambiente === 'PRODUCAO' || Number(contexto.ambiente) === 1)
      && /^\d{4}-\d{2}-\d{2}/.test(contexto.dataEmissao)
      && contexto.dataEmissao.slice(0, 10) < '2016-07-01') excecaoAplicada = 'dataHistorica';
    else if (itens.length > 0 && itens.every((item) => CST_EXCECAO.has(String(item.cstIcms ?? item.cst ?? '').trim())
      || CSOSN_EXCECAO.has(String(item.csosn ?? '').trim()))) excecaoAplicada = 'tributacaoIsenta';
  }
  return {
    aplica,
    bloqueia: aplica && excecaoAplicada === null,
    ufDestino: uf,
    code: CODE_E16A30,
    regra: REGRA_E16A30.code,
    cStat: REGRA_E16A30.cStat,
    excecaoAplicada,
    fonte: REGRA_E16A30.fonte,
  };
}

export function mensagemBloqueioE16a30(uf: string): string {
  return `${uf.toUpperCase()} não permite destinatário classificado como "2 - Contribuinte isento de inscrição estadual" nesta operação interestadual. Confira a situação fiscal do destinatário: se contribuinte do ICMS, use indicador 1 com IE ativa; se não contribuinte, use indicador 9. Regra E16a-30 — rejeição 805 da NF-e.`;
}

export function issueE16a30(contexto: ContextoE16a30): IcmsIssue | null {
  if (!avaliarRegraE16a30(contexto).bloqueia) return null;
  return {
    code: CODE_E16A30,
    severidade: 'BLOQUEIO',
    field: 'destinatario.indicadorIe',
    message: mensagemBloqueioE16a30(contexto.ufDestino),
    fontes: [REGRA_E16A30.fonte],
  };
}
