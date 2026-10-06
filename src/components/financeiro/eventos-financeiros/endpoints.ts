import type { DocumentoFinanceiro } from "@/lib/financeiro/documento-evento";

/**
 * Qual família de rota o painel usa.
 *
 * A criação recebe o documento real. OS mantém suas rotas e permissões;
 * venda usa payload discriminado e as regras compartilhadas de documento.
 * A fila endereça o evento diretamente e o servidor resolve sua proveniência.
 */
export type EndpointsDeEventos = {
  /** Onde um evento novo nasce, incluindo o contexto quando a URL não o tem. */
  criar(documento: DocumentoFinanceiro): { url: string; corpoExtra: Record<string, unknown> };
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
    criarDespesaVenda: (vendaId) => ({ url: `/api/venda/${vendaId}/eventos-financeiros`, corpoExtra: { modalidade: "DESPESA_FRETE" } }),
    criar: (documento) => documento.tipo === "VENDA"
      ? { url: `/api/venda/${documento.id}/eventos-financeiros`, corpoExtra: { modalidade: "AVULSO" } }
      : { url: "/api/eventos-financeiros", corpoExtra: { ordemServicoId: documento.id } },
    evento: (eventoId) => `/api/eventos-financeiros/${eventoId}`,
  };
}

export function endpointsDeVenda(): EndpointsDeEventos {
  return endpointsDoFinanceiro();
}
