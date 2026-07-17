import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buscarModoBaixaEstoqueOS,
  consumirEstoqueOS,
  mensagemEstoqueInsuficienteOS,
} from "@/lib/ordens/estoque-os";

type DBStatusOS =
  | "AGUARDANDO_CHECKLIST"
  | "ORCAMENTO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "SEM_COBRANCA"
  | "CONCLUIDO"
  | "CANCELADO";

type DBAprovacao = "PENDENTE" | "APROVADA" | "REPROVADA";

type Body = {
  status: DBStatusOS;
  semCobranca?: boolean;
  motivoSemCobranca?: string | null;
};

type ParamsId = { id: string };

export async function PUT(req: NextRequest, { params }: { params: Promise<ParamsId> }) {
  try {
    const { id } = await params;
    const osId = Number(id);

    if (!osId) {
      return NextResponse.json({ error: "ID invÃ¡lido" }, { status: 400 });
    }

    const body = (await req.json()) as Body;
    const status = body.status;
    const semCobranca = Boolean(body.semCobranca);
    const motivoSemCobranca = (body.motivoSemCobranca ?? "").trim() || null;

    if (!status) {
      return NextResponse.json({ error: "Status Ã© obrigatÃ³rio." }, { status: 400 });
    }

    // define statusaprovacao em funÃ§Ã£o do novo status
    if (status === "APROVACAO_ORCAMENTO") {
      const osRes = await supabaseAdmin
        .from("ordemservico")
        .select("id, clienteid, veiculoid")
        .eq("id", osId)
        .maybeSingle();

      if (osRes.error) throw osRes.error;
      if (!osRes.data?.id) {
        return NextResponse.json({ error: "OS nÃ£o encontrada." }, { status: 404 });
      }
      if (osRes.data.clienteid == null) {
        return NextResponse.json(
          { error: "Selecione um cliente antes de enviar a OS para aprovaÃ§Ã£o." },
          { status: 400 }
        );
      }
      if (osRes.data.veiculoid == null) {
        return NextResponse.json(
          { error: "Selecione um veículo antes de enviar a OS para aprovação." },
          { status: 400 }
        );
      }
    }

    let statusaprovacao: DBAprovacao | null = null;

    if (status === "ORCAMENTO_APROVADO") {
      statusaprovacao = "APROVADA";
    } else if (status === "ORCAMENTO_RECUSADO") {
      statusaprovacao = "REPROVADA";
    } else if (status === "ORCAMENTO" || status === "APROVACAO_ORCAMENTO" || status === "AGUARDANDO_CHECKLIST") {
      statusaprovacao = "PENDENTE";
    }

    const updateData: any = { status };

    if (statusaprovacao !== null) {
      updateData.statusaprovacao = statusaprovacao;
    }

    if (status === "EM_ANDAMENTO") {
      const modoBaixa = await buscarModoBaixaEstoqueOS();
      if (modoBaixa === "EXECUCAO") {
        const baixa = await consumirEstoqueOS(osId);
        if (!baixa.ok) {
          return NextResponse.json(
            {
              error: mensagemEstoqueInsuficienteOS(baixa.faltantes),
              itens: baixa.faltantes,
            },
            { status: 409 }
          );
        }
      }
    }

    // ðŸ‘‰ datasaida: quando a OS Ã© concluÃ­da (com ou sem cobranÃ§a)
    if (status === "CONCLUIDO" || status === "SEM_COBRANCA") {
      updateData.datasaida = new Date().toISOString();

      if (semCobranca || status === "SEM_COBRANCA") {
        updateData.motivo_sem_cobranca = motivoSemCobranca;
        updateData.status = "SEM_COBRANCA";
      }
    }

    const upd = await supabaseAdmin.from("ordemservico").update(updateData).eq("id", osId);

    if (upd.error) {
      // fallback caso coluna motivo_sem_cobranca ainda nÃ£o exista no banco
      if (semCobranca && upd.error.message?.includes("motivo_sem_cobranca")) {
        const fallbackData = { ...updateData };
        delete fallbackData.motivo_sem_cobranca;
        const upd2 = await supabaseAdmin.from("ordemservico").update(fallbackData).eq("id", osId);
        if (upd2.error) throw upd2.error;
      } else {
        throw upd.error;
      }
    }

    // opcional: marcar tokens da OS como "usados" quando aprovar/reprovar
    if (status === "ORCAMENTO_APROVADO" || status === "ORCAMENTO_RECUSADO") {
      const desiredAprov: DBAprovacao = status === "ORCAMENTO_APROVADO" ? "APROVADA" : "REPROVADA";

      const mark = await supabaseAdmin
        .from("osaprovacao")
        .update({
          usado_em: new Date().toISOString(),
          origem: "SISTEMA",
          resultado: desiredAprov,
        })
        .eq("ordemservicoid", osId)
        .is("usado_em", null);

      if (mark.error) {
        console.error("Falha ao marcar tokens de aprovaÃ§Ã£o como usados", mark.error);
      }
    }

    return NextResponse.json({ ok: true, status, statusaprovacao }, { status: 200 });
  } catch (err: any) {
    console.error("PUT /api/ordens/[id]/status", err);
    return NextResponse.json({ error: err?.message || "Falha ao atualizar status" }, { status: 500 });
  }
}
