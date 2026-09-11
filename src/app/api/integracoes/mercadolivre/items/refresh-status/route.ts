import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { refreshMercadoLivreListingStates } from "@/lib/integrations/mercadolivre-listing-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Relê no Mercado Livre a situação dos anúncios vinculados.
 *
 * A conferência é a mesma que o cron faz de hora em hora — este botão só existe
 * para quem não quer esperar a próxima passada. Os dois caminhos chamam
 * `refreshMercadoLivreListingStates`, então não há como um enxergar uma exclusão
 * que o outro ignora.
 */
export async function POST() {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    // Falha cedo e com mensagem própria quando a conta não está autorizada, em
    // vez de devolver uma varredura inteira marcada como "sem token".
    const account = await getValidMercadoLivreAccount(empresaId);

    const states = await refreshMercadoLivreListingStates({ empresaId });
    const changed = states
      .filter((entry) => entry.action === "changed")
      .map((entry) => ({
        itemId: entry.itemId,
        from: entry.from,
        to: entry.to,
        label: entry.label,
        detail: entry.detail,
      }));
    const removed = states
      .filter((entry) => entry.action === "removed")
      .map((entry) => ({ itemId: entry.itemId, produtoId: entry.produtoId, reason: entry.reason ?? null }));
    const failed = states.filter((entry) => entry.action === "failed");

    console.info("mercado-livre listing status refresh", {
      empresa_id: empresaId,
      ml_user_id: account.ml_user_id,
      checked: states.length,
      changed: changed.length,
      removed: removed.length,
      failed: failed.length,
    });

    return NextResponse.json({
      data: {
        checked: states.length,
        changed,
        removed,
        failed: failed.map((entry) => ({ itemId: entry.itemId, error: entry.error ?? null })),
      },
    });
  } catch (e: any) {
    console.error("POST /api/integracoes/mercadolivre/items/refresh-status", e);
    return NextResponse.json(
      { error: e?.message || "Falha ao atualizar a situação dos anúncios." },
      { status: errorStatus(e) },
    );
  }
}
