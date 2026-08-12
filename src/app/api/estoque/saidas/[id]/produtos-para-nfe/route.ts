import { NextResponse } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import { resolverPadraoFiscalItem } from "@/lib/nfe/padraoFiscalItem";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buscarContextoFiscalSaida, buscarOperacaoFiscalSaida } from "@/services/fiscal/nfeSaidaService";
import { buscarContextoPadraoFiscal, buscarFiscalConfig } from "@/services/fiscal/nfeConfigService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export async function GET(_request: Request, context: Context) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const saidaId = Number(rawId);
    if (!Number.isInteger(saidaId) || saidaId <= 0) {
      return NextResponse.json({ ok: false, message: "Saída inválida." }, { status: 400 });
    }

    const { saida, contexto, destinatario } = await buscarContextoFiscalSaida(saidaId);
    // Saída sem contexto gravado não é erro: a natureza fiscal, a origem e o
    // destinatário são escolhidos no próprio diálogo de emissão. Responder 409
    // aqui era o que obrigava a passar por uma tela anterior só para gravar o
    // contexto antes de poder ver os itens.
    const operacao = contexto
      ? await buscarOperacaoFiscalSaida(contexto.operacao_fiscal_codigo)
      : null;
    if (contexto && !operacao) {
      throw new Error("A natureza fiscal gravada para esta saída não é mais válida.");
    }

    const config = await buscarFiscalConfig(MODELO_NFE);
    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from("empresa")
      .select("uf")
      .eq("id", config?.empresaid ?? 0)
      .maybeSingle();
    if (empresaError) throw empresaError;
    const { padrao, crt } = await buscarContextoPadraoFiscal(MODELO_NFE, "SAIDA", config?.empresaid);

    const entradaItemIds = (contexto?.itens ?? [])
      .map((item: any) => Number(item.entrada_item_origem_id ?? 0))
      .filter(Boolean);
    const entradaItemById = new Map<number, any>();
    if (entradaItemIds.length) {
      const { data, error } = await supabaseAdmin
        .from("entradaitens")
        .select("id, valor_unitario_compra, precovenda")
        .in("id", entradaItemIds);
      if (error) throw error;
      (data ?? []).forEach((item: any) => entradaItemById.set(Number(item.id), item));
    }
    const mappingByItemId = new Map<number, any>(
      (contexto?.itens ?? []).map((item: any) => [Number(item.saida_item_id), item]),
    );
    const ufDestino = String(destinatario?.estado ?? "").trim().toUpperCase();
    const ufEmitente = String(empresa?.uf ?? "").trim().toUpperCase();
    // Sem natureza escolhida ainda não há CFOP a sugerir. O diálogo preenche
    // assim que o operador escolhe a operação e a entrada de origem.
    const cfopSugerido = !operacao
      ? ""
      : ufEmitente && ufDestino && ufEmitente !== ufDestino
        ? operacao.cfopInterestadual
        : operacao.cfopInterno;

    const itens = (saida.itens ?? []).map((row: any) => {
      const produto = relationOne<any>(row.produto);
      const mapping = mappingByItemId.get(Number(row.id));
      const entradaItem = entradaItemById.get(Number(mapping?.entrada_item_origem_id ?? 0));
      const quantidade = numberValue(row.quantidade);
      const valorUnitario = numberValue(
        entradaItem?.valor_unitario_compra ?? entradaItem?.precovenda ?? row.valor_custo_aplicado,
      );
      const { campos: fiscal, procedencia } = resolverPadraoFiscalItem({
        fontes: [{ origem: "PRODUTO", valores: produto }],
        padrao,
        crt,
      });

      return {
        osProdutoId: String(row.id),
        sourceItemId: `saida:${saidaId}:${row.id}`,
        produtoId: Number(row.produto_id),
        titulo: String(produto?.titulo || `Produto #${row.produto_id}`),
        descricao: String(produto?.descricao || produto?.titulo || `Produto #${row.produto_id}`),
        quantidade,
        precoUnitario: valorUnitario,
        subtotal: Number((quantidade * valorUnitario).toFixed(2)),
        ncm: produto?.ncm ?? null,
        cest: produto?.cest ?? null,
        ...fiscal,
        // A natureza escolhida para a saída tem precedência apenas no CFOP.
        // Todos os demais tributos continuam vindo do produto/perfil e passam
        // pela revisão assistida antes do rascunho.
        // Sem CFOP configurado para a natureza (garantia/"outra"), deixa vazio
        // para o assistente bloquear e pedir uma decisão explícita. O CFOP de
        // venda do produto não pode classificar uma operação diferente.
        cfop: cfopSugerido || null,
        codigobarras: produto?.codigobarras ?? null,
        referencia: produto?.referencia ?? null,
        unidade: produto?.unidade ?? "UN",
        procedenciaFiscal: {
          ...procedencia,
          cfop: cfopSugerido ? "OPERACAO_SAIDA" : "VAZIO",
        },
      };
    });

    return NextResponse.json({
      ok: true,
      saidaId,
      tipo_operacao: "SAIDA",
      natureza_operacao: contexto?.natureza_operacao ?? "",
      observacoes_fiscais: contexto?.observacoes_fiscais ?? null,
      cliente: null,
      fornecedor: {
        id: destinatario?.fornecedorId ?? null,
        nome: destinatario?.nomeRazaoSocial ?? null,
        uf: destinatario?.estado ?? null,
      },
      destinatario,
      parceiro_erros: [],
      configuracao_fiscal: {
        consumidorFinal: false,
        indicadorPresenca: "0",
        pagamentos: [],
        modFrete: "9",
        valorFrete: 0,
      },
      itens,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao preparar os itens da NF-e de saída." },
      { status: error?.statusCode === 403 ? 403 : 500 },
    );
  }
}
