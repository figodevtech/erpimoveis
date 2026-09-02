import { NextResponse } from "next/server";
import { requireConfigAccess, requireConfigEdit } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidMercadoLivreAccount } from "@/lib/integrations/mercadolivre-account";
import { mercadoLivreApiGet } from "@/lib/integrations/mercadolivre";
import {
  getMercadoLivreShippingAddress,
  selectMercadoLivreShippingAddressSummary,
  type MercadoLivreShippingAddress,
} from "@/lib/integrations/mercadolivre-address";
import { unregisterMercadoLivrePlatformAccount } from "@/lib/integrations/mercadolivre-platform";
import { validateMercadoLivreQuantityTiers } from "@/lib/integrations/mercadolivre-quantity-pricing";
import {
  parseMercadoLivreSellerProfile,
  type MercadoLivreSellerProfile,
} from "@/lib/integrations/mercadolivre-seller-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireConfigAccess();
    const empresaId = await requireEmpresaId();
    const { data, error } = await supabaseAdmin
      .from("mercadolivre_account")
      .select("id, empresa_id, ml_user_id, nickname, site_id, scope, expires_at, refresh_token, default_listing_type_id, quantity_pricing_default_enabled, quantity_pricing_default_tiers, updated_at")
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (error) throw error;

    let shipping: { modes: string[]; option: string | null; mercadoEnviosEnabled: boolean; error: string | null } | null = null;
    let sellerProfile: (MercadoLivreSellerProfile & { error: string | null }) | null = null;
    let shippingAddress: MercadoLivreShippingAddress | null = null;
    let shippingAddressError: string | null = null;
    let shippingAddressNotice: string | null = null;
    if (data) {
      try {
        const account = await getValidMercadoLivreAccount(empresaId);
        const [shippingResult, profileResult, addressResult] = await Promise.allSettled([
          mercadoLivreApiGet<{ modes?: string[]; option?: string | null }>(
            account.access_token,
            `/users/${account.ml_user_id}/shipping_preferences`,
          ),
          mercadoLivreApiGet<unknown>(account.access_token, `/users/${account.ml_user_id}`),
          getMercadoLivreShippingAddress(account.access_token, account.ml_user_id),
        ]);

        if (shippingResult.status === "fulfilled") {
          const modes = (shippingResult.value.modes ?? []).map((mode) => String(mode).toLowerCase());
          shipping = { modes, option: shippingResult.value.option ?? null, mercadoEnviosEnabled: modes.includes("me2"), error: null };
        } else {
          shipping = {
            modes: [],
            option: null,
            mercadoEnviosEnabled: false,
            error: errorMessage(shippingResult.reason, "Falha ao consultar preferências de envio."),
          };
        }

        sellerProfile = profileResult.status === "fulfilled"
          ? { ...parseMercadoLivreSellerProfile(profileResult.value), error: null }
          : { ...parseMercadoLivreSellerProfile(null), error: errorMessage(profileResult.reason, "Falha ao consultar o perfil do vendedor.") };

        if (addressResult.status === "fulfilled" && addressResult.value) {
          shippingAddress = addressResult.value;
        } else {
          shippingAddress = await getAddressSummaryFromLatestListing(empresaId)
            ?? (profileResult.status === "fulfilled"
              ? selectMercadoLivreShippingAddressSummary(profileResult.value, "seller_profile")
              : null);
          const message = "O Mercado Livre protegeu o endereço completo desta conta para este aplicativo. O frete continua sendo calculado com a origem configurada no Mercado Envios.";
          if (shippingAddress) shippingAddressNotice = message;
          else shippingAddressError = message;
        }
      } catch (accountError: unknown) {
        const message = errorMessage(accountError, "Falha ao consultar a conta Mercado Livre.");
        shipping = { modes: [], option: null, mercadoEnviosEnabled: false, error: message };
        sellerProfile = { ...parseMercadoLivreSellerProfile(null), error: message };
        shippingAddressError = message;
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
            defaultListingTypeId: data.default_listing_type_id || "gold_special",
            quantityPricingDefaultEnabled: Boolean(data.quantity_pricing_default_enabled),
            quantityPricingDefaultTiers: validateMercadoLivreQuantityTiers(data.quantity_pricing_default_tiers ?? []),
            shipping,
            shippingAddress,
            shippingAddressError,
            shippingAddressNotice,
            sellerProfile,
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

export async function PATCH(request: Request) {
  try {
    await requireConfigEdit();
    const empresaId = await requireEmpresaId();
    const body = await request.json().catch(() => null);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body?.defaultListingTypeId !== undefined) {
      const defaultListingTypeId = String(body.defaultListingTypeId).trim().toLowerCase();
      if (!new Set(["free", "gold_special", "gold_pro"]).has(defaultListingTypeId)) {
        return NextResponse.json({ error: "Tipo de publicação padrão inválido." }, { status: 400 });
      }
      updates.default_listing_type_id = defaultListingTypeId;
    }
    if (body?.quantityPricingDefaultEnabled !== undefined) {
      updates.quantity_pricing_default_enabled = Boolean(body.quantityPricingDefaultEnabled);
    }
    if (body?.quantityPricingDefaultTiers !== undefined) {
      updates.quantity_pricing_default_tiers = validateMercadoLivreQuantityTiers(body.quantityPricingDefaultTiers);
    }
    if (Object.keys(updates).length === 1) return NextResponse.json({ error: "Nenhuma preferência informada." }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("mercadolivre_account")
      .update(updates)
      .eq("empresa_id", empresaId)
      .select("default_listing_type_id, quantity_pricing_default_enabled, quantity_pricing_default_tiers")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Conecte uma conta Mercado Livre antes de definir o padrão." }, { status: 404 });

    return NextResponse.json({
      defaultListingTypeId: data.default_listing_type_id,
      quantityPricingDefaultEnabled: Boolean(data.quantity_pricing_default_enabled),
      quantityPricingDefaultTiers: validateMercadoLivreQuantityTiers(data.quantity_pricing_default_tiers ?? []),
    });
  } catch (error: any) {
    console.error("PATCH /api/config/integracoes/mercadolivre", error);
    return NextResponse.json(
      { error: error?.message || "Falha ao salvar o tipo de publicação padrão." },
      { status: errorStatus(error) },
    );
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function getAddressSummaryFromLatestListing(empresaId: number | string) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .select("raw_item")
    .eq("empresa_id", empresaId)
    .not("raw_item", "is", null)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) {
    console.warn("Falha ao obter localização aproximada dos anúncios Mercado Livre", error.message);
    return null;
  }

  for (const row of data ?? []) {
    const address = selectMercadoLivreShippingAddressSummary(row.raw_item, "listing");
    if (address) return address;
  }
  return null;
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

    await unregisterMercadoLivrePlatformAccount();

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
