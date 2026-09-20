export type IssueFiscalClassificavel = {
  severidade?: string | null;
  requerCiencia?: boolean | null;
};

export type ItemComCienciaFiscal = {
  cfop?: unknown;
  cst?: unknown;
  csosn?: unknown;
  avisosFiscaisConfirmados: readonly string[];
};

const CAMPOS_QUE_INVALIDAM_CIENCIA = ["cfop", "cst", "csosn"] as const;

/**
 * Regra única de apresentação das issues fiscais.
 *
 * Issues antigas da validação estrutural não carregam severidade; por
 * segurança, elas continuam sendo bloqueios. `requerCiencia` identifica um
 * aviso pendente, mas nunca rebaixa um BLOQUEIO/ERRO explícito.
 */
export function classificarIssuesFiscais<T extends IssueFiscalClassificavel>(
  issues: readonly T[],
) {
  const bloqueios: T[] = [];
  const avisos: T[] = [];
  const informativos: T[] = [];

  for (const issue of issues) {
    const severidade = String(issue.severidade ?? "").trim().toUpperCase();

    if (severidade === "BLOQUEIO" || severidade === "ERRO") {
      bloqueios.push(issue);
    } else if (severidade === "AVISO" || issue.requerCiencia === true) {
      avisos.push(issue);
    } else if (["INFO", "INFORMACAO", "INFORMAÇÃO", "INFORMATIVO"].includes(severidade)) {
      informativos.push(issue);
    } else {
      bloqueios.push(issue);
    }
  }

  return {
    bloqueios,
    avisos,
    informativos,
    pronto: bloqueios.length === 0 && avisos.length === 0,
  };
}

/**
 * A ciência vale para a combinação tributária conferida. Alterar CFOP,
 * CST ou CSOSN limpa as confirmações; alterações nos demais campos preservam.
 */
export function aplicarAlteracoesComCienciaFiscal<T extends ItemComCienciaFiscal>(
  item: T,
  alteracoes: Partial<T>,
): T {
  const mudouClassificacao = CAMPOS_QUE_INVALIDAM_CIENCIA.some(
    (campo) =>
      Object.prototype.hasOwnProperty.call(alteracoes, campo) &&
      alteracoes[campo] !== item[campo],
  );

  return {
    ...item,
    ...alteracoes,
    ...(mudouClassificacao ? { avisosFiscaisConfirmados: [] } : {}),
  } as T;
}
