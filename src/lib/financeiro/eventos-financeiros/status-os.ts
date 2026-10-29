/**
 * Quando o status da OS ainda permite mexer nos eventos financeiros dela.
 *
 * Até 2026-09 o corte era "OS finalizada": CONCLUIDO, SEM_COBRANCA e CANCELADO
 * fechavam tudo. Na prática isso deixava dois erros comuns sem conserto — a
 * despesa que chega depois da conclusão (a nota do terceirizado) e a comissão
 * calculada errada. O único caminho era reabrir a ordem, e reabrir APAGA os
 * títulos e pagamentos de receita dela (gatilho
 * `trg_excluir_transacoes_financeiras_os_por_status`, "deliberadamente
 * destrutivo"). Perder o histórico de pagamento para corrigir R$ 50 de comissão
 * não é conserto.
 *
 * Agora só a OS cancelada fecha. Lá todos os eventos já estão CANCELADO pelo
 * gatilho de finalização; não há o que ajustar, e criar um evento novo numa
 * ordem que não existe mais só sujaria a DRE.
 *
 * A correção volta para a competência ORIGINAL da OS — `competencia_em` é
 * carimbado com `execucao_fim_em` —, então a DRE do mês em que a execução
 * terminou é recalculada. Decisão de negócio de 2026-09-02, tomada ciente de
 * que relatório de mês fechado deixa de ser imutável. É o mesmo comportamento
 * que editar o orçamento e trocar realizadores já tinham: as duas rotas
 * recalculam o período e apenas avisam, via `mesesDeCompetenciaFechada`.
 */

export const MENSAGEM_OS_CANCELADA =
  "Esta OS está cancelada. Os eventos financeiros dela foram encerrados junto e não podem mais ser alterados.";

export const MENSAGEM_RECEITA_SEM_COBRANCA =
  "Esta OS foi finalizada sem cobrança e não tem receita a lançar. Registre apenas despesas.";

/** Motivo do bloqueio, ou `null` quando o status permite a operação. */
export function bloqueioDeStatusParaEventos(
  status: unknown,
  opcoes: { natureza?: string } = {},
) {
  const atual = String(status ?? "").toUpperCase();
  if (atual === "CANCELADO") return MENSAGEM_OS_CANCELADA;
  // Receita numa OS sem cobrança contradiz o próprio status: o gatilho de
  // finalização cancela as receitas existentes justamente para isso.
  if (atual === "SEM_COBRANCA" && String(opcoes.natureza ?? "").toUpperCase() === "RECEITA") {
    return MENSAGEM_RECEITA_SEM_COBRANCA;
  }
  return null;
}
