export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { carregarFatiasRateadas, fatiaComoTransacao } from "@/lib/financeiro/rateio-documentos";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPaymentMethodValues } from "@/lib/payment-methods-server";

type Origem = "VENDA";

type MetodoPagamentoResumo = {
  metodo: string;
  valor: number;
  parcelas?: number | null;
};

type Cobranca = {
  chave: string;
  origem: Origem;
  id: number;
  status: string;
  cliente: string;
  setor: { id: number; nome: string } | null;
  responsavel: string | null;
  descricao: string | null;
  referencia: string | null;
  data: string | null;
  atualizadoEm: string | null;
  total: number;
  pago: number;
  saldo: number;
  percentual: number;
  ultimoPagamentoEm: string | null;
  pagamentosPrevistos: MetodoPagamentoResumo[] | null;
  pagamentosExecutados: MetodoPagamentoResumo[] | null;
};

const VENDA_SELECT = `
  id, status, valortotal, datavenda, updatedat, canal, forma_pagamento,
  cliente:clienteid ( id, nomerazaosocial ),
  categoria:categoriavendaid ( id, nome ),
  vendedor_rel:vendedor (
    id, nome,
    setor:setorid ( id, nome )
  )
`;

/** Agrupa transações executadas por método de pagamento (soma valor + conta parcelas). */
function agruparPagamentosExecutados(
  transacoes: Array<{ metodopagamento: string | null; valor: unknown }>,
): MetodoPagamentoResumo[] | null {
  if (!transacoes.length) return null;
  const porMetodo = new Map<string, { valor: number; parcelas: number }>();
  for (const transacao of transacoes) {
    const metodo = transacao.metodopagamento || "NAO_INFORMADO";
    const atual = porMetodo.get(metodo) ?? { valor: 0, parcelas: 0 };
    atual.valor = moeda(atual.valor + numero(transacao.valor));
    atual.parcelas += 1;
    porMetodo.set(metodo, atual);
  }
  return Array.from(porMetodo.entries()).map(([metodo, dados]) => ({
    metodo,
    valor: dados.valor,
    parcelas: dados.parcelas > 1 ? dados.parcelas : null,
  }));
}

function parseValorMonetario(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : null;
}

/**
 * Separa os métodos de `forma_pagamento`.
 *
 * `split(",")` direto não serve: o valor em pt-BR também tem vírgula, então
 * "PIX: R$ 3.000,00" virava ["PIX: R$ 3.000", "00"] e o "00" órfão derrubava o
 * parse para o fallback de texto legado — o badge mostrava a string inteira como
 * se fosse o nome do método. Só quebra quando o trecho seguinte começa com um
 * método conhecido.
 */
function separarMetodosPagamento(texto: string, metodosValidos: Set<string>): string[] {
  const entradas: string[] = [];
  let atual = "";

  for (const trecho of texto.split(",")) {
    const candidato = trecho.trim().split(":")[0].trim().toUpperCase();

    if (atual && metodosValidos.has(candidato)) {
      entradas.push(atual.trim());
      atual = trecho;
    } else {
      atual = atual ? `${atual},${trecho}` : trecho;
    }
  }

  if (atual.trim()) entradas.push(atual.trim());
  return entradas;
}

/**
 * `forma_pagamento` guarda texto livre: pode ser "PIX", "PIX, BOLETO" ou, desde o
 * seletor multi-método, "BOLETO: R$ 9.000,00" / "PIX: R$ 3.000,00, BOLETO: R$ 6.000,00".
 * Sem isso, a string inteira (com o valor embutido) acabava virando o "método" do badge.
 */
function parseFormaPagamentoTexto(
  raw: string | null | undefined,
  totalFallback: number,
  parcelasFallback: number | null,
  metodosValidos: Set<string>,
): MetodoPagamentoResumo[] | null {
  const texto = String(raw ?? "").trim();
  if (!texto) return null;

  const partes = separarMetodosPagamento(texto, metodosValidos);
  if (!partes.length) return null;

  const entradas: MetodoPagamentoResumo[] = [];
  for (const parte of partes) {
    const [metodoBruto, ...valorPartes] = parte.split(":");
    const metodo = metodoBruto.trim().toUpperCase();
    if (!metodosValidos.has(metodo)) {
      // Texto legado nao reconhecido: mostra como veio, sem tentar separar valor.
      return [{ metodo: texto, valor: totalFallback, parcelas: parcelasFallback }];
    }

    const valorTexto = valorPartes.join(":").trim();
    const valor = valorTexto ? parseValorMonetario(valorTexto) : null;
    entradas.push({ metodo, valor: valor ?? 0, parcelas: null });
  }

  if (entradas.length === 1 && entradas[0].valor === 0) {
    entradas[0].valor = totalFallback;
    entradas[0].parcelas = parcelasFallback;
  }

  return entradas;
}

function numero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moeda(value: number) {
  return Math.round(value * 100) / 100;
}

function errorResponse(error: any) {
  const status = Number(error?.statusCode) || (error?.message === "Não autenticado" ? 401 : 500);
  return NextResponse.json(
    { error: error?.message || "Falha ao carregar acompanhamento financeiro" },
    { status },
  );
}

export async function GET(req: NextRequest) {
  try {
    await requireFinanceirosAccess();
    const metodosPagamentoValidos = new Set(await getPaymentMethodValues());

    const { searchParams } = new URL(req.url);
    const setorId = numero(searchParams.get("setorId")) || null;
    const origemParam = String(searchParams.get("origem") || "TODAS").toUpperCase();
    const origem = origemParam === "VENDA" ? origemParam : "TODAS";
    const horasRecentes = Math.min(168, Math.max(1, numero(searchParams.get("horasRecentes")) || 24));
    const limite = Math.min(1000, Math.max(10, numero(searchParams.get("limit")) || 500));
    const desde = new Date(Date.now() - horasRecentes * 60 * 60 * 1000).toISOString();

    const vendasResult = await supabaseAdmin
      .from("venda")
      .select(VENDA_SELECT)
      .in("status", ["PAGAMENTO", "PAGO", "FINALIZADA"])
      .order("updatedat", { ascending: false })
      .limit(limite);
    if (vendasResult.error) throw vendasResult.error;

    const vendas = (vendasResult.data ?? []) as any[];
    const vendaIds = vendas.map((item) => Number(item.id)).filter(Number.isFinite);

    const transacoesVendasResult = vendaIds.length
      ? await supabaseAdmin
          .from("transacao")
          .select("id, vendaid, valor, data, tipo, metodopagamento")
          .in("vendaid", vendaIds)
          .eq("is_deleted", false)
          .eq("tipo", "RECEITA")
      : { data: [], error: null };
    if (transacoesVendasResult.error) throw transacoesVendasResult.error;

    // As fatias do pagamento múltiplo entram na mesma lista: a transação de
    // grupo não aponta para documento nenhum, e sem elas a venda paga em grupo
    // apareceria como não recebida.
    const fatiasVendas = await carregarFatiasRateadas("VENDA", vendaIds);
    const transacoesVendas = [
      ...((transacoesVendasResult.data ?? []) as any[]),
      ...[...fatiasVendas.values()].flat().map((fatia) => ({
        ...fatiaComoTransacao(fatia),
        vendaid: fatia.documentoId,
      })),
    ];

    // Transações pendentes (lançadas mas ainda não baixadas) contam como pagas aqui:
    // a venda já foi marcada como concluída pelo valor lançado, então o painel
    // precisa refletir isso para o item não ficar "preso" em Aguardando.
    const pagamentosVendas = new Map<number, { total: number; ultimo: string | null }>();
    const transacoesPorVenda = new Map<number, Array<{ metodopagamento: string | null; valor: unknown }>>();
    for (const transacao of transacoesVendas) {
      const id = Number(transacao.vendaid);
      const atual = pagamentosVendas.get(id) ?? { total: 0, ultimo: null };
      atual.total += numero(transacao.valor);
      if (transacao.data && (!atual.ultimo || transacao.data > atual.ultimo)) atual.ultimo = transacao.data;
      pagamentosVendas.set(id, atual);
      const lista = transacoesPorVenda.get(id) ?? [];
      lista.push({ metodopagamento: transacao.metodopagamento ?? null, valor: transacao.valor });
      transacoesPorVenda.set(id, lista);
    }

    const cobrancas: Cobranca[] = [];

    for (const venda of vendas) {
      const pagamento = pagamentosVendas.get(Number(venda.id)) ?? { total: 0, ultimo: null };
      const total = moeda(numero(venda.valortotal));
      const pago = moeda(pagamento.total);
      const finalizada = venda.status === "FINALIZADA" || venda.status === "PAGO";
      const atualizadoEm = venda.updatedat ?? null;
      if (finalizada && (!atualizadoEm || new Date(atualizadoEm).getTime() < new Date(desde).getTime())) continue;

      const setorVenda = venda.vendedor_rel?.setor ?? null;
      if (setorId && Number(setorVenda?.id) !== setorId) continue;

      const pagamentosPrevistos: MetodoPagamentoResumo[] | null = parseFormaPagamentoTexto(
        venda.forma_pagamento,
        total,
        null,
        metodosPagamentoValidos,
      );

      cobrancas.push({
        chave: `VENDA-${venda.id}`,
        origem: "VENDA",
        id: Number(venda.id),
        status: String(venda.status),
        cliente: venda.cliente?.nomerazaosocial || "Cliente não informado",
        setor: setorVenda ? { id: Number(setorVenda.id), nome: setorVenda.nome } : null,
        responsavel: venda.vendedor_rel?.nome ?? null,
        descricao: venda.categoria?.nome ? `Categoria: ${venda.categoria.nome}` : null,
        referencia: venda.canal ? `Canal: ${String(venda.canal).replaceAll("_", " ")}` : null,
        data: venda.datavenda ?? null,
        atualizadoEm,
        total,
        pago,
        saldo: moeda(Math.max(0, total - pago)),
        percentual: total > 0 ? Math.min(100, Math.round((pago / total) * 100)) : 0,
        ultimoPagamentoEm: pagamento.ultimo,
        pagamentosPrevistos,
        pagamentosExecutados: agruparPagamentosExecutados(transacoesPorVenda.get(Number(venda.id)) ?? []),
      });
    }

    const recebidos = cobrancas
      .filter((item) => item.total > 0 && item.pago >= item.total - 0.009)
      .sort((a, b) => String(b.ultimoPagamentoEm ?? b.atualizadoEm).localeCompare(String(a.ultimoPagamentoEm ?? a.atualizadoEm)));
    const parciais = cobrancas
      .filter((item) => item.pago > 0 && (item.total <= 0 || item.pago < item.total - 0.009))
      .sort((a, b) => b.saldo - a.saldo);
    const aguardando = cobrancas
      .filter((item) => item.pago <= 0 || item.total <= 0)
      .sort((a, b) => String(a.data).localeCompare(String(b.data)));

    return NextResponse.json({
      aguardando,
      parciais,
      recebidos,
      resumo: {
        quantidade: cobrancas.length,
        aReceber: moeda([...aguardando, ...parciais].reduce((acc, item) => acc + item.saldo, 0)),
        recebido: moeda(cobrancas.reduce((acc, item) => acc + item.pago, 0)),
        total: moeda(cobrancas.reduce((acc, item) => acc + item.total, 0)),
      },
      meta: {
        setorId,
        origem,
        horasRecentes,
        atualizadoEm: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("[GET] /api/acompanhamento/financeiro", error);
    return errorResponse(error);
  }
}
