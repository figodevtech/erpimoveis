import { NextRequest, NextResponse } from "next/server";
import { syncSiteOrders } from "@/lib/integrations/site-order-sync";
import { requireVendasAccess, requireVendasCreate } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchPendingSiteOrders } from "@/lib/integrations/site-pending-orders";
import { nextOrderAction } from "@/lib/integrations/site-order-control";
import {EMPTY_SITE_ORDER_FILTERS,siteOrderFiltersError,orderDateBounds,matchesSiteOrderFilters,type SiteOrderFilters} from '@/lib/integrations/site-order-filters';

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
    const filters={...EMPTY_SITE_ORDER_FILTERS};
    for(const key of Object.keys(filters) as Array<keyof SiteOrderFilters>)filters[key]=request.nextUrl.searchParams.get(key)||filters[key];
    const filterError=siteOrderFiltersError(filters);
    if(filterError)return NextResponse.json({error:filterError},{status:400});
    const {start:dateStart,end:dateEnd}=orderDateBounds(filters);

    if(search && (!/^\d+$/.test(search)||!Number.isSafeInteger(Number(search))||Number(search)<1))return NextResponse.json({error:"Pesquise pelo número do pedido."},{status:400});
    const checkoutStages=['all','active','awaiting-payment','payment-analysis','payment-review','cancelled'];
    let warning:string|null=null;
    let pending:Awaited<ReturnType<typeof fetchPendingSiteOrders>>=[];
    if(checkoutStages.includes(stage)) {
      try {pending=await fetchPendingSiteOrders();}
      catch(error){warning=error instanceof Error?error.message:'Falha ao consultar compras pendentes.';}
      // A materialized ERP order always wins, even when payment/import races this read.
      for(let offset=0;offset<pending.length;offset+=100){
        const batch=pending.slice(offset,offset+100);
        const {data:linked,error:linkError}=await supabaseAdmin.from('site_order_link').select('site_order_id').eq('empresa_id',empresaId).in('site_order_id',batch.map(row=>row.site_order_id));
        if(linkError)throw linkError;
        const ids=new Set((linked||[]).map(row=>Number(row.site_order_id)));
        for(const row of batch)if(ids.has(row.site_order_id))row.id=0;
      }
      pending=pending.filter(row=>row.id!==0 && (!search||row.site_order_id===Number(search)) && (
        stage==='all'||stage==='active'&&row.site_status!=='CANCELADO'||stage==='cancelled'&&row.site_status==='CANCELADO'||stage==='awaiting-payment'&&row.site_status==='AGUARDANDO_PAGAMENTO'||stage==='payment-analysis'&&row.site_status==='PAGAMENTO_EM_ANALISE'||stage==='payment-review'&&row.site_status==='REVISAO_NECESSARIA'));
    }

    pending=pending.filter(row=>matchesSiteOrderFilters(row,filters));

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
      // Explicitly removed test orders remain audit records, never list entries.
      .or("raw_order->>archivedTest.is.null,raw_order->>archivedTest.neq.true")
      .order("order_created_at", { ascending: false });
    if(stage==='active')query=query.neq('site_status','CANCELADO');
    if(dateStart)query=query.gte('order_created_at',dateStart);
    if(dateEnd)query=query.lt('order_created_at',dateEnd);
    if(filters.minTotal)query=query.gte('total_amount',Number(filters.minTotal));
    if(filters.maxTotal)query=query.lte('total_amount',Number(filters.maxTotal));
    if(filters.payment==='PIX')query=query.ilike('raw_order->>paymentMethod','%pix%');
    if(filters.payment==='BOLETO')query=query.ilike('raw_order->>paymentMethod','%boleto%');
    if(filters.payment==='CREDIT_CARD')query=query.or('raw_order->>paymentMethod.ilike.%CREDIT_CARD%,raw_order->>paymentMethod.ilike.%cartão%,raw_order->>paymentMethod.ilike.%cartao%');
    if(filters.delivery==='pickup')query=query.eq('raw_order->shippingAddress->>deliveryMethod','pickup');
    if(filters.delivery==='delivery')query=query.or('raw_order->shippingAddress->>deliveryMethod.is.null,raw_order->shippingAddress->>deliveryMethod.neq.pickup');
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
    else if (["awaiting-payment","payment-analysis","payment-review"].includes(stage)) query = query.eq("id", -1);
    else if (stage !== "all" && stage !== "active") return NextResponse.json({error:"Filtro inválido."},{status:400});
    const { data, error, count } = await query.range(pending.length ? 0 : from, from + limit - 1);

    if (error) throw error;

    const combined = [...(data ?? []),...pending] as any[];
    combined.sort((a,b)=>String(b.order_created_at||'').localeCompare(String(a.order_created_at||''))||b.site_order_id-a.site_order_id);
    const rows=pending.length ? combined.slice(from,from+limit) : combined;
    const combinedCount=(count??0)+pending.length;
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
          nextAction: row.checkout_pending ? row.nextAction : nextOrderAction(row),
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
      warning,
      count: combinedCount,
      pagination: {
        page,
        limit,
        total: combinedCount,
        totalPages: Math.max(1, Math.ceil(combinedCount / limit)),
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
