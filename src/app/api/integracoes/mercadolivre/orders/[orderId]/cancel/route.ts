import { NextResponse, type NextRequest } from "next/server";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import {
  getMercadoLivreOrder,
  mercadoLivreApiGet,
  mercadoLivreApiPost,
  refreshMercadoLivreToken,
  tokenExpiresAt,
} from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_REASONS = new Set([
  "OUT_OF_STOCK",
  "BUYER_NOT_ENOUGH_MONEY",
  "BUYER_REGRETS",
  "SELLER_REGRETS",
  "BUYER_DID_NOT_ANSWER",
  "THEY_NOT_HONORING_POLICIES",
  "OTHER_MY_RESPONSIBILITY",
  "OTHER_THEIR_RESPONSIBILITY",
  "DUBIOUS_BUYER",
]);

type Account = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export async function POST(req: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const { orderId: orderIdParam } = await context.params;
    const orderDbId = Number(orderIdParam);
    if (!Number.isFinite(orderDbId) || orderDbId <= 0) {
      return NextResponse.json({ error: "Pedido Mercado Livre inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason ?? "").trim().toUpperCase();
    const message = String(body?.message ?? "Venda não concretizada.").trim();
    if (!ALLOWED_REASONS.has(reason)) {
      return NextResponse.json({ error: "Selecione um motivo de cancelamento válido." }, { status: 400 });
    }
    if (!message || message.length >= 160) {
      return NextResponse.json({ error: "A mensagem deve ter entre 1 e 159 caracteres." }, { status: 400 });
    }

    const order = await getStoredOrder(orderDbId, empresaId);
    await assertOrderCanBeCancelled(order);
    const account = await getAccount(order.account_id, empresaId);
    const accessToken = await ensureValidAccessToken(account);
    const feedback = await mercadoLivreApiPost<Record<string, unknown>>(
      accessToken,
      `/orders/${order.ml_order_id}/feedback`,
      { fulfilled: false, rating: "neutral", message, reason, restock_item: false },
    );

    const updatedOrder = await getMercadoLivreOrder(accessToken, order.ml_order_id);
    const feedbackId = updatedOrder.feedback?.sale;
    updatedOrder.feedback_detail =
      feedback && Object.keys(feedback).length > 0
        ? feedback
        : feedbackId && typeof feedbackId !== "object"
          ? await mercadoLivreApiGet<Record<string, unknown>>(accessToken, `/feedback/${encodeURIComponent(String(feedbackId))}`)
          : { fulfilled: false, reason, message, restock_item: false };
    await importMercadoLivreOrder({ ...account, access_token: accessToken }, updatedOrder);

    return NextResponse.json({ ok: true, data: updatedOrder.feedback_detail });
  } catch (error: any) {
    console.error("POST /api/integracoes/mercadolivre/orders/[orderId]/cancel", error);
    return NextResponse.json(
      { error: friendlyError(error, "Não foi possível cancelar a venda no Mercado Livre.") },
      { status: errorStatus(error) },
    );
  }
}

async function getStoredOrder(orderDbId: number, empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_order")
    .select("id, account_id, ml_order_id, status, payment_status, shipment_status, feedback_sale, cancel_code")
    .eq("id", orderDbId)
    .eq("empresa_id", empresaId)
    .single();
  if (error) throw error;
  return data as any;
}

async function assertOrderCanBeCancelled(order: any) {
  const status = String(order.status ?? "").toLowerCase();
  const paymentStatus = String(order.payment_status ?? "").toLowerCase();
  const shipmentStatus = String(order.shipment_status ?? "").toLowerCase();
  if (["cancelled", "canceled", "invalid"].includes(status) || ["refunded", "charged_back"].includes(paymentStatus) || order.cancel_code) {
    throw new Error("Este pedido já está cancelado ou integralmente reembolsado.");
  }
  if (["shipped", "delivered"].includes(shipmentStatus)) {
    throw new Error("O pedido já foi enviado. Use o fluxo de reclamação ou devolução disponível no Mercado Livre.");
  }
  if (order.feedback_sale?.fulfilled === false) throw new Error("Esta venda já foi marcada como não concretizada.");

  const { data, error } = await supabaseAdmin
    .from("mercadolivre_claim")
    .select("id, status, stage, closed_at")
    .eq("order_id", order.id)
    .is("closed_at", null);
  if (error) throw error;
  const hasActiveClaim = (data ?? []).some((claim: any) =>
    !["closed", "resolved", "cancelled", "canceled"].includes(String(claim.status ?? claim.stage ?? "").toLowerCase()),
  );
  if (hasActiveClaim) throw new Error("Há uma reclamação ativa. Resolva o cancelamento pelas ações da reclamação.");
}

async function getAccount(accountId: number | null, empresaId: number) {
  if (!accountId) throw new Error("Este pedido pertence a uma conta Mercado Livre anterior e não pode mais ser alterado.");
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1);
  query = query.eq("id", accountId);
  const { data, error } = await query.single();
  if (error) throw error;
  return data as Account;
}

async function ensureValidAccessToken(account: Account) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (!account.refresh_token || !expiresAt || expiresAt - Date.now() >= 5 * 60 * 1000) return account.access_token;
  const token = await refreshMercadoLivreToken(account.refresh_token);
  const { error } = await supabaseAdmin
    .from("mercadolivre_account")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? account.refresh_token,
      expires_at: tokenExpiresAt(token.expires_in),
      raw_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("empresa_id", account.empresa_id);
  if (error) throw error;
  return token.access_token;
}

function friendlyError(error: any, fallback: string) {
  const raw = String(error?.message ?? "");
  const jsonStart = raw.indexOf("{");
  let message = raw || fallback;
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      message = parsed.message || parsed.error || message;
    } catch {}
  }
  return message
    .replaceAll("You can't submit a not fulfilled feedback after order has expired", "O prazo para cancelar esta venda como não concretizada expirou.")
    .replaceAll("not_fulfilled_feedback_in_order_expired", "O prazo para cancelar esta venda expirou.")
    .replaceAll("Feedback already exists", "Esta venda já possui uma qualificação e não pode ser cancelada por este fluxo.")
    .replaceAll("invalid access token", "Token inválido. Reconecte a conta Mercado Livre.");
}
