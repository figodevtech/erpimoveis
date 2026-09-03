import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSAccess, requireOSEdit, requireOSEventosFinanceiros } from "@/app/api/_authz/perms";
import { somarEventosDaOs } from "@/lib/ordens/eventos-financeiros";
import { bloqueioDeStatusParaEventos } from "./_lib/status-os";

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

    // A conta vem de `@/lib/ordens/eventos-financeiros`, a mesma que a relação
    // de ordens impressa usa. `liquido` fica com o nome antigo porque é o que a
    // tela já consome; na lib ele se chama `lucroReal`.
    const { lucroReal, ...totais } = somarEventosDaOs(eventos as any);

    return NextResponse.json({ eventos, totais: { ...totais, liquido: lucroReal } });
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
    const body = await req.json();
    const natureza = String(body?.natureza ?? "").toUpperCase();

    // OS concluída e sem cobrança seguem aceitando lançamento: despesa que
    // chega depois do fechamento é caso comum, e o evento nasce com a
    // competência da execução, recalculando a DRE daquele mês.
    const bloqueio = bloqueioDeStatusParaEventos(os.status, { natureza });
    if (bloqueio) return NextResponse.json({ error: bloqueio }, { status: 409 });
    const descricao = String(body?.descricao ?? "").trim();
    const detalhe = String(body?.detalhe ?? "").trim() || null;
    const valor = Number(body?.valor);
    const eventoReceitaInformado = body?.eventoReceitaId != null;
    const eventoReceitaServicoLegadoInformado = body?.eventoReceitaServicoId != null;
    if (eventoReceitaInformado && eventoReceitaServicoLegadoInformado) {
      return NextResponse.json(
        { error: "Informe somente um vínculo de receita para esta despesa." },
        { status: 400 },
      );
    }
    const eventoReceitaVinculado = eventoReceitaInformado || eventoReceitaServicoLegadoInformado;
    const eventoReceitaId = Number(
      eventoReceitaInformado ? body?.eventoReceitaId : body?.eventoReceitaServicoId,
    );
    const tipoEvento = String(body?.tipo ?? "").toUpperCase();
    if (!['RECEITA', 'DESPESA'].includes(natureza)) {
      return NextResponse.json({ error: "Informe se o evento é uma receita ou despesa." }, { status: 400 });
    }
    if (!descricao) return NextResponse.json({ error: "A descrição é obrigatória." }, { status: 400 });
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "O valor deve ser maior que zero." }, { status: 400 });
    }
    if (
      eventoReceitaVinculado
      && (!Number.isInteger(eventoReceitaId) || eventoReceitaId <= 0)
    ) {
      return NextResponse.json({ error: "A receita informada é inválida." }, { status: 400 });
    }
    // CONSUMO é o material gasto na OS sem repasse ao cliente. Aqui ele entra
    // sem passar pelo estoque — a fita comprada na hora para esta ordem. O
    // caminho com baixa é `/consumo-estoque`, que além do evento cria a saída.
    if (!eventoReceitaVinculado && !["PRODUTO", "SERVICO", "CONSUMO"].includes(tipoEvento)) {
      return NextResponse.json({ error: "Informe se o lançamento é de Produto, Serviço ou Consumo." }, { status: 400 });
    }
    // Só existe `CONSUMO:DESPESA` na DRE (linha 4.4, Materiais aplicados).
    // Uma receita de consumo não teria para onde ir e ficaria em pendência.
    if (tipoEvento === "CONSUMO" && natureza !== "DESPESA") {
      return NextResponse.json({ error: "Um lançamento de consumo é sempre uma despesa." }, { status: 400 });
    }

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;

    if (eventoReceitaVinculado) {
      if (natureza !== "DESPESA") {
        return NextResponse.json({ error: "Um evento vinculado a uma receita deve ser uma despesa." }, { status: 400 });
      }

      const { data: receitaOrigem, error: receitaOrigemError } = await supabaseAdmin
        .from("eventos_financeiros")
        .select("id, origem, natureza, servicoid, descricao, valor, status")
        .eq("id", eventoReceitaId)
        .eq("ordemservicoid", osId)
        .maybeSingle();
      if (receitaOrigemError) throw receitaOrigemError;
      if (!receitaOrigem) {
        return NextResponse.json({ error: "A receita não foi encontrada nesta OS." }, { status: 404 });
      }
      if (receitaOrigem.natureza !== "RECEITA" || !["SERVICO", "FRETE"].includes(receitaOrigem.origem)) {
        return NextResponse.json(
          { error: "Somente receitas de serviço ou frete podem receber uma despesa vinculada." },
          { status: 400 },
        );
      }
      if (receitaOrigem.origem === "SERVICO" && !receitaOrigem.servicoid) {
        return NextResponse.json({ error: "A receita de serviço não possui um serviço vinculado." }, { status: 409 });
      }
      if (receitaOrigem.status !== "ATIVO") {
        return NextResponse.json({ error: "A receita informada não está ativa." }, { status: 409 });
      }

      const criadoEm = new Date().toISOString();
      const despesaDeFrete = receitaOrigem.origem === "FRETE";
      const { data, error } = await supabaseAdmin
        .from("eventos_financeiros")
        .insert({
          ordemservicoid: osId,
          source_type: "ORDEM_SERVICO",
          source_id: osId,
          source_item_id: despesaDeFrete ? receitaOrigem.id : receitaOrigem.servicoid,
          origem: receitaOrigem.origem,
          natureza: "DESPESA",
          natureza_dre: "CUSTO",
          chave_origem: `MANUAL:${randomUUID()}`,
          descricao,
          detalhe: detalhe || `Vinculada a ${receitaOrigem.descricao}`,
          valor: Math.round(valor * 100) / 100,
          servicoid: despesaDeFrete ? null : receitaOrigem.servicoid,
          is_manual: true,
          pode_gerar_transacao: true,
          dados_snapshot: {
            ...(despesaDeFrete
              ? {
                  despesa_frete_manual: true,
                  receita_frete_valor: Number(receitaOrigem.valor ?? 0),
                  dre_linha_codigo: "4.6",
                }
              : {
                  despesa_servico_manual: true,
                  receita_servico_valor: Number(receitaOrigem.valor ?? 0),
                }),
            evento_receita_origem_id: receitaOrigem.id,
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
          // Consumo lançado por aqui não tem saída de estoque atrás dele. A
          // marca separa os dois casos para quem lê o evento depois — o
          // estorno e o painel de impacto do cancelamento dependem disso.
          ...(tipoEvento === "CONSUMO" ? { consumo_de_estoque: false } : {}),
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
