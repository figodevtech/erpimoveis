// app/api/ordens/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { StatusOS } from "@/app/(app)/(pages)/ordens/types";

type Prioridade = "ALTA" | "NORMAL" | "BAIXA" | null;
type AlvoTipo = "VEICULO" | "PECA" | "EQUIPAMENTO" | null;

function parseStatuses(param?: string | null): StatusOS[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as StatusOS[];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);


    const status = (searchParams.get("status") as StatusOS) || "TODAS";
    const statuses = parseStatuses(searchParams.get("statuses"));
    const q = searchParams.get("q")?.trim() || "";

    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 200);
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("ordemservico")
      .select(
        `
        id,
        descricao,
        prioridade,
        orcamentototal,
        status,
        dataentrada,
        datasaida,
        alvo_tipo,
        equipamento_nome,
        equipamento_patrimonio,
        equipamento_ano,
        equipamento_horimetro,
        execucao_inicio_em,
        execucao_fim_em,
        createdat,

        cliente:clienteid (
          id,
          nomerazaosocial,
          telefone,
          email
        ),
        veiculo:veiculoid (
          id,
          placa,
          modelo,
          marca
        ),
        peca:pecaid (
          id,
          titulo,
          descricao
        ),
        setor:setorid (
          id,
          nome
        ),

        transacoes:transacao!transacao_ordemservicoid_fkey (
          id,
          descricao,
          valor,
          data,
          metodopagamento,
          categoria,
          tipo,
          banco_id,
          nomepagador,
          cpfcnpjpagador,
          created_at,
          updated_at
        ),

        usuario:usuario!usuariocriadorid (id, nome),

        cFilter:clienteid(),
        vFilter:veiculoid(),
        pFilter:pecaid()
      `,
        { count: "exact" }
      )
      .order("dataentrada", { ascending: false })
      .range(from, to)
      .order("data", { foreignTable: "transacoes", ascending: false })
      .limit(50, { foreignTable: "transacoes" });

    // status (1 ou vários)
    if (status && status !== "TODAS") {
      query = query.eq("status", status);
    } else if (statuses.length > 0) {
      query = query.in("status", statuses);
    }

    if (q) {
      const like = `%${q}%`;
      const onlyDigits = q.replace(/\D/g, "");

      // aplica filtros nos embeds (isso preenche cFilter/vFilter/pFilter quando casar)
      query = query.or(`nomerazaosocial.ilike.${like},telefone.ilike.${like},email.ilike.${like}`, {
        foreignTable: "cFilter",
      });
      query = query.or(`placa.ilike.${like},modelo.ilike.${like},marca.ilike.${like}`, {
        foreignTable: "vFilter",
      });
      query = query.or(`titulo.ilike.${like},descricao.ilike.${like}`, {
        foreignTable: "pFilter",
      });

      // agora faz OR no nível do pai:
      // - descricao bate OU
      // - algum embed "de filtro" não é null (porque passou no filtro acima)
      const topOr: string[] = [
        `descricao.ilike.${like}`,
        `equipamento_nome.ilike.${like}`,
        `equipamento_patrimonio.ilike.${like}`,
        `cFilter.not.is.null`,
        `vFilter.not.is.null`,
        `pFilter.not.is.null`,
      ];
      if (onlyDigits) topOr.push(`id.eq.${Number(onlyDigits)}`);

      query = query.or(topOr.join(","));
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const items = (data ?? []).map((r: any) => ({
      id: r.id as number,
      descricao: (r.descricao as string) ?? "",
      execucao_inicio_em: (r.execucao_inicio_em as Date) ?? null,
      execucao_fim_em: (r.execucao_fim_em as Date) ?? null,
      prioridade: (r.prioridade as Prioridade) ?? null,
      status: r.status as Exclude<StatusOS, "TODAS">,
      dataEntrada: r.dataentrada as string | null,
      orcamentototal: r.orcamentototal as number | null,
      dataSaida: r.datasaida as string | null,
      createdAt: r.createdat as string | null,

      alvo_tipo: (r.alvo_tipo as AlvoTipo) ?? null,

      responsavel: (r.usuario)
      ?{
        id: r.usuario.id as string,
        nome: r.usuario.nome as string,

      }: null,

      cliente: r.cliente
        ? {
            id: r.cliente.id as number,
            nome: r.cliente.nomerazaosocial as string,
            telefone: (r.cliente.telefone as string | null) ?? null,
            email: (r.cliente.email as string | null) ?? null,
          }
        : null,

      veiculo: r.veiculo
        ? {
            id: r.veiculo.id as number,
            placa: r.veiculo.placa as string,
            modelo: r.veiculo.modelo as string,
            marca: r.veiculo.marca as string,
          }
        : null,

      peca: r.peca
        ? {
            id: r.peca.id as number,
            titulo: r.peca.titulo as string,
            descricao: (r.peca.descricao as string | null) ?? null,
          }
        : null,

      equipamento: r.alvo_tipo === "EQUIPAMENTO" && r.equipamento_nome
        ? {
            nome: r.equipamento_nome as string,
            patrimonio: (r.equipamento_patrimonio as string | null) ?? null,
            ano: (r.equipamento_ano as number | null) ?? null,
            horimetro: (r.equipamento_horimetro as number | null) ?? null,
          }
        : null,

      setor: r.setor
        ? {
            id: r.setor.id as number,
            nome: r.setor.nome as string,
          }
        : null,

      transacoes: (r.transacoes ?? []).map((t: any) => ({
        id: Number(t.id),
        descricao: t.descricao as string,
        valor: Number(t.valor),
        data: t.data as string,
        metodoPagamento: t.metodopagamento as string,
        categoria: t.categoria as string,
        tipo: t.tipo as string,
        bancoId: Number(t.banco_id),
        pagador: { nome: t.nomepagador as string, cpfcnpj: t.cpfcnpjpagador as string },
        createdAt: t.created_at as string,
        updatedAt: t.updated_at as string,
      })),
    }));

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageCount = items.length;

    return NextResponse.json({ items, page, limit, total, totalPages, pageCount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao listar OS" }, { status: 500 });
  }
}
