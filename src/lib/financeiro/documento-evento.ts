export type DocumentoFinanceiro = { tipo: "ORDEM_SERVICO" | "VENDA"; id: number };

export function modalidadeDeCriacaoVenda(body: unknown): "AVULSO" | "DESPESA_FRETE" | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  if (payload.modalidade === "AVULSO") {
    return payload.eventoReceitaId == null && payload.eventoReceitaServicoId == null ? "AVULSO" : null;
  }
  if (payload.modalidade === "DESPESA_FRETE") return "DESPESA_FRETE";
  // Compatibilidade com clientes anteriores à modalidade explícita de frete.
  if (payload.modalidade == null && payload.eventoReceitaId != null) return "DESPESA_FRETE";
  return null;
}

/** Overrides automáticos (como comissão) não são lançamentos do operador. */
export function eventoManualDoOperador(evento: { is_manual?: boolean | null; chave_origem?: string | null }) {
  return evento.is_manual === true && String(evento.chave_origem ?? "").startsWith("MANUAL:");
}

/** Edição contábil não concede exclusão nem muda a proveniência do evento. */
export function eventoEditavelDaVenda(evento: {
  origem: string; natureza: string; status: string; is_manual?: boolean | null;
  chave_origem?: string | null; consumo_saida_id?: number | null;
  consumo_usoconsumo_saida_id?: number | null;
}) {
  if (!["ATIVO", "CONVERTIDO"].includes(evento.status)
    || evento.consumo_saida_id != null || evento.consumo_usoconsumo_saida_id != null) return false;
  if (evento.origem === "COMISSAO") return evento.natureza === "DESPESA" && evento.chave_origem === "COMISSAO_VENDA";
  if (evento.origem === "FRETE" && evento.natureza === "RECEITA") return evento.chave_origem === "FRETE";
  return eventoManualDoOperador(evento) || (evento.origem === "PRODUTO" && evento.natureza === "RECEITA");
}

export function despesaDeVendaLancavel(evento: {
  source_type?: string | null; source_id?: number | null; origem: string;
  natureza: string; is_manual?: boolean | null; chave_origem?: string | null;
  pode_gerar_transacao?: boolean;
}) {
  return evento.source_type === "VENDA" && evento.source_id != null
    && evento.natureza === "DESPESA" && evento.pode_gerar_transacao === true
    && (evento.origem === "COMISSAO" || eventoManualDoOperador(evento));
}
