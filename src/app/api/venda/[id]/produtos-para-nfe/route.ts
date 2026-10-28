import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { mapSalesChannelToPresence } from "@/lib/nfe/originFiscalDefaults";
import { descontoPorItem, parcelaDoDescontoNaNota } from "@/lib/nfe/descontoOrigem";
import { exigirModelo, MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import type { CfopCandidate } from "@/lib/nfe/cfopOperation";
import { resolverPadraoFiscalItem } from "@/lib/nfe/padraoFiscalItem";
import { buscarContextoPadraoFiscal } from "@/services/fiscal/nfeConfigService";
import { comporObservacoesComGarantia } from "@/lib/fiscal/garantiaObservacoes";
import { codigoMunicipioIbgePorNome } from "@/lib/ibge/municipio";
import { intermediadorDaVendaMercadoLivre, vendaDoMercadoLivre } from "@/lib/integrations/mercadolivre-intermediador";

export const runtime = "nodejs";

// Produto como vem do join
type ProdutoDb = {
  id: number;
  titulo: string;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  cfopCandidates: CfopCandidate[];
  codigobarras: string | null;
  referencia: string | null;
  unidade: string | null;
  origem_mercadoria: string | null;

  csosn: string | null;
  cst: string | null;
  cest: string | null;
  aliquotaicms: number | string | null;
  cst_pis: string | null;
  aliquota_pis: number | string | null;
  modo_pis: string | null;
  aliquota_por_unidade_pis: number | string | null;
  cst_cofins: string | null;
  aliquota_cofins: number | string | null;
  modo_cofins: string | null;
  aliquota_por_unidade_cofins: number | string | null;
  rtc_habilitado: boolean | null;
  cst_ibscbs: string | null;
  cclass_trib: string | null;
  aliquota_ibs_uf: number | string | null;
  aliquota_ibs_municipio: number | string | null;
  aliquota_cbs: number | string | null;
};

type VendaProdutoDbRow = {
  id: number; // vendaproduto.id
  venda_id: number;
  produtoid: number;
  quantidade: number | string;
  sub_total: number | string;
  valor_total: number | string;
  valor_desconto: number | string | null;
  valor_frete: number | string | null;
  produto: ProdutoDb | ProdutoDb[] | null;
};

type ProdutoParaNfeDTO = {
  osProdutoId: string; // para reaproveitar o mesmo componente do front
  sourceItemId: string;
  produtoId: number;

  titulo: string;
  descricao: string;

  quantidade: number;
  /** Preço de tabela: o desconto sai destacado, não diluído no unitário. */
  precoUnitario: number;
  subtotal: number;
  /** Desconto do item somado ao rateio do desconto geral da venda. */
  valorDesconto: number;
  /** Só o desconto dado no próprio item, sem o rateio: base do rerrateio na tela. */
  valorDescontoProprio: number;

  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  cst: string | null;
  cest: string | null;
  aliquotaicms: number | null;

  cst_pis: string | null;
  aliquota_pis: number | null;
  modo_pis: string | null;
  aliquota_por_unidade_pis: number | null;
  cst_cofins: string | null;
  aliquota_cofins: number | null;
  modo_cofins: string | null;
  aliquota_por_unidade_cofins: number | null;
  rtc_habilitado: boolean;
  cst_ibscbs: string | null;
  cclass_trib: string | null;
  aliquota_ibs_uf: number | null;
  aliquota_ibs_municipio: number | null;
  aliquota_cbs: number | null;

  codigobarras: string | null;
  referencia: string | null;
  unidade: string | null;
  origem_mercadoria: string | null;

  /** De onde veio cada campo fiscal: 'PRODUTO', 'PADRAO', 'REGRA' ou 'VAZIO'. */
  procedenciaFiscal: Record<string, string>;
};

function normalizarProduto(campo: VendaProdutoDbRow["produto"]): ProdutoDb | null {
  if (!campo) return null;
  return Array.isArray(campo) ? campo[0] ?? null : campo;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const vendaId = Number(id);

  if (!Number.isFinite(vendaId) || vendaId <= 0) {
    return NextResponse.json(
      { ok: false, message: "ID da venda inválido." },
      { status: 400 }
    );
  }

  try {
    await requireVendasAccess();
    // Sem `?modelo=`, responde a NF-e: era o único modelo quando esta rota
    // nasceu, e o padrão fiscal da NFC-e é outro.
    const modeloParam = new URL(req.url).searchParams.get("modelo");
    const modelo = modeloParam ? exigirModelo(modeloParam) : MODELO_NFE;
    // `SAIDA` é a saída de venda. A saída de estoque que não vende nada
    // (devolução, remessa, garantia) tem padrão próprio, em `SAIDA_NAO_VENDA`.
    const { padrao, crt, rotuloPadrao, garantiaPorOrigem } =
      await buscarContextoPadraoFiscal(modelo, "SAIDA");
    // 1) garantir que venda existe
    const { data: venda, error: vendaError } = await supabaseAdmin
      .from("venda")
      .select("id, clienteid, observacoes_fiscais, garantia, canal, valor_frete, valortotal, endereco_entrega_snapshot")
      .eq("id", vendaId)
      .maybeSingle();

    if (vendaError) {
      console.error("Erro ao buscar venda:", vendaError);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar venda no banco." },
        { status: 500 }
      );
    }

    if (!venda) {
      return NextResponse.json(
        { ok: false, message: "Venda não encontrada." },
        { status: 404 }
      );
    }

    // 2) buscar itens da venda + dados do produto
    const { data: itens, error: itensError } = await supabaseAdmin
      .from("vendaproduto")
      .select(
        `
          id,
          venda_id,
          produtoid,
          quantidade,
          sub_total,
          valor_total,
          valor_desconto,
          valor_frete,
          produto:produto (
            id,
            titulo,
            descricao,
            ncm,
            cfop,
            codigobarras,
            referencia,
            unidade,
            origem_mercadoria,
            csosn,
            cst,
            cest,
            aliquotaicms,
            cst_pis,
            aliquota_pis,
            modo_pis,
            aliquota_por_unidade_pis,
            cst_cofins,
            aliquota_cofins,
            modo_cofins,
            aliquota_por_unidade_cofins,
            rtc_habilitado,
            cst_ibscbs,
            cclass_trib,
            aliquota_ibs_uf,
            aliquota_ibs_municipio,
            aliquota_cbs
          )
        `
      )
      .eq("venda_id", vendaId)
      .returns<VendaProdutoDbRow[]>();

    if (itensError) {
      console.error("Erro ao buscar produtos da venda:", itensError);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar produtos vinculados à venda." },
        { status: 500 }
      );
    }

    const rows = itens ?? [];
    // Mesma conta do gerador de rascunho (`nfeOrigemService`), para a tela já
    // mostrar o desconto que o servidor gravaria.
    const brutoPorItem = rows.map((row) => {
      const bruto = toNumber(row.sub_total);
      return bruto > 0 ? bruto : toNumber(row.valor_total);
    });
    const fretePorItem = rows.map((row) => Math.max(0, toNumber(row.valor_frete)));
    const liquidoPorItem = rows.map((row, index) =>
      Math.min(Math.max(0, toNumber(row.valor_total) - fretePorItem[index]), brutoPorItem[index]),
    );
    const totalLiquidoItens = liquidoPorItem.reduce((soma, valor) => soma + valor, 0);
    const frete = Math.max(0, toNumber(venda.valor_frete))
      + fretePorItem.reduce((soma, valor) => soma + valor, 0);
    // Só deduz o desconto geral com o total comercial fechado: sem a guarda,
    // uma venda com `valortotal` ainda zerado viraria 100% de desconto.
    const totalComercial = toNumber(venda.valortotal);
    const descontoGeral = totalComercial > 0
      ? Math.max(0, Math.min(totalLiquidoItens, totalLiquidoItens + frete - totalComercial))
      : 0;
    const descontoPorLinha = descontoPorItem(
      brutoPorItem.map((bruto, index) => ({ bruto, liquido: liquidoPorItem[index] })),
      descontoGeral,
    );
    const descontoDosProdutos = parcelaDoDescontoNaNota(descontoGeral, liquidoPorItem);

    const resposta: ProdutoParaNfeDTO[] = rows.map((row, index) => {
      const p = normalizarProduto(row.produto);

      const titulo = p?.titulo || `Produto #${row.produtoid}`;
      // xProd é o título; a descrição do cadastro é texto de vitrine.
      const descricao = titulo;

      const quantidade = toNumber(row.quantidade);
      const bruto = brutoPorItem[index];
      const precoUnitario = quantidade > 0 ? bruto / quantidade : bruto;

      // O cadastro do produto manda; o padrão de configs preenche o que ficou
      // em branco. NCM e CEST ficam de fora — são do item, não do perfil.
      const { campos: fiscal, procedencia } = resolverPadraoFiscalItem({
        fontes: [{ origem: "PRODUTO", valores: p }],
        padrao,
        crt,
        rotuloPadrao,
      });

      return {
        osProdutoId: `${vendaId}-${row.produtoid}`, // reaproveita o mesmo campo do front
        sourceItemId: `venda:${vendaId}:${row.id}`,
        produtoId: row.produtoid,

        titulo,
        descricao,

        quantidade,
        precoUnitario,
        subtotal: bruto,
        valorDesconto: descontoPorLinha[index] ?? 0,
        valorDescontoProprio: Number(Math.max(0, bruto - liquidoPorItem[index]).toFixed(2)),

        ncm: p?.ncm ?? null,
        cest: p?.cest ?? null,
        ...fiscal,
        cfopCandidates: [
          { value: p?.cfop ?? null, origin: "PRODUTO" },
          { value: padrao?.cfop ?? null, origin: "PADRAO" },
        ],

        codigobarras: p?.codigobarras ?? null,
        referencia: p?.referencia ?? null,
        unidade: p?.unidade ?? "UN",
        procedenciaFiscal: procedencia,
      };
    });

    const { data: cliente } = venda.clienteid
      ? await supabaseAdmin
          .from("cliente")
          .select("id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, inscricaoestadual, ind_ie_dest, inscricaomunicipal, codigomunicipio, codigo_sistema")
          .eq("id", venda.clienteid)
          .maybeSingle()
      : { data: null };

    const enderecoPedido = venda.endereco_entrega_snapshot &&
      typeof venda.endereco_entrega_snapshot === "object" &&
      !Array.isArray(venda.endereco_entrega_snapshot)
      ? venda.endereco_entrega_snapshot as Record<string, unknown>
      : null;
    const clienteFiscal = cliente
      ? {
          ...cliente,
          endereco: String(enderecoPedido?.logradouro || cliente.endereco || ""),
          endereconumero: String(enderecoPedido?.numero || cliente.endereconumero || ""),
          enderecocomplemento: String(enderecoPedido?.complemento || cliente.enderecocomplemento || ""),
          bairro: String(enderecoPedido?.bairro || cliente.bairro || ""),
          cidade: String(enderecoPedido?.cidade || cliente.cidade || ""),
          estado: String(enderecoPedido?.estado || cliente.estado || ""),
          cep: String(enderecoPedido?.cep || cliente.cep || ""),
          // Mesmo critério do rascunho no servidor: cliente sem código (comprador
          // importado do Mercado Livre, por exemplo) usa o da própria cidade.
          codigomunicipio: cliente.codigomunicipio || codigoMunicipioIbgePorNome(cliente.cidade, cliente.estado),
        }
      : null;
    const intermediador = vendaDoMercadoLivre(venda.canal) ? await intermediadorDaVendaMercadoLivre(vendaId) : null;

    return NextResponse.json({
      ok: true,
      vendaId,
      tipo_operacao: "SAIDA",
      natureza_operacao: "VENDA DE MERCADORIA",
      configuracao_fiscal: {
        // Sem destino sugerido: a venda não diz se o cliente revende ou
        // consome a mercadoria. A tela cobra a escolha.
        destinoMercadoria: null,
        indicadorPresenca: mapSalesChannelToPresence(venda.canal),
        // Só para exibição: o servidor resolve de novo ao gravar o rascunho.
        intermediador,
        // O frete cobrado na venda entra na nota (vFrete) e continua editável na
        // tela. Com frete, "sem ocorrência de transporte" (9) não descreve mais
        // a operação, então a modalidade já sugere frete por conta do emitente.
        valorFrete: frete,
        modFrete: frete > 0 ? "0" : "9",
      },
      observacoes_fiscais: comporObservacoesComGarantia({
        observacoes: venda.observacoes_fiscais,
        garantia: venda.garantia,
        incluir: garantiaPorOrigem.VENDA,
      }) || null,
      // A venda não tem serviços, então todo o desconto geral cabe aos produtos.
      desconto_geral: descontoDosProdutos,
      // Mesmo formato da OS para a tela não precisar de dois caminhos. Sem
      // serviços não há rateio a explicar, e `servicos: 0` cala o aviso.
      desconto_origem: {
        total: descontoDosProdutos,
        produtos: descontoDosProdutos,
        servicos: 0,
        baseProdutos: Number(totalLiquidoItens.toFixed(2)),
        baseServicos: 0,
      },
      cliente: clienteFiscal
        ? {
            ...clienteFiscal,
            nome: clienteFiscal.nomerazaosocial,
            uf: clienteFiscal.estado,
          }
        : null,
      itens: resposta,
    });
  } catch (e: any) {
    console.error("Erro em GET /api/venda/[id]/produtos-para-nfe:", e);
    const status = e?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para acessar esta venda."
            : "Erro interno ao buscar produtos da venda.",
        detalhe: String(e?.message ?? e),
      },
      { status }
    );
  }
}
