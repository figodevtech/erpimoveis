import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireVendasCreate } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getMercadoLivreOrder, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { importMercadoLivreOrder } from "@/lib/integrations/mercadolivre-orders";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";

type MercadoLivreAccount = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export async function POST(req: NextRequest) {
  try {
    await requireVendasCreate();
    const empresaId = await requireEmpresaId();

    const body = await req.json().catch(() => ({}));
    const orderDbId = Number(body?.orderDbId ?? 0);
    const mlOrderId = Number(body?.mlOrderId ?? 0);
    const requestedPaymentId = body?.paymentId ? String(body.paymentId) : null;
    const amount = body?.amount != null && body?.amount !== "" ? Number(body.amount) : null;

    if ((!Number.isFinite(orderDbId) || orderDbId <= 0) && (!Number.isFinite(mlOrderId) || mlOrderId <= 0)) {
      return NextResponse.json({ error: "Informe o pedido Mercado Livre para reembolso." }, { status: 400 });
    }

    if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
      return NextResponse.json({ error: "Valor de reembolso inválido." }, { status: 400 });
    }

    const order = await getStoredOrder(orderDbId, mlOrderId, empresaId);
    const account = await getAccount(order.account_id, empresaId);
    const accessToken = await ensureValidAccessToken(account);
    const payment = getRefundablePayment(order, requestedPaymentId);

    if (!payment?.id) {
      return NextResponse.json({ error: "Nenhum pagamento aprovado disponível para reembolso neste pedido." }, { status: 400 });
    }

    const refund = await createPaymentRefund(accessToken, String(payment.id), amount);

    try {
      const updatedOrder = await getMercadoLivreOrder(accessToken, Number(order.ml_order_id));
      await importMercadoLivreOrder({ ...account, access_token: accessToken }, updatedOrder);
    } catch (error) {
      console.warn("Reembolso criado, mas falhou ao sincronizar pedido Mercado Livre", error);
    }

    return NextResponse.json({ ok: true, refund });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/refunds", e);
    return NextResponse.json({ error: friendlyError(e, "Falha ao reembolsar pedido Mercado Livre.") }, { status: errorStatus(e) });
  }
}

async function getStoredOrder(orderDbId: number, mlOrderId: number, empresaId: number) {
  let query = supabaseAdmin
    .from("mercadolivre_order")
    .select("id, account_id, ml_order_id, raw_payments, raw_order, payment_status, payment_status_detail")
    .eq("empresa_id", empresaId)
    .limit(1);

  if (Number.isFinite(orderDbId) && orderDbId > 0) query = query.eq("id", orderDbId);
  else query = query.eq("ml_order_id", mlOrderId);

  const { data, error } = await query.single();
  if (error) throw error;
  return data as any;
}

async function getAccount(accountId: number | null, empresaId: number) {
  let query = supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (accountId) query = query.eq("id", accountId);

  const { data, error } = await query.single();
  if (error) throw error;
  return data as MercadoLivreAccount;
}

async function ensureValidAccessToken(account: MercadoLivreAccount) {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  const shouldRefresh = Boolean(account.refresh_token && expiresAt && expiresAt - Date.now() < 5 * 60 * 1000);
  if (!shouldRefresh) return account.access_token;

  const token = await refreshMercadoLivreToken(account.refresh_token as string);
  const { error } = await supabaseAdmin
    .from("mercadolivre_account")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? account.refresh_token,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_at: tokenExpiresAt(token.expires_in),
      raw_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  if (error) throw error;
  return token.access_token;
}

function getRefundablePayment(order: any, requestedPaymentId: string | null) {
  const payments = Array.isArray(order.raw_payments) && order.raw_payments.length > 0 ? order.raw_payments : Array.isArray(order.raw_order?.payments) ? order.raw_order.payments : [];
  const candidates = payments.filter((payment: any) => payment?.id);

  if (requestedPaymentId) return candidates.find((payment: any) => String(payment.id) === requestedPaymentId) ?? null;

  return (
    candidates.find((payment: any) => ["approved", "paid"].includes(String(payment.status ?? "").toLowerCase())) ??
    candidates.find((payment: any) => !["refunded", "charged_back", "cancelled", "canceled"].includes(String(payment.status ?? "").toLowerCase())) ??
    null
  );
}

async function createPaymentRefund(accessToken: string, paymentId: string, amount: number | null) {
  const response = await fetch(`${MERCADO_PAGO_API_BASE_URL}/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": randomUUID(),
      ...(amount != null ? { "Content-Type": "application/json" } : {}),
    },
    body: amount != null ? JSON.stringify({ amount }) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Pago /v1/payments/${paymentId}/refunds falhou (${response.status}): ${text}`);
  }

  return response.json();
}

function friendlyError(error: any, fallback: string) {
  const raw = String(error?.message ?? "");
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return translateRefundError(raw || fallback);

  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    const causes = Array.isArray(parsed.cause) ? parsed.cause : [];
    const details = causes
      .map((cause: any) => cause?.description || cause?.message || cause?.code)
      .filter(Boolean)
      .join("; ");
    return translateRefundError(details || parsed.message || parsed.error || fallback);
  } catch {
    return translateRefundError(raw || fallback);
  }
}

function translateRefundError(message: string) {
  return message
    .replaceAll("Unauthorized use of live credentials", "Não foi possível reembolsar este pedido de teste usando credenciais live. Para compras de teste, o Mercado Pago exige credenciais/test tokens compatíveis com ambiente de teste.")
    .replaceAll("invalid access token", "Token inválido. Reconecte a conta Mercado Livre.")
    .replaceAll("not found", "Pagamento não encontrado para esta conta.")
    .replaceAll("resource not found", "Pagamento não encontrado para esta conta.")
    .replaceAll("already refunded", "Este pagamento já foi reembolsado.")
    .replaceAll("refund already exists", "Este pagamento já possui reembolso.")
    .replaceAll("not allowed", "O Mercado Pago não permite reembolso para este pagamento neste momento.")
    .replaceAll("forbidden", "A conta conectada não tem permissão para reembolsar este pagamento.")
    .replaceAll("unauthorized", "Conta não autorizada. Reconecte a conta Mercado Livre.");
}
