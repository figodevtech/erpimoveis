import { NextResponse, type NextRequest } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import { resolverPadraoFiscalItem } from "@/lib/nfe/padraoFiscalItem";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buscarContextoPadraoFiscal, buscarFiscalConfig } from "@/services/fiscal/nfeConfigService";
import {
  buscarOperacaoFiscalSaida,
  buscarSaidasRelacionadasDaEntrada,
} from "@/services/fiscal/nfeSaidaService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function idPositivo(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: NextRequest, context: Context) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const saidaId = idPositivo(rawId);
    const body = await request.json().catch(() => null);
    const saidaItemId = idPositivo(body?.saidaItemId);
    const entradaItemOrigemId = idPositivo(body?.entradaItemOrigemId);
    if (!saidaId || !saidaItemId || !entradaItemOrigemId) {
      return NextResponse.json(
        { ok: false, message: "Informe a saída, o item e a entrada fiscal de origem." },
        { status: 400 },
      );
    }

    const [relacionadas, config, operacao] = await Promise.all([
      buscarSaidasRelacionadasDaEntrada(saidaId, saidaItemId, entradaItemOrigemId),
      buscarFiscalConfig(MODELO_NFE),
      buscarOperacaoFiscalSaida(body?.operacaoFiscalCodigo),
    ]);
    const [{ padrao, crt, rotuloPadrao }, empresaResult] = await Promise.all([
      buscarContextoPadraoFiscal(MODELO_NFE, "SAIDA_NAO_VENDA", config?.empresaid),
      supabaseAdmin.from("empresa").select("uf").eq("id", config?.empresaid ?? 0).maybeSingle(),
    ]);
    if (empresaResult.error) throw empresaResult.error;

    const ufEmitente = String(empresaResult.data?.uf ?? "").trim().toUpperCase();
    const ufDestino = String(body?.ufDestinatario ?? "").trim().toUpperCase();
    const cfopSugerido = operacao
      ? ufEmitente && ufDestino && ufEmitente !== ufDestino
        ? operacao.cfopInterestadual
        : operacao.cfopInterno
      : "";

    const candidatos = relacionadas.map((relacionada) => {
      const produto = relacionada.produto ?? {};
      const { campos: fiscal, procedencia } = resolverPadraoFiscalItem({
        fontes: [{ origem: "PRODUTO", valores: produto }],
        padrao,
        crt,
        rotuloPadrao,
      });
      return {
        ...relacionada,
        produto: undefined,
        item: {
          osProdutoId: String(relacionada.saidaItemId),
          sourceItemId: relacionada.sourceItemId,
          produtoId: Number(produto.id),
          titulo: String(produto.titulo || `Produto #${produto.id}`),
          descricao: String(produto.descricao || produto.titulo || `Produto #${produto.id}`),
          quantidade: relacionada.quantidade,
          precoUnitario: relacionada.valorUnitario,
          subtotal: Number((relacionada.quantidade * relacionada.valorUnitario).toFixed(2)),
          ncm: produto.ncm ?? null,
          cest: produto.cest ?? null,
          ...fiscal,
          cfop: cfopSugerido || null,
          codigobarras: produto.codigobarras ?? null,
          referencia: produto.referencia ?? null,
          unidade: produto.unidade ?? "UN",
          procedenciaFiscal: {
            ...procedencia,
            cfop: cfopSugerido ? "OPERACAO_SAIDA" : "VAZIO",
          },
        },
      };
    });

    return NextResponse.json({ ok: true, candidatos });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.statusCode === 403
          ? "Você não tem permissão para consultar saídas relacionadas."
          : error?.message ?? "Erro ao procurar outras saídas da NF-e de origem.",
      },
      { status: error?.statusCode === 403 ? 403 : 422 },
    );
  }
}
