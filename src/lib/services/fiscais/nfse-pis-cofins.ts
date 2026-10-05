/** CST da DPS: https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html
 * Campo opcional, sem valor automático por CRT. Códigos são strings de duas
 * posições para preservar zeros iniciais; a escolha fiscal cabe à empresa.
 */
export const SITUACOES_TRIBUTARIAS_PIS_COFINS = [
  "00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "49",
  "50", "51", "52", "53", "54", "55", "56",
  "60", "61", "62", "63", "64", "65", "66", "67",
  "70", "71", "72", "73", "74", "75", "98", "99",
] as const;

export type SituacaoTributariaPisCofins = typeof SITUACOES_TRIBUTARIAS_PIS_COFINS[number];

/** Vazio omite o campo; qualquer valor preenchido deve corresponder à tabela. */
export function conferirSituacaoTributariaPisCofins(valor: unknown): string | null {
  const texto = String(valor ?? "").trim();
  return !texto || SITUACOES_TRIBUTARIAS_PIS_COFINS.some((codigo) => codigo === texto)
    ? null
    : "Informe um CST de PIS/COFINS válido com 2 dígitos conforme a tabela da Focus.";
}
