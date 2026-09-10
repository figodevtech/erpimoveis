import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { describeMercadoLivreListingStatus } from "@/lib/integrations/mercadolivre-listing-status";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** O multiget do Mercado Livre aceita no máximo 20 ids por chamada. */
const BATCH_SIZE = 20;

type MultiGetEntry = { code?: number; body?: { id?: string; status?: string; sub_status?: unknown; tags?: unknown } };

/**
 * Relê no Mercado Livre a situação dos anúncios vinculados.
 *
 * O ERP só gravava o status quando ele próprio mexia no anúncio, então uma
 * finalização feita pelo Mercado Livre (moderação, categoria incorreta) ficava
 * invisível até alguém abrir o item. O multiget resolve isso barato: uma
 * chamada a cada 20 anúncios, pedindo só os campos de estado.
 */
export async function POST() {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const account = await getValidMercadoLivreAccount(empresaId);

    const { data: links, error } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .select("id, ml_item_id, status")
      .eq("empresa_id", empresaId)
      .not("ml_item_id", "is", null);
    if (error) throw error;

    const rows = (links ?? []).filter((link) => link.ml_item_id);
    const changed: Array<{ itemId: string; from: string | null; to: string; label: string; detail: string | null }> = [];

    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const batch = rows.slice(index, index + BATCH_SIZE);
      const ids = batch.map((link) => String(link.ml_item_id)).join(",");
      const response = await mercadoLivreApiGet<MultiGetEntry[]>(
        account.access_token,
        `/items?ids=${encodeURIComponent(ids)}&attributes=id,status,sub_status,tags`,
      ).catch(() => null);
      if (!Array.isArray(response)) continue;

      for (const entry of response) {
        if (entry?.code !== 200 || !entry.body?.id) continue;
        const link = batch.find((item) => String(item.ml_item_id) === String(entry.body?.id));
        if (!link) continue;

        const state = describeMercadoLivreListingStatus({
          status: entry.body.status,
          subStatus: entry.body.sub_status,
          tags: entry.body.tags,
        });
        if (!state.status || state.status === String(link.status ?? "").toLowerCase()) continue;

        await supabaseAdmin
          .from("mercadolivre_product_link")
          .update({
            status: state.status,
            item_tags: Array.isArray(entry.body.tags) ? entry.body.tags : [],
            updated_at: new Date().toISOString(),
          })
          .eq("id", link.id);

        changed.push({
          itemId: String(entry.body.id),
          from: link.status ?? null,
          to: state.status,
          label: state.label,
          detail: state.detail,
        });
      }
    }

    console.info("mercado-livre listing status refresh", {
      empresa_id: empresaId,
      ml_user_id: account.ml_user_id,
      checked: rows.length,
      changed: changed.length,
    });

    return NextResponse.json({ data: { checked: rows.length, changed } });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/items/refresh-status", e);
    return NextResponse.json(
      { error: e?.message || "Falha ao atualizar a situação dos anúncios." },
      { status: errorStatus(e) },
    );
  }
}
