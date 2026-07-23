import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSAccess, requireOSEdit } from "@/app/api/_authz/perms";

type Params = { id: string };

function idValido(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSAccess();
    const osId = idValido((await params).id);
    if (!osId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("*")
      .eq("ordemservicoid", osId)
      .order("data_evento", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;

    const ativos = (data ?? []).filter((evento: any) => evento.status !== "CANCELADO");
    const receita = ativos
      .filter((evento: any) => evento.natureza === "RECEITA")
      .reduce((soma: number, evento: any) => soma + Number(evento.valor ?? 0), 0);
    const despesa = ativos
      .filter((evento: any) => evento.natureza === "DESPESA")
      .reduce((soma: number, evento: any) => soma + Number(evento.valor ?? 0), 0);

    return NextResponse.json({ eventos: data ?? [], totais: { receita, despesa, liquido: receita - despesa } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao carregar eventos financeiros." }, { status: error?.statusCode || 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    const osId = idValido((await params).id);
    if (!osId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    const { data: os, error: osError } = await supabaseAdmin
      .from("ordemservico")
      .select("id, status")
      .eq("id", osId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (osError) throw osError;
    if (!os) return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    if (["CONCLUIDO", "SEM_COBRANCA", "CANCELADO"].includes(String(os.status))) {
      return NextResponse.json({ error: "Não é possível inserir eventos financeiros em uma OS finalizada." }, { status: 409 });
    }

    const body = await req.json();
    const natureza = String(body?.natureza ?? "").toUpperCase();
    const descricao = String(body?.descricao ?? "").trim();
    const detalhe = String(body?.detalhe ?? "").trim() || null;
    const valor = Number(body?.valor);
    if (!['RECEITA', 'DESPESA'].includes(natureza)) {
      return NextResponse.json({ error: "Informe se o evento é uma receita ou despesa." }, { status: 400 });
    }
    if (!descricao) return NextResponse.json({ error: "A descrição é obrigatória." }, { status: 400 });
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "O valor deve ser maior que zero." }, { status: 400 });
    }

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .insert({
        ordemservicoid: osId,
        origem: "AVULSO",
        natureza,
        descricao,
        detalhe,
        valor: Math.round(valor * 100) / 100,
        pode_gerar_transacao: true,
        created_by: usuarioId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ evento: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao criar evento financeiro." }, { status: error?.statusCode || 500 });
  }
}
