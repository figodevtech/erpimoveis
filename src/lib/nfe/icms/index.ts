// Núcleo de ICMS da NF-e/NFC-e.
//
// Os cinco fluxos de emissão (venda, OS, entrada, saída de estoque e avulsa)
// convergem em `salvarNFeAvulsaDraft`, que chama este módulo uma vez por item.
// O resultado — `IcmsCanonico` — é a única fonte do grupo ICMS no XML, dos
// totais <ICMSTot>, das colunas de `nfe_item`, da prévia e do snapshot.

import { chaveCiencia, type CienciaRegistrada } from '../issuesFiscais';
import type { CRT, NFeItem } from '../types';
import { blocosPresentes, calcularIcmsItem } from './calculo';
import { validarCoerenciaCfopIcms } from './cfopSemantica';
import { validarIcmsCanonico } from './serializacao';
import { BLOCOS_ICMS, NFE_ICMS_RULE_VERSION, resolverTratamentoIcms } from './tratamento';
import type { DecisaoIcms, EntradaIcms, IcmsCanonico, IcmsIssue, ResultadoIcms } from './tipos';

export * from './tipos';
export {
  FONTE_FRETE_NA_BASE,
  MODALIDADES_FRETE_DO_REMETENTE,
  comporBaseIcms,
  freteNaBaseIcms,
  nomeModalidadeFrete,
  type ComposicaoBaseIcms,
  type DecisaoFreteNaBase,
} from './baseCalculo';
export { blocosPresentes, calcularIcmsItem, icmsVazio, numeroIcms } from './calculo';
export { VERSAO_REGRA_CFOP_ST, papelStDoCfop, papelStDoTratamento, validarCoerenciaCfopIcms } from './cfopSemantica';
export { ORDEM_XSD_ICMS, serializarIcms, validarIcmsCanonico } from './serializacao';
export {
  BLOCOS_ICMS,
  NFE_ICMS_RULE_VERSION,
  blocoPermitido,
  codigoIcmsDoRegime,
  resolverTratamentoIcms,
  semIcmsProprio,
} from './tratamento';

/**
 * Valor do item efetivamente cobrado: vProd menos o desconto incondicional.
 * É a base padrão de ICMS, PIS/COFINS e IPI quando nada for informado — o
 * desconto incondicional reduz a base de cálculo desses tributos.
 *
 * O frete cobrado na própria nota ainda não entra na base do ICMS; mudar isso
 * altera imposto devido e é decisão separada.
 */
export function valorLiquidoItem(item: Pick<NFeItem, 'valorTotal' | 'valorDesconto'>) {
  const bruto = Number(item.valorTotal ?? 0);
  const desconto = Math.min(Math.max(0, Number(item.valorDesconto ?? 0)), Math.max(0, bruto));
  return Number((bruto - desconto).toFixed(2));
}

/**
 * Entrada do núcleo a partir dos campos soltos de um `NFeItem`. Usada para
 * itens que não passaram pelo serviço (testes, integrações). Base, valor e
 * redução informados aqui contam como decisão explícita; a alíquota, não.
 */
export function entradaIcmsDeItem(item: NFeItem, crt: CRT): EntradaIcms {
  return {
    crt,
    cst: item.cstIcms ?? item.cst,
    csosn: item.csosn,
    orig: item.orig,
    valorOperacao: valorLiquidoItem(item),
    aliquotaIcms: item.pICMS ?? item.aliquotaIcms,
    proprio: {
      modBC: item.modBC ?? null,
      vBC: item.vBC ?? item.baseCalculoIcms,
      pRedBC: item.pRedBC,
      vICMS: item.vICMS ?? item.valorIcms,
    },
    fcp: { pFCP: item.pFCP, vFCP: item.vFCP },
    diferimento: { pDif: item.pDif },
    st: {
      modBCST: item.modBCST ?? null,
      pMVAST: item.pMVAST,
      pRedBCST: item.pRedBCST,
      vBCST: item.vBCST,
      pICMSST: item.pICMSST,
      vICMSST: item.vICMSST,
    },
    fcpSt: { vBCFCPST: item.vBCFCPST, pFCPST: item.pFCPST, vFCPST: item.vFCPST },
    stRetida: {
      vBCSTRet: item.vBCSTRet,
      pST: item.pST,
      vICMSSubstituto: item.vICMSSubstituto,
      vICMSSTRet: item.vICMSSTRet,
    },
    fcpStRetido: { vBCFCPSTRet: item.vBCFCPSTRet, pFCPSTRet: item.pFCPSTRet, vFCPSTRet: item.vFCPSTRet },
    desoneracao: { vICMSDeson: item.vICMSDeson, motDesICMS: item.motDesICMS ?? null },
    creditoSn: { pCredSN: item.pCredSN, vCredICMSSN: item.vCredICMSSN },
  };
}

/** Grupo ICMS do item: o canônico já decidido pelo serviço, ou calculado agora. */
export function resolverIcmsDoItem(item: NFeItem, crt: CRT): ResultadoIcms {
  if (item.icms) {
    const tratamento = resolverTratamentoIcms({ crt, cst: item.cstIcms ?? item.cst, csosn: item.csosn });
    return {
      tratamento,
      valores: item.icms,
      camposIgnorados: item.icmsDecisao?.camposIgnorados ?? [],
      issues: validarIcmsCanonico(item.icms, tratamento),
    };
  }
  return calcularIcmsItem(entradaIcmsDeItem(item, crt));
}

/** Canônico pronto para serializar. Lança se a combinação não fecha. */
export function icmsCanonicoDoItem(item: NFeItem, crt: CRT): IcmsCanonico {
  const resultado = resolverIcmsDoItem(item, crt);
  const bloqueios = resultado.issues.filter((issue) => issue.severidade === 'BLOQUEIO');
  if (bloqueios.length) {
    throw new Error(bloqueios.map((issue) => `${issue.code}: item ${item.numeroItem}; ${issue.message}`).join(' '));
  }
  if (!resultado.valores) {
    throw new Error(
      `NFE_ICMS_CST_UNSUPPORTED: item ${item.numeroItem}, ${crt === 1 || crt === 4 ? 'CSOSN' : 'CST'} ${String(
        (crt === 1 || crt === 4 ? item.csosn : item.cstIcms ?? item.cst) ?? '',
      )}.`,
    );
  }
  return resultado.valores;
}

/** Avisos de coerência (CFOP × CST/CSOSN) que exigem ciência do usuário. */
export function avisosSemanticosIcms(item: NFeItem, crt: CRT): IcmsIssue[] {
  const resultado = resolverIcmsDoItem(item, crt);
  if (!resultado.tratamento || !resultado.valores) return [];
  return validarCoerenciaCfopIcms({
    cfop: item.cfop,
    tratamento: resultado.tratamento,
    // Em itens já canônicos, a decisão persistida é preferível; a presença do
    // bloco resolvido é o fallback para integrações anteriores ao snapshot.
    stAtivada: item.icmsDecisao?.stOperacao ?? blocosPresentes(resultado.valores).includes('st'),
  });
}

function explicar(resultado: ResultadoIcms): string {
  const { tratamento, valores } = resultado;
  if (!tratamento || !valores) return '';
  const rotulo = `${tratamento.regime === 'SIMPLES' ? 'CSOSN' : 'CST'} ${tratamento.codigo}`;
  const partes = [`${rotulo} (${tratamento.grupoXml}) — ${tratamento.descricao}.`];
  partes.push(
    valores.vICMS !== null
      ? `ICMS próprio destacado: base ${valores.vBC?.toFixed(2)}, alíquota ${valores.pICMS}%, valor ${valores.vICMS.toFixed(2)}.`
      : 'Sem ICMS próprio nesta nota.',
  );
  const composicao = resultado.composicaoBase;
  if (composicao && composicao.frete > 0 && (valores.vBC !== null || valores.vBCST !== null)) {
    partes.push(
      `Frete de ${composicao.frete.toFixed(2)} ${composicao.freteIntegraBaseIcms ? 'incluído' : 'não incluído'} na base do ICMS próprio` +
        (valores.vBCST !== null ? ' e incluído na base da ST.' : '.'),
    );
  }
  if (valores.vICMSST !== null) partes.push(`ICMS-ST desta operação: base ${valores.vBCST?.toFixed(2)}, valor ${valores.vICMSST.toFixed(2)}.`);
  if (valores.vICMSSTRet !== null) partes.push(`ICMS-ST cobrado anteriormente informado: ${valores.vICMSSTRet.toFixed(2)}.`);
  for (const ignorado of resultado.camposIgnorados) partes.push(ignorado.motivo);
  return partes.join(' ');
}

export function montarDecisaoIcms(
  resultado: ResultadoIcms,
  avisosConfirmados: Array<IcmsIssue & { ciencia?: CienciaRegistrada }> = [],
): DecisaoIcms | undefined {
  const { tratamento, valores } = resultado;
  if (!tratamento || !valores) return undefined;
  const presentes = blocosPresentes(valores);
  const natureza = tratamento.natureza;
  return {
    versaoRegraIcms: NFE_ICMS_RULE_VERSION,
    cst: valores.cst,
    csosn: valores.csosn,
    grupoXmlIcms: valores.grupoXml,
    tratamentoIcms: natureza,
    icmsProprio: valores.vICMS !== null,
    stOperacao: valores.vBCST !== null,
    stRetidaAnteriormente: natureza === 'ST_RETIDA_ANTERIORMENTE' || natureza === 'SN_ST_RETIDA_ANTERIORMENTE',
    reducaoBase: valores.pRedBC !== null,
    diferimento: valores.pDif !== null,
    desoneracao: valores.vICMSDeson !== null,
    creditoSn: valores.pCredSN !== null,
    camposAplicaveis: BLOCOS_ICMS.filter((bloco) => tratamento.blocos[bloco] !== 'PROIBIDO'),
    camposInformados: presentes,
    camposIgnorados: resultado.camposIgnorados,
    // Só avisos que admitem ciência; INFO e BLOQUEIO nunca entram aqui.
    avisosConfirmados: avisosConfirmados
      .filter((aviso) => chaveCiencia(aviso) !== null)
      .map((aviso) => ({
        code: aviso.code,
        message: aviso.message,
        fingerprint: aviso.fingerprint,
        ...(aviso.fontes ? { fontes: aviso.fontes } : {}),
        ...(aviso.ciencia ? { ciencia: aviso.ciencia } : {}),
      })),
    ...(resultado.composicaoBase ? { composicaoBase: resultado.composicaoBase } : {}),
    motivo: explicar(resultado),
  };
}

export type TotaisIcms = {
  vBC: number;
  vICMS: number;
  vICMSDeson: number;
  vFCP: number;
  vBCST: number;
  vST: number;
  vFCPST: number;
  vFCPSTRet: number;
};

/**
 * Totais do <ICMSTot>: a soma exata do que foi serializado nos itens. É isso
 * que a SEFAZ confere (vBC e vICMS "difere do somatório dos itens").
 */
export function somarTotaisIcms(itens: IcmsCanonico[]): TotaisIcms {
  return itens.reduce<TotaisIcms>(
    (total, icms) => ({
      vBC: total.vBC + (icms.vBC ?? 0),
      vICMS: total.vICMS + (icms.vICMS ?? 0),
      vICMSDeson: total.vICMSDeson + (icms.vICMSDeson ?? 0),
      vFCP: total.vFCP + (icms.vFCP ?? 0),
      vBCST: total.vBCST + (icms.vBCST ?? 0),
      vST: total.vST + (icms.vICMSST ?? 0),
      vFCPST: total.vFCPST + (icms.vFCPST ?? 0),
      vFCPSTRet: total.vFCPSTRet + (icms.vFCPSTRet ?? 0),
    }),
    { vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0 },
  );
}
