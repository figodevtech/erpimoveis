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
const CODIGOS_INFORMATIVOS_SEM_CIENCIA = new Set([
  "NFE_ST_RETIDA_POLITICA_UF",
  "NFE_ICMS_EFETIVO_POLITICA_UF",
]);

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
  const avisosComCiencia: T[] = [];
  const informativos: T[] = [];

  for (const issue of issues) {
    const severidade = String(issue.severidade ?? "").trim().toUpperCase();

    if (severidade === "BLOQUEIO" || severidade === "ERRO") {
      bloqueios.push(issue);
    } else if (issue.requerCiencia === true) {
      avisosComCiencia.push(issue);
    } else if (["AVISO", "INFO", "INFORMACAO", "INFORMAÇÃO", "INFORMATIVO"].includes(severidade)) {
      informativos.push(issue);
    } else {
      bloqueios.push(issue);
    }
  }

  return {
    bloqueios,
    avisosComCiencia,
    /** Alias temporário para os consumidores existentes. Contém só ciência. */
    avisos: avisosComCiencia,
    informativos,
    pronto: bloqueios.length === 0 && avisosComCiencia.length === 0,
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

/**
 * Registra a ciência dada no fechamento da emissão. Mantém confirmações
 * anteriores e não duplica códigos quando o mesmo aviso reaparece na tela.
 */
export function confirmarAvisosFiscais<T extends ItemComCienciaFiscal>(
  item: T,
  codigos: readonly string[],
): T {
  const confirmados = [
    ...new Set([
      ...item.avisosFiscaisConfirmados,
      ...codigos.map((codigo) => String(codigo).trim()).filter(Boolean),
    ]),
  ].filter((codigo) => !CODIGOS_INFORMATIVOS_SEM_CIENCIA.has(codigo));

  if (
    confirmados.length === item.avisosFiscaisConfirmados.length &&
    confirmados.every((codigo, index) => codigo === item.avisosFiscaisConfirmados[index])
  ) {
    return item;
  }

  return { ...item, avisosFiscaisConfirmados: confirmados };
}
