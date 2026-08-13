import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { syncShopeeOrders } from "@/lib/integrations/shopee-orders";
import { syncShopeeProductInventory } from "@/lib/integrations/shopee-products";

export async function GET(req: NextRequest) {
  try {
    const secrets = [process.env.CRON_SECRET, process.env.SHOPEE_CRON_SECRET].map((value) => value?.trim()).filter(Boolean);
    if (!secrets.length && process.env.NODE_ENV === "production") return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
    const received = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (secrets.length && (!received || !secrets.includes(received))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    const { data: accounts, error } = await supabaseAdmin.from("shopee_account").select("id, empresa_id");
    if (error) throw error;
    const summaries = [];
    for (const account of accounts ?? []) {
      const results = await syncShopeeOrders({ empresaId: Number(account.empresa_id), accountId: Number(account.id), days: 2 });
      const products = await syncShopeeProductInventory(Number(account.empresa_id));
      summaries.push({ accountId: account.id, total: results.length, created: results.filter((row) => row.created).length, failed: results.filter((row) => row.error).length, products });
    }
    return NextResponse.json({ ok: true, accounts: summaries });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Falha na rotina Shopee." }, { status: 500 });
  }
}
