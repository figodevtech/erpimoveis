export type EventoParaExclusao = {
  id: number;
  origem: string;
  natureza: "RECEITA" | "DESPESA";
  status: string;
  descricao: string;
  valor: number;
  chave_origem?: string | null;
  is_manual?: boolean | null;
  transacaoid?: number | null;
  lancamento_id?: number | null;
  competencia_em?: string | null;
  quantidade_snapshot?: number | null;
  consumo_saida_id?: number | null;
  consumo_usoconsumo_saida_id?: number | null;
  dados_snapshot?: Record<string, unknown> | null;
};

export type ImpactoExclusaoEvento = {
  eventoId: number;
  descricao: string;
  origem: string;
  natureza: "RECEITA" | "DESPESA";
  valor: number;
  competenciaEm: string | null;
  podeExcluir: boolean;
  bloqueio: string | null;
  exigeMotivo: boolean;
  devolveEstoque: boolean;
  estoque: {
    quantidade: number;
    unidade: string;
    item: string;
    escopo: string;
  } | null;
  efeitos: string[];
  transacaoId: number | null;
  lancamentoId: number | null;
};

type OpcoesAnalise = {
  statusOs: string;
  mesesFechados?: string[];
};

function moeda(valor: number) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function consumoComBaixaDeEstoque(evento: EventoParaExclusao) {
  return evento.origem === "CONSUMO"
    && evento.natureza === "DESPESA"
    && (evento.consumo_saida_id != null || evento.consumo_usoconsumo_saida_id != null);
}

/**
 * Proveniencia que autoriza a exclusao.
 *
 * `is_manual` sozinho nao basta: uma comissao corrigida tambem recebe essa
 * marca para sair do reconciliador automatico. A chave MANUAL identifica os
 * eventos realmente criados pelo usuario; consumo com estoque tem sua propria
 * chave estruturada e e reconhecido pelo documento de saida vinculado.
 */
export function eventoTemProvenienciaExcluivel(evento: EventoParaExclusao) {
  if (evento.origem === "COMISSAO") return false;
  if (evento.origem === "FRETE" && evento.natureza === "RECEITA") return false;
  if (consumoComBaixaDeEstoque(evento)) return evento.is_manual === true;
  return evento.is_manual === true && String(evento.chave_origem ?? "").startsWith("MANUAL:");
}

export function analisarExclusaoEventoFinanceiro(
  evento: EventoParaExclusao,
  opcoes: OpcoesAnalise,
): ImpactoExclusaoEvento {
  const origem = String(evento.origem ?? "").toUpperCase();
  const status = String(evento.status ?? "").toUpperCase();
  const statusOs = String(opcoes.statusOs ?? "").toUpperCase();
  const comEstoque = consumoComBaixaDeEstoque(evento);
  const transacaoId = evento.transacaoid == null ? null : Number(evento.transacaoid);
  const lancamentoId = evento.lancamento_id == null ? null : Number(evento.lancamento_id);
  let bloqueio: string | null = null;

  if (!eventoTemProvenienciaExcluivel(evento)) {
    bloqueio = origem === "FRETE" && evento.natureza === "RECEITA"
      ? "A receita de frete é automática. Para removê-la, edite o orçamento da OS e zere o frete."
      : "Este evento foi gerado automaticamente e deve ser corrigido na origem que o criou.";
  } else if (status === "CONVERTIDO" || transacaoId != null || lancamentoId != null) {
    bloqueio = "Este evento já foi lançado no Financeiro. Exclua primeiro a transação ou o lançamento vinculado; nenhuma exclusão financeira será feita automaticamente.";
  } else if (status !== "ATIVO") {
    bloqueio = "Somente eventos financeiros ativos podem ser excluídos.";
  } else if (statusOs === "CANCELADO") {
    bloqueio = "Esta OS está cancelada e seus eventos financeiros não podem mais ser alterados.";
  } else if (comEstoque && ["CONCLUIDO", "SEM_COBRANCA"].includes(statusOs)) {
    bloqueio = "A OS já foi finalizada. Reabra a OS para excluir este consumo e devolver o item ao estoque.";
  }

  const snapshot = evento.dados_snapshot ?? {};
  const quantidade = Number(evento.quantidade_snapshot ?? snapshot.quantidade ?? 0);
  const unidade = String(snapshot.unidade ?? "UN");
  const item = String(snapshot.item_titulo ?? evento.descricao ?? "Item consumido");
  const escopoCodigo = String(snapshot.escopo ?? (evento.consumo_saida_id != null ? "PRODUTO" : "USOCONSUMO"));
  const escopo = escopoCodigo === "PRODUTO"
    ? "Estoque de produtos"
    : escopoCodigo === "USOCONSUMO" ? "Uso e consumo" : "Estoque geral/avulso";
  const estoque = comEstoque
    ? { quantidade, unidade, item, escopo }
    : null;

  const efeitos: string[] = [];
  if (evento.natureza === "RECEITA") {
    efeitos.push(`A receita de ${moeda(evento.valor)} será removida e o resultado da OS diminuirá no mesmo valor.`);
    efeitos.push("O orçamento, os itens da OS e o saldo de estoque não serão alterados.");
  } else {
    efeitos.push(`A despesa de ${moeda(evento.valor)} será removida e o resultado da OS aumentará no mesmo valor.`);
    if (origem === "FRETE") {
      efeitos.push("O frete cobrado do cliente, o valor do orçamento e o total da OS não serão alterados.");
      efeitos.push("O custo deixará de compor a linha 4.6 — Serviços terceirizados diretos da DRE.");
      efeitos.push("Nenhum saldo de estoque será alterado.");
    } else if (comEstoque && estoque) {
      efeitos.push(`${estoque.quantidade.toLocaleString("pt-BR")} ${estoque.unidade} de ${estoque.item} retornará ao estoque (${estoque.escopo}).`);
      efeitos.push("A saída será cancelada e permanecerá no histórico do estoque com o motivo informado.");
    } else if (origem === "CONSUMO") {
      efeitos.push("Este consumo não possui saída de estoque vinculada; somente o custo financeiro será removido.");
    } else {
      efeitos.push("Nenhum item da OS ou saldo de estoque será alterado.");
    }
  }
  if (status === "CONVERTIDO" || transacaoId != null || lancamentoId != null) {
    efeitos.push("Nada será excluído enquanto houver vínculo com o Financeiro, e nenhuma transação será removida em cascata.");
  } else {
    efeitos.push("Este evento não possui vínculo financeiro ativo; nenhuma transação, parcela ou pagamento será excluído.");
  }
  efeitos.push("O evento deixará de compor os totais financeiros e a DRE da competência indicada.");
  if ((opcoes.mesesFechados ?? []).length) {
    efeitos.push(`A DRE de ${(opcoes.mesesFechados ?? []).join(", ")} será recalculada.`);
  }

  return {
    eventoId: evento.id,
    descricao: evento.descricao,
    origem,
    natureza: evento.natureza,
    valor: Number(evento.valor ?? 0),
    competenciaEm: evento.competencia_em ?? null,
    podeExcluir: bloqueio == null,
    bloqueio,
    exigeMotivo: comEstoque,
    devolveEstoque: comEstoque,
    estoque,
    efeitos,
    transacaoId,
    lancamentoId,
  };
}
