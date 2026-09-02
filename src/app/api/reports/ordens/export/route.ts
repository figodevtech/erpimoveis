export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { carregarFatiasRateadas, fatiaComoTransacao } from "@/lib/financeiro/rateio-documentos";
import * as XLSX from "xlsx";

import { requireOSEventosFinanceiros, requireRelatoriosAccess } from "@/app/api/_authz/perms";
import {
  eventosAtivos,
  ordenarEventosDaOs,
  type EventoFinanceiroOs,
} from "@/lib/ordens/eventos-financeiros";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { arredondarMoeda } from "@/lib/ordens/desconto";
import { inferirDescontoGeralOs, sanitizarValorFrete } from "@/lib/ordens/totais";
import { calculateFinancialSurcharge } from "@/lib/financial-surcharge";
import { fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import { resolveOrdemVehicle } from "@/lib/ordens/vehicle-snapshot";
import { resolveOrdemCustomer } from "@/lib/ordens/customer-snapshot";

const LOCAL_OFFSET = "-03:00";
const PAGE_SIZE = 1000;

/** Status válidos de OS. Filtro fora desta lista é descartado, não aplicado. */
const STATUS_OS = new Set([
  "AGUARDANDO_CHECKLIST",
  "ORCAMENTO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
  "SEM_COBRANCA",
  "CONCLUIDO",
  "CANCELADO",
]);

const PRIORIDADES = new Set(["ALTA", "NORMAL", "BAIXA"]);
const ALVOS = new Set(["VEICULO", "PECA", "EQUIPAMENTO"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lista de status vinda da tela: `CONCLUIDO,PAGAMENTO`.
 *
 * Antes o filtro era um status só, e a pergunta mais comum do balcão — "tudo
 * que ainda não fechou" — exigia gerar um relatório por status e juntar à mão.
 */
function statusSelecionados(valor: string | null) {
  return [
    ...new Set(
      (valor ?? "")
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item) => STATUS_OS.has(item)),
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

function targetLabel(os: any) {
  const veiculo = resolveOrdemVehicle(os.veiculo, os.veiculo_snapshot);
  if (veiculo) return [veiculo.placa, veiculo.marca, veiculo.modelo].filter(Boolean).join(" · ");
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

type ItensDaOs = { produtos: number; servicos: number };

type OrigemItem = "CATALOGO" | "AVULSO" | "SERVICO" | "HISTORICO";

type LinhaItemOs = {
  ordemservicoid: number;
  origem: OrigemItem;
  tipo: "PRODUTO" | "SERVICO";
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  precoUnitario: number;
  /** Sempre o valor gravado, já líquido do desconto do próprio item. */
  subtotal: number;
};

const ROTULO_ORIGEM: Record<OrigemItem, string> = {
  CATALOGO: "Catálogo",
  AVULSO: "Avulso",
  SERVICO: "Serviço",
  HISTORICO: "Migrado",
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

/** O Supabase devolve a junção ora como objeto, ora como lista de um. */
function juncao(valor: unknown): any {
  return Array.isArray(valor) ? valor[0] ?? null : valor ?? null;
}

/**
 * Os itens de cada OS, pelas quatro portas em que eles existem.
 *
 * Produto entra por três (catálogo, avulso e item de OS migrada) e serviço por
 * duas; deixar qualquer uma de fora subestima o total em silêncio.
 *
 * `detalhado` só troca a lista de colunas de cada consulta: sem ele nenhuma
 * junção de descrição é paga e o relatório padrão custa o que sempre custou.
 * As duas saídas — as colunas Produtos/Serviços e a aba Itens — leem das mesmas
 * linhas, então a soma da aba e o total da ordem não têm como divergir.
 *
 * A ordem sai pronta daqui, e a folha de impressão não reordena nada: é o que
 * impede o papel e a planilha de discordarem.
 */
async function carregarItensPorOs(ids: number[], detalhado: boolean) {
  const porOs = new Map<number, LinhaItemOs[]>();
  if (!ids.length) return porOs;

  const buscar = (tabela: string, colunas: string, ordem: string[]) =>
    fetchAllSupabaseRowsByChunks<any, number>(ids, (chunk) => {
      let query = supabaseAdmin.from(tabela).select(colunas).in("ordemservicoid", chunk);
      ordem.forEach((coluna) => { query = query.order(coluna, { ascending: true }); });
      return query as any;
    });

  const colunas = (resumo: string, detalhe: string) => (detalhado ? `${resumo}, ${detalhe}` : resumo);

  const [produtos, avulsos, servicos, historicos] = await Promise.all([
    buscar(
      "osproduto",
      colunas("ordemservicoid, subtotal", "quantidade, precounitario, produto:produtoid (titulo, descricao, referencia)"),
      ["ordemservicoid", "produtoid"],
    ),
    buscar(
      "osproduto_avulso",
      colunas("ordemservicoid, subtotal", "id, titulo, quantidade, precounitario"),
      ["id"],
    ),
    buscar(
      "osservico",
      colunas("ordemservicoid, subtotal", "descricao, quantidade, precounitario, servico:servicoid (codigo, descricao)"),
      ["ordemservicoid", "servicoid"],
    ),
    buscar(
      "ositem_historico",
      colunas("ordemservicoid, subtotal, tipo", "codigo_legado, descricao, unidade, quantidade, preco_unitario"),
      // Por `linha_origem`, que é a ordem do documento migrado. A ordenação por
      // id era inofensiva para somar e errada para exibir.
      ["linha_origem", "id"],
    ),
  ]);

  let sequencia = 0;
  const acrescentar = (linha: any, montar: () => Omit<LinhaItemOs, "ordemservicoid">) => {
    const osId = Number(linha.ordemservicoid);
    if (!Number.isFinite(osId)) return;
    const atual = porOs.get(osId) ?? [];
    atual.push({ ordemservicoid: osId, ...montar() });
    porOs.set(osId, atual);
  };

  produtos.forEach((linha) => {
    const produto = juncao(linha.produto);
    acrescentar(linha, () => ({
      origem: "CATALOGO",
      tipo: "PRODUTO",
      // `titulo` antes de `descricao`, como na tela de orçamento.
      codigo: texto(produto?.referencia),
      descricao: texto(produto?.titulo) || texto(produto?.descricao),
      unidade: "",
      quantidade: Number(linha.quantidade ?? 0),
      precoUnitario: Number(linha.precounitario ?? 0),
      subtotal: Number(linha.subtotal ?? 0),
      chave: `catalogo-${(sequencia += 1)}`,
    }));
  });

  avulsos.forEach((linha) =>
    acrescentar(linha, () => ({
      origem: "AVULSO",
      tipo: "PRODUTO",
      codigo: "",
      descricao: texto(linha.titulo),
      unidade: "",
      quantidade: Number(linha.quantidade ?? 0),
      precoUnitario: Number(linha.precounitario ?? 0),
      subtotal: Number(linha.subtotal ?? 0),
      chave: `avulso-${(sequencia += 1)}`,
    })),
  );

  servicos.forEach((linha) => {
    const servico = juncao(linha.servico);
    acrescentar(linha, () => ({
      origem: "SERVICO",
      tipo: "SERVICO",
      codigo: texto(servico?.codigo),
      // O texto específico daquela OS vence o do catálogo: é o que o cliente viu.
      descricao: texto(linha.descricao) || texto(servico?.descricao),
      unidade: "",
      quantidade: Number(linha.quantidade ?? 0),
      precoUnitario: Number(linha.precounitario ?? 0),
      subtotal: Number(linha.subtotal ?? 0),
      chave: `servico-${(sequencia += 1)}`,
    }));
  });

  historicos.forEach((linha) =>
    acrescentar(linha, () => ({
      origem: "HISTORICO",
      tipo: linha.tipo === "SERVICO" ? "SERVICO" : "PRODUTO",
      codigo: texto(linha.codigo_legado),
      descricao: texto(linha.descricao),
      unidade: texto(linha.unidade),
      quantidade: Number(linha.quantidade ?? 0),
      precoUnitario: Number(linha.preco_unitario ?? 0),
      subtotal: Number(linha.subtotal ?? 0),
      chave: `historico-${(sequencia += 1)}`,
    })),
  );

  return porOs;
}

/**
 * Produtos e serviços somados, por OS.
 *
 * As duas colunas não fecham com `orcamentototal`: aquele campo já traz o
 * desconto geral, o frete e o acréscimo financeiro da ordem, que são da OS
 * inteira e não pertencem a nenhum dos dois lados. O que se soma aqui é o
 * subtotal dos itens — já líquido do desconto de cada item —, que é o nível
 * onde a divisão entre produto e serviço de fato existe.
 */
function somarItensPorOs(itensPorOs: Map<number, LinhaItemOs[]>) {
  const totais = new Map<number, ItensDaOs>();

  for (const [osId, itens] of itensPorOs) {
    const soma: ItensDaOs = { produtos: 0, servicos: 0 };
    for (const item of itens) {
      if (item.tipo === "SERVICO") soma.servicos += item.subtotal;
      else soma.produtos += item.subtotal;
    }
    totais.set(osId, soma);
  }

  return totais;
}

/**
 * Desconto do próprio item, em reais.
 *
 * `subtotal` é gravado líquido, então o desconto é a diferença para o bruto. O
 * piso em zero importa: linha migrada pode ter subtotal acima do bruto por
 * arredondamento na migração, e "− R$ −0,03" no papel é pior que nada.
 */
function descontoDoItem(item: LinhaItemOs) {
  return Math.max(0, arredondarMoeda(item.quantidade * item.precoUnitario - item.subtotal));
}

type LinhaEventoOs = EventoFinanceiroOs & {
  ordemservicoid: number;
  descricao: string | null;
  detalhe: string | null;
};

/**
 * Os eventos financeiros de cada OS, já sem os cancelados e na ordem em que o
 * painel da tela os mostra.
 *
 * Ordenar aqui, e não na folha, é o que mantém o papel e a planilha contando a
 * mesma história — a mesma escolha feita para os itens. A regra vive em
 * `@/lib/ordens/eventos-financeiros`, junto da que o dialog usa.
 */
async function carregarEventosPorOs(ids: number[]) {
  const porOs = new Map<number, LinhaEventoOs[]>();
  if (!ids.length) return porOs;

  const linhas = await fetchAllSupabaseRowsByChunks<LinhaEventoOs, number>(ids, (chunk) =>
    supabaseAdmin
      .from("eventos_financeiros")
      .select("id, ordemservicoid, origem, natureza, status, descricao, detalhe, valor, produtoid, servicoid, chave_origem")
      .in("ordemservicoid", chunk)
      .order("ordemservicoid", { ascending: true })
      .order("id", { ascending: true }),
  );

  for (const linha of eventosAtivos(linhas)) {
    const osId = Number(linha.ordemservicoid);
    if (!Number.isFinite(osId)) continue;
    const atual = porOs.get(osId) ?? [];
    atual.push(linha);
    porOs.set(osId, atual);
  }

  for (const [osId, eventos] of porOs) porOs.set(osId, ordenarEventosDaOs(eventos));

  return porOs;
}

/**
 * As parcelas que fecham a OS, na ordem da regra única de `calcularTotaisOs`:
 * itens − desconto + frete = orçamento. O acréscimo financeiro sai à parte por
 * incidir sobre o orçamento já fechado, e não sobre os itens.
 *
 * O desconto e o acréscimo são gravados como tipo + valor (R$ ou %), nunca em
 * reais já resolvidos, então o relatório precisa refazer a mesma conta para ter
 * o número que de fato saiu do total. O desconto sai de `inferirDescontoGeralOs`
 * pelo subtotal gravado — é o mesmo caminho usado na origem da NF-e, e é o que
 * evita que uma OS ainda sem total vire 100% de desconto.
 */
function fecharOs(os: any) {
  const orcamento = arredondarMoeda(Number(os.orcamentototal ?? 0));
  const frete = sanitizarValorFrete(os.valor_frete);
  const desconto = inferirDescontoGeralOs({
    subtotal: os.subtotal,
    orcamentoTotal: orcamento,
    valorFrete: frete,
  });
  const acrescimoFinanceiro = calculateFinancialSurcharge(
    orcamento,
    os.acrescimo_financeiro_tipo,
    os.acrescimo_financeiro_valor,
  );
  return { desconto, frete, orcamento, acrescimoFinanceiro };
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
    const mode = searchParams.get("mode") === "financeiro" ? "financeiro" : "simples";
    // Só a folha de impressão pede os itens e os eventos, e só quando o usuário
    // marca a opção; o download pela tela de relatórios continua com uma aba só.
    const incluirItens = searchParams.get("itens") === "1";
    const incluirEventos = searchParams.get("eventos") === "1";
    // Custo e lucro moram atrás de uma permissão própria — a mesma que esconde
    // o painel de eventos no dialog da OS. Um relatório não pode ser a porta
    // dos fundos para o que a tela protege.
    if (incluirEventos) await requireOSEventosFinanceiros();
    const status = statusSelecionados(searchParams.get("status"));
    const prioridadeParam = safeText(searchParams.get("prioridade"), 20).toUpperCase();
    const prioridade = PRIORIDADES.has(prioridadeParam) ? prioridadeParam : "";
    const alvoParam = safeText(searchParams.get("alvoTipo"), 20).toUpperCase();
    const alvoTipo = ALVOS.has(alvoParam) ? alvoParam : "";
    const responsavelParam = safeText(searchParams.get("responsavelId"), 40);
    const responsavelId = UUID.test(responsavelParam) ? responsavelParam : "";
    const dateFrom = safeText(searchParams.get("dateFrom"), 10);
    const dateTo = safeText(searchParams.get("dateTo"), 10);
    const ordemId = integer(searchParams.get("ordemId"));
    const clienteId = integer(searchParams.get("clienteId"));
    const setorId = integer(searchParams.get("setorId"));
    const natureza = safeText(searchParams.get("natureza"), 20);
    const eventoStatus = safeText(searchParams.get("eventoStatus"), 20);
    // Eixo do período. Conclusão usa `execucao_fim_em`, carimbado pelo sistema
    // quando a execução termina — é a mesma referência do DRE. `datasaida` fica
    // de fora de propósito: é digitada à mão e há OS com saída antes da entrada.
    const colunaPeriodo = searchParams.get("campoData") === "conclusao" ? "execucao_fim_em" : "dataentrada";

    const buildOsQuery = () => {
      let query = supabaseAdmin
        .from("ordemservico")
        .select(`
          id, descricao, status, prioridade, dataentrada, datasaida, execucao_fim_em, orcamentototal,
          subtotal, valor_frete, acrescimo_financeiro_tipo, acrescimo_financeiro_valor,
          alvo_tipo, equipamento_nome, equipamento_patrimonio, equipamento_ano, equipamento_horimetro,
          migracao_referencia, cliente_snapshot, veiculo_snapshot,
          cliente:clienteid(id, nomerazaosocial, cpfcnpj),
          veiculo:veiculoid(id, placa, marca, modelo),
          peca:pecaid(id, titulo, descricao),
          setor:setorid(id, nome),
          usuario:usuario!usuariocriadorid(id, nome)
        `)
        .eq("is_deleted", false)
        .order(colunaPeriodo, { ascending: true })
        .order("id", { ascending: true });
      if (status.length === 1) query = query.eq("status", status[0]);
      if (status.length > 1) query = query.in("status", status);
      if (dateFrom) query = query.gte(colunaPeriodo, startOfDay(dateFrom));
      if (dateTo) query = query.lt(colunaPeriodo, nextDay(dateTo));
      if (ordemId) query = query.eq("id", ordemId);
      if (clienteId) query = query.eq("clienteid", clienteId);
      if (setorId) query = query.eq("setorid", setorId);
      if (prioridade) query = query.eq("prioridade", prioridade);
      // OS antiga nasceu sem `alvo_tipo` e sempre foi tratada como veículo.
      if (alvoTipo === "VEICULO") query = query.or("alvo_tipo.is.null,alvo_tipo.eq.VEICULO");
      else if (alvoTipo) query = query.eq("alvo_tipo", alvoTipo);
      if (responsavelId) query = query.eq("usuariocriadorid", responsavelId);
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
      const itensPorOs = await carregarItensPorOs(ordens.map((os) => Number(os.id)), incluirItens);
      const totaisPorOs = somarItensPorOs(itensPorOs);
      const rows = ordens.map((os) => {
        const itens = totaisPorOs.get(Number(os.id)) ?? { produtos: 0, servicos: 0 };
        const fechamento = fecharOs(os);
        return [
          os.id,
          formatDate(os.dataentrada),
          formatDate(os.execucao_fim_em),
          formatDate(os.datasaida),
          os.status ?? "",
          os.prioridade ?? "",
          resolveOrdemCustomer(os.cliente, os.cliente_snapshot)?.nomerazaosocial ?? "Sem cliente",
          resolveOrdemCustomer(os.cliente, os.cliente_snapshot)?.cpfcnpj ?? "",
          targetLabel(os),
          os.setor?.nome ?? "Sem setor",
          os.usuario?.nome ?? "Não informado",
          os.descricao ?? "",
          arredondarMoeda(itens.produtos),
          arredondarMoeda(itens.servicos),
          fechamento.desconto,
          fechamento.frete,
          fechamento.orcamento,
          fechamento.acrescimoFinanceiro,
        ];
      });
      const abas: SheetSpec[] = [
        {
          name: "Relatório",
          headers: ["OS", "Entrada", "Conclusão", "Saída", "Status", "Prioridade", "Cliente", "CPF/CNPJ", "Alvo atendido", "Setor", "Responsável", "Descrição", "Produtos (R$)", "Serviços (R$)", "Desconto (R$)", "Frete (R$)", "Orçamento (R$)", "Acréscimo financeiro (R$)"],
          rows,
          widths: [9, 20, 20, 20, 24, 12, 35, 20, 35, 22, 26, 45, 16, 16, 16, 14, 18, 24],
        },
      ];

      if (incluirItens) {
        // Agrupada na mesma ordem da aba principal, para a folha distribuir os
        // itens numa passada só, sem reordenar nada.
        const linhasDeItens = ordens.flatMap((os) =>
          (itensPorOs.get(Number(os.id)) ?? []).map((item) => [
            os.id,
            ROTULO_ORIGEM[item.origem],
            item.tipo === "SERVICO" ? "Serviço" : "Produto",
            item.codigo,
            item.descricao,
            item.unidade,
            item.quantidade,
            arredondarMoeda(item.precoUnitario),
            descontoDoItem(item),
            arredondarMoeda(item.subtotal),
          ]),
        );
        abas.push({
          name: "Itens",
          headers: ["OS", "Origem", "Tipo", "Código", "Descrição", "Unidade", "Quantidade", "Preço unitário (R$)", "Desconto do item (R$)", "Subtotal (R$)"],
          rows: linhasDeItens,
          widths: [9, 12, 12, 16, 45, 10, 12, 18, 20, 16],
        });
      }

      if (incluirEventos) {
        const eventosPorOs = await carregarEventosPorOs(ordens.map((os) => Number(os.id)));
        const linhasDeEventos = ordens.flatMap((os) =>
          (eventosPorOs.get(Number(os.id)) ?? []).map((evento) => [
            os.id,
            evento.origem,
            evento.natureza,
            evento.status,
            texto(evento.descricao),
            texto(evento.detalhe),
            arredondarMoeda(Number(evento.valor ?? 0)),
          ]),
        );
        abas.push({
          name: "Eventos",
          headers: ["OS", "Origem", "Natureza", "Situação", "Descrição", "Detalhe", "Valor (R$)"],
          rows: linhasDeEventos,
          widths: [9, 16, 12, 14, 45, 32, 16],
        });
      }

      const buffer = makeWorkbookFrom(abas);
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
        formatDate(os?.execucao_fim_em),
        formatDate(os?.datasaida),
        os?.usuario?.nome ?? "Não informado",
        resolveOrdemCustomer(os?.cliente, os?.cliente_snapshot)?.nomerazaosocial ?? "Sem cliente",
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
        headers: ["OS", "Status da OS", "Entrada da OS", "Conclusão da OS", "Saída da OS", "Criador da OS", "Cliente", "Alvo atendido", "Evento", "Data do evento", "Origem", "Chave origem", "Natureza", "Descrição", "Detalhe", "Valor (R$)", "Status do evento", "Transação", "Quantidade snapshot", "Valor unitário snapshot", "Percentual snapshot", "Base snapshot", "Receitas da OS", "Despesas da OS", "Resultado da OS"],
        rows,
        widths: [9, 22, 20, 20, 20, 26, 32, 32, 10, 20, 14, 16, 12, 42, 32, 16, 18, 12, 18, 22, 20, 18, 18, 18, 18],
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
