import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSAccess, requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";

type Params = { id: string };

function idValido(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSAccess();
    await requireOSEventosFinanceiros();
    const osId = idValido((await params).id);
    if (!osId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("*")
      .eq("ordemservicoid", osId)
      .order("data_evento", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;

    const usuarioIds = Array.from(new Set(
      (data ?? [])
        .map((evento: any) => String(evento.created_by ?? "").trim())
        .filter(Boolean),
    ));
    const usuarios = usuarioIds.length
      ? await supabaseAdmin
          .from("usuario")
          .select("id, nome, email")
          .in("id", usuarioIds)
      : { data: [], error: null };
    if (usuarios.error) throw usuarios.error;
    const usuariosPorId = new Map(
      (usuarios.data ?? []).map((usuario: any) => [String(usuario.id), {
        id: String(usuario.id),
        nome: String(usuario.nome || usuario.email || "Usuário"),
      }]),
    );
    const eventos = (data ?? []).map((evento: any) => ({
      ...evento,
      criado_por: evento.created_by
        ? usuariosPorId.get(String(evento.created_by)) ?? { id: String(evento.created_by), nome: "Usuário não identificado" }
        : null,
    }));

    const ativos = eventos.filter((evento: any) => evento.status !== "CANCELADO");
    const receita = ativos
      .filter((evento: any) => evento.natureza === "RECEITA")
      .reduce((soma: number, evento: any) => soma + Number(evento.valor ?? 0), 0);
    const despesa = ativos
      .filter((evento: any) => evento.natureza === "DESPESA")
      .reduce((soma: number, evento: any) => soma + Number(evento.valor ?? 0), 0);
    const somarPorTipo = (natureza: "RECEITA" | "DESPESA", origem: "PRODUTO" | "SERVICO") =>
      ativos
        .filter((evento: any) => evento.natureza === natureza && evento.origem === origem)
        .reduce((soma: number, evento: any) => soma + Number(evento.valor ?? 0), 0);

    return NextResponse.json({
      eventos,
      totais: {
        receita,
        despesa,
        liquido: receita - despesa,
        receitaProdutos: somarPorTipo("RECEITA", "PRODUTO"),
        receitaServicos: somarPorTipo("RECEITA", "SERVICO"),
        despesaProdutos: somarPorTipo("DESPESA", "PRODUTO"),
        despesaServicos: somarPorTipo("DESPESA", "SERVICO"),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao carregar eventos financeiros." }, { status: error?.statusCode || 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();
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
    const eventoReceitaServicoInformado = body?.eventoReceitaServicoId != null;
    const eventoReceitaServicoId = Number(body?.eventoReceitaServicoId);
    const tipoEvento = String(body?.tipo ?? "").toUpperCase();
    if (!['RECEITA', 'DESPESA'].includes(natureza)) {
      return NextResponse.json({ error: "Informe se o evento é uma receita ou despesa." }, { status: 400 });
    }
    if (!descricao) return NextResponse.json({ error: "A descrição é obrigatória." }, { status: 400 });
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "O valor deve ser maior que zero." }, { status: 400 });
    }
    if (
      eventoReceitaServicoInformado
      && (!Number.isInteger(eventoReceitaServicoId) || eventoReceitaServicoId <= 0)
    ) {
      return NextResponse.json({ error: "A receita de serviço informada é inválida." }, { status: 400 });
    }
    if (!eventoReceitaServicoInformado && !["PRODUTO", "SERVICO"].includes(tipoEvento)) {
      return NextResponse.json({ error: "Informe se o lançamento é de Produto ou Serviço." }, { status: 400 });
    }

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;

    if (eventoReceitaServicoInformado) {
      if (natureza !== "DESPESA") {
        return NextResponse.json({ error: "Um evento vinculado à receita de serviço deve ser uma despesa." }, { status: 400 });
      }

      const { data: receitaServico, error: receitaServicoError } = await supabaseAdmin
        .from("eventos_financeiros")
        .select("id, servicoid, descricao, valor, status")
        .eq("id", eventoReceitaServicoId)
        .eq("ordemservicoid", osId)
        .eq("origem", "SERVICO")
        .eq("natureza", "RECEITA")
        .maybeSingle();
      if (receitaServicoError) throw receitaServicoError;
      if (!receitaServico || !receitaServico.servicoid) {
        return NextResponse.json({ error: "A receita de serviço não foi encontrada nesta OS." }, { status: 404 });
      }
      if (receitaServico.status !== "ATIVO") {
        return NextResponse.json({ error: "A receita de serviço não está ativa." }, { status: 409 });
      }

      const criadoEm = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from("eventos_financeiros")
        .insert({
          ordemservicoid: osId,
          source_type: "ORDEM_SERVICO",
          source_id: osId,
          source_item_id: receitaServico.servicoid,
          origem: "SERVICO",
          natureza: "DESPESA",
          natureza_dre: "CUSTO",
          chave_origem: `MANUAL:${randomUUID()}`,
          descricao,
          detalhe: detalhe || `Vinculada a ${receitaServico.descricao}`,
          valor: Math.round(valor * 100) / 100,
          servicoid: receitaServico.servicoid,
          is_manual: true,
          pode_gerar_transacao: true,
          dados_snapshot: {
            despesa_servico_manual: true,
            evento_receita_origem_id: receitaServico.id,
            receita_servico_valor: Number(receitaServico.valor ?? 0),
            criado_em: criadoEm,
          },
          created_by: usuarioId,
        })
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ evento: data }, { status: 201 });
    }

    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .insert({
        ordemservicoid: osId,
        source_type: "ORDEM_SERVICO",
        source_id: osId,
        origem: tipoEvento,
        natureza,
        natureza_dre: natureza === "RECEITA" ? "RECEITA" : "CUSTO",
        chave_origem: `MANUAL:${randomUUID()}`,
        descricao,
        detalhe,
        valor: Math.round(valor * 100) / 100,
        is_manual: true,
        pode_gerar_transacao: true,
        dados_snapshot: {
          lancamento_avulso_manual: true,
          tipo_informado: tipoEvento,
        },
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
