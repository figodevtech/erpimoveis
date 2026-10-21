import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { storefrontFetch } from "@/lib/integrations/storefront-http";

type QueueItem = {
  queue_id: number;
  produto_id: number;
  desired_version: number;
};

type CatalogRow = {
  produto_id: number;
  titulo: string | null;
  descricao: string | null;
  preco: number | null;
  estoque: number | null;
  referencia: string | null;
  fabricante: string | null;
  grupo_produto_id: number | null;
  imagem_principal: string | null;
  conservacao: string | null;
  codigobarras: string | null;
  destaque: boolean | null;
  visible: boolean | null;
  source_updated_at: string | null;
};

export async function syncStorefrontCatalog(empresaId: number, limit = 100) {
  const endpoint = storefrontCatalogEndpoint();
  const secret = process.env.STOREFRONT_CATALOG_SYNC_SECRET?.trim();
  if (!secret) throw new Error("STOREFRONT_CATALOG_SYNC_SECRET não configurado no ERP.");

  const { data: reservedData, error: reserveError } = await supabaseAdmin.rpc(
    "fn_reservar_sincronizacao_site",
    { p_limit: Math.min(Math.max(limit, 1), 100), p_empresa_id: empresaId },
  );
  if (reserveError) throw reserveError;

  const reserved = (reservedData ?? []) as QueueItem[];

  try {
    const productIds = reserved.map((item) => Number(item.produto_id));
    const [catalogResult, categoriesResult, imagesResult] = await Promise.all([
      supabaseAdmin
        .from("site_catalog_export")
        .select("produto_id,titulo,descricao,preco,estoque,referencia,fabricante,grupo_produto_id,imagem_principal,conservacao,codigobarras,destaque,visible,source_updated_at")
        .eq("empresa_id", empresaId)
        .in("produto_id", productIds),
      supabaseAdmin
        .from("produtogrupo")
        .select("id,nome,descricao,ativo,exibirSite")
        .order("nome"),
      supabaseAdmin
        .from("produto_imagem")
        .select("produto_id,url,path,ordem")
        .in("produto_id", productIds)
        .order("ordem"),
    ]);

    if (catalogResult.error) throw catalogResult.error;
    if (categoriesResult.error) throw categoriesResult.error;
    if (imagesResult.error) throw imagesResult.error;

    const imagesByProduct = new Map<number, Array<{ url: string; path?: string; order: number }>>();
    for (const image of imagesResult.data ?? []) {
      const url = validHttpUrl(image.url);
      if (!url) continue;
      const productId = Number(image.produto_id);
      const list = imagesByProduct.get(productId) ?? [];
      list.push({
        url,
        path: image.path ? String(image.path).slice(0, 1000) : undefined,
        order: Number(image.ordem ?? 0),
      });
      imagesByProduct.set(productId, list);
    }

    const rows = (catalogResult.data ?? []) as CatalogRow[];
    if (reserved.length && !rows.length) throw new Error("Nenhum produto reservado foi encontrado na exportação do Site.");
    if (!rows.length && !categoriesResult.data?.length) return { processed: 0, categories: 0, products: 0 };

    const payload = {
      categories: (categoriesResult.data ?? []).map((category) => ({
        id: Number(category.id),
        name: String(category.nome || `Categoria #${category.id}`).slice(0, 160),
        description: category.descricao ? String(category.descricao).slice(0, 2000) : null,
        // No site, "ativo" decide se a categoria aparece; aqui isso e exibirSite.
        active: category.exibirSite === true,
      })),
      products: rows.map((product) => ({
        id: Number(product.produto_id),
        title: String(product.titulo || `Produto #${product.produto_id}`).slice(0, 300),
        marketplaceTitle: product.titulo ? String(product.titulo).slice(0, 300) : null,
        marketplaceDescription: product.descricao ? String(product.descricao).slice(0, 10000) : null,
        price: Math.max(0, Number(product.preco ?? 0)),
        stock: Math.max(0, Math.trunc(Number(product.estoque ?? 0))),
        reference: product.referencia ? String(product.referencia).slice(0, 200) : null,
        manufacturer: product.fabricante ? String(product.fabricante).slice(0, 200) : null,
        categoryId: product.grupo_produto_id ? Number(product.grupo_produto_id) : null,
        imageUrl:
          validHttpUrl(product.imagem_principal) ??
          imagesByProduct.get(Number(product.produto_id))?.[0]?.url ??
          null,
        condition: normalizeCondition(product.conservacao),
        featured: Boolean(product.destaque),
        visible: Boolean(product.visible),
        deleted: false,
        barcode: product.codigobarras ? String(product.codigobarras).slice(0, 100) : null,
        updatedAt: validIsoDate(product.source_updated_at),
        images: imagesByProduct.get(Number(product.produto_id)) ?? [],
      })),
    };

    const response = await storefrontFetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 800);
      throw new Error(`A loja recusou a sincronização (${response.status}): ${detail}`);
    }

    await completeQueue(reserved, true);
    return {
      processed: reserved.length,
      categories: payload.categories.length,
      products: payload.products.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar o catálogo.";
    await completeQueue(reserved, false, message);
    throw error;
  }
}

function storefrontCatalogEndpoint() {
  const raw = process.env.STOREFRONT_API_URL?.trim().replace(/\/$/, "");
  if (!raw) throw new Error("STOREFRONT_API_URL não configurada no ERP.");
  return `${raw}/api/integrations/erp/catalog`;
}

async function completeQueue(items: QueueItem[], success: boolean, error?: string) {
  const results = await Promise.all(
    items.map((item) =>
      supabaseAdmin.rpc("fn_concluir_sincronizacao_site", {
        p_queue_id: item.queue_id,
        p_desired_version: item.desired_version,
        p_success: success,
        p_error: error ?? null,
      }),
    ),
  );
  const failure = results.find((result) => result.error)?.error;
  if (failure && success) throw failure;
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function validIsoDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeCondition(value: string | null) {
  const condition = value?.trim().toUpperCase();
  return condition === "NOVO" || condition === "USADO" || condition === "RECONDICIONADO"
    ? condition
    : null;
}
