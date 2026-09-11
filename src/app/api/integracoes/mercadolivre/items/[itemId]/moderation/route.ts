import { NextResponse, type NextRequest } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import {
  describeMercadoLivreListingStatus,
  moderationReferenceId,
  normalizeMercadoLivreModeration,
  normalizeWrongCategoryDiagnosis,
} from "@/lib/integrations/mercadolivre-listing-status";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamsCtx = { params: Promise<{ itemId: string }> };

/**
 * Por que o anúncio está em análise, pausado ou finalizado.
 *
 * O estado sai do próprio item (`status` + `sub_status`) e o texto que o
 * vendedor lê no painel do Mercado Livre vem de
 * `GET /moderations/last_moderation/{ITEM_ID}-ITM`.
 */
export async function GET(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const { itemId } = await ctx.params;
    const normalizedItemId = String(itemId ?? "").trim().toUpperCase();
    if (!normalizedItemId) return NextResponse.json({ error: "Informe o anúncio." }, { status: 400 });

    const { data: link } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, empresa_id")
      .eq("empresa_id", empresaId)
      .eq("ml_item_id", normalizedItemId)
      .maybeSingle();
    if (!link) return NextResponse.json({ error: "Anúncio não vinculado a esta empresa." }, { status: 404 });

    const account = await getValidMercadoLivreAccount(link.empresa_id);
    const item = await mercadoLivreApiGet<any>(
      account.access_token,
      `/items/${encodeURIComponent(normalizedItemId)}`,
    );

    // Sem moderação registrada o Mercado Livre responde 404: é ausência de
    // motivo, não falha da consulta.
    const rawModeration = await mercadoLivreApiGet<unknown>(
      account.access_token,
      `/moderations/last_moderation/${encodeURIComponent(moderationReferenceId(normalizedItemId))}`,
    ).catch(() => null);

    // O próprio texto da moderação aponta este recurso quando o problema é a
    // categoria. Não está na documentação pública; vem do link da evidência.
    const rawCategoryDiagnosis = await mercadoLivreApiGet<unknown>(
      account.access_token,
      `/tagging/wrong-domain/prustomer/${encodeURIComponent(normalizedItemId)}`,
    ).catch(() => null);

    const state = describeMercadoLivreListingStatus({
      status: item?.status,
      subStatus: item?.sub_status,
      tags: item?.tags,
    });
    const moderation = normalizeMercadoLivreModeration(rawModeration);

    await supabaseAdmin
      .from("mercadolivre_product_link")
      .update({
        status: item?.status ?? null,
        item_tags: Array.isArray(item?.tags) ? item.tags : [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    console.info("mercado-livre listing moderation", {
      empresa_id: link.empresa_id,
      ml_item_id: normalizedItemId,
      status: state.status,
      sub_status: state.subStatus,
      moderation_code: moderation?.code ?? null,
    });

    return NextResponse.json({
      data: {
        itemId: normalizedItemId,
        permalink: item?.permalink ?? null,
        ...state,
        moderation,
        categoryDiagnosis: normalizeWrongCategoryDiagnosis(rawCategoryDiagnosis),
      },
    });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/items/[itemId]/moderation", e);
    return NextResponse.json(
      { error: e?.message || "Falha ao consultar a situação do anúncio no Mercado Livre." },
      { status: errorStatus(e) },
    );
  }
}
