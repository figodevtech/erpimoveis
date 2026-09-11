/**
 * Qual família de rota o painel usa.
 *
 * As duas fazem a mesma coisa e compartilham a regra em
 * `api/ordens/[id]/eventos-financeiros/_lib/servico.ts`. O que muda é a
 * permissão exigida: dentro da OS o operador já tem `ordens:editar`; na fila do
 * financeiro quem age é o financeiro, e pedir acesso à ordem inteira para
 * corrigir uma despesa seria dar mais do que a tarefa precisa.
 *
 * É a única diferença de comportamento entre os dois usos do painel — e por
 * isso é um parâmetro, e não um `if` espalhado pelas ações.
 */
export type EndpointsDeEventos = {
  /** Onde um evento novo nasce. O corpo extra carrega a OS quando a URL não a tem. */
  criar(osId: number): { url: string; corpoExtra: Record<string, unknown> };
  /** A venda permite criar o custo vinculado à receita de frete. */
  criarDespesaVenda?(vendaId: number): { url: string; corpoExtra: Record<string, unknown> };
  /** O evento em si: prévia do impacto (GET), edição (PATCH) e exclusão (DELETE). */
  evento(eventoId: number, osId: number | null): string;
};

export function endpointsDeOrdem(osId: number): EndpointsDeEventos {
  return {
    criar: () => ({ url: `/api/ordens/${osId}/eventos-financeiros`, corpoExtra: {} }),
    evento: (eventoId) => `/api/ordens/${osId}/eventos-financeiros/${eventoId}`,
  };
}

export function endpointsDoFinanceiro(): EndpointsDeEventos {
  return {
    criarDespesaVenda: (vendaId) => ({ url: `/api/venda/${vendaId}/eventos-financeiros`, corpoExtra: {} }),
    criar: (osId) => ({ url: "/api/eventos-financeiros", corpoExtra: { ordemServicoId: osId } }),
    evento: (eventoId) => `/api/eventos-financeiros/${eventoId}`,
  };
}
