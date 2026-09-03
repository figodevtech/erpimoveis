/**
 * Regras de realizador dos serviços da OS.
 *
 * A exigência não é a mesma em todo o fluxo:
 *
 * - iniciar a OS pelo fluxo normal exige realizador em TODOS os serviços;
 * - iniciar um serviço pelo módulo de execução não exige nada, porque lá quem
 *   escolhe quem executa é o próprio mecânico ao assumir o serviço;
 * - salvar o orçamento de uma OS em andamento exige realizador apenas nos
 *   serviços que entraram naquele salvamento;
 * - enviar para pagamento exige TODOS de novo — é a trava final, que pega tanto
 *   a OS iniciada pela execução quanto as que já estão em andamento hoje.
 *
 * O `escopo` existe justamente para essa terceira regra.
 */

export type ServicoDaOS = { servicoid: number; descricao?: string | null };
export type VinculoRealizador = { servicoid: number };

export type ServicoSemRealizador = { servicoid: number; descricao: string };

export type AcaoRealizadores = "iniciar" | "pagamento" | "orcamento";

function paraId(valor: unknown): number {
  return Number(valor);
}

export function descreverServico(servico: ServicoDaOS): string {
  const descricao = String(servico.descricao ?? "").trim();
  return descricao || `Serviço #${servico.servicoid}`;
}

/**
 * Serviços da OS sem nenhum realizador vinculado.
 *
 * `escopo`, quando informado, restringe a checagem a esses `servicoid` — os
 * demais serviços podem seguir sem realizador sem entrar no resultado.
 */
export function servicosSemRealizador(
  servicos: readonly ServicoDaOS[],
  vinculos: readonly VinculoRealizador[],
  escopo?: readonly number[] | null,
): ServicoSemRealizador[] {
  const comRealizador = new Set(vinculos.map((vinculo) => paraId(vinculo.servicoid)));
  const restricao = escopo ? new Set(escopo.map(paraId)) : null;

  const pendentes = new Map<number, ServicoSemRealizador>();

  for (const servico of servicos) {
    const servicoid = paraId(servico.servicoid);
    if (!Number.isFinite(servicoid)) continue;
    if (restricao && !restricao.has(servicoid)) continue;
    if (comRealizador.has(servicoid)) continue;
    if (pendentes.has(servicoid)) continue;

    pendentes.set(servicoid, { servicoid, descricao: descreverServico(servico) });
  }

  return [...pendentes.values()];
}

/** Mensagem única para as rotas que recusam a transição. */
export function mensagemRealizadoresPendentes(
  pendentes: readonly ServicoSemRealizador[],
  acao: AcaoRealizadores,
): string {
  const lista = pendentes.map((servico) => servico.descricao).join(", ");

  if (acao === "iniciar") {
    return `Defina os realizadores de todos os serviços antes de iniciar a OS. Sem realizador: ${lista}.`;
  }

  if (acao === "pagamento") {
    return `Defina os realizadores de todos os serviços antes de enviar a OS para pagamento. Sem realizador: ${lista}.`;
  }

  return `Defina o realizador dos serviços incluídos no orçamento: ${lista}.`;
}

export const CODIGO_REALIZADORES_PENDENTES = "REALIZADORES_PENDENTES";

/**
 * Até quando dá para mexer em quem executou o serviço.
 *
 * Vale enquanto a OS não fechou. `PAGAMENTO` entra porque a execução acabou mas
 * a ordem ainda não: OS que passou para lá antes da trava de realizador — ou que
 * ganhou um serviço no caminho — só tem esta janela para ser acertada. Depois de
 * `CONCLUIDO`, `SEM_COBRANCA` ou `CANCELADO` o valor é histórico e não se mexe.
 *
 * Antes da aprovação também não: o orçamento ainda pode trocar de serviço, e
 * atribuir gente a um item que talvez nem exista só gera vínculo órfão.
 */
export const STATUS_EDITAM_REALIZADOR = [
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
] as const;

export function podeEditarRealizadores(status: unknown): boolean {
  const atual = String(status ?? "").toUpperCase();
  return (STATUS_EDITAM_REALIZADOR as readonly string[]).includes(atual);
}

/**
 * Trocar o realizador é sempre permitido; deixar o serviço órfão, não — depois
 * que a execução começou isso devolve a OS ao estado que a trava de início
 * existe para impedir.
 */
export function podeFicarSemRealizador(status: unknown): boolean {
  const atual = String(status ?? "").toUpperCase();
  return atual !== "EM_ANDAMENTO" && atual !== "PAGAMENTO";
}
