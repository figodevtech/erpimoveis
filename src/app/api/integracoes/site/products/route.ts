import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicationSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
    status: z.enum(["RASCUNHO", "PUBLICADO", "PAUSADO"]).default("RASCUNHO"),
    siteTitle: z.string().trim().max(300).nullish(),
    siteDescription: z.string().trim().max(10000).nullish(),
    useErpPrice: z.boolean().default(true),
    sitePrice: z.coerce.number().min(0).nullish(),
    safetyStock: z.coerce.number().int().min(0).default(0),
    maxSiteStock: z.coerce.number().int().min(0).nullish(),
    featured: z.boolean().default(false),
    slug: z
      .string()
      .trim()
      .max(180)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido.")
      .nullish(),
  })
  .superRefine((value, context) => {
    if (!value.useErpPrice && value.sitePrice == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sitePrice"],
        message: "Informe o preço da loja ou habilite o preço do ERP.",
      });
    }
  });

const STATUS_FILTERS = new Set([
  "all",
  "draft",
  "published",
  "paused",
  "unpublished",
]);
const SYNC_STATUS_FILTERS = new Set(["all", "error", "pending", "synced"]);

const CONDITION_FILTERS = new Set(["NOVO", "USADO", "RECONDICIONADO"]);

export async function GET(request: NextRequest) {
  try {
    await requireEstoqueAccess();
    const empresaId = await requireEmpresaId();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(20, Number(request.nextUrl.searchParams.get("limit") || 20)));
    const rawStatus = request.nextUrl.searchParams.get("status") || "all";
    const status = STATUS_FILTERS.has(rawStatus) ? rawStatus : "all";
    const rawSyncStatus = request.nextUrl.searchParams.get("syncStatus") || "all";
    const syncStatus = SYNC_STATUS_FILTERS.has(rawSyncStatus) ? rawSyncStatus : "all";
    const search = request.nextUrl.searchParams.get("search")?.trim().slice(0, 120) || "";
    const groupId = positiveInteger(request.nextUrl.searchParams.get("groupId"));
    const rawCondition = request.nextUrl.searchParams.get("condition")?.toUpperCase() || "";
    const condition = CONDITION_FILTERS.has(rawCondition) ? rawCondition : "";
    const manufacturer = request.nextUrl.searchParams.get("manufacturer")?.trim().slice(0, 120) || "";
    const image = request.nextUrl.searchParams.get("image") || "";
    const stockMin = finiteNumber(request.nextUrl.searchParams.get("stockMin"));
    const stockMax = finiteNumber(request.nextUrl.searchParams.get("stockMax"));
    const priceMin = finiteNumber(request.nextUrl.searchParams.get("priceMin"));
    const priceMax = finiteNumber(request.nextUrl.searchParams.get("priceMax"));

    const { data: links, error: linksError } = await supabaseAdmin
      .from("site_product_link")
      .select("id,produto_id,status,sync_status,last_synced_at,last_sync_error,titulo_site,usar_preco_erp,preco_site,estoque_seguranca,estoque_maximo_site,destaque")
      .eq("empresa_id", empresaId);
    if (linksError) throw linksError;

    const linkByProduct = new Map(
      (links ?? []).map((link) => [Number(link.produto_id), link]),
    );
    const filteredIds = statusProductIds(status, syncStatus, links ?? []);
    if (filteredIds && !filteredIds.length) {
      return NextResponse.json({
        data: [],
        pagination: { page: 1, limit, total: 0, totalPages: 1 },
        summary: summarizeLinks(links ?? []),
      });
    }

    let query = supabaseAdmin
      .from("produto")
      .select("id,titulo,tituloMarketplace,precovenda,estoque,referencia,fabricante,imgUrl", { count: "exact" })
      .eq("is_deleted", false)
      .order("id", { ascending: false });

    if (filteredIds) query = query.in("id", filteredIds);
    if (status === "unpublished") {
      const linkedIds = (links ?? []).map((link) => Number(link.produto_id));
      if (linkedIds.length) query = query.not("id", "in", `(${linkedIds.join(",")})`);
    }
    if (groupId) query = query.eq("grupo_produto_id", groupId);
    if (condition) query = query.eq("conservacao", condition);
    if (manufacturer) query = query.ilike("fabricante", `%${manufacturer}%`);
    if (image === "with") query = query.not("imgUrl", "is", null).neq("imgUrl", "");
    if (image === "without") query = query.or('imgUrl.is.null,imgUrl.eq.""');
    if (stockMin != null) query = query.gte("estoque", stockMin);
    if (stockMax != null) query = query.lte("estoque", stockMax);
    if (priceMin != null) query = query.gte("precovenda", priceMin);
    if (priceMax != null) query = query.lte("precovenda", priceMax);

    if (search) {
      const term = search.replace(/[,%()]/g, " ").trim();
      const numericId = /^#?\d+$/.test(term) ? Number(term.replace("#", "")) : null;
      query = query.or(
        `${numericId ? `id.eq.${numericId},` : ""}titulo.ilike.%${term}%,tituloMarketplace.ilike.%${term}%,referencia.ilike.%${term}%,fabricante.ilike.%${term}%,codigobarras.ilike.%${term}%`,
      );
    }

    const from = (page - 1) * limit;
    const catalog = await query.range(from, from + limit - 1);

    if (catalog.error) throw catalog.error;

    const productIds = (catalog.data ?? []).map((product) => Number(product.id));
    const { data: images, error: imagesError } = productIds.length
      ? await supabaseAdmin
          .from("produto_imagem")
          .select("produto_id,url,ordem")
          .in("produto_id", productIds)
          .order("ordem")
      : { data: [], error: null };
    if (imagesError) throw imagesError;
    const firstImageByProduct = new Map<number, string>();
    for (const imageRow of images ?? []) {
      const productId = Number(imageRow.produto_id);
      if (!firstImageByProduct.has(productId) && imageRow.url) {
        firstImageByProduct.set(productId, String(imageRow.url));
      }
    }

    const data = (catalog.data ?? []).map((product) => {
      const link = linkByProduct.get(Number(product.id));
      const erpStock = Math.max(0, Math.trunc(Number(product.estoque ?? 0)));
      const safetyStock = Number(link?.estoque_seguranca ?? 0);
      const maximumStock = link?.estoque_maximo_site == null
        ? Number.MAX_SAFE_INTEGER
        : Number(link.estoque_maximo_site);
      const price = link && !link.usar_preco_erp
        ? Number(link.preco_site ?? 0)
        : Number(product.precovenda ?? 0);
      const imageUrl = product.imgUrl || firstImageByProduct.get(Number(product.id)) || null;

      return {
        product_link_id: link ? Number(link.id) : null,
        produto_id: Number(product.id),
        titulo: link?.titulo_site || product.tituloMarketplace || product.titulo,
        preco: price,
        estoque: Math.min(Math.max(erpStock - safetyStock, 0), maximumStock),
        status: link?.status ?? "RASCUNHO",
        sync_status: link?.sync_status ?? "NAO_SINCRONIZADO",
        referencia: product.referencia,
        fabricante: product.fabricante,
        imagem_principal: imageUrl,
        has_image: Boolean(imageUrl),
        last_synced_at: link?.last_synced_at ?? null,
        last_sync_error: link?.last_sync_error ?? null,
        visible: link?.status === "PUBLICADO",
      };
    });

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total: catalog.count ?? 0,
        totalPages: Math.max(1, Math.ceil((catalog.count ?? 0) / limit)),
      },
      summary: summarizeLinks(links ?? []),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error, "Falha ao carregar o canal Site.") },
      { status: errorStatus(error) }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireEstoqueEdit();
    const empresaId = await requireEmpresaId();
    const parsed = publicationSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados da publicação inválidos.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const value = parsed.data;
    const { data: product, error: productError } = await supabaseAdmin
      .from("produto")
      .select("id")
      .eq("id", value.productId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (productError) throw productError;
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("site_product_link")
      .upsert(
        {
          empresa_id: empresaId,
          produto_id: value.productId,
          status: value.status,
          titulo_site: value.siteTitle || null,
          descricao_site: value.siteDescription || null,
          usar_preco_erp: value.useErpPrice,
          preco_site: value.useErpPrice ? null : value.sitePrice,
          estoque_seguranca: value.safetyStock,
          estoque_maximo_site: value.maxSiteStock ?? null,
          destaque: value.featured,
          slug: value.slug || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,produto_id" }
      )
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ data }, { status: 200 });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error, "Falha ao salvar a publicação da Loja.") },
      { status: errorStatus(error) }
    );
  }
}

type SiteLink = {
  produto_id: number;
  status: string;
  sync_status: string;
};

function statusProductIds(status: string, syncStatus: string, links: SiteLink[]) {
  if ((status === "all" || status === "unpublished") && syncStatus === "all") return null;
  if (status === "unpublished") return [];
  return links
    .filter((link) => {
      const publicationMatches =
        status === "all" ||
        (status === "draft" && link.status === "RASCUNHO") ||
        (status === "published" && link.status === "PUBLICADO") ||
        (status === "paused" && link.status === "PAUSADO");
      const syncMatches =
        syncStatus === "all" ||
        (syncStatus === "error" && link.sync_status === "ERRO") ||
        (syncStatus === "pending" && link.sync_status === "PENDENTE") ||
        (syncStatus === "synced" && link.sync_status === "SINCRONIZADO");
      return publicationMatches && syncMatches;
    })
    .map((link) => Number(link.produto_id));
}

function finiteNumber(value: string | null) {
  if (value == null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveInteger(value: string | null) {
  const number = finiteNumber(value);
  return number != null && Number.isInteger(number) && number > 0 ? number : null;
}

function summarizeLinks(links: SiteLink[]) {
  return {
    published: links.filter((link) => link.status === "PUBLICADO").length,
    paused: links.filter((link) => link.status === "PAUSADO").length,
    pending: links.filter((link) => link.sync_status === "PENDENTE").length,
    errors: links.filter((link) => link.sync_status === "ERRO").length,
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
