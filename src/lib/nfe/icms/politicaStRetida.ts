// ICMS-ST cobrado anteriormente e ICMS efetivo (CST 60 / CSOSN 500).
//
// As regras N12-81, N12-82 (ICMS60) e N12a-50, N12a-60 (ICMSSN500) do MOC 7.0,
// vindas da NT 2018.005, são de implementação facultativa por UF. Não existe
// regra nacional "CST 60 exige esses campos". Sem política estadual cadastrada,
// com fonte e vigência, a orientação é INFO: não pede ciência e não bloqueia.
// Com política obrigatória vigente, é BLOQUEIO só no contexto que ela cobre.
//
// O ERP nunca estima vBCSTRet, pST, vICMSSubstituto, vICMSSTRet, pRedBCEfet,
// vBCEfet, pICMSEfet nem vICMSEfet: vêm do documento fiscal de aquisição.

import type { FonteIssueFiscal, IcmsCanonico, IcmsIssue } from './tipos';

export type ContextoStRetida = {
  ufEmitente?: string;
  ufDestino?: string;
  indFinal?: number | null;
  dataEmissao?: string;
};

export type RegraStRetida = 'ST_RETIDA' | 'ICMS_EFETIVO';

/**
 * Manifestação estadual cadastrada; sem fonte e vigência não existe bloqueio.
 *
 * - `VIGENTE`: a fonte estabelece a regra sem prazo (ou com `fim`) e pode
 *   decidir a severidade na data da emissão.
 * - `HISTORICA`: a fonte descreve uma situação datada ("inicialmente", "por
 *   ora"). Serve de evidência na mensagem, nunca decide a severidade: sem regra
 *   obrigatória vigente comprovada, o aviso é INFO.
 */
export type PoliticaStRetida = {
  /** UF que valida o documento (a do emitente). */
  ufEmitente: string;
  /** Restringe a política às operações para esta UF. Ausente = qualquer destino. */
  ufDestino?: string;
  /** AAAA-MM-DD */
  inicio: string;
  /** AAAA-MM-DD, inclusive. */
  fim?: string;
  /** ST_RETIDA = indFinal 0 (N12-81/N12a-50); ICMS_EFETIVO = indFinal 1 (N12-82/N12a-60). */
  regra: RegraStRetida;
  status?: 'VIGENTE' | 'HISTORICA';
  /** Quem se manifestou, para a mensagem ("SEFAZ-PB"). */
  orgao?: string;
  fonte: string;
  fonteUrl?: string;
  /** Data da manifestação do órgão, AAAA-MM-DD. É a data citada ao usuário. */
  publicadaEm?: string;
  /** Regras do MOC afetadas, para a auditoria. */
  regrasMoc?: string[];
  /**
   * Quando o ERP conferiu a fonte, AAAA-MM-DD. Metadado interno: não é uma
   * manifestação do órgão e nunca aparece como data da política.
   */
  revisadaEm?: string;
  obrigatoria: boolean;
};

const PB_NT_2018_005 = {
  ufEmitente: 'PB',
  inicio: '2019-04-08',
  orgao: 'SEFAZ-PB',
  publicadaEm: '2019-04-08',
  fonte: 'SEFAZ-PB, comunicado de 08/04/2019 sobre a NT 2018.005 (ICMS-ST anteriormente retido)',
  fonteUrl:
    'https://www.sefaz.pb.gov.br/announcements/7581-validacao-do-icms-de-substituicao-tributaria-dos-documentos-eletronicos-nf-e-e-nfc-e-precisa-ser-realizada-ate-29-de-abril',
  revisadaEm: '2026-09-22',
  obrigatoria: false,
} as const;

/**
 * Políticas estaduais conferidas. Uma orientação nova da mesma UF entra como
 * outra linha com `inicio` posterior (e, se for o caso, `fim` na anterior): a
 * mais recente vigente na data da emissão prevalece.
 */
export const POLITICAS_ST_RETIDA: readonly PoliticaStRetida[] = [
  // "Tornou-se facultativo o preenchimento" de vBCSTRet, pST, vICMSSubstituto e
  // vICMSSTRet. O comunicado não traz prazo; ainda assim a mensagem cita a data
  // dele e não afirma que a situação continua a mesma hoje.
  { ...PB_NT_2018_005, regra: 'ST_RETIDA', status: 'VIGENTE', regrasMoc: ['N12-81', 'N12a-50'] },
  // "As demais validações opcionais por Estado da NT 2018.005 também não serão
  // aplicadas, inicialmente, no estado da Paraíba." O "inicialmente" faz disto
  // um registro histórico, não uma política facultativa permanente.
  { ...PB_NT_2018_005, regra: 'ICMS_EFETIVO', status: 'HISTORICA', regrasMoc: ['N12-82', 'N12a-60'] },
];

export const FONTE_MOC_ST_RETIDA: FonteIssueFiscal = {
  titulo: 'MOC 7.0 / NT 2018.005 — regras N12-81, N12-82, N12a-50 e N12a-60 (aplicação facultativa pela UF)',
  url: 'https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=URRwWd0zp2U%3D',
  jurisdicao: 'NACIONAL',
};

function dataBr(valor: string) {
  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor;
}

function vigenteEm(politica: PoliticaStRetida, data: string) {
  return data >= politica.inicio && (!politica.fim || data <= politica.fim);
}

export function resolverObrigatoriedadeStRetida(
  contexto: ContextoStRetida & { cst?: string | null; csosn?: string | null },
  politicas: readonly PoliticaStRetida[] = POLITICAS_ST_RETIDA,
) {
  if (contexto.cst !== '60' && contexto.csosn !== '500') return null;
  if (contexto.indFinal !== 0 && contexto.indFinal !== 1) return null;
  const regra: RegraStRetida = contexto.indFinal === 0 ? 'ST_RETIDA' : 'ICMS_EFETIVO';
  const data = contexto.dataEmissao?.slice(0, 10);
  const candidatas = politicas
    .filter(
      (p) =>
        p.regra === regra &&
        p.ufEmitente === contexto.ufEmitente &&
        (!p.ufDestino || p.ufDestino === contexto.ufDestino) &&
        p.fonte.trim() &&
        data &&
        vigenteEm(p, data),
    )
    // A mais recente prevalece; entre duas do mesmo dia, a de destino específico.
    .sort((a, b) => b.inicio.localeCompare(a.inicio) || Number(Boolean(b.ufDestino)) - Number(Boolean(a.ufDestino)));
  // Registro histórico nunca decide a severidade: só é citado.
  const politica = candidatas.find((p) => (p.status ?? 'VIGENTE') === 'VIGENTE') ?? null;
  const historica = politica ? null : candidatas.find((p) => p.status === 'HISTORICA') ?? null;
  return {
    regra,
    severidade: politica?.obrigatoria ? ('BLOQUEIO' as const) : ('INFO' as const),
    fonte: (politica ?? historica)?.fonte ?? 'MOC 7.0, N12-81/N12-82 e N12a-50/N12a-60; aplicação facultativa pela UF',
    contexto,
    politica,
    historica,
  };
}

export function validarPoliticaStRetida(
  icms: IcmsCanonico,
  contexto: ContextoStRetida,
  politicas: readonly PoliticaStRetida[] = POLITICAS_ST_RETIDA,
): IcmsIssue[] {
  const regra = resolverObrigatoriedadeStRetida({ ...contexto, cst: icms.cst, csosn: icms.csosn }, politicas);
  if (!regra) return [];
  const campos = regra.regra === 'ST_RETIDA'
    ? ['vBCSTRet', 'pST', 'vICMSSubstituto', 'vICMSSTRet'] as const
    : ['pRedBCEfet', 'vBCEfet', 'pICMSEfet', 'vICMSEfet'] as const;
  const faltantes = campos.filter((campo) => icms[campo] == null);
  if (!faltantes.length) return [];
  const identificacao = `CST/CSOSN ${icms.cst ?? icms.csosn}, indFinal=${contexto.indFinal}`;
  const orientacao = regra.regra === 'ST_RETIDA'
    ? 'Dados de ICMS-ST cobrado anteriormente não informados. O grupo permite vBCSTRet, pST, vICMSSubstituto e vICMSSTRet. Preencha somente quando aplicável e com os dados da operação anterior.'
    : 'ICMS efetivo não informado. O grupo permite pRedBCEfet, vBCEfet, pICMSEfet e vICMSEfet. Preencha somente quando aplicável e com dados fiscalmente comprovados.';
  const obrigatoriedade = `Política estadual vigente exige o preenchimento de ${faltantes.join(', ')}.`;
  const { politica, historica } = regra;
  const citada = politica ?? historica;
  const orgaoEData = (p: PoliticaStRetida) =>
    `${p.orgao ?? p.ufEmitente} de ${dataBr(p.publicadaEm ?? p.inicio)}`;
  // Cita a manifestação do órgão com a data dela. A data em que o ERP conferiu
  // a fonte (`revisadaEm`) não é uma nova manifestação e não aparece aqui.
  const situacao = regra.severidade === 'BLOQUEIO'
    ? ''
    : politica
      ? `Existe comunicado da ${orgaoEData(politica)} informando a não aplicação obrigatória dessa validação. ` +
        'Não há política estadual obrigatória mais recente cadastrada no ERP. '
      : historica
        ? `Comunicado da ${orgaoEData(historica)} informou que essa validação não seria aplicada, inicialmente. ` +
          'Não há regra estadual obrigatória vigente comprovada cadastrada no ERP. '
        : 'Não há política estadual obrigatória configurada. ';
  const fontes: FonteIssueFiscal[] = [
    FONTE_MOC_ST_RETIDA,
    ...(citada
      ? [{
          titulo: citada.status === 'HISTORICA' ? `${citada.fonte} (registro histórico)` : citada.fonte,
          url: citada.fonteUrl,
          vigenciaDesde: citada.publicadaEm ?? citada.inicio,
          jurisdicao: citada.ufEmitente,
        }]
      : []),
  ];
  return [{ code: `NFE_${regra.regra}_POLITICA_UF`, severidade: regra.severidade,
    requerCiencia: false,
    field: regra.regra === 'ST_RETIDA' ? 'icms.stRetida' : 'icms.icmsEfetivo',
    message: `${identificacao}: ${regra.severidade === 'BLOQUEIO' ? obrigatoriedade : orientacao} `
      + situacao
      + `O ERP não estima esses valores. Fonte: ${regra.fonte}.`,
    fontes }];
}
