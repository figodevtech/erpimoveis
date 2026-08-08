import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceiroCreate } from "@/app/api/_authz/perms";
import { dataDoCalendario } from "@/lib/data-calendario";

type Params = { params: Promise<{ id: string }> };

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number;
}

export async function POST(req: Request, { params }: Params) {
  try {
    await requireFinanceiroCreate();
    const { id: rawId } = await params;
    const entryId = Number(rawId);

    if (!Number.isInteger(entryId) || entryId <= 0) {
      return NextResponse.json({ error: "ID de entrada inválido." }, { status: 400 });
    }

    const body = await req.json();
    const inventory = String(body?.inventory ?? "produto").toLowerCase();
    const isUsoConsumo = inventory === "usoconsumo" || inventory === "uso-consumo";
    const table = isUsoConsumo ? "usoconsumo_entrada" : "entrada";
    const fkField = isUsoConsumo ? "usoconsumo_entrada_id" : "entrada_id";

    // 1. Busca a entrada para validar existencia, cancelamento e fornecedor
    const { data: entrada, error: fetchErr } = await supabaseAdmin
      .from(table)
      .select("id, status, cancelada_at, valor_total, fornecedor:fornecedorid(id, cpfcnpj, nomerazaosocial)")
      .eq("id", entryId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!entrada) {
      return NextResponse.json({ error: "Entrada não encontrada." }, { status: 404 });
    }
    if (entrada.cancelada_at || entrada.status === "CANCELADA") {
      return NextResponse.json({ error: "Não é possível lançar financeiro para uma entrada cancelada." }, { status: 409 });
    }

    // 2. Verifica se ja existem transacoes ativas vinculadas
    const { data: existingTx, error: txCheckErr } = await supabaseAdmin
      .from("transacao")
      .select("id")
      .eq(fkField, entryId)
      .eq("is_deleted", false);

    if (txCheckErr) throw txCheckErr;
    if (existingTx && existingTx.length > 0) {
      return NextResponse.json(
        { error: "Esta entrada já possui lançamentos financeiros registrados no sistema." },
        { status: 409 },
      );
    }

    const financeiro = body?.financeiro ?? body;
    const futuro = Boolean(financeiro?.isPagamentoFuturo ?? financeiro?.pagamentoFuturo ?? true);
    const parcelas = Array.isArray(financeiro?.parcelas) ? financeiro.parcelas : [];

    const fornecedorObj = Array.isArray(entrada.fornecedor) ? entrada.fornecedor[0] : entrada.fornecedor;
    const nomePagador = text(financeiro?.nomePagador ?? fornecedorObj?.nomerazaosocial) ?? "Fornecedor";
    const cpfCnpjPagador = digits(financeiro?.cpfCnpjPagador ?? fornecedorObj?.cpfcnpj) || "NÃO INFORMADO";

    const base = {
      metodopagamento: text(financeiro?.metodoPagamento ?? financeiro?.metodopagamento),
      categoria: text(financeiro?.categoria) ?? "NÃO RELACIONADO",
      categoria_id: financeiro?.categoriaId ? Number(financeiro.categoriaId) : null,
      banco_id: financeiro?.bancoId ? Number(financeiro.bancoId) : null,
      plano_de_conta_id: financeiro?.planoContaId ? Number(financeiro.planoContaId) : null,
      plano_de_conta: text(financeiro?.planoConta),
      centro_custo_id: financeiro?.centroCustoId ? Number(financeiro.centroCustoId) : null,
      centro_custo: text(financeiro?.centroCusto),
      nomepagador: nomePagador,
      cpfcnpjpagador: cpfCnpjPagador,
      tipo: "DESPESA" as const,
      [fkField]: entryId,
    };

    let rowsToInsert: any[] = [];

    if (futuro) {
      if (!parcelas.length) {
        return NextResponse.json({ error: "Informe ao menos uma parcela para o lançamento futuro." }, { status: 400 });
      }
      rowsToInsert = parcelas.map((parcela: any, index: number) => ({
        ...base,
        descricao: `${text(financeiro?.descricaoTransacao ?? financeiro?.descricao) ?? "Compra de mercadorias"}${parcelas.length > 1 ? ` - Parcela ${index + 1}/${parcelas.length}` : ""}`,
        valor: positiveNumber(parcela.valor),
        valorLiquido: positiveNumber(parcela.valor),
        data: dataDoCalendario(parcela.dataVencimento ?? parcela.data) ?? new Date().toISOString(),
        vencimento_em: dataDoCalendario(parcela.dataVencimento ?? parcela.data),
        pendente: true,
      }));
    } else {
      if (!base.banco_id) {
        return NextResponse.json({ error: "Selecione a conta bancária para lançar o pagamento à vista." }, { status: 400 });
      }
      if (!base.metodopagamento) {
        return NextResponse.json({ error: "Selecione o método de pagamento." }, { status: 400 });
      }
      const valorTotal = positiveNumber(financeiro?.valorTotal ?? entrada.valor_total);
      rowsToInsert = [
        {
          ...base,
          descricao: text(financeiro?.descricaoTransacao ?? financeiro?.descricao) ?? "Compra de mercadorias",
          valor: valorTotal,
          valorLiquido: valorTotal,
          data: dataDoCalendario(financeiro?.dataPagamento) ?? new Date().toISOString(),
          pendente: false,
        },
      ];
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("transacao")
      .insert(rowsToInsert)
      .select("id");

    if (insertErr) throw insertErr;

    return NextResponse.json({
      success: true,
      count: inserted?.length ?? 0,
      transacoes: inserted,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao lançar financeiro para a entrada." },
      { status: error?.statusCode ?? 500 },
    );
  }
}
