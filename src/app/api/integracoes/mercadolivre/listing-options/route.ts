import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_LISTING_TYPES = [
  { id: "gold_special", name: "Clássico" },
  { id: "gold_pro", name: "Premium" },
  { id: "free", name: "Grátis" },
];

type ListingType = {
  id?: string;
  name?: string;
};

type SellerProfile = { tags?: string[] };

export async function GET() {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();

    try {
      const account = await getValidMercadoLivreAccount(empresaId);
      const siteId = account.site_id || "MLB";
      const [listingTypes, seller] = await Promise.all([
        mercadoLivreApiGet<ListingType[]>(account.access_token, `/sites/${encodeURIComponent(siteId)}/listing_types`).catch(() => []),
        mercadoLivreApiGet<SellerProfile>(account.access_token, `/users/${account.ml_user_id}`),
      ]);
      const data = (listingTypes ?? [])
        .filter((item) => item.id)
        .map((item) => ({ id: item.id, name: item.name ?? item.id }));

      const sellerTags = Array.isArray(seller?.tags) ? seller.tags.map(String) : [];
      return NextResponse.json({
        listingTypes: data.length ? data : FALLBACK_LISTING_TYPES,
        source: data.length ? "mercadolivre" : "fallback",
        sellerTags,
        userProductSeller: sellerTags.includes("user_product_seller"),
      });
    } catch {
      return NextResponse.json({ listingTypes: FALLBACK_LISTING_TYPES, source: "fallback" });
    }
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/listing-options", e);
    return NextResponse.json({ listingTypes: FALLBACK_LISTING_TYPES, source: "fallback" });
  }
}
