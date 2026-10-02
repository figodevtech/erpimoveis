import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVendasAccess, requireVendasCreate } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  produtoId: z.coerce.number().int().positive(),
  quantidade: z.coerce.number().int().positive(),
  subTotal: z.coerce.number().nonnegative(),
  valorTotal: z.coerce.number().nonnegative(),
  valorDesconto: z.coerce.number().nonnegative().default(0),
  valorFrete: z.coerce.number().nonnegative().default(0),
  baixarEstoque: z.boolean().default(true),
});

const orderSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.literal("PAGO"),
  subtotal: z.coerce.number().positive(),
  total: z.coerce.number().positive(),
  paymentMethod: z.string().trim().max(100).nullish(),
  paymentProvider: z.string().trim().max(60).nullish(),
  gatewayPaymentId: z.string().trim().max(200).nullish(),
  createdAt: z.string().datetime({ offset: true }),
  shippingAddress: z.record(z.string(), z.unknown()),
  customer: z.object({
    id: z.coerce.number().int().positive(),
    type: z.enum(["FISICA", "JURIDICA"]),
    document: z.string().trim().min(11).max(18),
    name: z.string().trim().min(1).max(300),
    email: z.string().email().max(320),
    phone: z.string().trim().min(8).max(30),
  }),
  items: z.array(itemSchema).min(1).max(200),
});

const storefrontResponseSchema = z.object({
  data: z.array(orderSchema),
  count: z.coerce.number().int().nonnegative(),
});

export async function GET(request: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("limit") || 50)));
    const from = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from("site_order_link")
      .select(`
        id, site_order_id, site_status, payment_provider, gateway_payment_id,
        total_amount, order_created_at, import_status, import_error, last_synced_at, raw_order,
        venda:venda_id (
          id, status, status_entrega, codigo_rastreio, transportadora_rastreio,
          valortotal, datavenda, endereco_entrega_snapshot,
          cliente:clienteid ( id, nomerazaosocial, cpfcnpj, email, telefone )
        )
      `, { count: "exact" })
      .eq("empresa_id", empresaId)
      .order("order_created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw error;

    const rows = (data ?? []) as any[];
    const vendaIds = rows.map((row) => Number(row.venda?.id)).filter(Number.isFinite);
    const invoiceBySale = new Map<number, any>();
    if (vendaIds.length) {
      const { data: invoices, error: invoiceError } = await supabaseAdmin
        .from("nfe")
        .select("id, vendaid, numero, serie, chave_acesso, status, dataautorizacao")
        .in("vendaid", vendaIds)
        .order("id", { ascending: false });
      if (invoiceError) throw invoiceError;
      for (const invoice of invoices ?? []) {
        const saleId = Number((invoice as any).vendaid);
        if (!invoiceBySale.has(saleId)) invoiceBySale.set(saleId, invoice);
      }
    }

    return NextResponse.json({
      data: rows.map((row) => {
        const address = row.venda?.endereco_entrega_snapshot
          ?? row.raw_order?.shippingAddress
          ?? {};
        return {
          ...row,
          raw_order: undefined,
          delivery: {
            method: address.deliveryMethod === "pickup" ? "pickup" : "delivery",
            label: address.deliveryMethod === "pickup" ? "Retirada no local" : "Entrega no endereço",
            address: {
              street: address.logradouro ?? null,
              number: address.numero ?? null,
              complement: address.complemento ?? null,
              neighborhood: address.bairro ?? null,
              city: address.cidade ?? null,
              state: address.estado ?? null,
              zipCode: address.cep ?? null,
            },
          },
          invoice: invoiceBySale.get(Number(row.venda?.id)) ?? null,
        };
      }),
      count: count ?? rows.length,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Falha ao carregar os pedidos do Site.") },
      { status: errorStatus(error) },
    );
  }
}

export async function POST() {
  try {
    await requireVendasCreate();
    const empresaId = await requireEmpresaId();
    const baseUrl = process.env.STOREFRONT_API_URL?.trim().replace(/\/+$/, "");
    const secret = process.env.STOREFRONT_ORDER_SYNC_SECRET?.trim();
    if (!baseUrl || !secret) {
      return NextResponse.json(
        { error: "Configure STOREFRONT_API_URL e STOREFRONT_ORDER_SYNC_SECRET no ERP." },
        { status: 503 },
      );
    }

    const response = await fetch(`${baseUrl}/api/integrations/erp/orders?limit=100`, {
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(raw?.error || `A loja respondeu HTTP ${response.status}.`);
    }

    const parsed = storefrontResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A loja retornou pedidos em formato inválido.", details: parsed.error.flatten() },
        { status: 502 },
      );
    }

    const results: Array<{ siteOrderId: number; vendaId: number | null; imported: boolean; error?: string }> = [];
    for (const order of parsed.data.data) {
      const { data: existing } = await supabaseAdmin
        .from("site_order_link")
        .select("venda_id")
        .eq("empresa_id", empresaId)
        .eq("site_order_id", order.id)
        .maybeSingle();

      const { data: vendaId, error } = await supabaseAdmin.rpc("fn_importar_pedido_site", {
        p_empresa_id: empresaId,
        p_pedido: order,
      });

      if (error) {
        console.error(`[site/orders] Falha ao importar pedido ${order.id}:`, error);
        await supabaseAdmin.from("site_order_link").upsert({
          empresa_id: empresaId,
          site_order_id: order.id,
          site_customer_id: order.customer.id,
          site_status: order.status,
          payment_provider: order.paymentProvider || null,
          gateway_payment_id: order.gatewayPaymentId || null,
          total_amount: order.total,
          order_created_at: order.createdAt,
          import_status: "ERRO",
          import_error: error.message,
          raw_order: order,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "empresa_id,site_order_id" });
        results.push({ siteOrderId: order.id, vendaId: null, imported: false, error: error.message });
        continue;
      }

      results.push({
        siteOrderId: order.id,
        vendaId: Number(vendaId),
        imported: !existing?.venda_id,
      });
    }

    return NextResponse.json({
      ok: true,
      received: parsed.data.count,
      imported: results.filter((item) => item.imported).length,
      errors: results.filter((item) => item.error).length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Falha ao sincronizar os pedidos do Site.") },
      { status: errorStatus(error) },
    );
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
