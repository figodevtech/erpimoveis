import type { NFeItem, TributoPisCofins } from './types';

// Base de cálculo do IBS e da CBS (gIBSCBS/vBC) por item.
//
// Composição oficial: NT 2025.002-RTC, regra de validação UB16-10 (rejeição
// 1104, "Valor da Base de cálculo do IBS e CBS difere do somatório dos valores
// que a compõem"):
//
//   vBC = vProd + vServ + vFrete + vSeg + vOutro + vII
//       − vDesc − vPIS − vCOFINS − vPISST* − vCOFINSST* − vICMS − vICMSUFDest − vFCP − vFCPUFDest
//       − vICMSMono − vISSQN + vIS
//
// * Exceções 1 e 2 da UB16-10: não subtrair PIS-ST/COFINS-ST quando o
//   respectivo indSoma*=1, pois nesse caso o valor compõe o total da NF-e.
//
// Fundamento material: LC 214/2025, art. 12. O §1º põe na base o valor
// integral cobrado pelo fornecedor, inclusive transporte, seguros e demais
// importâncias; o §2º, V tira ICMS, ISS, PIS e COFINS de 2026 a 2032.
//
// Frete: o vFrete do item é o frete cobrado na própria nota, e por isso entra
// sempre, qualquer que seja a modalidade. O que a lei exclui (§2º, IV:
// reembolso de transporte contratado em nome do adquirente, com documento em
// nome dele) não deve estar no vFrete da NF-e. modFrete 9 com frete é
// incoerente e é barrado antes (freteNaBaseIcms).
//
// Na NT 2025.002 v1.51 a UB16-10 ainda é "implementação futura, aguardando
// orientação normativa": a SEFAZ não rejeita hoje uma base diferente. Por isso
// a base digitada à mão que diverge da composição é AVISO, não bloqueio.

export const VERSAO_BASE_IBS_CBS = 'base-ibs-cbs@2026-09-20.3|UB16-10';
export const FONTE_BASE_IBS_CBS = 'NT 2025.002-RTC v1.51, RV UB16-10; LC 214/2025, art. 12, §§ 1º e 2º';

const moeda = (valor: number) => Number(valor.toFixed(2));
const naoNegativo = (valor: unknown) => Math.max(0, Number(valor) || 0);

export type ComponentesBaseIbsCbs = {
  vProd: number;
  vServ: number;
  vFrete: number;
  vSeg: number;
  vOutro: number;
  vII: number;
  vDesc: number;
  vPIS: number;
  vCOFINS: number;
  vPISST: number;
  indSomaPISST: boolean;
  vCOFINSST: number;
  indSomaCOFINSST: boolean;
  vICMS: number;
  vICMSUFDest: number;
  vFCP: number;
  vFCPUFDest: number;
  vICMSMono: number;
  vISSQN: number;
  vIS: number;
};

export function comporBaseIbsCbs(input: Partial<ComponentesBaseIbsCbs> & {
  modFrete?: string;
  dataEmissao: string;
  baseInformada?: number | null;
}) {
  const componentes: ComponentesBaseIbsCbs = {
    vProd: naoNegativo(input.vProd),
    vServ: naoNegativo(input.vServ),
    vFrete: naoNegativo(input.vFrete),
    vSeg: naoNegativo(input.vSeg),
    vOutro: naoNegativo(input.vOutro),
    vII: naoNegativo(input.vII),
    vDesc: naoNegativo(input.vDesc),
    vPIS: naoNegativo(input.vPIS),
    vCOFINS: naoNegativo(input.vCOFINS),
    vPISST: naoNegativo(input.vPISST),
    indSomaPISST: input.indSomaPISST === true,
    vCOFINSST: naoNegativo(input.vCOFINSST),
    indSomaCOFINSST: input.indSomaCOFINSST === true,
    vICMS: naoNegativo(input.vICMS),
    vICMSUFDest: naoNegativo(input.vICMSUFDest),
    vFCP: naoNegativo(input.vFCP),
    vFCPUFDest: naoNegativo(input.vFCPUFDest),
    vICMSMono: naoNegativo(input.vICMSMono),
    vISSQN: naoNegativo(input.vISSQN),
    vIS: naoNegativo(input.vIS),
  };
  const c = componentes;
  const baseCalculada = moeda(
    c.vProd + c.vServ + c.vFrete + c.vSeg + c.vOutro + c.vII
      - c.vDesc - c.vPIS - c.vCOFINS
      - (c.indSomaPISST ? 0 : c.vPISST)
      - (c.indSomaCOFINSST ? 0 : c.vCOFINSST)
      - c.vICMS - c.vICMSUFDest - c.vFCP - c.vFCPUFDest
      - c.vICMSMono - c.vISSQN + c.vIS,
  );
  const modFrete = input.modFrete ?? '9';
  const baseInformada = input.baseInformada ?? null;
  return {
    versao: VERSAO_BASE_IBS_CBS,
    fonte: FONTE_BASE_IBS_CBS,
    dataEmissao: input.dataEmissao.slice(0, 10),
    modFrete,
    componentes,
    baseCalculada,
    baseInformada,
    baseCalculo: baseInformada ?? baseCalculada,
    origem: baseInformada == null ? ('COMPOSICAO' as const) : ('MANUAL' as const),
    inconsistencia:
      c.vFrete > 0 && modFrete === '9'
        ? 'Frete cobrado com modFrete 9 (sem ocorrência de transporte): corrija a modalidade ou o valor do frete.'
        : !['0', '1', '2', '3', '4', '9'].includes(modFrete)
          ? 'Modalidade do frete inválida.'
          : baseCalculada < 0 || (baseInformada != null && (!Number.isFinite(baseInformada) || baseInformada < 0))
            ? 'Base do IBS/CBS negativa: revise desconto e tributos deduzidos.'
            : null,
  };
}

export type ComposicaoBaseIbsCbs = ReturnType<typeof comporBaseIbsCbs>;

function contribuicao(
  tributo: TributoPisCofins | undefined,
  base: number,
  cst?: string | null,
  aliquota?: number,
  valor?: number,
) {
  if (tributo?.modo === 'NAO_TRIBUTADO' || ['04', '05', '06', '07', '08', '09'].includes(tributo?.cst ?? cst ?? '')) {
    return 0;
  }
  return moeda(
    tributo?.valor ??
      valor ??
      (tributo?.modo === 'QUANTIDADE'
        ? (tributo.quantidade ?? 0) * (tributo.aliquotaPorUnidade ?? 0)
        : ((tributo?.base ?? base) * (tributo?.aliquota ?? aliquota ?? 0)) / 100),
  );
}

/**
 * Componentes lidos do item já resolvido: ICMS do núcleo (grupo canônico) e
 * DIFAL (icmsUfDest). O IBS/CBS tem de ser resolvido DEPOIS deles.
 */
export function baseIbsCbsDoItem(
  item: NFeItem,
  contexto: { modFrete?: string; dataEmissao?: string },
  baseInformada?: number | null,
) {
  const valorLiquido = moeda(item.valorTotal - Number(item.valorDesconto ?? 0));
  return comporBaseIbsCbs({
    vProd: item.valorTotal,
    vDesc: Number(item.valorDesconto ?? 0),
    vFrete: Number(item.valorFrete ?? 0),
    vPIS: contribuicao(item.pis, valorLiquido, item.cstPis, item.aliquotaPis, item.valorPis),
    vCOFINS: contribuicao(item.cofins, valorLiquido, item.cstCofins, item.aliquotaCofins, item.valorCofins),
    vPISST: item.pisST?.valor ?? 0,
    indSomaPISST: item.pisST?.compoeTotal ?? false,
    vCOFINSST: item.cofinsST?.valor ?? 0,
    indSomaCOFINSST: item.cofinsST?.compoeTotal ?? false,
    vICMS: item.icms?.vICMS ?? 0,
    vFCP: item.icms?.vFCP ?? 0,
    vICMSUFDest: item.icmsUfDest?.vICMSUFDest ?? 0,
    vFCPUFDest: item.icmsUfDest?.vFCPUFDest ?? 0,
    vIS: item.impostoSeletivo?.valor ?? 0,
    modFrete: contexto.modFrete,
    dataEmissao: contexto.dataEmissao ?? new Date().toISOString(),
    baseInformada,
  });
}

/** Recupera a escolha, não congela como manual uma base que era calculada. */
export function baseRtcParaEdicao(rtc: NFeItem['rtc']): string {
  if (!rtc) return '';
  const valor = rtc.composicaoBase ? rtc.composicaoBase.baseInformada : rtc.baseCalculo;
  return valor == null ? '' : String(valor);
}

/**
 * Base e valores do IBS/CBS do item, a partir da composição oficial. Valores
 * digitados à mão prevalecem e ficam registrados como informados.
 */
export function resolverRtcDoItem(
  item: NFeItem,
  contexto: { modFrete?: string; dataEmissao?: string },
  valores: { base?: number | null; ibsUf?: number | null; ibsMun?: number | null; cbs?: number | null },
): void {
  if (!item.rtc) return;
  const composicao = baseIbsCbsDoItem(item, contexto, valores.base);
  item.rtc.composicaoBase = composicao;
  item.rtc.valoresInformados = { ibsUf: valores.ibsUf ?? null, ibsMun: valores.ibsMun ?? null, cbs: valores.cbs ?? null };
  item.rtc.baseCalculo = composicao.baseCalculo;
  item.rtc.ibsUf.valor = valores.ibsUf ?? moeda((composicao.baseCalculo * item.rtc.ibsUf.aliquota) / 100);
  item.rtc.ibsMunicipio.valor = valores.ibsMun ?? moeda((composicao.baseCalculo * item.rtc.ibsMunicipio.aliquota) / 100);
  item.rtc.cbs.valor = valores.cbs ?? moeda((composicao.baseCalculo * item.rtc.cbs.aliquota) / 100);
  item.rtc.valorIbs = moeda(item.rtc.ibsUf.valor + item.rtc.ibsMunicipio.valor);
}

export function valorRtcParaEdicao(rtc: NFeItem['rtc'], campo: 'ibsUf' | 'ibsMun' | 'cbs'): string {
  if (!rtc) return '';
  const valor = rtc.valoresInformados
    ? rtc.valoresInformados[campo]
    : campo === 'ibsMun'
      ? rtc.ibsMunicipio.valor
      : rtc[campo].valor;
  return valor == null ? '' : String(valor);
}

export function issuesBaseIbsCbs(rtc: NFeItem['rtc']): import('./icms/tipos').IcmsIssue[] {
  const base = rtc?.composicaoBase;
  if (!base) return [];
  if (base.inconsistencia) {
    return [{ code: 'NFE_IBSCBS_BASE_INVALIDA', severidade: 'BLOQUEIO', field: 'baseRtc', message: base.inconsistencia }];
  }
  return base.origem === 'MANUAL' && Math.abs(base.baseCalculo - base.baseCalculada) > 0.009
    ? [{
        code: 'NFE_IBSCBS_BASE_MANUAL',
        severidade: 'AVISO',
        field: 'baseRtc',
        message:
          `Base IBS/CBS informada (${base.baseCalculo.toFixed(2)}) difere da composição oficial ` +
          `(${base.baseCalculada.toFixed(2)}: vProd + vFrete − vDesc − vPIS − vCOFINS − PIS-ST/COFINS-ST quando não somados ao total − vICMS − vICMSUFDest − vFCP − vFCPUFDest...). ` +
          'Quando a UB16-10 entrar em vigor a SEFAZ rejeita essa diferença (rejeição 1104). ' +
          `Fonte: ${base.fonte}.`,
      }]
    : [];
}
