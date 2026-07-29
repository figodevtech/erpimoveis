// app/api/veiculos/[id]/transferencia/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireVeiculosEdit } from "@/app/api/_authz/perms";

type Body = {
  novoDonoId: number; // cliente.id
};

function toPositiveInt(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
try {
    await requireVeiculosEdit();
    const { id } = await context.params;           // ✅ aqui é o ponto
    const veiculoId = toPositiveInt(id);

  console.log(veiculoId)
    if (!veiculoId) {
      return NextResponse.json(
        { error: "Parâmetro 'id' inválido." },
        { status: 400 }
      );
    }

    const body = (await req.json()) as Partial<Body>;
    const novoDonoId = toPositiveInt(body.novoDonoId);

    if (!novoDonoId) {
      return NextResponse.json(
        { error: "Campo 'novoDonoId' inválido." },
        { status: 400 }
      );
    }

    const session = await auth();
    const createdBy = session?.user?.id || null;

    const { data: veiculo, error: veiculoErr } = await supabase
      .from("veiculo")
      .select("id, clienteid")
      .eq("id", veiculoId)
      .single();

    if (veiculoErr || !veiculo) {
      return NextResponse.json(
        { error: "Veículo não encontrado.", details: veiculoErr?.message },
        { status: 404 }
      );
    }

    const donoAnterior = veiculo.clienteid as number;

    if (donoAnterior === novoDonoId) {
      return NextResponse.json(
        { error: "O novo dono é igual ao dono atual." },
        { status: 400 }
      );
    }

    const { error: updateErr } = await supabase
      .from("veiculo")
      .update({
        clienteid: novoDonoId,
        updatedat: new Date().toISOString(),
      })
      .eq("id", veiculoId);

    if (updateErr) {
      return NextResponse.json(
        { error: "Falha ao atualizar dono do veículo.", details: updateErr.message },
        { status: 500 }
      );
    }

    const { data: transferencia, error: insertErr } = await supabase
      .from("transferencias_veiculos")
      .insert({
        veiculo_id: veiculoId,
        dono_anteior: donoAnterior, // mantendo como está no schema
        novo_dono: novoDonoId,
        created_by: createdBy,
      })
      .select("*")
      .single();

    if (insertErr) {
      await supabase
        .from("veiculo")
        .update({ clienteid: donoAnterior, updatedat: new Date().toISOString() })
        .eq("id", veiculoId);

      return NextResponse.json(
        {
          error: "Falha ao registrar transferência. Alteração revertida.",
          details: insertErr.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, veiculoId, donoAnterior, novoDono: novoDonoId, transferencia },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "Erro inesperado.", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
