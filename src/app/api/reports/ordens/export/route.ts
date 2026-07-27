export const runtime = "nodejs";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const LOCAL_OFFSET = "-03:00";
const PAGE_SIZE = 1000;

function integer(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeText(value: string | null, limit = 100) {
  return (value ?? "").trim().slice(0, limit).replace(/[%_]/g, "");
}

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00${LOCAL_OFFSET}`).toISOString();
}

function nextDay(value: string) {
  return new Date(new Date(`${value}T00:00:00${LOCAL_OFFSET}`).getTime() + 86_400_000).toISOString();
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function targetLabel(os: any) {
  if (os.veiculo) return [os.veiculo.placa, os.veiculo.marca, os.veiculo.modelo].filter(Boolean).join(" · ");
  if (os.peca) return os.peca.titulo || os.peca.descricao || `Peça #${os.peca.id}`;
  return "Sem veículo/peça";
}

function makeWorkbook(headers: string[], rows: unknown[][], widths: number[]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, "Relatório");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export async function GET(request: Request) {
  try {
    await requireRelatoriosAccess();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") === "financeiro" ? "financeiro" : "simples";
    const status = safeText(searchParams.get("status"), 40);
    const dateFrom = safeText(searchParams.get("dateFrom"), 10);
    const dateTo = safeText(searchParams.get("dateTo"), 10);
    const ordemId = integer(searchParams.get("ordemId"));
    const clienteId = integer(searchParams.get("clienteId"));
    const setorId = integer(searchParams.get("setorId"));
    const natureza = safeText(searchParams.get("natureza"), 20);
    const eventoStatus = safeText(searchParams.get("eventoStatus"), 20);

    const buildOsQuery = () => {
      let query = supabaseAdmin
        .from("ordemservico")
        .select(`
          id, descricao, status, prioridade, dataentrada, datasaida, orcamentototal,
          cliente:clienteid(id, nomerazaosocial, cpfcnpj),
          veiculo:veiculoid(id, placa, marca, modelo),
          peca:pecaid(id, titulo, descricao),
          setor:setorid(id, nome),
          usuario:usuario!usuariocriadorid(id, nome)
        `)
        .eq("is_deleted", false)
        .order("dataentrada", { ascending: true })
        .order("id", { ascending: true });
      if (status && status !== "TODAS") query = query.eq("status", status);
      if (dateFrom) query = query.gte("dataentrada", startOfDay(dateFrom));
      if (dateTo) query = query.lt("dataentrada", nextDay(dateTo));
      if (ordemId) query = query.eq("id", ordemId);
      if (clienteId) query = query.eq("clienteid", clienteId);
      if (setorId) query = query.eq("setorid", setorId);
      return query;
    };

    const ordens: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await buildOsQuery().range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      ordens.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    if (mode === "simples") {
      const rows = ordens.map((os) => [
        os.id,
        formatDate(os.dataentrada),
        formatDate(os.datasaida),
        os.status ?? "",
        os.prioridade ?? "",
        os.cliente?.nomerazaosocial ?? "Sem cliente",
        os.cliente?.cpfcnpj ?? "",
        targetLabel(os),
        os.setor?.nome ?? "Sem setor",
        os.usuario?.nome ?? "Não informado",
        os.descricao ?? "",
        Number(os.orcamentototal ?? 0),
      ]);
      const buffer = makeWorkbook(
        ["OS", "Entrada", "Saída", "Status", "Prioridade", "Cliente", "CPF/CNPJ", "Veículo / Peça", "Setor", "Responsável", "Descrição", "Orçamento (R$)"],
        rows,
        [9, 20, 20, 24, 12, 35, 20, 35, 22, 26, 45, 18],
      );
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="ordens_servico_${new Date().toISOString().slice(0, 10)}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const osById = new Map(ordens.map((os) => [Number(os.id), os]));
    const allEvents: any[] = [];
    const ids = Array.from(osById.keys());
    for (let index = 0; index < ids.length; index += 200) {
      const query = supabaseAdmin
        .from("eventos_financeiros")
        .select("id, ordemservicoid, origem, natureza, status, descricao, detalhe, valor, data_evento, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot, valor_base_snapshot, pode_gerar_transacao, transacaoid")
        .in("ordemservicoid", ids.slice(index, index + 200))
        .order("ordemservicoid", { ascending: true })
        .order("data_evento", { ascending: true })
        .order("id", { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      allEvents.push(...(data ?? []));
    }

    const totals = new Map<number, { receita: number; despesa: number }>();
    allEvents.forEach((evento) => {
      if (evento.status === "CANCELADO") return;
      const osId = Number(evento.ordemservicoid);
      const current = totals.get(osId) ?? { receita: 0, despesa: 0 };
      if (evento.natureza === "RECEITA") current.receita += Number(evento.valor ?? 0);
      if (evento.natureza === "DESPESA") current.despesa += Number(evento.valor ?? 0);
      totals.set(osId, current);
    });
    const eventos = allEvents.filter((evento) => {
      if (natureza && natureza !== "TODAS" && evento.natureza !== natureza) return false;
      if (eventoStatus && eventoStatus !== "TODOS" && evento.status !== eventoStatus) return false;
      return true;
    });

    const rows = eventos.map((evento) => {
      const os = osById.get(Number(evento.ordemservicoid));
      const total = totals.get(Number(evento.ordemservicoid)) ?? { receita: 0, despesa: 0 };
      return [
        evento.ordemservicoid,
        os?.status ?? "",
        os?.cliente?.nomerazaosocial ?? "Sem cliente",
        targetLabel(os ?? {}),
        evento.id,
        formatDate(evento.data_evento),
        evento.origem,
        evento.natureza,
        evento.descricao,
        evento.detalhe ?? "",
        Number(evento.valor ?? 0),
        evento.status,
        evento.transacaoid ?? "",
        evento.quantidade_snapshot ?? "",
        evento.valor_unitario_snapshot ?? "",
        evento.percentual_snapshot ?? "",
        evento.valor_base_snapshot ?? "",
        total.receita,
        total.despesa,
        total.receita - total.despesa,
      ];
    });
    const buffer = makeWorkbook(
      ["OS", "Status da OS", "Cliente", "Veículo / Peça", "Evento", "Data do evento", "Origem", "Natureza", "Descrição", "Detalhe", "Valor (R$)", "Status do evento", "Transação", "Quantidade snapshot", "Valor unitário snapshot", "Percentual snapshot", "Base snapshot", "Receitas da OS", "Despesas da OS", "Resultado da OS"],
      rows,
      [9, 22, 32, 32, 10, 20, 14, 12, 42, 32, 16, 18, 12, 18, 22, 20, 18, 18, 18, 18],
    );
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="eventos_financeiros_os_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao gerar relatório de ordens de serviço." }, { status: error?.statusCode || 500 });
  }
}
