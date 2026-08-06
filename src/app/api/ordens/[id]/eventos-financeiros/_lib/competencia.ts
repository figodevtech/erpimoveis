/**
 * A DRE soma `eventos_financeiros` por `competencia_em`, carimbado quando a
 * execucao da OS encerra. Alterar o valor depois disso reescreve o periodo em
 * que o evento ja entrou — e o relatorio e recalculado a cada consulta, entao a
 * mudanca aparece retroativa para quem ja recebeu o numero fechado.
 *
 * A trava e por mes, nao pelo carimbo em si: enquanto a competencia cai no mes
 * corrente, a OS em PAGAMENTO segue ajustavel, que e a janela onde custo,
 * comissao e lancamento avulso ainda sao acertados antes do fechamento.
 */
const FUSO_BR = "America/Sao_Paulo";

export const MENSAGEM_COMPETENCIA_FECHADA =
  "Este lançamento pertence a um mês já encerrado na DRE e não pode mais ser alterado.";

/** "YYYY-MM" da data no fuso do Brasil — o mes que a DRE enxerga. */
function mesDaCompetencia(data: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_BR,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(data);
  const ano = partes.find((parte) => parte.type === "year")?.value ?? "";
  const mes = partes.find((parte) => parte.type === "month")?.value ?? "";
  return `${ano}-${mes}`;
}

/** Verdadeiro quando a competencia do evento e anterior ao mes corrente. */
export function competenciaEmMesFechado(competenciaEm: unknown, agora = new Date()) {
  if (!competenciaEm) return false;
  const data = new Date(String(competenciaEm));
  if (Number.isNaN(data.getTime())) return false;
  // Comparacao lexicografica: "2026-03" < "2026-08".
  return mesDaCompetencia(data) < mesDaCompetencia(agora);
}

/**
 * Rotulos "MM/AAAA" distintos e ordenados dos meses ja fechados presentes na
 * lista. Usado para dizer ao usuario *qual* periodo uma acao alcancou.
 */
export function mesesDeCompetenciaFechada(competencias: unknown[], agora = new Date()) {
  const chaves = new Set<string>();
  for (const competencia of competencias) {
    if (!competenciaEmMesFechado(competencia, agora)) continue;
    chaves.add(mesDaCompetencia(new Date(String(competencia))));
  }
  return [...chaves].sort().map((chave) => {
    const [ano, mes] = chave.split("-");
    return `${mes}/${ano}`;
  });
}
