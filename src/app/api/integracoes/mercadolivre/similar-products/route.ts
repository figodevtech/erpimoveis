import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchResult = {
  id?: string;
  title?: string;
  price?: number;
  currency_id?: string;
  available_quantity?: number;
  thumbnail?: string;
  permalink?: string;
  condition?: string;
  category_id?: string;
};

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const categoryId = req.nextUrl.searchParams.get("categoryId")?.trim().toUpperCase() ?? "";
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 8), 1), 12);

    if (q.length < 3) {
      return NextResponse.json({ error: "Informe pelo menos 3 caracteres para pesquisar." }, { status: 400 });
    }

    const account = await getDefaultAccount(await requireEmpresaId());
    const params = new URLSearchParams({
      q,
      limit: String(limit),
    });
    if (categoryId) params.set("category", categoryId);

    const result = await mercadoLivreApiGet<{ results?: SearchResult[] }>(
      account.access_token,
      `/sites/MLB/search?${params.toString()}`,
    );

    const data = (result.results ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      price: item.price ?? 0,
      currencyId: item.currency_id ?? "BRL",
      availableQuantity: item.available_quantity ?? null,
      thumbnail: item.thumbnail ?? null,
      permalink: item.permalink ?? null,
      condition: item.condition ?? null,
      categoryId: item.category_id ?? null,
    }));

    return NextResponse.json({ data });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/similar-products", e);
    const message = String(e?.message ?? "");
    if (message.includes("(403)") || message.toLowerCase().includes("forbidden")) {
      return NextResponse.json({
        data: [],
        unavailable: true,
        error: "O Mercado Livre bloqueou a busca de anúncios semelhantes para esta aplicação/conta.",
      });
    }

    return NextResponse.json({ error: e?.message || "Falha ao buscar anúncios semelhantes." }, { status: 500 });
  }
}

async function getDefaultAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, empresa_id, access_token")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data as { id: number; empresa_id: number; access_token: string };
}
