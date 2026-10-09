import { NextRequest, NextResponse } from "next/server";
import { syncSiteOrders } from "@/lib/integrations/site-order-sync";
import { requireVendasAccess, requireVendasCreate } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { nextOrderAction } from "@/lib/integrations/site-order-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const requestedPage = Number(request.nextUrl.searchParams.get("page") || 1);
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 50);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      return NextResponse.json({ error: "Paginação inválida." }, { status: 400 });
    }
    const page = requestedPage;
    const limit = Math.min(100, Math.max(10, requestedLimit));
    const from = (page - 1) * limit;
    const stage = request.nextUrl.searchParams.get("stage") || "all";
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";

    let query = supabaseAdmin
      .from("site_order_link")
      .select(`
        id, site_order_id, site_status, payment_provider, gateway_payment_id,
        total_amount, order_created_at, import_status, import_error, last_synced_at, raw_order, refund_status, refund_requested_at, refund_reason, refund_denial_reason, refund_checked_at, refund_request_url, return_requested_at, return_received_at, return_reason, return_inspection_note, reverse_tracking,
        venda:venda_id (
          id, status, status_entrega, codigo_rastreio, transportadora_rastreio,
          valortotal, datavenda, endereco_entrega_snapshot,
          cliente:clienteid ( id, nomerazaosocial, cpfcnpj, email, telefone )
        )
      `, { count: "exact" })
      .eq("empresa_id", empresaId)
      // Keep the integration history, but hide canceled orders whose ERP sale was removed.
      .or("venda_id.not.is.null,site_status.neq.CANCELADO")
      .order("order_created_at", { ascending: false });
    if (search) {
      if (!/^\d+$/.test(search) || !Number.isSafeInteger(Number(search)) || Number(search) < 1) return NextResponse.json({error:"Pesquise pelo número do pedido."},{status:400});
      query = query.eq("site_order_id", Number(search));
    }
    if (stage === "error") query = query.eq("import_status", "ERRO");
    else if (stage === "refund-denied") query = query.eq("refund_status", "DENIED");
    else if (stage === "refund-pending") query = query.not("refund_requested_at", "is", null).neq("refund_status", "REFUNDED").neq("refund_status", "DENIED").neq("site_status", "CANCELADO");
    else if (stage === "return-pending") query = query.not("return_requested_at", "is", null).is("return_received_at", null);
    else if (stage === "return-received") query = query.not("return_received_at", "is", null);
    else if (stage === "cancelled") query = query.eq("site_status", "CANCELADO");
    else if (stage === "dispute") query = query.like("refund_status", "CHARGEBACK%");
    else if (stage !== "all") return NextResponse.json({error:"Filtro inválido."},{status:400});
    const { data, error, count } = await query.range(from, from + limit - 1);

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
          nextAction: nextOrderAction(row),
          paymentMethod: row.raw_order?.paymentMethod ?? null,
          subtotal: row.raw_order?.subtotal ?? null,
          customer: row.raw_order?.customer ?? null,
          raw_order: undefined,
          returnItems: (row.raw_order?.items ?? []).map((item: { produtoId: number; quantidade: number; title?: string; reference?: string; subTotal?: number; valorTotal?: number; valorDesconto?: number; valorFrete?: number }) => ({
            productId: item.produtoId, quantity: item.quantidade, title: item.title || `Produto #${item.produtoId}`,
            reference: item.reference, subtotal: item.subTotal, total: item.valorTotal, discount: item.valorDesconto, freight: item.valorFrete,
          })),
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
