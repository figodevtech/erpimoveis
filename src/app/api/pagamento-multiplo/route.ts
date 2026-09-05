import { buscarFaturamentoOsHabilitado } from "@/lib/ordens/faturamento-server";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroCreate } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { RateioInvalidoError, paraCentavos } from "@/lib/financeiro/rateio";
import { podeRegistrarPagamentoOs } from "@/lib/ordens/financeiro";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { carregarSaldos, montarLinhas, type TipoDocumento } from "./_lib/preparar";

/** Teto de segurança: seleção maior que isso é engano, não operação. */
const LIMITE_DOCUMENTOS = 100;
const LIMITE_PARCELAS = 60;

const STATUS_VENDA_ACEITA = new Set(["PAGAMENTO", "ABERTA"]);

export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroCreate();

    const body = await req.json().catch(() => ({}));

    const tipoDocumento = String(body?.tipoDocumento ?? "").toUpperCase() as TipoDocumento;
    if (tipoDocumento !== "OS" && tipoDocumento !== "VENDA") {
      return NextResponse.json({ error: "tipoDocumento deve ser OS ou VENDA." }, { status: 400 });
    }

    const ids = [
      ...new Set(
        (Array.isArray(body?.documentoIds) ? body.documentoIds : [])
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isSafeInteger(id) && id > 0),
      ),
    ] as number[];

    if (ids.length === 0) {
      return NextResponse.json({ error: "Selecione ao menos um documento." }, { status: 400 });
    }
    if (ids.length > LIMITE_DOCUMENTOS) {
      return NextResponse.json(
        { error: `Selecione no máximo ${LIMITE_DOCUMENTOS} documentos por pagamento.` },
        { status: 400 },
      );
    }

    const modo = String(body?.modo ?? "AVISTA").toUpperCase();
    if (modo !== "AVISTA" && modo !== "PARCELADO") {
      return NextResponse.json({ error: "modo deve ser AVISTA ou PARCELADO." }, { status: 400 });
    }

    const quantidadeDeParcelas = modo === "PARCELADO" ? Number(body?.parcelas ?? 0) : 1;
    if (
      modo === "PARCELADO" &&
      (!Number.isSafeInteger(quantidadeDeParcelas) ||
        quantidadeDeParcelas < 2 ||
        quantidadeDeParcelas > LIMITE_PARCELAS)
    ) {
      return NextResponse.json(
        { error: `Informe de 2 a ${LIMITE_PARCELAS} parcelas.` },
        { status: 400 },
      );
    }

    const bancoId = Number(body?.bancoId);
    if (modo === "AVISTA" && (!Number.isSafeInteger(bancoId) || bancoId <= 0)) {
      return NextResponse.json(
        { error: "Informe o banco que recebeu o pagamento." },
        { status: 400 },
      );
    }

    const valorEmCentavos = paraCentavos(body?.valor);
    if (valorEmCentavos <= 0) {
      return NextResponse.json(
        { error: "O valor do pagamento deve ser maior que zero." },
        { status: 400 },
      );
    }

    const documentos = await carregarSaldos(tipoDocumento, ids);

    const faltando = ids.filter((id) => !documentos.some((documento) => documento.id === id));
    if (faltando.length > 0) {
      return NextResponse.json(
        { error: `Documento(s) não encontrado(s): ${faltando.map((id) => `#${id}`).join(", ")}.` },
        { status: 404 },
      );
    }

    // O status é do documento, não do pagamento: uma OS concluída ou cancelada não
    // aceita lançamento novo, e deixar passar aqui só produziria erro no banco.
    const faturamentoOs = tipoDocumento === "OS" && await buscarFaturamentoOsHabilitado();
    const bloqueados = documentos.filter((documento) =>
      tipoDocumento === "OS"
        ? !podeRegistrarPagamentoOs(documento.status, faturamentoOs)
        : !STATUS_VENDA_ACEITA.has(documento.status),
    );
    if (bloqueados.length > 0) {
      return NextResponse.json(
        {
          error: `Documento(s) que não aceitam pagamento agora: ${bloqueados
            .map((documento) => `#${documento.id} (${documento.status})`)
            .join(", ")}.`,
        },
        { status: 409 },
      );
    }

    let linhas;
    try {
      linhas = montarLinhas({
        documentos,
        valorEmCentavos,
        quantidadeDeParcelas,
        primeiroVencimento: String(body?.primeiroVencimento ?? "").trim() || null,
      });
    } catch (error) {
      if (error instanceof RateioInvalidoError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const session = await auth().catch(() => null);
    const createdBy = (session?.user as { id?: string } | undefined)?.id ?? null;

    const dataPagamento = String(body?.data ?? "").trim();
    // Meio-dia no fuso do Brasil: a data chega como dia puro e precisa cair no dia
    // certo depois da conversão para UTC — mesma regra da baixa individual.
    const dataIso = /^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)
      ? new Date(`${dataPagamento}T12:00:00-03:00`).toISOString()
      : new Date().toISOString();

    const { data, error } = await supabaseAdmin.rpc("registrar_pagamento_multiplo", {
      p_payload: {
        tipo_documento: tipoDocumento,
        modo,
        valor_total: valorEmCentavos / 100,
        // O líquido é o que entra no banco depois da taxa; o valor é o que o
        // cliente deve. Sem este campo a taxa não fica registrada em lugar nenhum.
        valor_liquido: (paraCentavos(body?.valorLiquido) || valorEmCentavos) / 100,
        data: dataIso,
        banco_id: modo === "AVISTA" ? bancoId : null,
        metodopagamento: String(body?.metodoPagamento ?? "").trim() || null,
        descricao: String(body?.descricao ?? "").trim() || null,
        categoria: String(body?.categoria ?? "").trim() || null,
        categoria_id: body?.categoriaId ?? null,
        // Pagador escolhido na tela. Quando não vem, a RPC assume o cliente dos
        // documentos se todos forem o mesmo — e "Diversos" quando não forem.
        cliente_id: body?.clienteId ?? null,
        nomepagador: String(body?.nomePagador ?? "").trim() || null,
        cpfcnpjpagador: String(body?.cpfCnpjPagador ?? "").trim() || null,
        plano_de_conta_id: body?.planoDeContaId ?? null,
        centro_custo_id: body?.centroCustoId ?? null,
        created_by: createdBy,
        linhas,
      },
    });

    if (error) {
      // P0001 é regra de negócio da RPC (rateio que não fecha, documento sem saldo):
      // é erro do pedido, não falha do servidor.
      const status = error.code === "P0001" ? 400 : error.code === "P0002" ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json(
      { data: { id: Number(data), linhas: linhas.length, documentos: documentos.length } },
      { status: 201 },
    );
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível registrar o pagamento." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
