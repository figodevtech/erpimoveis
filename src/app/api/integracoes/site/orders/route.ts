import { NextRequest, NextResponse } from "next/server";
import { syncSiteOrders } from "@/lib/integrations/site-order-sync";
import { requireVendasAccess, requireVendasCreate } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        total_amount, order_created_at, import_status, import_error, last_synced_at, raw_order, refund_status, refund_requested_at, refund_reason, refund_checked_at,
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
    return NextResponse.json(await syncSiteOrders(empresaId));
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
