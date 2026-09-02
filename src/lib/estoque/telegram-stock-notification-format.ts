import { escapeTelegramHtml } from "@/lib/integrations/telegram";
import type { StockNotificationEvent } from "@/lib/estoque/telegram-stock-events";

export type TelegramStockMovement = {
  id: number;
  produto_id: number;
  quantidade: number;
  saldo_anterior: number | null;
  saldo_resultante: number | null;
  entrada_id: number | null;
  saida_id: number | null;
  venda_id: number | null;
  ordemservicoid: number | null;
  documento_label: string | null;
  observacao: string | null;
  created_at: string;
  produto_titulo: string | null;
  produto_referencia: string | null;
  produto_unidade: string | null;
  entrada_origem: string | null;
  entrada_fiscal: boolean | null;
  entrada_numero_nota: string | null;
  fornecedor_nome: string | null;
  saida_motivo: string | null;
  saida_observacao: string | null;
  criador_nome: string | null;
};

const EVENT_HEADINGS: Record<StockNotificationEvent, string> = {
  ENTRADA_REGISTRO: "📥 <b>Entrada de estoque</b>",
  ENTRADA_ESTORNO: "↩️ <b>Cancelamento de entrada</b>",
  SAIDA_MANUAL_REGISTRO: "📤 <b>Saída avulsa de estoque</b>",
  SAIDA_MANUAL_ESTORNO: "↩️ <b>Cancelamento de saída avulsa</b>",
  VENDA_REGISTRO: "🛒 <b>Baixa de estoque por venda</b>",
  VENDA_ESTORNO: "↩️ <b>Estorno de estoque da venda</b>",
  ORDEM_SERVICO_REGISTRO: "🔧 <b>Baixa de estoque por OS</b>",
  ORDEM_SERVICO_ESTORNO: "↩️ <b>Estorno de estoque da OS</b>",
};

function humanizeCode(value: string | null) {
  if (!value) return null;
  return value
    .replaceAll("_", " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(date);
}

function documentLabel(movement: TelegramStockMovement) {
  if (movement.documento_label) return movement.documento_label;
  if (movement.entrada_id) return `Entrada #${movement.entrada_id}`;
  if (movement.saida_id) return `Saída #${movement.saida_id}`;
  if (movement.venda_id) return `Venda #${movement.venda_id}`;
  if (movement.ordemservicoid) return `OS #${movement.ordemservicoid}`;
  return `Movimento #${movement.id}`;
}

export function buildStockMovementMessage(
  event: StockNotificationEvent,
  movement: TelegramStockMovement,
) {
  const unit = movement.produto_unidade ? ` ${movement.produto_unidade}` : "";
  const lines = [
    EVENT_HEADINGS[event],
    "",
    `<b>Produto:</b> ${escapeTelegramHtml(movement.produto_titulo ?? `Produto #${movement.produto_id}`)}`,
  ];

  if (movement.produto_referencia) {
    lines.push(`<b>Referência:</b> ${escapeTelegramHtml(movement.produto_referencia)}`);
  }

  lines.push(`<b>Quantidade:</b> ${escapeTelegramHtml(`${formatQuantity(movement.quantidade)}${unit}`)}`);

  if (movement.saldo_anterior !== null && movement.saldo_resultante !== null) {
    lines.push(
      `<b>Saldo:</b> ${escapeTelegramHtml(formatQuantity(movement.saldo_anterior))} → ${escapeTelegramHtml(formatQuantity(movement.saldo_resultante))}`,
    );
  }

  lines.push(`<b>Documento:</b> ${escapeTelegramHtml(documentLabel(movement))}`);

  if (event.startsWith("ENTRADA_")) {
    const entryType = movement.entrada_fiscal
      ? "Fiscal"
      : humanizeCode(movement.entrada_origem) ?? "Entrada de estoque";
    lines.push(`<b>Tipo:</b> ${escapeTelegramHtml(entryType)}`);
    if (movement.entrada_numero_nota) {
      lines.push(`<b>Nota:</b> ${escapeTelegramHtml(movement.entrada_numero_nota)}`);
    }
    if (movement.fornecedor_nome) {
      lines.push(`<b>Fornecedor:</b> ${escapeTelegramHtml(movement.fornecedor_nome)}`);
    }
  }

  if (event.startsWith("SAIDA_MANUAL_") && movement.saida_motivo) {
    lines.push(`<b>Motivo:</b> ${escapeTelegramHtml(humanizeCode(movement.saida_motivo))}`);
  }

  if (movement.criador_nome) {
    lines.push(`<b>Responsável:</b> ${escapeTelegramHtml(movement.criador_nome)}`);
  }

  const observation = movement.saida_observacao ?? movement.observacao;
  if (observation) lines.push(`<b>Observação:</b> ${escapeTelegramHtml(observation)}`);
  lines.push(`<b>Data:</b> ${escapeTelegramHtml(formatDate(movement.created_at))}`);

  return lines.join("\n").slice(0, 4000);
}

