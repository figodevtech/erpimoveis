import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticated, requireOSAccess, requireOSEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { platformConfiguration } from "@/lib/platform-billing/client";
export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({ action: z.enum(["reserve", "complete", "cancel", "access", "delete"]), id: z.string().uuid(),
  osId: z.number().int().positive(), itemId: z.number().int().positive(), kind: z.enum(["entrada", "saida"]),
  name: z.string().max(160).optional(), size: z.number().int().positive().max(250000000).optional(), download: z.boolean().optional() });
async function central(path: string, body?: unknown) {
  const config = platformConfiguration();
  if (!config.configured) throw new Error("Serviço de vídeos ainda não configurado.");
  const response = await fetch(`${config.url}/api/v1/videos${path}`, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Installation-Id": config.installationId!, Authorization: `Bearer ${config.secret}` },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(55000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Central indisponível."), { code: data.code });
  return data;
}
async function administrator(userId: string) {
  const user = await supabaseAdmin.from("usuario").select("ativo,perfil:perfilid(nome)").eq("id", userId).single();
  const profile = Array.isArray(user.data?.perfil) ? user.data?.perfil[0] : user.data?.perfil;
  return !user.error && user.data?.ativo !== false && profile?.nome?.toUpperCase() === "ADMINISTRADOR";
}
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthenticated(); await requireOSAccess();
    const id = z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get("osId"));
    const os = await supabaseAdmin.from("ordemservico").select("id").eq("id", id).maybeSingle();
    if (os.error || !os.data) throw new Error("OS não encontrada.");
    return NextResponse.json({ ...await central(`?osId=${id}`), canDelete: await administrator(session.user.id!) });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthenticated(); await requireOSAccess();
    const body = schema.parse(await req.json());
    if (body.action !== "access") await requireOSEdit();
    if (body.action === "delete" && !await administrator(session.user.id!)) return NextResponse.json({ error: "Somente administradores podem excluir vídeos." }, { status: 403 });
    let owner: number | undefined;
    if (body.kind === "entrada") {
      const item = await supabaseAdmin.from("checklist").select("ordemservicoid").eq("id", body.itemId).single();
      owner = item.data?.ordemservicoid;
    } else {
      const item = await supabaseAdmin.from("os_saida_checklist_item").select("os_saida_id").eq("id", body.itemId).single();
      if (item.data) {
        const exit = await supabaseAdmin.from("os_saida").select("ordemservico_id").eq("id", item.data.os_saida_id).single();
        owner = exit.data?.ordemservico_id;
      }
    }
    if (Number(owner) !== body.osId) return NextResponse.json({ error: "Item não pertence à OS." }, { status: 404 });
    const data = await central("", { ...body, actor: session.user.id });
    if (body.action === "complete") {
      const link = await supabaseAdmin.from("checklist_video").upsert({ id: body.id, ordemservicoid: body.osId, kind: body.kind, item_id: body.itemId, created_by: session.user.id }, { onConflict: "id", ignoreDuplicates: true });
      if (link.error) throw new Error("Vídeo enviado; falha ao vincular. Tente concluir novamente.");
    }
    return NextResponse.json(data);
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  const code = error instanceof Error && "code" in error && error.code === "UPLOAD_REJECTED" ? "UPLOAD_REJECTED" : undefined;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível acessar os vídeos.", code }, { status: 400 });
}
