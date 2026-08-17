export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";

import { hasRadiosAccess } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const patchSchema = z
  .object({
    radio: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

type PreferenceRow = {
  radio_habilitado: boolean;
};

async function getOwnUserId() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id?.trim();
  return userId || null;
}

function preferenceResponse(permitted: boolean, enabled: boolean) {
  return {
    data: {
      radio: {
        permitted,
        enabled,
        effective: permitted && enabled,
      },
    },
  };
}

export async function GET() {
  const userId = await getOwnUserId();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  try {
    const [{ data, error }, permitted] = await Promise.all([
      supabaseAdmin
        .from("usuario_preferencia")
        .select("radio_habilitado")
        .eq("usuario_id", userId)
        .maybeSingle<PreferenceRow>(),
      hasRadiosAccess(),
    ]);

    if (error) throw error;

    // Sem linha gravada, preservamos o comportamento anterior do sistema.
    const enabled = data?.radio_habilitado ?? true;
    return NextResponse.json(preferenceResponse(permitted, enabled), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[preferencias:get]", error);
    return NextResponse.json(
      { error: "Não foi possível carregar suas preferências." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const userId = await getOwnUserId();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: "Preferência inválida.",
        details: error instanceof z.ZodError ? error.flatten() : undefined,
      },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("usuario_preferencia")
      .upsert(
        {
          usuario_id: userId,
          radio_habilitado: parsed.radio.enabled,
        },
        { onConflict: "usuario_id" },
      )
      .select("radio_habilitado")
      .single<PreferenceRow>();

    if (error) throw error;

    const permitted = await hasRadiosAccess();
    return NextResponse.json(preferenceResponse(permitted, data.radio_habilitado), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[preferencias:patch]", error);
    return NextResponse.json(
      { error: "Não foi possível salvar sua preferência." },
      { status: 500 },
    );
  }
}
