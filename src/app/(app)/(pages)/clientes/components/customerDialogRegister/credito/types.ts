import type { SaldoMovimentoCliente } from "../../../types";

export type { SaldoMovimentoCliente };

export type Sentido = SaldoMovimentoCliente["sentido"];

export type ModoLancamento =
  | { tipo: "criar"; sentido: Sentido }
  | { tipo: "editar"; movimento: SaldoMovimentoCliente };

export const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const dataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatarQuando(valor: string): string {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "—" : dataHora.format(data);
}

/** Efeito do lançamento sobre a carteira: positivo entra, negativo sai. */
export function efeito(sentido: Sentido, valor: number): number {
  return sentido === "CREDITO" ? valor : -valor;
}

/** O que a linha do razão quer dizer em uma frase descritiva. */
export function descrever(movimento: SaldoMovimentoCliente): string {
  if (movimento.motivo) return movimento.motivo;
  if (movimento.origem === "MANUAL") {
    return movimento.sentido === "CREDITO"
      ? "Crédito adicionado manualmente"
      : "Crédito removido manualmente";
  }
  return "Movimentação de título financeiro";
}

/** Quem gerou o movimento: o operador do ajuste ou quem baixou/estornou o título. */
export function autoria(movimento: SaldoMovimentoCliente): string | null {
  const verbo =
    movimento.origem === "MANUAL"
      ? "Lançado por"
      : movimento.acao === "ESTORNO"
        ? "Estornado por"
        : "Baixa feita por";
  return movimento.created_by_nome ? `${verbo} ${movimento.created_by_nome}` : null;
}

/** Documento de origem por trás de uma linha do sistema (OS ou Venda). */
export function documento(movimento: SaldoMovimentoCliente) {
  if (movimento.venda_id) {
    return { tipo: "venda" as const, id: movimento.venda_id, rotulo: `Venda #${movimento.venda_id}` };
  }
  if (movimento.ordemservico_id) {
    return { tipo: "os" as const, id: movimento.ordemservico_id, rotulo: `OS #${movimento.ordemservico_id}` };
  }
  return null;
}
