import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticated, requireEstoqueAccess, requireEstoqueEdit, requireVendasAccess, requireVendasEdit, hasPerm, PERMS } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { platformConfiguration } from "@/lib/platform-billing/client";
export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({ action: z.enum(["reserve", "complete", "cancel", "access", "delete"]), id: z.string().uuid(),
  osId: z.number().int().positive(), itemId: z.number().int().positive(), kind: z.enum(["produto", "venda"]),
  name: z.string().max(160).optional(), size: z.number().int().positive().max(250000000).optional(), download: z.boolean().optional(), category: z.string().min(1).max(80).optional() });
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
    const session = await requireAuthenticated();
    const id = z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get("osId"));
    const scope = z.enum(["produto", "venda"]).parse(req.nextUrl.searchParams.get("scope"));
    await authorize(scope, id, false);
    const editPermission = scope === "produto" ? PERMS.ESTOQUE_EDITAR : PERMS.VENDAS_EDITAR;
    const listing = await central(`?osId=${id}&scope=${scope}`);
    if (scope === "venda") {
      const ids = (listing.items ?? []).map((item: { id: string }) => item.id);
      if (ids.length) {
        const links = await supabaseAdmin.from("entity_video").select("id,category").in("id", ids);
        if (links.error) throw new Error("Falha ao carregar categorias dos vídeos.");
        const categories = new Map((links.data ?? []).map(link => [link.id, link.category]));
        listing.items = listing.items.map((item: { id: string }) => ({ ...item, category: categories.get(item.id) ?? null }));
      }
    }
    return NextResponse.json({ ...listing, canEdit: await hasPerm(editPermission), canDelete: await administrator(session.user.id!) });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthenticated();
    const body = schema.parse(await req.json());
    await authorize(body.kind, body.osId, body.action !== "access");
    if (body.action === "delete" && !await administrator(session.user.id!)) return NextResponse.json({ error: "Somente administradores podem excluir vídeos." }, { status: 403 });
    if (body.itemId !== body.osId) return NextResponse.json({ error: "Item não pertence ao cadastro." }, { status: 404 });
    const data = await central("", { ...body, actor: session.user.id });
    if (body.action === "complete") {
      const column = body.kind === "produto" ? "produto_id" : "venda_id";
      const link = await supabaseAdmin.from("entity_video").upsert({ id: body.id, [column]: body.osId, category: body.category ?? null, created_by: session.user.id }, { onConflict: "id", ignoreDuplicates: true });
      if (link.error) throw new Error("Envio concluído; tente novamente para vincular o vídeo.");
    }
    if (body.action === "delete") {
      const removed = await supabaseAdmin.from("entity_video").delete().eq("id", body.id);
      if (removed.error) throw new Error("Vídeo excluído; tente novamente para remover o vínculo.");
    }
    return NextResponse.json(data);
  } catch (error) { return failure(error); }
}
async function authorize(kind: string, id: number, edit: boolean) {
  if (kind === "produto") { await requireEstoqueAccess(); if (edit) await requireEstoqueEdit(); }
  else { await requireVendasAccess(); if (edit) await requireVendasEdit(); }
  const table = kind === "produto" ? "produto" : "venda";
  const entity = await supabaseAdmin.from(table).select("id").eq("id", id).maybeSingle();
  if (entity.error) throw new Error("Falha ao consultar o cadastro.");
  if (!entity.data) throw Object.assign(new Error("Cadastro não encontrado."), { statusCode: 404 });
}
function failure(error: unknown) {
  const code = error instanceof Error && "code" in error && error.code === "UPLOAD_REJECTED" ? "UPLOAD_REJECTED" : undefined;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível acessar os vídeos.", code }, { status: error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 400 });
}
