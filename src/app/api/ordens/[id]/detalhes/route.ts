import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { resolveOrdemVehicle } from "@/lib/ordens/vehicle-snapshot";

// Tipagem compatível com Next 15 (params é Promise)
type RouteCtx = { params: Promise<{ id: string }> };

// helper: quando o Supabase devolver array acidental, normaliza para 1 registro
function one<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const osId = Number(id);
    if (!Number.isFinite(osId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("ordemservico")
      .select(`
        id,
        descricao,
        status,
        statusaprovacao,
        dataentrada,
        datasaida,
        pagamento_concluido_em,
        finalizado_em,
        orcamentototal,
        destacada,
        destaque_motivo,
        destaque_cor,
        destacada_por,
        destacada_em,
        observacoes,
        updatedat,
        migracao_referencia,
        veiculo_snapshot,
        cliente:clienteid ( id, nomerazaosocial ),
        veiculo:veiculoid ( id, placa, modelo, marca, ano, cor, kmatual, chassi ),
        setor:setorid ( id, nome ),
        checklist:checklist ( id, item, status, observacao, createdat )
      `)
      .eq("id", osId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "OS não encontrada" }, { status: 404 });

    const cliente = one<any>((data as any).cliente);
    const veiculo = resolveOrdemVehicle(
      one<any>((data as any).veiculo),
      (data as any).veiculo_snapshot,
    );
    const setor = one<any>((data as any).setor);
    const checklist = Array.isArray((data as any).checklist) ? (data as any).checklist : [];

    return NextResponse.json(
      {
        id: data.id,
        descricao: data.descricao,
        status: data.status,
        statusaprovacao: data.statusaprovacao,
        dataentrada: data.dataentrada,
        datasaida: data.datasaida,
        pagamento_concluido_em: (data as any).pagamento_concluido_em ?? null,
        finalizado_em: (data as any).finalizado_em ?? null,
        orcamentototal: data.orcamentototal,
        destacada: data.destacada === true,
        destaque_motivo: data.destaque_motivo ?? null,
        destaque_cor: (data as any).destaque_cor ?? "vermelho",
        destacada_por: data.destacada_por ?? null,
        destacada_em: data.destacada_em ?? null,
        observacoes: data.observacoes,
        updatedat: data.updatedat,
        migracaoReferencia: (data as any).migracao_referencia ?? null,
        veiculo_snapshot: (data as any).veiculo_snapshot ?? null,
        cliente: cliente ? { id: cliente.id, nomerazaosocial: cliente.nomerazaosocial } : null,
        veiculo: veiculo
          ? {
              id: veiculo.id,
              placa: veiculo.placa,
              modelo: veiculo.modelo,
              marca: veiculo.marca,
              ano: veiculo.ano,
              cor: veiculo.cor,
              kmatual: veiculo.kmatual,
              chassi: veiculo.chassi,
            }
          : null,
        setor: setor ? { id: setor.id, nome: setor.nome } : null,
        checklist,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[GET] /api/ordens/[id]/detalhes", err);
    return NextResponse.json({ error: "Falha ao carregar detalhes" }, { status: 500 });
  }
}
