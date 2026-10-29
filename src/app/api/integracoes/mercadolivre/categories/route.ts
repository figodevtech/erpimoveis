import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ML_API_BASE_URL = "https://api.mercadolibre.com";

type DomainDiscoveryItem = {
  domain_id?: string;
  domain_name?: string;
  category_id?: string;
  category_name?: string;
};

type CategoryDetail = {
  id?: string;
  name?: string;
  total_items_in_this_category?: number;
  path_from_root?: Array<{ id?: string; name?: string }>;
  children_categories?: Array<{ id?: string; name?: string; total_items_in_this_category?: number }>;
  settings?: {
    item_conditions?: string[];
    shipping_options?: string[];
    simple_shipping?: string;
    shipping_profile?: string;
  };
};

const CATEGORY_ROOTS = {
  products: [
    { id: "MLB5672", name: "Acessórios para Veículos" },
    { id: "MLB271599", name: "Agro" },
    { id: "MLB1403", name: "Alimentos e Bebidas" },
    { id: "MLB1071", name: "Pet Shop" },
    { id: "MLB1368", name: "Arte, Papelaria e Armarinho" },
    { id: "MLB1384", name: "Bebês" },
    { id: "MLB1246", name: "Beleza e Cuidado Pessoal" },
    { id: "MLB1132", name: "Brinquedos e Hobbies" },
    { id: "MLB1430", name: "Calçados, Roupas e Bolsas" },
    { id: "MLB1574", name: "Casa, Móveis e Decoração" },
    { id: "MLB1051", name: "Celulares e Telefones" },
    { id: "MLB1500", name: "Construção" },
    { id: "MLB1039", name: "Câmeras e Acessórios" },
    { id: "MLB5726", name: "Eletrodomésticos" },
    { id: "MLB1000", name: "Eletrônicos, Áudio e Vídeo" },
    { id: "MLB1276", name: "Esportes e Fitness" },
    { id: "MLB263532", name: "Ferramentas" },
    { id: "MLB1144", name: "Games" },
    { id: "MLB1499", name: "Indústria e Comércio" },
    { id: "MLB1648", name: "Informática" },
    { id: "MLB1182", name: "Instrumentos Musicais" },
    { id: "MLB3937", name: "Joias e Relógios" },
    { id: "MLB1196", name: "Livros, Revistas e Comics" },
    { id: "MLB1168", name: "Música, Filmes e Seriados" },
    { id: "MLB264586", name: "Saúde" },
    { id: "MLB1367", name: "Antiguidades e Coleções" },
  ],
  vehicles: [{ id: "MLB1743", name: "Carros, Motos e Outros" }],
  real_estate: [{ id: "MLB1459", name: "Imóveis" }],
  services: [{ id: "MLB1540", name: "Serviços" }],
} as const;

export async function GET(req: NextRequest) {
  try {
    await requireVendasAccess();

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const parentId = req.nextUrl.searchParams.get("parentId")?.trim() ?? "";
    const vertical = normalizeVertical(req.nextUrl.searchParams.get("vertical"));
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 8), 1), 8);

    if (parentId) {
      const detail = await mercadoLivrePublicGet<CategoryDetail>(`/categories/${encodeURIComponent(parentId)}`);
      return NextResponse.json({
        parent: mapCategoryDetail(detail),
        data: (detail.children_categories ?? []).map((child) => ({
          id: child.id,
          name: child.name ?? child.id,
          path: [...(detail.path_from_root?.map((node) => node.name).filter(Boolean) ?? []), child.name].filter(Boolean).join(" > "),
          childrenCount: null,
          totalItems: child.total_items_in_this_category ?? 0,
          shippingOptions: null,
        })),
      });
    }

    if (q.length < 2) {
      return NextResponse.json({ data: await loadRootCategories(vertical) });
    }

    const discovery = await mercadoLivrePublicGet<DomainDiscoveryItem[]>(
      `/sites/MLB/domain_discovery/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );

    const byCategory = new Map<string, DomainDiscoveryItem>();
    for (const item of discovery ?? []) {
      if (item.category_id && !byCategory.has(item.category_id)) {
        byCategory.set(item.category_id, item);
      }
    }

    const details = await Promise.all(
      Array.from(byCategory.keys()).map(async (categoryId) => {
        try {
          return [categoryId, await mercadoLivrePublicGet<CategoryDetail>(`/categories/${encodeURIComponent(categoryId)}`)] as const;
        } catch {
          return [categoryId, null] as const;
        }
      }),
    );

    const detailsById = new Map(details);
    const data = Array.from(byCategory.values()).map((item) => {
      const detail = item.category_id ? detailsById.get(item.category_id) : null;
      const path = detail?.path_from_root?.map((node) => node.name).filter(Boolean).join(" > ") ?? item.category_name ?? "";

      return {
        id: item.category_id,
        name: detail?.name ?? item.category_name ?? item.category_id,
        domainId: item.domain_id ?? null,
        domainName: item.domain_name ?? null,
        path,
        childrenCount: detail?.children_categories?.length ?? null,
        totalItems: detail?.total_items_in_this_category ?? 0,
        conditionOptions: detail?.settings?.item_conditions ?? null,
        shippingOptions: detail?.settings?.shipping_options ?? null,
        simpleShipping: detail?.settings?.simple_shipping ?? null,
        shippingProfile: detail?.settings?.shipping_profile ?? null,
      };
    });

    return NextResponse.json({ data: data.length > 0 ? data : await loadRootCategories(vertical) });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/categories", e);
    return NextResponse.json({ error: e?.message || "Falha ao buscar categorias Mercado Livre." }, { status: 500 });
  }
}

function normalizeVertical(value: string | null) {
  if (value === "vehicles" || value === "real_estate" || value === "services") return value;
  return "products";
}

function mapCategoryDetail(detail: CategoryDetail) {
  return {
    id: detail.id,
    name: detail.name ?? detail.id,
    path: detail.path_from_root?.map((node) => node.name).filter(Boolean).join(" > ") ?? detail.name ?? detail.id,
    childrenCount: detail.children_categories?.length ?? null,
    totalItems: detail.total_items_in_this_category ?? 0,
    conditionOptions: detail.settings?.item_conditions ?? null,
    shippingOptions: detail.settings?.shipping_options ?? null,
    simpleShipping: detail.settings?.simple_shipping ?? null,
    shippingProfile: detail.settings?.shipping_profile ?? null,
  };
}

async function loadRootCategories(vertical: keyof typeof CATEGORY_ROOTS) {
  return Promise.all(
    CATEGORY_ROOTS[vertical].map(async (root) => {
      try {
        return mapCategoryDetail(await mercadoLivrePublicGet<CategoryDetail>(`/categories/${encodeURIComponent(root.id)}`));
      } catch {
        return {
          id: root.id,
          name: root.name,
          path: root.name,
          childrenCount: null,
          totalItems: 0,
        };
      }
    }),
  );
}

async function mercadoLivrePublicGet<T>(path: string) {
  const response = await fetch(`${ML_API_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "erpimoveis-marketplace/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Livre ${path} falhou (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}
