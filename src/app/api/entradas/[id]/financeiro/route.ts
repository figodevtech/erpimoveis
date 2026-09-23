import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireFinanceiroCreate } from "@/app/api/_authz/perms";
import { dataDoCalendario } from "@/lib/data-calendario";
import { calcularTotalDocumentoEntrada, parcelasFechamTotalDocumento } from "@/lib/financeiro/entrada-fiscal";
import { paraCentavos } from "@/lib/financeiro/rateio";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

type FornecedorEntrada = {
  id?: number | null;
  cpfcnpj?: string | null;
  nomerazaosocial?: string | null;
  nomefantasia?: string | null;
} | null;

type LadoEntradaFinanceira = {
  id: number;
  status: string;
  canceladaAt: string | null;
  valorTotal: number;
  documentoId: number | null;
  chave: string | null;
  numeroNota: string | null;
  fornecedor: FornecedorEntrada;
};

type ContextoEntradaFinanceira = {
  selecionada: LadoEntradaFinanceira;
  estoque: LadoEntradaFinanceira | null;
  usoconsumo: LadoEntradaFinanceira | null;
  valorTotal: number;
  mista: boolean;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function nullablePositiveInt(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function chaveFiscal(value: unknown) {
  const normalized = digits(value);
  return normalized.length === 44 ? normalized : null;
}

function mapEntradaEstoque(data: any): LadoEntradaFinanceira {
  return {
    id: Number(data.id),
    status: String(data.status ?? ""),
    canceladaAt: data.cancelada_at ?? null,
    valorTotal: Number(data.valor_total ?? 0),
    documentoId: nullablePositiveInt(data.fiscal_dfe_documento_id),
    chave: chaveFiscal(data.notachave),
    numeroNota: text(data.numero_nota),
    fornecedor: relationOne(data.fornecedor),
  };
}

function mapEntradaUsoConsumo(data: any): LadoEntradaFinanceira {
  return {
    id: Number(data.id),
    status: String(data.status ?? ""),
    canceladaAt: data.cancelada_at ?? null,
    valorTotal: Number(data.valor_total ?? 0),
    documentoId: nullablePositiveInt(data.documento_fiscal_recebido_id),
    chave: chaveFiscal(data.chave_nfe),
    numeroNota: text(data.numero_nota),
    fornecedor: relationOne(data.fornecedor),
  };
}

const CAMPOS_ENTRADA_ESTOQUE =
  "id,status,cancelada_at,valor_total,fiscal_dfe_documento_id,notachave,numero_nota,fornecedor:fornecedorid(id,cpfcnpj,nomerazaosocial,nomefantasia)";
const CAMPOS_ENTRADA_USO =
  "id,status,cancelada_at,valor_total,documento_fiscal_recebido_id,chave_nfe,numero_nota,fornecedor:fornecedor_id(id,cpfcnpj,nomerazaosocial,nomefantasia)";

async function entradaEstoquePorId(id: number) {
  const { data, error } = await supabaseAdmin
    .from("entrada")
    .select(CAMPOS_ENTRADA_ESTOQUE)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapEntradaEstoque(data) : null;
}

async function entradaUsoPorId(id: number) {
  const { data, error } = await supabaseAdmin
    .from("usoconsumo_entrada")
    .select(CAMPOS_ENTRADA_USO)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapEntradaUsoConsumo(data) : null;
}

async function entradaEstoqueRelacionada(documentoId: number | null, chave: string | null) {
  if (documentoId) {
    const { data, error } = await supabaseAdmin
      .from("entrada")
      .select(CAMPOS_ENTRADA_ESTOQUE)
      .eq("fiscal_dfe_documento_id", documentoId)
      .neq("status", "CANCELADA")
      .maybeSingle();
    if (error) throw error;
    if (data) return mapEntradaEstoque(data);
  }

  if (!chave) return null;
  const { data, error } = await supabaseAdmin
    .from("entrada")
    .select(CAMPOS_ENTRADA_ESTOQUE)
    .eq("notachave", chave)
    .neq("status", "CANCELADA")
    .maybeSingle();
  if (error) throw error;
  return data ? mapEntradaEstoque(data) : null;
}

async function entradaUsoRelacionada(documentoId: number | null, chave: string | null) {
  if (documentoId) {
    const { data, error } = await supabaseAdmin
      .from("usoconsumo_entrada")
      .select(CAMPOS_ENTRADA_USO)
      .eq("documento_fiscal_recebido_id", documentoId)
      .neq("status", "CANCELADA")
      .maybeSingle();
    if (error) throw error;
    if (data) return mapEntradaUsoConsumo(data);
  }

  if (!chave) return null;
  const { data, error } = await supabaseAdmin
    .from("usoconsumo_entrada")
    .select(CAMPOS_ENTRADA_USO)
    .eq("chave_nfe", chave)
    .neq("status", "CANCELADA")
    .maybeSingle();
  if (error) throw error;
  return data ? mapEntradaUsoConsumo(data) : null;
}

async function carregarContextoEntrada(entryId: number, isUsoConsumo: boolean) {
  const selecionada = isUsoConsumo
    ? await entradaUsoPorId(entryId)
    : await entradaEstoquePorId(entryId);
  if (!selecionada) {
    throw Object.assign(new Error("Entrada não encontrada."), { statusCode: 404 });
  }

  const estoque = isUsoConsumo
    ? await entradaEstoqueRelacionada(selecionada.documentoId, selecionada.chave)
    : selecionada;
  const usoconsumo = isUsoConsumo
    ? selecionada
    : await entradaUsoRelacionada(selecionada.documentoId, selecionada.chave);
  const valorTotal = calcularTotalDocumentoEntrada(
    estoque?.valorTotal,
    usoconsumo?.valorTotal,
  );

  return {
    selecionada,
    estoque,
    usoconsumo,
    valorTotal,
    mista: Boolean(estoque && usoconsumo),
  } satisfies ContextoEntradaFinanceira;
}

async function buscarTransacoesAtivas(
  contexto: ContextoEntradaFinanceira,
  campos = "id,descricao,valor,data,pendente,is_deleted,entrada_id,usoconsumo_entrada_id",
) {
  let query = supabaseAdmin
    .from("transacao")
    .select(campos)
    .eq("is_deleted", false);

  if (contexto.estoque && contexto.usoconsumo) {
    query = query.or(
      `entrada_id.eq.${contexto.estoque.id},usoconsumo_entrada_id.eq.${contexto.usoconsumo.id}`,
    );
  } else if (contexto.estoque) {
    query = query.eq("entrada_id", contexto.estoque.id);
  } else if (contexto.usoconsumo) {
    query = query.eq("usoconsumo_entrada_id", contexto.usoconsumo.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function GET(req: Request, { params }: Params) {
  try {
    await requireFinanceiroCreate();
    const { id: rawId } = await params;
    const entryId = Number(rawId);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return NextResponse.json({ error: "ID de entrada inválido." }, { status: 400 });
    }

    const inventory = new URL(req.url).searchParams.get("inventory")?.toLowerCase();
    const isUsoConsumo = inventory === "usoconsumo" || inventory === "uso-consumo";
    const contexto = await carregarContextoEntrada(entryId, isUsoConsumo);
    const transacoes = await buscarTransacoesAtivas(contexto);

    return NextResponse.json({
      entrada: {
        id: contexto.selecionada.id,
        numero_nota: contexto.selecionada.numeroNota,
        fornecedor: contexto.selecionada.fornecedor,
        valor_total: contexto.valorTotal,
        valor_total_parcial: contexto.selecionada.valorTotal,
        valor_total_produtos: contexto.estoque?.valorTotal ?? 0,
        valor_total_usoconsumo: contexto.usoconsumo?.valorTotal ?? 0,
        entrada_id: contexto.estoque?.id ?? null,
        usoconsumo_entrada_id: contexto.usoconsumo?.id ?? null,
        mista: contexto.mista,
        transacoes,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao consultar os dados financeiros da entrada." },
      { status: error?.statusCode ?? 500 },
    );
  }
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
    const contexto = await carregarContextoEntrada(entryId, isUsoConsumo);
    const entrada = contexto.selecionada;

    if (entrada.canceladaAt || entrada.status === "CANCELADA") {
      return NextResponse.json(
        { error: "Não é possível lançar financeiro para uma entrada cancelada." },
        { status: 409 },
      );
    }

    // Em uma NF-e mista, qualquer lançamento de um dos lados pertence ao documento inteiro.
    const existingTx = await buscarTransacoesAtivas(contexto, "id");
    if (existingTx.length > 0) {
      return NextResponse.json(
        { error: "Esta entrada já possui lançamentos financeiros registrados no sistema." },
        { status: 409 },
      );
    }

    const financeiro = body?.financeiro ?? body;
    const futuro = Boolean(financeiro?.isPagamentoFuturo ?? financeiro?.pagamentoFuturo ?? true);
    const parcelas = Array.isArray(financeiro?.parcelas) ? financeiro.parcelas : [];

    const fornecedorObj = entrada.fornecedor;
    const nomePagador =
      text(financeiro?.nomePagador ?? fornecedorObj?.nomerazaosocial) ?? "Fornecedor";
    const cpfCnpjPagador =
      digits(financeiro?.cpfCnpjPagador ?? fornecedorObj?.cpfcnpj) || "NÃO INFORMADO";
    const valorTotalCentavos = paraCentavos(contexto.valorTotal);
    if (valorTotalCentavos <= 0) {
      return NextResponse.json(
        { error: "O total da entrada deve ser maior que zero." },
        { status: 400 },
      );
    }

    // Quem lancou o financeiro da entrada. Vem da sessao, nunca do corpo — e e
    // o que a listagem do fluxo usa para saber de quem e a linha.
    const session = await auth();
    const criadoPor = ((session?.user as { id?: string } | undefined)?.id as string | undefined) ?? null;

    const base = {
      created_by: criadoPor,
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
      fornecedor_id: fornecedorObj?.id ?? null,
      tipo: "DESPESA" as const,
      entrada_id: contexto.estoque?.id ?? null,
      usoconsumo_entrada_id: contexto.usoconsumo?.id ?? null,
      ...(contexto.mista
        ? { origem: "ENTRADA_FISCAL_MISTA" }
        : isUsoConsumo
          ? { origem: "USOCONSUMO_ENTRADA" }
          : {}),
    };

    let rowsToInsert: any[] = [];
    let parcelamentoId: number | null = null;

    if (futuro) {
      if (!parcelas.length) {
        return NextResponse.json(
          { error: "Informe ao menos uma parcela para o lançamento futuro." },
          { status: 400 },
        );
      }

      const valoresParcelas = parcelas.map((parcela: any) => positiveNumber(parcela.valor));
      if (valoresParcelas.some((valor: number) => valor <= 0)) {
        return NextResponse.json(
          { error: "Todas as parcelas devem ter valor maior que zero." },
          { status: 400 },
        );
      }
      if (!parcelasFechamTotalDocumento(contexto.valorTotal, valoresParcelas)) {
        return NextResponse.json(
          { error: "A soma das parcelas deve ser igual ao valor total do documento fiscal." },
          { status: 400 },
        );
      }

      const descricaoBase =
        text(financeiro?.descricaoTransacao ?? financeiro?.descricao) ?? "Compra de mercadorias";

      /*
       * Parcelamento de duas ou mais ganha grupo formal, como o lançamento
       * avulso do fluxo de caixa já faz (`POST /api/transaction`).
       *
       * É o grupo que autoriza reparcelar depois: sem ele a aba de parcelas
       * consegue reconstruir o conjunto pela descrição, mas não escrever nele —
       * e a divisão da compra ficaria permanente. A descrição do grupo é a base,
       * sem o sufixo, porque é dela que a renumeração é montada.
       */
      if (parcelas.length > 1) {
        const { data: grupo, error: grupoError } = await supabaseAdmin
          .from("transacao_parcelamento")
          .insert({ descricao: descricaoBase })
          .select("id")
          .single();

        if (grupoError) throw grupoError;
        parcelamentoId = Number(grupo.id);
      }

      rowsToInsert = parcelas.map((parcela: any, index: number) => {
        const valor = valoresParcelas[index];
        return {
          ...base,
          ...(parcelamentoId != null ? { parcelamento_id: parcelamentoId } : {}),
          descricao: `${descricaoBase}${parcelas.length > 1 ? ` - Parcela ${index + 1}/${parcelas.length}` : ""}`,
          valor,
          valorLiquido: valor,
          data:
            dataDoCalendario(parcela.dataVencimento ?? parcela.data) ?? new Date().toISOString(),
          vencimento_em: dataDoCalendario(parcela.dataVencimento ?? parcela.data),
          pendente: true,
        };
      });
    } else {
      if (!base.banco_id) {
        return NextResponse.json(
          { error: "Selecione a conta bancária para lançar o pagamento à vista." },
          { status: 400 },
        );
      }
      if (!base.metodopagamento) {
        return NextResponse.json(
          { error: "Selecione o método de pagamento." },
          { status: 400 },
        );
      }

      // O valor vem do documento persistido, nunca do navegador nem do recorte selecionado.
      const valorTotal = valorTotalCentavos / 100;
      rowsToInsert = [
        {
          ...base,
          descricao:
            text(financeiro?.descricaoTransacao ?? financeiro?.descricao) ??
            "Compra de mercadorias",
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

    if (insertErr) {
      // As parcelas não entraram: o grupo criado acima ficaria sem nenhuma linha
      // apontando para ele. Mesmo cuidado do lançamento avulso.
      if (parcelamentoId != null) {
        await supabaseAdmin.from("transacao_parcelamento").delete().eq("id", parcelamentoId);
      }
      throw insertErr;
    }

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
