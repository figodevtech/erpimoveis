import { Metodo_pagamento, type NewTransaction } from "../../types";
import { tiposDaConciliacao } from "../transactionDialog/conciliacao-ofx";
import type { Decisao, MovimentoAnalisado } from "./types";

export function transacaoInicialOfx(
  m: MovimentoAnalisado,
  bancoId: number,
  decisao?: Decisao,
): NewTransaction {
  const nova = decisao?.acao === "CRIAR" ? decisao.nova : null;
  const [ano, mes, dia] = m.dataPostagem.split("-").map(Number);
  const tipos = tiposDaConciliacao(m.valorCentavos);
  return {
    descricao: nova?.descricao ?? m.memo ?? m.nome ?? "",
    tipo: tipos.find((tipo) => tipo === nova?.tipo) ?? tipos[0],
    data: new Date(ano, mes - 1, dia, 12),
    competencia_em: nova?.competencia_em ? new Date(nova.competencia_em) : null,
    valor: Math.abs(m.valorCentavos) / 100,
    valorLiquido: Math.abs(m.valorCentavos) / 100,
    banco_id: bancoId,
    parcelas: 1,
    pendente: false,
    metodopagamento: (decisao?.metodopagamento ??
      m.metodoSugerido ??
      undefined) as Metodo_pagamento | undefined,
    categoria: nova?.categoria ?? undefined,
    categoria_id: nova?.categoria_id ?? null,
    plano_de_conta_id: decisao?.planoContaId ?? nova?.plano_de_conta_id ?? null,
    centro_custo_id: decisao?.centroCustoId ?? nova?.centro_custo_id ?? null,
    cliente_id: nova?.cliente_id ?? null,
    fornecedor_id: nova?.fornecedor_id ?? null,
    nomepagador: nova?.nomepagador ?? "",
    cpfcnpjpagador: nova?.cpfcnpjpagador ?? "",
  };
}

/** Os campos do formulário que a criação atômica OFX já suporta. */
export function decisaoDeNovaTransacao(
  m: MovimentoAnalisado,
  t: NewTransaction,
): Decisao {
  return {
    fingerprint: m.fingerprint,
    movimentoId: m.movimentoId ?? undefined,
    acao: "CRIAR",
    metodopagamento: t.metodopagamento,
    planoContaId: t.plano_de_conta_id ?? null,
    centroCustoId: t.centro_custo_id ?? null,
    nova: {
      descricao: t.descricao?.trim(),
      tipo: t.tipo,
      categoria: t.categoria ?? null,
      categoria_id: t.categoria_id ?? null,
      plano_de_conta_id: t.plano_de_conta_id ?? null,
      centro_custo_id: t.centro_custo_id ?? null,
      cliente_id: t.cliente_id ?? null,
      fornecedor_id: t.fornecedor_id ?? null,
      nomepagador: t.nomepagador?.trim() || null,
      cpfcnpjpagador: t.cpfcnpjpagador?.trim() || null,
      competencia_em: t.competencia_em?.toISOString() ?? null,
    },
  };
}
