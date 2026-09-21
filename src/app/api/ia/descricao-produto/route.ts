import { NextResponse } from "next/server";
import { requireAuthenticated, requireAny, PERMS } from "@/app/api/_authz/perms";
import { errorStatus } from "@/lib/empresa-context";
import { descriptionInputSchema, readDescriptionBody } from "@/lib/ai/description-contract";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    const session = await requireAuthenticated();
    await requireAny([PERMS.ESTOQUE_CRIAR, PERMS.ESTOQUE_EDITAR]);
    const url = process.env.PLATFORM_API_URL?.trim().replace(/\/$/, "");
    const installationId = process.env.PLATFORM_INSTALLATION_ID?.trim();
    const secret = process.env.PLATFORM_API_SECRET?.trim();
    if (!url || !installationId || !secret) return json({ error: "Configure a conexão desta instalação com a Central para usar a IA." }, 503);
    const input = descriptionInputSchema.safeParse(await readDescriptionBody(req));
    if (!input.success) return json({ error: "Informe um título de 3 a 200 caracteres e revise os dados do produto." }, 400);
    const response = await fetch(`${url}/api/v1/ia/descricao-produto`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, "X-Installation-Id": installationId },
      body: JSON.stringify({ ...input.data, usuarioId: (session.user as { id?: string }).id }),
      signal: AbortSignal.timeout(45000), cache: "no-store", redirect: "error",
    });
    const result = await response.json();
    if (!response.ok) return json({ error: typeof result?.error === "string" ? result.error : "A Central não conseguiu gerar a descrição." }, response.status);
    if (typeof result?.descricao !== "string" || !result.descricao.trim() || result.descricao.length > 300) throw new Error("invalid_response");
    return json({ descricao: result.descricao });
  } catch (error) {
    const status = errorStatus(error);
    return json({ error: status === 401 ? "Entre no sistema para usar a IA." : status === 403
      ? "Você não tem permissão para criar ou editar produtos." : status === 413 ? "Dados do produto excedem o limite permitido."
      : status === 400 ? "Dados do produto inválidos." : "Não foi possível consultar a IA na Central. Tente novamente mais tarde." }, status === 500 ? 502 : status);
  }
}
