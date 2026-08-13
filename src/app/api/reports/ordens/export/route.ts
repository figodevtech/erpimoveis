export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { carregarFatiasRateadas, fatiaComoTransacao } from "@/lib/financeiro/rateio-documentos";
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
  if (os.equipamento_nome) {
    return [
      os.equipamento_nome,
      os.equipamento_patrimonio,
      os.equipamento_ano,
      os.equipamento_horimetro != null ? `${os.equipamento_horimetro} h` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return "Sem alvo informado";
}

type SheetSpec = { name: string; headers: string[]; rows: unknown[][]; widths: number[] };

function makeWorkbookFrom(sheets: SheetSpec[]) {
  const workbook = XLSX.utils.book_new();

  sheets.forEach((spec) => {
    const sheet = XLSX.utils.aoa_to_sheet([spec.headers, ...spec.rows]);
    sheet["!cols"] = spec.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, spec.name);
  });

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function makeWorkbook(headers: string[], rows: unknown[][], widths: number[]) {
  return makeWorkbookFrom([{ name: "Relatório", headers, rows, widths }]);
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
          equipamento_nome, equipamento_patrimonio, equipamento_ano, equipamento_horimetro,
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
        ["OS", "Entrada", "Saída", "Status", "Prioridade", "Cliente", "CPF/CNPJ", "Alvo atendido", "Setor", "Responsável", "Descrição", "Orçamento (R$)"],
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
        .select("id, ordemservicoid, origem, chave_origem, natureza, status, descricao, detalhe, valor, data_evento, quantidade_snapshot, valor_unitario_snapshot, percentual_snapshot, valor_base_snapshot, pode_gerar_transacao, transacaoid")
        .in("ordemservicoid", ids.slice(index, index + 200))
        .order("ordemservicoid", { ascending: true })
        .order("data_evento", { ascending: true })
        .order("id", { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      allEvents.push(...(data ?? []));
    }

    // Pagamentos de cada OS. Vão numa aba própria porque a granularidade é
    // outra: a aba principal tem uma linha por evento financeiro.
    const transacoes: any[] = [];
    for (let index = 0; index < ids.length; index += 200) {
      const { data, error } = await supabaseAdmin
        .from("transacao")
        .select("id, ordemservicoid, descricao, descricao_pagamento, data, metodopagamento, tipo, valor, valorLiquido, pendente")
        .in("ordemservicoid", ids.slice(index, index + 200))
        .eq("is_deleted", false)
        .order("ordemservicoid", { ascending: true })
        .order("data", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      transacoes.push(...(data ?? []));
    }

    // Pagamento em grupo não aponta para a OS; sem as fatias, a exportação
    // mostraria a ordem sem nenhum recebimento.
    const fatiasExport = await carregarFatiasRateadas("OS", ids);
    for (const fatia of [...fatiasExport.values()].flat()) {
      transacoes.push({
        ...fatiaComoTransacao(fatia),
        ordemservicoid: fatia.documentoId,
        descricao_pagamento: null,
      });
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
        formatDate(os?.dataentrada),
        formatDate(os?.datasaida),
        os?.usuario?.nome ?? "Não informado",
        os?.cliente?.nomerazaosocial ?? "Sem cliente",
        targetLabel(os ?? {}),
        evento.id,
        formatDate(evento.data_evento),
        evento.origem,
        // Par (origem, chave_origem) identifica o item: é o que permite casar a
        // despesa com a receita do mesmo produto/serviço na impressão.
        evento.chave_origem ?? "",
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
    const transacaoRows = transacoes.map((transacao) => [
      transacao.ordemservicoid,
      transacao.id,
      formatDate(transacao.data),
      transacao.descricao ?? "",
      transacao.descricao_pagamento ?? "",
      transacao.metodopagamento ?? "",
      transacao.tipo ?? "",
      transacao.pendente ? "Pendente" : "Liquidada",
      // O que de fato circulou: bruto só quando não há líquido registrado.
      Number(transacao.valorLiquido ?? transacao.valor ?? 0),
      Number(transacao.valor ?? 0),
    ]);

    const buffer = makeWorkbookFrom([
      {
        name: "Relatório",
        headers: ["OS", "Status da OS", "Entrada da OS", "Conclusão da OS", "Criador da OS", "Cliente", "Alvo atendido", "Evento", "Data do evento", "Origem", "Chave origem", "Natureza", "Descrição", "Detalhe", "Valor (R$)", "Status do evento", "Transação", "Quantidade snapshot", "Valor unitário snapshot", "Percentual snapshot", "Base snapshot", "Receitas da OS", "Despesas da OS", "Resultado da OS"],
        rows,
        widths: [9, 22, 20, 20, 26, 32, 32, 10, 20, 14, 16, 12, 42, 32, 16, 18, 12, 18, 22, 20, 18, 18, 18, 18],
      },
      {
        name: "Transações",
        headers: ["OS", "Transação", "Data", "Descrição", "Descrição do pagamento", "Método", "Tipo", "Situação", "Valor (R$)", "Valor bruto (R$)"],
        rows: transacaoRows,
        widths: [9, 12, 20, 42, 32, 22, 14, 14, 16, 18],
      },
    ]);
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
