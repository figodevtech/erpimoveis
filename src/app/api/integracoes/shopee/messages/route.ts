import { NextRequest, NextResponse } from "next/server";
import { requireVendasAccess, requireVendasEdit } from "@/app/api/_authz/perms";
import { errorStatus } from "@/lib/empresa-context";
import { shopeeShopApi } from "@/lib/integrations/shopee";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireVendasAccess();
    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim();
    if (conversationId) {
      const data = await shopeeShopApi<any>({
        path: "/api/v2/sellerchat/get_message",
        query: { conversation_id: conversationId, offset: 0, page_size: 50 },
      });
      return NextResponse.json({ messages: data?.response?.messages ?? [], page: data?.response?.page_result ?? null });
    }

    const data = await shopeeShopApi<any>({
      path: "/api/v2/sellerchat/get_conversation_list",
      query: { direction: "latest", type: "all", page_size: 30 },
    });
    return NextResponse.json({ conversations: data?.response?.conversations ?? [], page: data?.response?.page_result ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyChatError(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireVendasEdit();
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "send");
    const conversationId = String(body.conversationId || "").trim();
    if (action === "read") {
      if (!conversationId) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
      const data = await shopeeShopApi({ path: "/api/v2/sellerchat/read_conversation", method: "POST", body: { conversation_id: conversationId } });
      return NextResponse.json({ ok: true, data });
    }

    const toId = Number(body.toId);
    const text = String(body.text || "").trim();
    if (!Number.isInteger(toId) || toId <= 0) return NextResponse.json({ error: "Destinatário inválido." }, { status: 400 });
    if (!text) return NextResponse.json({ error: "Digite uma mensagem." }, { status: 400 });
    if (text.length > 2000) return NextResponse.json({ error: "A mensagem pode ter no máximo 2.000 caracteres." }, { status: 400 });
    const data = await shopeeShopApi({
      path: "/api/v2/sellerchat/send_message",
      method: "POST",
      body: { to_id: toId, message_type: "text", content: { text } },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyChatError(error) }, { status: errorStatus(error) });
  }
}

function friendlyChatError(error: any) {
  const message = String(error?.message || "Falha ao acessar mensagens da Shopee.");
  if (/permission|not authorized|no permission/i.test(message)) {
    return "O aplicativo Shopee ainda não possui a permissão Customer Service/Seller Chat. Solicite essa permissão no Go-live ou no suporte da Open Platform.";
  }
  return message;
}
