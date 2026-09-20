// Composição da base de cálculo do ICMS.
//
// ICMS próprio — LC 87/1996, art. 13, §1º (reproduzido no RICMS/PB):
//   II, "a": integram a base seguros, juros e demais importâncias pagas,
//            recebidas ou debitadas;
//   II, "b": integra a base o frete, caso o transporte seja efetuado pelo
//            próprio remetente ou por sua conta e ordem e seja cobrado em
//            separado.
//
// ICMS-ST — LC 87/1996, art. 8º, II: valor da operação própria + seguro, frete
// e outros encargos cobrados ou transferíveis aos adquirentes + MVA.
//
// O frete que entra aqui é o cobrado na própria nota (vFrete do item). Com
// transporte do remetente (modFrete 0 ou 3) a lei responde sozinha. Nas demais
// modalidades o frete cobrado não se encaixa na alínea "b" e a resposta depende
// da operação: o ERP não presume — o usuário decide e a decisão fica gravada.

/** modFrete em que o transporte é do remetente ou contratado por ele. */
export const MODALIDADES_FRETE_DO_REMETENTE = new Set(['0', '3']);

const NOME_MODALIDADE: Record<string, string> = {
  '0': 'contratação do frete por conta do remetente (CIF)',
  '1': 'contratação do frete por conta do destinatário (FOB)',
  '2': 'contratação do frete por conta de terceiros',
  '3': 'transporte próprio por conta do remetente',
  '4': 'transporte próprio por conta do destinatário',
  '9': 'sem ocorrência de transporte',
};

export const FONTE_FRETE_NA_BASE = 'LC 87/1996, art. 13, §1º, II, "b"';

export type DecisaoFreteNaBase = {
  /** `null` = há frete cobrado e ninguém decidiu ainda: a nota não sai. */
  integra: boolean | null;
  fonte: 'SEM_FRETE' | 'LEI' | 'USUARIO' | 'PENDENTE' | 'INCONSISTENTE';
  modFrete: string;
  valorFrete: number;
  motivo: string;
};

export function nomeModalidadeFrete(modFrete: unknown) {
  const codigo = String(modFrete ?? '').trim();
  return NOME_MODALIDADE[codigo] ?? `modalidade ${codigo || 'não informada'}`;
}

/**
 * O frete cobrado na nota integra a base do ICMS próprio?
 *
 * - Sem frete cobrado: não há o que decidir.
 * - Transporte do remetente ou por conta dele (0, 3): sim, por lei.
 * - Demais modalidades: vale a decisão informada; sem ela, pendente.
 */
export function freteNaBaseIcms(input: {
  modFrete?: string | null;
  valorFrete: number;
  decisaoUsuario?: boolean | null;
}): DecisaoFreteNaBase {
  const modFrete = String(input.modFrete ?? '9').trim() || '9';
  const valorFrete = Math.max(0, Number(input.valorFrete) || 0);
  const modalidade = `modFrete ${modFrete} — ${nomeModalidadeFrete(modFrete)}`;

  if (valorFrete <= 0) {
    return { integra: false, fonte: 'SEM_FRETE', modFrete, valorFrete, motivo: 'Nenhum frete cobrado na nota.' };
  }
  if (modFrete === '9') {
    return {
      integra: null, fonte: 'INCONSISTENTE', modFrete, valorFrete,
      motivo: 'Frete cobrado na NF-e é incompatível com modFrete 9 (sem ocorrência de transporte). Corrija a modalidade ou o valor do frete. Regra de coerência do ERP.',
    };
  }
  if (MODALIDADES_FRETE_DO_REMETENTE.has(modFrete)) {
    return {
      integra: true,
      fonte: 'LEI',
      modFrete,
      valorFrete,
      motivo: `Frete cobrado na nota com transporte do remetente (${modalidade}): integra a base do ICMS (${FONTE_FRETE_NA_BASE}).`,
    };
  }
  if (typeof input.decisaoUsuario === 'boolean') {
    return {
      integra: input.decisaoUsuario,
      fonte: 'USUARIO',
      modFrete,
      valorFrete,
      motivo:
        `Frete cobrado na nota com ${modalidade}: fora da hipótese automática do ${FONTE_FRETE_NA_BASE}; ` +
        `o usuário decidiu que ${input.decisaoUsuario ? '' : 'não '}integra a base do ICMS próprio.`,
    };
  }
  return {
    integra: null,
    fonte: 'PENDENTE',
    modFrete,
    valorFrete,
    motivo:
      `Há frete de R$ ${valorFrete.toFixed(2)} cobrado na nota com ${modalidade}. O ${FONTE_FRETE_NA_BASE} só inclui ` +
      'automaticamente o frete na base do ICMS quando o transporte é do remetente ou por sua conta e ordem. ' +
      'Informe se este frete integra a base do ICMS próprio.',
  };
}

export type ComposicaoBaseIcms = {
  /** Item líquido do desconto incondicional. */
  valorOperacao: number;
  /** Frete do item cobrado na nota (vFrete). */
  frete: number;
  freteIntegraBaseIcms: boolean;
  seguro: number;
  outrasDespesas: number;
  /** Base do ICMS próprio antes de qualquer redução (pRedBC). */
  baseIcmsProprio: number;
  /** Valor da operação para o ICMS-ST, antes de MVA e redução da BC ST. */
  baseSt: number;
};

function dinheiro(valor: number) {
  return Number(valor.toFixed(2));
}

export function comporBaseIcms(input: {
  valorOperacao: number;
  frete?: number | null;
  freteIntegraBaseIcms?: boolean | null;
  seguro?: number | null;
  outrasDespesas?: number | null;
}): ComposicaoBaseIcms {
  const valorOperacao = Math.max(0, Number(input.valorOperacao) || 0);
  const frete = Math.max(0, Number(input.frete) || 0);
  const seguro = Math.max(0, Number(input.seguro) || 0);
  const outrasDespesas = Math.max(0, Number(input.outrasDespesas) || 0);
  const freteIntegraBaseIcms = input.freteIntegraBaseIcms === true;
  return {
    valorOperacao,
    frete,
    freteIntegraBaseIcms,
    seguro,
    outrasDespesas,
    baseIcmsProprio: dinheiro(valorOperacao + (freteIntegraBaseIcms ? frete : 0) + seguro + outrasDespesas),
    // Na ST o frete cobrado do adquirente entra sempre (art. 8º, II, "b").
    baseSt: dinheiro(valorOperacao + frete + seguro + outrasDespesas),
  };
}
