export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { checklistPublicIdValido } from "@/lib/ordens/checklist-documento";
import { conteudoHash, snapshotHash } from "@/lib/ordens/checklist-documento-hash";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!checklistPublicIdValido(token)) {
    return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  }
  const result = await supabaseAdmin
    .from("checklist_documento")
    .select("id,codigo,ordemservico_id,tipo,versao,criado_em,snapshot,snapshot_hash,conteudo_hash")
    .eq("token_verificacao", token)
    .maybeSingle();
  if (result.error) {
    console.error("GET verificar checklist", result.error);
    return NextResponse.json({ error: "Não foi possível verificar o documento." }, { status: 500 });
  }
  if (!result.data) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  const row = result.data as any;
  const [signature, file, newer] = await Promise.all([
    supabaseAdmin.from("checklist_documento_assinatura").select("assinado_em,metodo").eq("documento_id", row.id).maybeSingle(),
    supabaseAdmin.from("checklist_documento_arquivo").select("pdf_hash").eq("documento_id", row.id).maybeSingle(),
    supabaseAdmin
      .from("checklist_documento")
      .select("id", { count: "exact", head: true })
      .eq("ordemservico_id", row.ordemservico_id)
      .eq("tipo", row.tipo)
      .gt("versao", row.versao),
  ]);
  if (signature.error || file.error || newer.error) {
    console.error("GET verificar checklist metadata", signature.error || file.error || newer.error);
    return NextResponse.json({ error: "Não foi possível verificar o documento." }, { status: 500 });
  }
  const intact =
    snapshotHash(row.snapshot) === String(row.snapshot_hash) &&
    conteudoHash(row.snapshot) === String(row.conteudo_hash);
  return NextResponse.json({
    autentico: intact,
    empresa: String(row.snapshot?.empresa?.nome ?? "Empresa"),
    ordemServicoId: Number(row.ordemservico_id),
    tipo: String(row.tipo),
    versao: Number(row.versao),
    codigo: String(row.codigo),
    criadoEm: String(row.criado_em),
    assinadoEm: signature.data?.assinado_em ?? null,
    metodoAssinatura: signature.data?.metodo ?? null,
    snapshotHash: String(row.snapshot_hash),
    conteudoHash: String(row.conteudo_hash),
    pdfHash: file.data?.pdf_hash ?? null,
    pdfDisponivel: Boolean(file.data),
    possuiVersaoPosterior: Number(newer.count ?? 0) > 0,
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
