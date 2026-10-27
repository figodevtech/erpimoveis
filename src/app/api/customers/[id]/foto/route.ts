export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireClientesCreate } from "@/app/api/_authz/perms";
import { recusaSeClienteDoSistema } from "@/lib/clientes/consumidor-final-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BUCKET = "cliente-images";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Params) {
  try {
    await requireClientesCreate();
    const { id: rawId } = await context.params;
    const clienteId = Number(rawId);
    if (!Number.isInteger(clienteId) || clienteId <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }
    const recusa = await recusaSeClienteDoSistema(clienteId);
    if (recusa) return recusa;

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione uma imagem." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Use uma imagem JPG, PNG ou WebP." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "A imagem deve ter no máximo 5 MB." }, { status: 400 });
    }

    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${clienteId}/perfil-${crypto.randomUUID()}.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const fotoUrl = publicData.publicUrl;
    const { data, error: updateError } = await supabaseAdmin
      .from("cliente")
      .update({ foto_url: fotoUrl, updatedat: new Date().toISOString() })
      .eq("id", clienteId)
      .select("id, foto_url")
      .maybeSingle();

    if (updateError || !data) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      if (updateError) throw updateError;
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao salvar foto do cliente." },
      { status: 500 }
    );
  }
}
