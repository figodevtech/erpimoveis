import { NextResponse } from "next/server";
import { z } from "zod";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  deliveryStatus: z.enum(["SEPARACAO", "FATURADO", "ENVIADO", "ENTREGUE"]),
  trackingCode: z.string().trim().max(120).default(""),
  carrier: z.string().trim().max(160).default(""),
  trackingUrl: z.string().url().max(2000).or(z.literal("")).default(""),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireVendasEdit();
    const empresaId = await requireEmpresaId();
    const { id } = await params;
    const siteOrderId = Number(id);
    if (!Number.isSafeInteger(siteOrderId) || siteOrderId <= 0) {
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    }

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados de postagem inválidos.", details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: link, error: linkError } = await supabaseAdmin
      .from("site_order_link")
      .select("site_order_id, venda_id, raw_order")
      .eq("empresa_id", empresaId)
      .eq("site_order_id", siteOrderId)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link?.venda_id) return NextResponse.json({ error: "Pedido ainda não foi importado para uma venda." }, { status: 409 });

    const value = parsed.data;
    const shippingAddress = (link.raw_order as { shippingAddress?: { deliveryMethod?: string } } | null)?.shippingAddress;
    const isPickup = shippingAddress?.deliveryMethod === "pickup";
    if (value.deliveryStatus === "ENVIADO" && !isPickup && (!value.trackingCode || !value.carrier)) {
      return NextResponse.json(
        { error: "Informe transportadora e código de rastreio para marcar como enviado." },
        { status: 400 },
      );
    }
    const now = new Date().toISOString();
    const localDeliveryStatus = value.deliveryStatus === "ENVIADO"
      ? "ENVIO"
      : value.deliveryStatus === "FATURADO"
        ? "SEPARACAO"
        : value.deliveryStatus;

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("nfe")
      .select("id, numero, serie, chave_acesso, status")
      .eq("vendaid", link.venda_id)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (value.deliveryStatus === "FATURADO" && !invoice?.chave_acesso) {
      return NextResponse.json(
        { error: "Emita e autorize a NF-e antes de marcar o pedido como faturado." },
        { status: 409 },
      );
    }

    const { error: saleError } = await supabaseAdmin
      .from("venda")
      .update({
        codigo_rastreio: value.trackingCode || null,
        transportadora_rastreio: value.carrier || null,
        status_entrega: localDeliveryStatus,
        ultimo_evento_rastreio: value.deliveryStatus === "ENTREGUE"
          ? isPickup ? "Pedido retirado pelo cliente" : "Pedido entregue"
          : value.deliveryStatus === "ENVIADO"
            ? isPickup ? "Pedido pronto para retirada" : "Pedido postado"
            : null,
        ultimo_evento_rastreio_em: now,
        rastreio_atualizado_em: now,
        updatedat: now,
      })
      .eq("id", link.venda_id);
    if (saleError) throw saleError;

    const baseUrl = process.env.STOREFRONT_API_URL?.trim().replace(/\/+$/, "");
    const secret = process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
    if (!baseUrl || !secret) throw new Error("Integração de pedidos da loja não configurada.");

    const callback = await fetch(`${baseUrl}/api/integrations/erp/orders/${siteOrderId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryStatus: value.deliveryStatus,
        trackingCode: value.trackingCode || null,
        carrier: value.carrier || null,
        trackingUrl: value.trackingUrl || null,
        invoice: invoice?.chave_acesso ? {
          number: invoice.numero == null ? null : String(invoice.numero),
          series: invoice.serie == null ? null : String(invoice.serie),
          accessKey: String(invoice.chave_acesso).replace(/\D/g, ""),
        } : null,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const callbackBody = await callback.json().catch(() => null);
    if (!callback.ok) throw new Error(callbackBody?.error || `A loja respondeu HTTP ${callback.status}.`);

    return NextResponse.json({
      ok: true,
      vendaId: link.venda_id,
      deliveryStatus: value.deliveryStatus,
      deliveryMethod: isPickup ? "pickup" : "delivery",
      invoiceSent: Boolean(invoice?.chave_acesso),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao registrar a postagem." },
      { status: errorStatus(error) },
    );
  }
}
