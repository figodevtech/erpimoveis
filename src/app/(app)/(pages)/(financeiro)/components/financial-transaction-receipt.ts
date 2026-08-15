import type { Transaction } from "../fluxodecaixa/types";
import { formatPaymentMethodLabel } from "@/lib/payment-methods";

type ReceiptContext = {
  transaction: Transaction;
  documentType: "Venda" | "Ordem de serviço";
  documentId: number;
  customerName?: string | null;
};

const money = (value: unknown) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value ?? 0));

const date = (value: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export function transactionReceiptText({
  transaction,
  documentType,
  documentId,
  customerName,
}: ReceiptContext) {
  return [
    `RECIBO DE PAGAMENTO #${transaction.id}`,
    `${documentType} #${documentId}`,
    customerName ? `Cliente: ${customerName}` : null,
    `Data: ${date(transaction.data)}`,
    `Descrição: ${transaction.descricao || "Pagamento"}`,
    `Método: ${formatPaymentMethodLabel(transaction.metodopagamento ?? "") || "Não informado"}`,
    `Banco: ${transaction.banco?.titulo || "Não informado"}`,
    `Valor: ${money(transaction.valor)}`,
    `Valor líquido: ${money(transaction.valorLiquido ?? transaction.valor)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function printTransactionReceipt(context: ReceiptContext) {
  const { transaction, documentType, documentId, customerName } = context;
  const popup = window.open("", "_blank", "width=720,height=760");
  if (!popup) throw new Error("O navegador bloqueou a janela de impressão.");

  popup.document.write(`<!doctype html>
    <html lang="pt-BR"><head><meta charset="utf-8" />
    <title>Recibo #${transaction.id}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Arial,sans-serif;color:#171717;margin:0;padding:40px}
      .sheet{max-width:680px;margin:0 auto;border:1px solid #bbb;padding:32px}
      .eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin:0 0 8px}
      h1{font-size:22px;margin:0 0 4px} .doc{color:#555;margin:0 0 28px}
      dl{display:grid;grid-template-columns:150px 1fr;border-top:1px solid #ddd;margin:0}
      dt,dd{margin:0;padding:11px 0;border-bottom:1px solid #ddd} dt{font-size:12px;color:#666;text-transform:uppercase}
      dd{font-weight:600}.total{font-size:20px}.sign{margin-top:70px;padding-top:8px;border-top:1px solid #333;text-align:center;font-size:12px}
      @media print{body{padding:0}.sheet{border:0;max-width:none}}
    </style></head><body><main class="sheet">
      <p class="eyebrow">Comprovante financeiro</p><h1>Recibo de pagamento #${transaction.id}</h1>
      <p class="doc">${escapeHtml(documentType)} #${documentId}</p>
      <dl>
        <dt>Cliente</dt><dd>${escapeHtml(customerName || "Não informado")}</dd>
        <dt>Data</dt><dd>${escapeHtml(date(transaction.data))}</dd>
        <dt>Descrição</dt><dd>${escapeHtml(transaction.descricao || "Pagamento")}</dd>
        <dt>Método</dt><dd>${escapeHtml(formatPaymentMethodLabel(transaction.metodopagamento ?? "") || "Não informado")}</dd>
        <dt>Banco</dt><dd>${escapeHtml(transaction.banco?.titulo || "Não informado")}</dd>
        <dt>Valor</dt><dd class="total">${escapeHtml(money(transaction.valor))}</dd>
        <dt>Valor líquido</dt><dd>${escapeHtml(money(transaction.valorLiquido ?? transaction.valor))}</dd>
      </dl>
      <div class="sign">Assinatura / confirmação de recebimento</div>
    </main><script>window.onload=()=>{window.print()}</script></body></html>`);
  popup.document.close();
}

export async function shareTransactionReceipt(context: ReceiptContext) {
  const text = transactionReceiptText(context);
  if (navigator.share) {
    await navigator.share({
      title: `Recibo #${context.transaction.id}`,
      text,
    });
    return "shared" as const;
  }

  await navigator.clipboard.writeText(text);
  return "copied" as const;
}
