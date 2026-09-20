import type { IcmsCanonico, IcmsIssue } from './tipos';

export type ContextoStRetida = {
  ufEmitente?: string;
  ufDestino?: string;
  indFinal?: number | null;
  dataEmissao?: string;
};
/** Cadastro de políticas revisadas; sem fonte/vigência não existe bloqueio estadual. */
export type PoliticaStRetida = {
  ufEmitente: string;
  ufDestino?: string;
  inicio: string;
  fim?: string;
  regra: 'ST_RETIDA' | 'ICMS_EFETIVO';
  fonte: string;
  obrigatoria: boolean;
};
export function resolverObrigatoriedadeStRetida(
  contexto: ContextoStRetida & { cst?: string | null; csosn?: string | null },
  politicas: readonly PoliticaStRetida[] = [],
) {
  if (contexto.cst !== '60' && contexto.csosn !== '500') return null;
  if (contexto.indFinal !== 0 && contexto.indFinal !== 1) return null;
  const regra = contexto.indFinal === 0 ? 'ST_RETIDA' : 'ICMS_EFETIVO';
  const data = contexto.dataEmissao?.slice(0, 10);
  const politica = politicas.find((p) => p.regra === regra && p.ufEmitente === contexto.ufEmitente
    && (!p.ufDestino || p.ufDestino === contexto.ufDestino) && p.fonte.trim()
    && data && data >= p.inicio && (!p.fim || data <= p.fim));
  return { regra, severidade: politica?.obrigatoria ? 'BLOQUEIO' as const : 'AVISO' as const,
    fonte: politica?.fonte ?? 'MOC 7.0, N12-81/N12-82 e N12a-50/N12a-60; aplicação facultativa pela UF',
    contexto, politica: politica ?? null };
}

export function validarPoliticaStRetida(icms: IcmsCanonico, contexto: ContextoStRetida, politicas: readonly PoliticaStRetida[] = []): IcmsIssue[] {
  const regra = resolverObrigatoriedadeStRetida({ ...contexto, cst: icms.cst, csosn: icms.csosn }, politicas);
  if (!regra) return [];
  const campos = regra.regra === 'ST_RETIDA'
    ? ['vBCSTRet', 'pST', 'vICMSSubstituto', 'vICMSSTRet'] as const
    : ['pRedBCEfet', 'vBCEfet', 'pICMSEfet', 'vICMSEfet'] as const;
  const faltantes = campos.filter((campo) => icms[campo] == null);
  if (!faltantes.length) return [];
  return [{ code: `NFE_${regra.regra}_POLITICA_UF`, severidade: regra.severidade,
    field: regra.regra === 'ST_RETIDA' ? 'icms.stRetida' : 'icms.icmsEfetivo',
    message: `CST/CSOSN ${icms.cst ?? icms.csosn}, indFinal=${contexto.indFinal}: faltam ${faltantes.join(', ')}. `
      + (regra.severidade === 'AVISO' ? 'Confira a exigência da UF; não há política estadual obrigatória configurada. ' : 'Política estadual vigente exige o preenchimento. ')
      + `Não estimar valores da compra. Fonte: ${regra.fonte}.` }];
}
