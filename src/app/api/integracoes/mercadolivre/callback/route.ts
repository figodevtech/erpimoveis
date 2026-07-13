import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  decodeMercadoLivreState,
  exchangeMercadoLivreCode,
  getMercadoLivreConfig,
  getMercadoLivreMe,
  tokenExpiresAt,
} from "@/lib/integrations/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const error = req.nextUrl.searchParams.get("error");
    if (error) {
      const description = req.nextUrl.searchParams.get("error_description") || error;
      return htmlResponse("Mercado Livre", `Autorizacao recusada: ${description}`, 400);
    }

    const code = req.nextUrl.searchParams.get("code");
    if (!code) return htmlResponse("Mercado Livre", "Codigo de autorizacao ausente.", 400);

    const state = decodeMercadoLivreState(req.nextUrl.searchParams.get("state"));
    if (!state?.empresaId) return htmlResponse("Mercado Livre", "Estado OAuth inválido ou expirado. Inicie a conexão novamente pelo ERP.", 400);
    const empresaId = state.empresaId;

    const token = await exchangeMercadoLivreCode(code);
    const user = await getMercadoLivreMe(token.access_token);
    const config = getMercadoLivreConfig();
    const existingAccount = await getExistingAccount(empresaId);
    const accountChanged = Boolean(existingAccount && Number(existingAccount.ml_user_id) !== Number(user.id));

    const { error: upsertError } = await supabaseAdmin
      .from("mercadolivre_account")
      .upsert(
        {
          empresa_id: empresaId,
          ml_user_id: user.id,
          nickname: user.nickname ?? null,
          site_id: user.site_id ?? config.siteId,
          access_token: token.access_token,
          refresh_token: token.refresh_token ?? (accountChanged ? null : existingAccount?.refresh_token) ?? null,
          token_type: token.token_type ?? null,
          scope: token.scope ?? null,
          expires_at: tokenExpiresAt(token.expires_in),
          raw_token: token,
          raw_user: user,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id" }
      );

    if (upsertError) throw upsertError;
    if (accountChanged && existingAccount) {
      await prepareAccountReplacement(empresaId, Number(existingAccount.id));
    }

    return htmlResponse(
      "Mercado Livre conectado",
      `Conta ${user.nickname || user.id} vinculada com sucesso a empresa ${empresaId}.`
    );
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/callback", e);
    return htmlResponse("Mercado Livre", e?.message || "Falha ao concluir autorizacao.", 500);
  }
}

async function getExistingAccount(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("mercadolivre_account")
    .select("id, ml_user_id, refresh_token")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function prepareAccountReplacement(empresaId: number, accountId: number) {
  for (const table of ["mercadolivre_order", "mercadolivre_notification", "mercadolivre_claim"]) {
    const { error } = await supabaseAdmin.from(table).update({ account_id: null }).eq("account_id", accountId);
    if (error) throw error;
  }

  const { error: linksError } = await supabaseAdmin
    .from("mercadolivre_product_link")
    .delete()
    .eq("empresa_id", empresaId);
  if (linksError) throw linksError;
}

function htmlResponse(title: string, message: string, status = 200) {
  return new NextResponse(
    `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; color: #111827; }
      main { max-width: 680px; }
      h1 { font-size: 24px; margin-bottom: 12px; }
      p { font-size: 16px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char] || char;
  });
}
