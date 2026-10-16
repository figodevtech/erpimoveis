import type { SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";

export type SpedDocumentReconciliation = {
  /** NF-e/NFC-e próprias elegíveis na competência (autorizadas, canceladas e denegadas). */
  sourceNotes: number;
  /** Entradas documentais com data fiscal na competência. */
  sourceEntries: number;
  /** Documentos projetados e escriturados (um C100 cada). */
  projected: number;
  /** Documentos elegíveis que não puderam ser projetados e têm bloqueio próprio. */
  rejected: number;
  /** Projeções descartadas por chave repetida, com bloqueio próprio. */
  duplicates: number;
  /** Registros C100 montados. */
  c100: number;
};

/**
 * Fecha a conta entre o banco e o arquivo: todo documento elegível termina
 * escriturado ou com um bloqueio que o explica. Uma diferença aqui significa
 * documento perdido em silêncio, e o arquivo não pode ser gerado.
 */
export function reconcileDocuments(input: SpedDocumentReconciliation): {
  summary: SpedDocumentReconciliation & { balanced: boolean };
  diagnostics: SpedDiagnostic[];
} {
  const eligible = input.sourceNotes + input.sourceEntries;
  const accounted = input.projected + input.rejected + input.duplicates;
  const diagnostics: SpedDiagnostic[] = [];
  if (eligible !== accounted) diagnostics.push({
    code: "RECONCILIACAO_DOCUMENTOS_DIVERGENTE",
    severity: "BLOQUEIO",
    message: `${eligible} documento(s) elegível(is) na fonte, mas ${accounted} foram escriturados ou explicados por bloqueio.`,
    context: { ...input },
  });
  if (input.c100 !== input.projected) diagnostics.push({
    code: "RECONCILIACAO_C100_DIVERGENTE",
    severity: "BLOQUEIO",
    message: `${input.projected} documento(s) projetado(s), mas ${input.c100} registro(s) C100 montado(s).`,
    record: "C100",
    context: { ...input },
  });
  return { summary: { ...input, balanced: diagnostics.length === 0 }, diagnostics };
}
