import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentUserAccess } from "@/app/api/_authz/perms";
import { permissionSetHas, type Permission } from "@/app/api/_authz/permission-constants";

export const db = supabaseAdmin;
export class ImobError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export type ImobContext = { params: Promise<{ path?: string[] }> };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function imobFailure(error: unknown) {
  if (error instanceof ImobError) return json({ error: error.message, ...error.extra }, error.status);
  if (error instanceof ZodError) return json({ error: "Confira os dados informados.", campos: error.flatten().fieldErrors }, 400);
  const e = error as { code?: string; message?: string };
  if (e.code === "23P01") return json({ error: "O imóvel já está ocupado ou bloqueado nesse período. Atualize a disponibilidade." }, 409);
  if (e.code === "23505") return json({ error: "Já existe um registro com esses dados." }, 409);
  if (["23503", "23514", "22023", "22P02"].includes(e.code ?? "")) return json({ error: e.code === "23503" ? "O registro está vinculado a outros dados ou a referência informada não existe." : e.message ?? "Dados inválidos." }, 400);
  if (e.code === "P0002") return json({ error: "Registro não encontrado." }, 404);
  if (e.code === "42501") return json({ error: "Você não tem autorização para esta operação." }, 403);
  if (e.code === "P0001") return json({ error: e.message ?? "A operação não pode ser realizada." }, 409);
  console.error("[imobiliario]", error);
  return json({ error: "Não foi possível concluir a operação imobiliária." }, 500);
}

export async function internal(permission: string) {
  const access = await getCurrentUserAccess();
  if (!access?.ativo) throw new ImobError(401, "Entre no ERP para continuar.");
  if (!permissionSetHas(access.permissoes, permission as Permission)) throw new ImobError(403, "Você não tem permissão para esta operação.");
  return access;
}

export async function internalAny(permissions: string[]) {
  const access = await getCurrentUserAccess();
  if (!access?.ativo) throw new ImobError(401, "Entre no ERP para continuar.");
  if (!permissions.some((p) => permissionSetHas(access.permissoes, p as Permission))) throw new ImobError(403, "Você não tem permissão para esta operação.");
  return access;
}

export function identifier(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ImobError(400, "Identificador inválido.");
  return n;
}

export function pagination(url: URL) {
  const page = Math.max(1, Math.min(100000, Number(url.searchParams.get("page") ?? url.searchParams.get("pagina") ?? 1) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? 20) || 20));
  return { page: Math.floor(page), pageSize: Math.floor(pageSize), from: (Math.floor(page) - 1) * Math.floor(pageSize), to: Math.floor(page) * Math.floor(pageSize) - 1 };
}

export async function bodyOf(request: Request): Promise<Record<string, any>> {
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ImobError(400, "Informe um objeto JSON válido.");
  return data;
}

export async function one(table: string, id: number, select = "*") {
  const { data, error } = await db.from(table).select(select).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ImobError(404, "Registro não encontrado.");
  return data as unknown as Record<string, any>;
}

export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

export function filterText(value: string | null) { return (value ?? "").trim().slice(0, 200).replace(/[%,()]/g, " "); }

export async function verifiedIdentity(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new ImobError(401, "Entre na sua conta para continuar.");
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user || !data.user.email_confirmed_at) throw new ImobError(401, "Confirme seu e-mail e entre na sua conta.");
  return data.user;
}

export async function external(request: Request, type?: "CLIENTE" | "PROPRIETARIO") {
  const user = await verifiedIdentity(request);
  const { data, error } = await db.from("site_usuario").select("*").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "ATIVO" || (type && data.tipo !== type)) throw new ImobError(403, "Esta conta não possui acesso a esta área.");
  return { user, account: data as Record<string, any> };
}
