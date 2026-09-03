export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  requireEstoqueEdit,
  requireOSEdit,
  requireOSEventosFinanceiros,
  requireUsoConsumoSaida,
} from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Consumo de estoque na OS: uma baixa e uma despesa, na mesma transacao.
 *
 * O trabalho todo mora na RPC `registrar_consumo_produto_os`, que reusa as RPCs
 * de saida existentes — e delas que vem a trava de linha, a checagem de saldo e
 * o carimbo da origem no razao. Aqui ficam a autorizacao, o formato do corpo e a
 * traducao dos erros do banco.
 */

/** Os tres estoques do ERP. `PRODUTO` e o de venda; os outros dois sao os simples. */
const ESCOPOS = ["PRODUTO", "USOCONSUMO", "GERAL"] as const;

const consumoSchema = z
  .object({
    escopo: z.enum(ESCOPOS),
    itemId: z.coerce.number().int().positive(),
    quantidade: z.coerce.number().int().positive(),
    descricao: z.string().trim().min(1, "Informe o título da despesa.").max(200),
    detalhe: z.string().trim().max(500).optional().nullable(),
    observacao: z.string().trim().max(500).optional().nullable(),
    /** Ausente = custo do cadastro. Presente = correcao manual, e a RPC marca a linha. */
    valor: z.coerce.number().nonnegative().optional(),
    podeGerarTransacao: z.boolean().default(false),
  })
  .strict();

function idValido(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Mesmo mapa de `/api/estoque/saidas`: regra de negocio do banco nao e erro 500. */
function statusDoErro(code: string | undefined, message: string) {
  if (code === "P0002") return 404;
  if (code === "P0001" || code === "23514" || message.includes("Estoque insuficiente")) return 409;
  if (code === "22023") return 400;
  return 500;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOSEdit();
    await requireOSEventosFinanceiros();

    const osId = idValido((await params).id);
    if (!osId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

    const parsed = consumoSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join(" ") },
        { status: 400 },
      );
    }
    const corpo = parsed.data;

    // Quem registra o consumo precisa poder mexer NAQUELE estoque, e nao apenas
    // na OS: a operacao tira saldo de verdade do inventario.
    if (corpo.escopo === "PRODUTO") await requireEstoqueEdit();
    else await requireUsoConsumoSaida();

    const session = await auth().catch(() => null);
    const createdBy = (session?.user as { id?: string } | undefined)?.id ?? null;

    const { data, error } = await supabaseAdmin.rpc("registrar_consumo_produto_os", {
      p_payload: {
        ordemservicoid: osId,
        escopo: corpo.escopo,
        item_id: corpo.itemId,
        quantidade: corpo.quantidade,
        descricao: corpo.descricao,
        detalhe: corpo.detalhe || null,
        observacao: corpo.observacao || null,
        valor: corpo.valor ?? null,
        pode_gerar_transacao: corpo.podeGerarTransacao,
        created_by: createdBy,
      },
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusDoErro(error.code, error.message ?? "") },
      );
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    return NextResponse.json(
      { error: erro?.message || "Não foi possível registrar o consumo." },
      { status: erro?.statusCode || 500 },
    );
  }
}
