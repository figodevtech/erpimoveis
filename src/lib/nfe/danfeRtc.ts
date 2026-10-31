/** NT 2026.010 v1.00: implantação em produção em 01/12/2026. */
export function usaDanfeRtc2026(dataEmissao?: string | Date | null): boolean {
  if (!dataEmissao) return false;
  const data = typeof dataEmissao === "string"
    ? dataEmissao.slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(dataEmissao);
  return /^\d{4}-\d{2}-\d{2}$/.test(data) && data >= "2026-12-01";
}

export function temTotaisRtc(totais: {
  possuiGrupoRtc?: boolean; vBCIBSCBS: number; vIBS: number; vCBS: number; vIS: number;
  vIBSMono?: number; vCBSMono?: number; vIBSMonoReten?: number; vCBSMonoReten?: number;
}): boolean {
  return Boolean(totais.possuiGrupoRtc || totais.vBCIBSCBS || totais.vIBS || totais.vCBS || totais.vIS ||
    totais.vIBSMono || totais.vCBSMono || totais.vIBSMonoReten || totais.vCBSMonoReten);
}

export function temGrupoRegularRtc(item: { possui_grupo_ibs_cbs?: boolean; cst_ibs_cbs: string | null }): boolean {
  return item.possui_grupo_ibs_cbs ?? Boolean(item.cst_ibs_cbs);
}
