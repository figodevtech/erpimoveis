/** Rótulo estável exibido no texto livre dos documentos fiscais. */
export const ROTULO_GARANTIA_FISCAL = "Garantia:";

function texto(value: unknown) {
  return String(value ?? "").trim();
}

/**
 * Acrescenta a garantia ao texto livre sem cortar nenhum dos dois campos.
 *
 * O limite depende do documento e é validado pelo respectivo emissor. Manter o
 * texto completo aqui permite que o operador veja o excesso e escolha o que
 * remover, em vez de perder informação silenciosamente.
 */
export function comporObservacoesComGarantia({
  observacoes,
  garantia,
  incluir,
}: {
  observacoes: unknown;
  garantia: unknown;
  incluir: boolean;
}) {
  const base = texto(observacoes);
  const garantiaNormalizada = texto(garantia);
  if (!incluir || !garantiaNormalizada) return base;

  const bloco = `${ROTULO_GARANTIA_FISCAL} ${garantiaNormalizada}`;
  // Torna a composição idempotente quando um valor já composto volta a passar
  // por este helper (por exemplo, ao reabrir uma revisão).
  if (base.includes(bloco)) return base;

  return base ? `${base}\n${bloco}` : bloco;
}
