export const runtime = "nodejs";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { arredondarMoeda } from "@/lib/ordens/desconto";
import { inferirDescontoGeralOs, sanitizarValorFrete } from "@/lib/ordens/totais";
import { calculateFinancialSurcharge } from "@/lib/financial-surcharge";
import { fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import { applyMarketplaceBuyerNames } from "@/lib/vendas/marketplace-buyer-names";
import {
  CABECALHOS_DE_RECEBIMENTOS,
  COLUNAS_DE_SALDO,
  diaLocal,
  linhaDoRecebimento,
  saldosDoDocumento,
} from "@/lib/relatorios/recebimentos-de-documentos";
import { carregarRecebimentosPorDocumento } from "@/lib/relatorios/recebimentos-de-documentos-server";

/**
 * Exportação da relação de vendas.
 *
 * Espelha `../../ordens/export` de propósito: mesma leitura de filtros, mesma
 * paginação manual, mesmo formato de saída. É a fonte única do arquivo em xlsx e
 * da folha de impressão em `/print/relatorios/vendas`, que relê esta mesma
 * resposta por nome de coluna — os rótulos dos cabeçalhos são contrato, não
 * enfeite, e mudá-los quebra o papel em silêncio.
 *
 * Duas diferenças de fundo em relação à OS, e as duas vêm do schema:
 * - `venda` não tem `is_deleted`; a exclusão é definitiva, então não há filtro;
 * - venda é só de produto, e o subtotal já está gravado em `venda.sub_total`.
 *   Por isso a aba principal não precisa dos itens, e o relatório padrão não
 *   consulta `vendaproduto` uma vez sequer — a OS paga quatro consultas ali.
 */

const LOCAL_OFFSET = "-03:00";
const PAGE_SIZE = 1000;

/**
 * Status válidos de venda. Filtro fora desta lista é descartado, não aplicado.
 *
 * `CANCELADA` e `CANCELADO` convivem no enum por compatibilidade — as duas
 * grafias existem em produção, e deixar uma de fora esconde vendas canceladas.
 */
const STATUS_VENDA = new Set([
  "ORCAMENTO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO",
  "ABERTA",
  "PAGAMENTO",
  "PENDENTE",
  "PAGO",
  "AUTORIZADO",
  "FINALIZADA",
  "CANCELADA",
  "CANCELADO",
]);

/**
 * Status em que a venda não deve nada, e por isso não tem saldo sem lançamento.
 * As duas grafias de cancelada, pelo mesmo motivo de `STATUS_VENDA`.
 */
const STATUS_SEM_VALOR_DEVIDO = new Set(["ORCAMENTO_RECUSADO", "CANCELADA", "CANCELADO"]);

const CANAIS = new Set(["PDV", "ONLINE", "MERCADO_LIVRE", "SHOPEE"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lista de status vinda da tela: `FINALIZADA,PAGO`. */
function statusSelecionados(valor: string | null) {
  return [
    ...new Set(
      (valor ?? "")
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item) => STATUS_VENDA.has(item)),
    ),
  ];
}

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

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

/** O Supabase devolve a junção ora como objeto, ora como lista de um. */
function juncao(valor: unknown): any {
  return Array.isArray(valor) ? valor[0] ?? null : valor ?? null;
}

type LinhaItemVenda = {
  vendaId: number;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  precoUnitario: number;
  descontoItem: number;
  freteItem: number;
  /** Líquido do desconto do próprio item e sem o frete dele. */
  subtotal: number;
};

/**
 * Desconto do próprio item, em reais.
 *
 * `vendaproduto` grava tipo + valor, nunca o resultado — a mesma conta está em
 * `fn_criar_venda_com_itens`, e é ela que o banco valida ao inserir. Repeti-la
 * aqui é o que faz `Subtotal + Frete do item` fechar com o `valor_total` gravado.
 */
function descontoDoItemVenda(linha: any) {
  const bruto = Math.max(0, Number(linha.sub_total ?? 0));
  const valor = Math.max(0, Number(linha.valor_desconto ?? 0));
  if (!valor || !bruto) return 0;
  if (linha.tipo_desconto === "PORCENTAGEM") return arredondarMoeda((bruto * Math.min(valor, 100)) / 100);
  return linha.tipo_desconto === "FIXO" ? arredondarMoeda(Math.min(bruto, valor)) : 0;
}

/**
 * Os itens de cada venda.
 *
 * Uma porta só, contra as quatro da OS: não existem `vendaservico` nem item
 * avulso de venda. Só é chamada quando a folha pede os itens — a aba principal
 * se vira com os totais gravados na própria venda.
 */
async function carregarItensPorVenda(ids: number[]) {
  const porVenda = new Map<number, LinhaItemVenda[]>();
  if (!ids.length) return porVenda;

  const linhas = await fetchAllSupabaseRowsByChunks<any, number>(
    ids,
    (chunk) =>
      supabaseAdmin
        .from("vendaproduto")
        .select(
          "venda_id, quantidade, sub_total, valor_desconto, tipo_desconto, valor_frete, valor_total, produto:produtoid (titulo, referencia, unidade)",
        )
        .in("venda_id", chunk)
        .order("venda_id", { ascending: true })
        .order("id", { ascending: true }) as any,
    300,
  );

  linhas.forEach((linha) => {
    const vendaId = Number(linha.venda_id);
    if (!Number.isFinite(vendaId)) return;
    const produto = juncao(linha.produto);
    const quantidade = Number(linha.quantidade ?? 0);
    const bruto = Number(linha.sub_total ?? 0);
    const desconto = descontoDoItemVenda(linha);
    const atual = porVenda.get(vendaId) ?? [];
    atual.push({
      vendaId,
      codigo: texto(produto?.referencia),
      descricao: texto(produto?.titulo),
      unidade: texto(produto?.unidade),
      quantidade,
      // `vendaproduto` não guarda preço unitário: ele volta do bruto dividido
      // pela quantidade, que é exatamente como o bruto foi formado.
      precoUnitario: quantidade > 0 ? arredondarMoeda(bruto / quantidade) : 0,
      descontoItem: desconto,
      freteItem: sanitizarValorFrete(linha.valor_frete),
      subtotal: arredondarMoeda(Math.max(0, bruto - desconto)),
    });
    porVenda.set(vendaId, atual);
  });

  return porVenda;
}

/**
 * As parcelas que fecham a venda: subtotal − desconto + frete = total. O
 * acréscimo financeiro sai à parte, por incidir sobre o total já fechado.
 *
 * O desconto geral é gravado como tipo + valor (R$ ou %), nunca em reais já
 * resolvidos, então o relatório refaz a conta a partir dos totais para ter o
 * número que de fato saiu — é o mesmo `inferirDescontoGeralOs` da OS, cuja
 * assinatura já é genérica, e é o que evita que uma venda ainda sem total vire
 * 100% de desconto.
 */
function fecharVenda(venda: any) {
  const total = arredondarMoeda(Number(venda.valortotal ?? 0));
  const frete = sanitizarValorFrete(venda.valor_frete);
  // Venda antiga pode não ter `sub_total` gravado. Sem o resgate pelo total, a
  // folha mostraria subtotal zerado ao lado de um total cheio.
  const gravado = Number(venda.sub_total ?? 0);
  const subtotal = gravado > 0 ? arredondarMoeda(gravado) : arredondarMoeda(Math.max(0, total - frete));
  const desconto = inferirDescontoGeralOs({
    subtotal,
    orcamentoTotal: total,
    valorFrete: frete,
  });
  const acrescimoFinanceiro = calculateFinancialSurcharge(
    total,
    venda.acrescimo_financeiro_tipo,
    venda.acrescimo_financeiro_valor,
  );
  return { subtotal, desconto, frete, total, acrescimoFinanceiro };
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

export async function GET(request: Request) {
  try {
    await requireRelatoriosAccess();
    const { searchParams } = new URL(request.url);
    // Só a folha de impressão pede os itens, e só quando o usuário marca a
    // opção; o download pela tela de relatórios continua com uma aba só.
    const incluirItens = searchParams.get("itens") === "1";
    const status = statusSelecionados(searchParams.get("status"));
    const canalParam = safeText(searchParams.get("canal"), 20).toUpperCase();
    const canal = CANAIS.has(canalParam) ? canalParam : "";
    const vendedorParam = safeText(searchParams.get("vendedorId"), 40);
    const vendedorId = UUID.test(vendedorParam) ? vendedorParam : "";
    const criadorParam = safeText(searchParams.get("criadorId"), 40);
    const criadorId = UUID.test(criadorParam) ? criadorParam : "";
    const dateFrom = safeText(searchParams.get("dateFrom"), 10);
    const dateTo = safeText(searchParams.get("dateTo"), 10);
    const vendaId = integer(searchParams.get("vendaId"));
    const clienteId = integer(searchParams.get("clienteId"));
    const categoriaVendaId = integer(searchParams.get("categoriaVendaId"));
    // Eixo do período. Os três marcos são carimbados por trigger quando a venda
    // muda de status, e existem justamente para servir de eixo de relatório.
    // `orcamento_em` fica de fora: nasce nulo em toda venda de balcão, e como
    // eixo faria o PDV inteiro sumir do recorte sem explicação.
    const campoData = searchParams.get("campoData");
    const colunaPeriodo =
      campoData === "pagamento" ? "pagamento_em" : campoData === "baixa" ? "baixada_em" : "datavenda";

    const buildVendaQuery = () => {
      let query = supabaseAdmin
        .from("venda")
        .select(`
          id, status, canal, descricao, datavenda, pagamento_em, baixada_em,
          sub_total, valor_frete, valortotal,
          acrescimo_financeiro_tipo, acrescimo_financeiro_valor,
          forma_pagamento, parcelas_pagamento,
          cliente:clienteid(id, nomerazaosocial, cpfcnpj),
          categoria_venda:categoriavendaid(id, nome),
          vendedor_rel:vendedor(id, nome),
          criador:created_by(id, nome)
        `)
        // `venda` não tem `is_deleted`: a exclusão é definitiva, e não há o
        // filtro de descartadas que a OS aplica neste ponto.
        .order(colunaPeriodo, { ascending: true })
        .order("id", { ascending: true });
      if (status.length === 1) query = query.eq("status", status[0]);
      if (status.length > 1) query = query.in("status", status);
      // Com o eixo em pagamento ou baixa, venda sem o marco cai fora assim que
      // há data — mesmo comportamento da OS filtrada por conclusão.
      if (dateFrom) query = query.gte(colunaPeriodo, startOfDay(dateFrom));
      if (dateTo) query = query.lt(colunaPeriodo, nextDay(dateTo));
      if (vendaId) query = query.eq("id", vendaId);
      if (clienteId) query = query.eq("clienteid", clienteId);
      if (categoriaVendaId) query = query.eq("categoriavendaid", categoriaVendaId);
      if (canal) query = query.eq("canal", canal);
      // Vendedor e criador são colunas distintas: a venda pode ser lançada por
      // quem está no caixa e atribuída a quem de fato a fez.
      if (vendedorId) query = query.eq("vendedor", vendedorId);
      if (criadorId) query = query.eq("created_by", criadorId);
      return query;
    };

    const vendas: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await buildVendaQuery().range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      vendas.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    // Venda de marketplace não tem cliente cadastrado; sem isto o comprador do
    // Mercado Livre sairia genérico no papel e na planilha. Sai cedo quando não
    // há nenhuma no recorte.
    await applyMarketplaceBuyerNames(vendas);

    // Todos os recebimentos de cada venda, de qualquer data: o período escolhe
    // as vendas, não os pagamentos. É daqui que sai o resumo financeiro.
    const recebimentosPorVenda = await carregarRecebimentosPorDocumento(
      "VENDA",
      vendas.map((venda) => Number(venda.id)),
    );
    const hoje = diaLocal(new Date());

    const rows = vendas.map((venda) => {
      const cliente = juncao(venda.cliente);
      const fechamento = fecharVenda(venda);
      return [
        venda.id,
        formatDate(venda.datavenda),
        formatDate(venda.pagamento_em),
        formatDate(venda.baixada_em),
        venda.status ?? "",
        venda.canal ?? "",
        juncao(venda.categoria_venda)?.nome ?? "Sem categoria",
        cliente?.nomerazaosocial ?? "Sem cliente",
        cliente?.cpfcnpj ?? "",
        juncao(venda.vendedor_rel)?.nome ?? "Não informado",
        juncao(venda.criador)?.nome ?? "Não informado",
        venda.descricao ?? "",
        venda.forma_pagamento ?? "",
        venda.parcelas_pagamento ?? "",
        fechamento.subtotal,
        fechamento.desconto,
        fechamento.frete,
        fechamento.total,
        fechamento.acrescimoFinanceiro,
        // A conta do saldo é a mesma da tela de pagamento da venda.
        ...saldosDoDocumento({
          totalComercial: venda.valortotal,
          acrescimoFinanceiroTipo: venda.acrescimo_financeiro_tipo,
          acrescimoFinanceiroValor: venda.acrescimo_financeiro_valor,
          recebimentos: recebimentosPorVenda.get(Number(venda.id)) ?? [],
          // Venda cancelada ou recusada não deve nada: o total dela não é saldo
          // a lançar.
          semValorDevido: STATUS_SEM_VALOR_DEVIDO.has(String(venda.status ?? "")),
          hoje,
        }),
      ];
    });

    // Uma linha por recebimento, na ordem das vendas da aba principal. É dela
    // que a folha monta o resumo por forma de pagamento.
    const linhasDeRecebimentos = vendas.flatMap((venda) =>
      (recebimentosPorVenda.get(Number(venda.id)) ?? []).map((transacao) => [venda.id, ...linhaDoRecebimento(transacao, hoje)]),
    );

    const abas: SheetSpec[] = [
      {
        name: "Relatório",
        headers: ["Venda", "Data da venda", "Pagamento", "Baixa", "Status", "Canal", "Categoria", "Cliente", "CPF/CNPJ", "Vendedor", "Lançado por", "Descrição", "Forma de pagamento", "Parcelas", "Subtotal (R$)", "Desconto (R$)", "Frete (R$)", "Total (R$)", "Acréscimo financeiro (R$)", ...COLUNAS_DE_SALDO],
        rows,
        widths: [9, 20, 20, 20, 22, 16, 24, 35, 20, 26, 26, 45, 30, 10, 16, 16, 14, 16, 24, 16, 22, 22, 20],
      },
      {
        name: "Recebimentos",
        headers: ["Venda", ...CABECALHOS_DE_RECEBIMENTOS],
        rows: linhasDeRecebimentos,
        widths: [9, 12, 14, 22, 22, 18, 16, 22, 22],
      },
    ];

    if (incluirItens) {
      const itensPorVenda = await carregarItensPorVenda(vendas.map((venda) => Number(venda.id)));
      // Agrupada na mesma ordem da aba principal, para a folha distribuir os
      // itens numa passada só, sem reordenar nada.
      const linhasDeItens = vendas.flatMap((venda) =>
        (itensPorVenda.get(Number(venda.id)) ?? []).map((item) => [
          venda.id,
          item.codigo,
          item.descricao,
          item.unidade,
          item.quantidade,
          item.precoUnitario,
          item.descontoItem,
          item.freteItem,
          item.subtotal,
        ]),
      );
      abas.push({
        name: "Itens",
        headers: ["Venda", "Código", "Descrição", "Unidade", "Quantidade", "Preço unitário (R$)", "Desconto do item (R$)", "Frete do item (R$)", "Subtotal (R$)"],
        rows: linhasDeItens,
        widths: [9, 16, 45, 10, 12, 18, 20, 18, 16],
      });
    }

    const buffer = makeWorkbookFrom(abas);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="vendas_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao gerar relatório de vendas." }, { status: error?.statusCode || 500 });
  }
}
