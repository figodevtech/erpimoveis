import { carregarFatiasRateadas } from "@/lib/financeiro/rateio-documentos";
import { valorDeFace } from "@/lib/financeiro/transacao";
import {
  buildPrintPaymentSummary,
  isPaidPrintStatus,
  type PrintDocumentType,
  type PrintPaymentSummary,
  type RecordedPayment,
} from "@/lib/print-payment-display";
import type { PlannedPayment } from "@/lib/payment-methods";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function loadRecordedPayments(
  type: PrintDocumentType,
  documentId: number,
): Promise<RecordedPayment[]> {
  const foreignKey = type === "OS" ? "ordemservicoid" : "vendaid";

  // O documento e concluido quando todo o valor esta coberto por transacoes.
  // Isso inclui titulos parcelados ainda pendentes; eles ja substituem a
  // previsao e precisam preservar o metodo registrado na impressao.
  const { data, error } = await supabaseAdmin
    .from("transacao")
    .select("metodopagamento, valor, valor_acrescimos, data")
    .eq(foreignKey, documentId)
    .eq("tipo", "RECEITA")
    .eq("is_deleted", false)
    .is("evento_financeiro_id", null)
    .order("data", { ascending: true });

  if (error) throw error;

  const direct = (data ?? []).map((transaction) => ({
    metodo: transaction.metodopagamento ?? null,
    valor: valorDeFace(transaction),
  }));

  const allocatedByDocument = await carregarFatiasRateadas(type, [documentId]);
  const allocated = (allocatedByDocument.get(documentId) ?? [])
    .map((slice) => ({
      metodo: slice.metodopagamento,
      valor: Number(slice.valor ?? 0),
    }));

  return [...direct, ...allocated];
}

export async function loadPrintPaymentSummary({
  type,
  documentId,
  status,
  pagamentosPrevistos,
  formaPagamento,
  parcelasPagamento,
}: {
  type: PrintDocumentType;
  documentId: number;
  status: unknown;
  pagamentosPrevistos?: PlannedPayment[] | null;
  formaPagamento?: string | null;
  parcelasPagamento?: number | null;
}): Promise<PrintPaymentSummary | null> {
  const recordedPayments = isPaidPrintStatus(type, status)
    ? await loadRecordedPayments(type, documentId)
    : [];

  return buildPrintPaymentSummary({
    type,
    status,
    pagamentosPrevistos,
    formaPagamento,
    parcelasPagamento,
    recordedPayments,
  });
}
