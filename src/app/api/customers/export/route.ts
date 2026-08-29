// src/app/api/customers/export/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import * as XLSX from "xlsx";

type Status = "ATIVO" | "INATIVO" | "PENDENTE";
const STATUS_SET = new Set<Status>(["ATIVO", "INATIVO", "PENDENTE"]);



export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // mesmos filtros da sua listagem
    const q = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim();
    const statusParam = (searchParams.get("status") ?? "TODOS").toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;

    // tamanho do lote para buscar do Supabase sem estourar limites
    const CHUNK = Math.min(
      Math.max(Number(searchParams.get("chunk") ?? 1000), 200),
      5000
    );

    // Cabeçalhos do Excel (ordem das colunas)
    const headers = [
      "ID",
      "Tipo Pessoa",
      "CPF/CNPJ",
      "Nome/Razão Social",
      "E-mail",
      "Telefone",
      "Endereço",
      "Número",
      "Complemento",
      "Cidade",
      "Estado",
      "CEP",
      "Inscrição Estadual",
      "Inscrição Municipal",
      "Código Município",
      "Status",
      "Em aberto",
      "Vencido",
      "Títulos vencidos",
      "Tem título migrado",
      "Criado em",
      "Atualizado em",
    ] as const;

    // cria planilha e aba com header
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers as unknown as string[]]);
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    // larguras aproximadas por coluna (opcional)
    ws["!cols"] = [
      { wch: 8 },  // ID
      { wch: 10 }, // Tipo Pessoa
      { wch: 16 }, // CPF/CNPJ
      { wch: 40 }, // Nome/Razão Social
      { wch: 28 }, // E-mail
      { wch: 16 }, // Telefone
      { wch: 40 }, // Endereço
      { wch: 10 }, // Número
      { wch: 10 }, // Complemento
      { wch: 22 }, // Cidade
      { wch: 6 },  // Estado
      { wch: 10 }, // CEP
      { wch: 18 }, // IE
      { wch: 18 }, // IM
      { wch: 16 }, // Código Município
      { wch: 10 }, // Status
      { wch: 14 }, // Em aberto
      { wch: 14 }, // Vencido
      { wch: 16 }, // Títulos vencidos
      { wch: 18 }, // Tem título migrado
      { wch: 20 }, // Criado em
      { wch: 20 }, // Atualizado em
    ];

    // Função que monta a query base com os filtros
    const buildQuery = () => {
      let query = supabaseAdmin
        .from("cliente")
        .select(
          `
          id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco, endereconumero, enderecocomplemento,
          cidade, estado, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio,
          createdat, updatedat, status
        `,
          { count: "exact" }
        )
        // Para paginação por faixas, ordene ASC pra ser determinístico
        .order("id", { ascending: true });

      if (q) {
        query = query.or(
          `nomerazaosocial.ilike.%${q}%,cpfcnpj.ilike.%${q}%,email.ilike.%${q}%,telefone.ilike.%${q}%`
        );
      }
      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }
      return query;
    };

    // 1ª chamada só para pegar o total
    const first = await buildQuery().range(0, 0);
    if (first.error) throw first.error;

    // Busca tudo em blocos, anexando diretamente na planilha (memória mais estável)
    for (let from = 0; ; from += CHUNK) {
      const to = from + CHUNK - 1;
      const { data, error } = await buildQuery().range(from, to);
      if (error) throw error;

      /*
       * A dívida vem por bloco, pelos ids que já estão em maos — a mesma RPC da
       * listagem, para a planilha nao contar uma historia diferente da tela.
       */
      const dividas = new Map<number, any>();
      const ids = (data ?? []).map((c: any) => Number(c.id));
      if (ids.length) {
        const { data: linhas, error: erroDivida } = await supabaseAdmin.rpc(
          "clientes_divida",
          { p_cliente_ids: ids, p_somente_devedores: false },
        );
        if (erroDivida) throw erroDivida;
        for (const linha of (linhas ?? []) as any[]) {
          dividas.set(Number(linha.cliente_id), linha);
        }
      }

      const rows = (data ?? []).map((c) => [
        c.id ?? "",
        c.tipopessoa ?? "",
        c.cpfcnpj ?? "",
        c.nomerazaosocial ?? "",
        c.email ?? "",
        c.telefone ?? "",
        c.endereco ?? "",
        c.endereconumero ?? "",
        c.enderecocomplemento ?? "",
        c.cidade ?? "",
        c.estado ?? "",
        c.cep ?? "",
        c.inscricaoestadual ?? "",
        c.inscricaomunicipal ?? "",
        c.codigomunicipio ?? "",
        c.status ?? "",
        Number(dividas.get(Number(c.id))?.total_em_aberto ?? 0),
        Number(dividas.get(Number(c.id))?.total_vencido ?? 0),
        Number(dividas.get(Number(c.id))?.quantidade_vencida ?? 0),
        dividas.get(Number(c.id))?.tem_migrado ? "SIM" : "",
        c.createdat ? new Date(c.createdat) : "",
        c.updatedat ? new Date(c.updatedat) : "",
      ]);

      if (rows.length) {
        XLSX.utils.sheet_add_aoa(ws, rows as unknown as any[][], { origin: -1 });
      }

      if (!data?.length || data.length < CHUNK) break;
    }

    // Escreve o workbook em Buffer
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `clientes_${statusFilter ?? "TODOS"}_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Erro ao exportar clientes" },
      { status: 500 }
    );
  }
}
