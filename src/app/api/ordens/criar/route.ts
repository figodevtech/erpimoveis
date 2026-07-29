export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSCreate } from "@/app/api/_authz/perms";

type DBChecklistStatus = "OK" | "ALERTA" | "FALHA";
type DBAlvo = "VEICULO" | "PECA" | "EQUIPAMENTO";
type DBPrioridade = "BAIXA" | "NORMAL" | "ALTA";
type DBStatusOS = "AGUARDANDO_CHECKLIST" | "ORCAMENTO";

type PecaPayload = {
  nome: string;
  descricao?: string | null;
  lacre?: string | null;
};

type EquipamentoPayload = {
  nome?: string | null;
  ano?: number | null;
  patrimonio?: string | null;
  horimetro?: number | null;
};

type Payload = {
  setorid: number | null;
  veiculoid: number | null;
  descricao: string | null;
  observacoes: string | null;
  observacoes_fiscais?: string | null;
  status?: DBStatusOS | null;
  checklistTemplateId?: string | null;
  prioridade?: DBPrioridade;
  cliente?: { id?: number | null } | null;
  alvo?: {
    tipo: DBAlvo;
    equipamento?: EquipamentoPayload;
    veiculo?: {
      placa?: string | null;
      modelo?: string | null;
      marca?: string | null;
      ano?: number | null;
      cor?: string | null;
      kmatual?: number | null;
    };
    peca?: PecaPayload;
    pecas?: PecaPayload[];
  };
  checklist?: Array<{
    item: string;
    status?: DBChecklistStatus | string | null | undefined;
    observacao?: string | null;
  }>;
};

function normPrioridade(v: unknown): DBPrioridade {
  const t = String(v ?? "").trim().toUpperCase();
  return t === "BAIXA" || t === "ALTA" ? (t as DBPrioridade) : "NORMAL";
}

function normalizarPecas(alvo?: Payload["alvo"]): PecaPayload[] {
  const lista = Array.isArray(alvo?.pecas) && alvo.pecas.length > 0
    ? alvo.pecas
    : alvo?.peca
      ? [alvo.peca]
      : [];

  return lista
    .map((item) => ({
      nome: String(item?.nome || "").trim(),
      descricao: item?.descricao ? String(item.descricao).trim() : null,
      lacre: item?.lacre ? String(item.lacre).trim() : null,
    }))
    .filter((item) => item.nome);
}

export async function POST(req: NextRequest) {
  let createdVeiculoId: number | null = null;
  const createdPecaIds: number[] = [];
  const createdOsIds: number[] = [];

  try {
    await requireOSCreate();
    const session = await auth();
    const usuariocriadorid = (session?.user as any)?.id as string | undefined;
    if (!usuariocriadorid) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = (await req.json()) as any;

    if (!body?.setorid) {
      return NextResponse.json({ error: "setorid é obrigatório" }, { status: 400 });
    }

    if (
      body?.cliente != null &&
      (typeof body.cliente !== "object" || typeof body.cliente?.id !== "number")
    ) {
      return NextResponse.json(
        { error: "Cliente inválido. Envie cliente.id numérico ou cliente null." },
        { status: 400 }
      );
    }

    const payload = body as Payload;
    const setorid = Number(payload.setorid);
    const prioridade = normPrioridade(payload.prioridade);
    const status: DBStatusOS =
      payload.status === "ORCAMENTO" ? "ORCAMENTO" : "AGUARDANDO_CHECKLIST";
    const clienteid =
      typeof payload.cliente?.id === "number" ? Number(payload.cliente.id) : null;

    if (clienteid !== null) {
      const { data: cRow, error: cErr } = await supabaseAdmin
        .from("cliente")
        .select("id")
        .eq("id", clienteid)
        .maybeSingle();

      if (cErr) throw cErr;
      if (!cRow?.id) {
        return NextResponse.json({ error: "Cliente não encontrado." }, { status: 400 });
      }
    }

    let alvo_tipo: DBAlvo = "VEICULO";
    let veiculoid: number | null = payload?.veiculoid ? Number(payload.veiculoid) : null;
    let pecaid: number | null = null;
    let equipamentoNome: string | null = null;
    let equipamentoPatrimonio: string | null = null;
    let equipamentoAno: number | null = null;
    let equipamentoHorimetro: number | null = null;
    const alvo = payload?.alvo;

    if (!alvo) {
      if (!veiculoid) {
        return NextResponse.json(
          {
            error:
              "Informe o 'alvo' (VEICULO/PECA). Quando VEICULO, selecione um veículo ou informe placa, modelo e marca.",
          },
          { status: 400 }
        );
      }
      alvo_tipo = "VEICULO";
    } else if (alvo.tipo === "VEICULO") {
      alvo_tipo = "VEICULO";

      if (!veiculoid) {
        const placa = (alvo.veiculo?.placa || "").trim();
        const modelo = (alvo.veiculo?.modelo || "").trim() || "N/I";
        const marca = (alvo.veiculo?.marca || "").trim() || "N/I";
        const ano = alvo.veiculo?.ano ?? null;
        const cor = (alvo.veiculo?.cor || "").trim() || null;
        const kmatual = alvo.veiculo?.kmatual ?? null;

        if (placa) {
          const { data: vNew, error: eVNew } = await supabaseAdmin
            .from("veiculo")
            .insert({
              clienteid,
              placa,
              modelo,
              marca,
              ano,
              cor,
              kmatual,
            })
            .select("id")
            .single();

          if (eVNew) throw eVNew;

          veiculoid = Number(vNew.id);
          createdVeiculoId = Number(vNew.id);
        } else {
          veiculoid = null;
        }
      }

      pecaid = null;
      equipamentoNome = null;
    } else if (alvo.tipo === "PECA") {
      alvo_tipo = "PECA";

      const pecas = normalizarPecas(alvo);
      if (pecas.length === 0) {
        return NextResponse.json(
          { error: "Para alvo PEÇA, informe ao menos uma peça." },
          { status: 400 }
        );
      }

      for (const pecaItem of pecas) {
        const { data: pNew, error: eP } = await supabaseAdmin
          .from("peca")
          .insert({
            clienteid,
            veiculoid: veiculoid || null,
            titulo: pecaItem.nome,
            descricao: pecaItem.descricao,
            lacre: pecaItem.lacre,
          })
          .select("id")
          .single();

        if (eP) throw eP;

        const pecaIdAtual = Number(pNew.id);
        createdPecaIds.push(pecaIdAtual);

        const { data: osPeca, error: eOSPeca } = await supabaseAdmin
          .from("ordemservico")
          .insert({
            clienteid,
            veiculoid,
            pecaid: pecaIdAtual,
            alvo_tipo,
            usuariocriadorid,
            setorid,
            prioridade,
            descricao: payload.descricao || null,
            observacoes: payload.observacoes || null,
            observacoes_fiscais: payload.observacoes_fiscais || null,
            status,
          })
          .select("id")
          .single();

        if (eOSPeca) throw eOSPeca;

        createdOsIds.push(Number(osPeca.id));
      }

      return NextResponse.json(
        {
          id: createdOsIds[0] ?? null,
          ids: createdOsIds,
          totalCriadas: createdOsIds.length,
        },
        { status: 201 }
      );
    } else if (alvo.tipo === "EQUIPAMENTO") {
      alvo_tipo = "EQUIPAMENTO";
      veiculoid = null;
      pecaid = null;
      const equipamento = alvo.equipamento;
      equipamentoNome = String(equipamento?.nome ?? "").trim();
      equipamentoPatrimonio = String(equipamento?.patrimonio ?? "").trim() || null;
      equipamentoAno =
        equipamento?.ano === null || equipamento?.ano === undefined
          ? null
          : Number(equipamento.ano);
      equipamentoHorimetro =
        equipamento?.horimetro === null || equipamento?.horimetro === undefined
          ? null
          : Number(equipamento.horimetro);

      if (!equipamentoNome) {
        return NextResponse.json(
          { error: "Informe o nome da máquina ou equipamento." },
          { status: 400 },
        );
      }
      if (
        equipamentoAno !== null &&
        (!Number.isInteger(equipamentoAno) || equipamentoAno < 1900 || equipamentoAno > 3000)
      ) {
        return NextResponse.json({ error: "Ano do equipamento inválido." }, { status: 400 });
      }
      if (
        equipamentoHorimetro !== null &&
        (!Number.isFinite(equipamentoHorimetro) || equipamentoHorimetro < 0)
      ) {
        return NextResponse.json({ error: "Horímetro inválido." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "alvo.tipo inválido" }, { status: 400 });
    }

    const { data: os, error: eOS } = await supabaseAdmin
      .from("ordemservico")
      .insert({
        clienteid,
        veiculoid,
        pecaid,
        equipamento_nome: equipamentoNome,
        equipamento_patrimonio: equipamentoPatrimonio,
        equipamento_ano: equipamentoAno,
        equipamento_horimetro: equipamentoHorimetro,
        alvo_tipo,
        usuariocriadorid,
        setorid,
        prioridade,
        descricao: payload.descricao || null,
        observacoes: payload.observacoes || null,
        observacoes_fiscais: payload.observacoes_fiscais || null,
        status,
      })
      .select("id")
      .single();

    if (eOS) throw eOS;

    return NextResponse.json({ id: Number(os.id) }, { status: 201 });
  } catch (err: any) {
    if (createdOsIds.length > 0) {
      await supabaseAdmin.from("ordemservico").delete().in("id", createdOsIds);
    }
    if (createdPecaIds.length > 0) {
      await supabaseAdmin.from("peca").delete().in("id", createdPecaIds);
    }
    if (createdVeiculoId) {
      await supabaseAdmin.from("veiculo").delete().eq("id", createdVeiculoId);
    }

    console.error("POST /api/ordens/criar", err);
    return NextResponse.json({ error: err?.message || "Falha ao criar OS" }, { status: 500 });
  }
}
