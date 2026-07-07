import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";

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

export async function GET() {
  try {
    await requireVendasAccess();

    try {
      const response = await fetch("https://api.mercadolibre.com/sites/MLB/listing_types", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Mercado Livre /sites/MLB/listing_types falhou (${response.status}): ${text}`);
      }

      const listingTypes = (await response.json()) as ListingType[];
      const data = (listingTypes ?? [])
        .filter((item) => item.id)
        .map((item) => ({ id: item.id, name: item.name ?? item.id }));

      return NextResponse.json({ listingTypes: data.length ? data : FALLBACK_LISTING_TYPES, source: data.length ? "mercadolivre" : "fallback" });
    } catch (e) {
      console.warn("Falha ao buscar listing_types no Mercado Livre; usando fallback.", e);
      return NextResponse.json({ listingTypes: FALLBACK_LISTING_TYPES, source: "fallback" });
    }
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/listing-options", e);
    return NextResponse.json({ listingTypes: FALLBACK_LISTING_TYPES, source: "fallback" });
  }
}
