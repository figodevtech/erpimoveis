import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet, mercadoLivreApiPost, refreshMercadoLivreToken, tokenExpiresAt } from "@/lib/integrations/mercadolivre";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MercadoLivreAccount = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  site_id: string | null;
};

type MessageOrder = {
  id: number;
  venda_id: number | null;
  ml_order_id: number;
  buyer_id: number | null;
  status: string | null;
  date_created: string | null;
  raw_order: any;
};

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();

    const account = await getActiveAccount(await requireEmpresaId());
    const accessToken = await ensureValidAccessToken(account);
    const orderDbId = req.nextUrl.searchParams.get("orderDbId");
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 20), 1), 50);

    const orders = await getMessageOrders(account.empresa_id, orderDbId ? Number(orderDbId) : undefined);
    const conversations = await Promise.all(
      orders.map(async (order) => {
        const packId = getPackId(order);
        const buyerId = Number(order.buyer_id ?? order.raw_order?.buyer?.id ?? 0) || null;
        const title = getOrderTitle(order);
        const base = {
          orderDbId: order.id,
          vendaId: order.venda_id,
          mlOrderId: order.ml_order_id,
          packId,
          buyerId,
          title,
          status: order.status,
          dateCreated: order.date_created,
          messages: [] as any[],
          conversationStatus: null as any,
          error: null as string | null,
        };

        if (!packId) return { ...base, error: "Pedido sem pack/conversa disponível." };

        try {
          const data = await mercadoLivreApiGet<any>(
            accessToken,
            `/messages/packs/${encodeURIComponent(String(packId))}/sellers/${encodeURIComponent(String(account.ml_user_id))}?tag=post_sale&limit=${limit}`,
          );
          return {
            ...base,
            messages: normalizeMessages(data?.messages ?? [], account.ml_user_id),
            conversationStatus: data?.conversation_status ?? null,
          };
        } catch (e: any) {
          return { ...base, error: friendlyMercadoLivreError(e, "Falha ao carregar mensagens.") };
        }
      }),
    );

    return NextResponse.json({ data: conversations });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/messages", e);
    return NextResponse.json({ error: friendlyMercadoLivreError(e, "Falha ao carregar mensagens Mercado Livre.") }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireVendasEdit();

    const body = await req.json().catch(() => ({}));
    const orderDbId = Number(body?.orderDbId);
    const text = String(body?.text ?? "").trim();

    if (!Number.isInteger(orderDbId) || orderDbId <= 0) {
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "Informe a mensagem." }, { status: 400 });
    }
    if (text.length > 350) {
      return NextResponse.json({ error: "A mensagem pode ter no máximo 350 caracteres." }, { status: 400 });
    }

    const account = await getActiveAccount(await requireEmpresaId());
    const accessToken = await ensureValidAccessToken(account);
    const [order] = await getMessageOrders(account.empresa_id, orderDbId);
    if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

    const packId = getPackId(order);
    const buyerId = Number(order.buyer_id ?? order.raw_order?.buyer?.id ?? 0);
    if (!packId || !buyerId) {
      return NextResponse.json({ error: "Pedido sem dados suficientes para conversa." }, { status: 400 });
    }

    const data = await mercadoLivreApiPost<any>(
      accessToken,
      `/messages/packs/${encodeURIComponent(String(packId))}/sellers/${encodeURIComponent(String(account.ml_user_id))}?tag=post_sale`,
      {
        from: { user_id: account.ml_user_id },
        to: { user_id: getMessageAgentId(account.site_id) },
        text,
      },
    );

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/messages", e);
    return NextResponse.json({ error: friendlyMercadoLivreError(e, "Falha ao enviar mensagem Mercado Livre.") }, { status: errorStatus(e) });
  }
}

async function getActiveAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, ml_user_id, access_token, refresh_token, expires_at, site_id")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data as MercadoLivreAccount;
}

function getMessageAgentId(siteId: string | null) {
  const agents: Record<string, number> = {
    MLA: 3037674934,
    MLB: 3037675074,
    MLC: 3020819166,
    MCO: 3037204123,
    MLM: 3037204279,
    MLU: 3037204685,
  };
  return agents[String(siteId || "MLB").toUpperCase()] ?? agents.MLU;
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

async function getMessageOrders(empresaId: number, orderDbId?: number) {
  let query = supabaseAdmin
    .from("mercadolivre_order")
    .select("id, venda_id, ml_order_id, buyer_id, status, date_created, raw_order")
    .eq("empresa_id", empresaId)
    .order("date_created", { ascending: false })
    .limit(orderDbId ? 1 : 10);

  if (orderDbId) query = query.eq("id", orderDbId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MessageOrder[];
}

function getPackId(order: MessageOrder) {
  return order.raw_order?.pack_id || order.raw_order?.pack?.id || order.ml_order_id;
}

function getOrderTitle(order: MessageOrder) {
  const item = Array.isArray(order.raw_order?.order_items) ? order.raw_order.order_items[0]?.item : null;
  return item?.title || `Pedido ${order.ml_order_id}`;
}

function normalizeMessages(messages: any[], sellerId: number) {
  return messages
    .map((message) => {
      const fromId = Number(message?.from?.user_id ?? 0);
      return {
        id: message?.id ?? crypto.randomUUID(),
        text: message?.text ?? "",
        fromUserId: fromId || null,
        toUserId: message?.to?.user_id ?? null,
        fromSeller: fromId === sellerId,
        status: message?.status ?? null,
        dateCreated: message?.message_date?.created ?? message?.date_created ?? message?.message_date?.received ?? null,
      };
    })
    .sort((a, b) => new Date(a.dateCreated ?? 0).getTime() - new Date(b.dateCreated ?? 0).getTime());
}

function friendlyMercadoLivreError(error: any, fallback: string) {
  const raw = String(error?.message ?? "");
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return raw || fallback;

  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    const causes = Array.isArray(parsed.cause) ? parsed.cause : Array.isArray(parsed.cause_list) ? parsed.cause_list : [];
    const details = causes.map((cause: any) => cause?.message || cause?.msg || cause?.cause || cause?.code).filter(Boolean).join("; ");
    return details || parsed.message || parsed.error || fallback;
  } catch {
    return raw || fallback;
  }
}
