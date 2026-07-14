import { NextResponse } from "next/server";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireConfigAccess();
    const empresaId = await requireEmpresaId();
    const { data, error } = await supabaseAdmin
      .from("mercadolivre_account")
      .select("id, empresa_id, ml_user_id, nickname, site_id, scope, expires_at, refresh_token, updated_at")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error) throw error;

    let shipping: { modes: string[]; option: string | null; mercadoEnviosEnabled: boolean; error: string | null } | null = null;
    if (data) {
      try {
        const account = await getValidMercadoLivreAccount(empresaId);
        const preferences = await mercadoLivreApiGet<{ modes?: string[]; option?: string | null }>(
          account.access_token,
          `/users/${account.ml_user_id}/shipping_preferences`,
        );
        const modes = (preferences.modes ?? []).map((mode) => String(mode).toLowerCase());
        shipping = { modes, option: preferences.option ?? null, mercadoEnviosEnabled: modes.includes("me2"), error: null };
      } catch (shippingError: any) {
        shipping = { modes: [], option: null, mercadoEnviosEnabled: false, error: shippingError?.message || "Falha ao consultar preferências de envio." };
      }
    }

    return NextResponse.json({
      account: data
        ? {
            id: data.id,
            empresaId: data.empresa_id,
            userId: data.ml_user_id,
            nickname: data.nickname,
            siteId: data.site_id,
            scope: data.scope,
            expiresAt: data.expires_at,
            updatedAt: data.updated_at,
            needsReconnect: !data.refresh_token,
            shipping,
          }
        : null,
    });
  } catch (error: any) {
    console.error("GET /api/config/integracoes/mercadolivre", error);
    return NextResponse.json(
      { error: error?.message || "Falha ao carregar configuração do Mercado Livre." },
      { status: errorStatus(error) },
    );
  }
}

export async function DELETE() {
  try {
    await requireConfigEdit();
    const empresaId = await requireEmpresaId();
    const { data: account, error: accountError } = await supabaseAdmin
      .from("mercadolivre_account")
      .select("id, ml_user_id")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ ok: true });

    await detachHistoricalRecords(Number(account.id), Number(account.ml_user_id));

    const { error: linksError } = await supabaseAdmin
      .from("mercadolivre_product_link")
      .delete()
      .eq("empresa_id", empresaId);
    if (linksError) throw linksError;

    const { error: deleteError } = await supabaseAdmin
      .from("mercadolivre_account")
      .delete()
      .eq("id", account.id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /api/config/integracoes/mercadolivre", error);
    return NextResponse.json(
      { error: error?.message || "Falha ao desconectar a conta Mercado Livre." },
      { status: errorStatus(error) },
    );
  }
}

async function detachHistoricalRecords(accountId: number, mlUserId: number) {
  for (const table of ["mercadolivre_order", "mercadolivre_claim"]) {
    const { error } = await supabaseAdmin.from(table).update({ account_id: null }).eq("account_id", accountId);
    if (error) throw error;
  }

  const { error: notificationDetachError } = await supabaseAdmin
    .from("mercadolivre_notification")
    .update({ account_id: null })
    .eq("account_id", accountId);
  if (notificationDetachError) throw notificationDetachError;

  const { error: notificationCloseError } = await supabaseAdmin
    .from("mercadolivre_notification")
    .update({
      status: "IGNORADA",
      error: "Evento encerrado porque a conta Mercado Livre foi desconectada.",
      next_retry_at: null,
      locked_at: null,
      processed_at: new Date().toISOString(),
    })
    .eq("ml_user_id", mlUserId)
    .in("status", ["RECEBIDA", "PROCESSANDO", "ERRO"]);
  if (notificationCloseError) throw notificationCloseError;
}
