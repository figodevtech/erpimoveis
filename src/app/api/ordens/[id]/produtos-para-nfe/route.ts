// src/app/api/ordens/[osId]/produtos-para-nfe/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOSAccess } from "@/app/api/_authz/perms";
import { descontoPorItem, parcelaDoDescontoNaNota } from "@/lib/nfe/descontoOrigem";

export const runtime = "nodejs";

// Produto como vem do join
type ProdutoDb = {
  id: number;
  titulo: string;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  codigobarras: string | null;
  referencia: string | null;
  unidade: string | null;
  origem_mercadoria: string | null;

  // campos fiscais adicionais
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

// Linha do osproduto + embed do produto
type OsProdutoDbRow = {
  ordemservicoid: number;
  produtoid: number;
  quantidade: number | null;
  precounitario: number;
  subtotal: number;
  // Mantemos compatibilidade com os dois formatos possíveis
  produto: ProdutoDb | ProdutoDb[] | null;
};

function toNumber(value: unknown) {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : 0;
}

// Tipo que vamos devolver para o frontend
type ProdutoParaNfeDTO = {
  // id estável baseado na PK composta da tabela osproduto
  osProdutoId: string;
  sourceItemId: string;
  ordemservicoId: number;
  produtoId: number;

  // agora mandamos título separado
  titulo: string;
  descricao: string;

  quantidade: number;
  /** Preço de tabela: o desconto sai destacado, não diluído no unitário. */
  precoUnitario: number;
  subtotal: number;
  /** Desconto do item somado ao rateio do desconto geral da OS. */
  valorDesconto: number;
  /** Só o desconto dado no próprio item, sem o rateio: base do rerrateio na tela. */
  valorDescontoProprio: number;

  // fiscais obrigatórios p/ emissão (validados no frontend)
  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  cst: string | null;
  cest: string | null;
  aliquotaicms: number | null;

  // fiscais opcionais (PIS/COFINS)
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
};

// Extrai o osId direto da URL: /api/ordens/95/produtos-para-nfe
function getOsIdFromUrl(req: Request): number | null {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  // Ex.: ["", "api", "ordens", "95", "produtos-para-nfe"]

  const idx = parts.indexOf("ordens");
  if (idx === -1 || idx + 1 >= parts.length) return null;

  const raw = parts[idx + 1];
  const n = Number(raw);

  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizarProduto(campo: OsProdutoDbRow["produto"]): ProdutoDb | null {
  if (!campo) return null;
  return Array.isArray(campo) ? campo[0] ?? null : campo;
}

export async function GET(req: Request) {
  try {
    await requireOSAccess();
    const idOs = getOsIdFromUrl(req);

    if (idOs === null) {
      return NextResponse.json(
        {
          ok: false,
          message: "Parâmetro 'osId' inválido (deve ser numérico).",
        },
        { status: 400 }
      );
    }

    console.log(
      "GET /api/ordens/[osId]/produtos-para-nfe -> idOs:",
      idOs
    );

    // 1) Garantir que a OS existe
    const { data: os, error: osError } = await supabaseAdmin
      .from("ordemservico")
      .select("id, clienteid, observacoes_fiscais, subtotal, orcamentototal")
      .eq("id", idOs)
      .maybeSingle();

    if (osError) {
      console.error("Erro ao buscar OS:", osError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar OS no banco.",
        },
        { status: 500 }
      );
    }

    if (!os) {
      return NextResponse.json(
        {
          ok: false,
          message: "Ordem de serviço não encontrada.",
        },
        { status: 404 }
      );
    }

    // 2) Buscar itens da OS + dados do produto
    const { data: itens, error: itensError } = await supabaseAdmin
      .from("osproduto")
      .select(
        `
          ordemservicoid,
          produtoid,
          quantidade,
          precounitario,
          subtotal,
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
      .eq("ordemservicoid", idOs)
      .returns<OsProdutoDbRow[]>();

    if (itensError) {
      console.error("Erro ao buscar produtos da OS:", itensError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar produtos vinculados à OS.",
        },
        { status: 500 }
      );
    }

    const { data: servicos, error: servicosError } = await supabaseAdmin
      .from("osservico")
      .select("subtotal")
      .eq("ordemservicoid", idOs);

    if (servicosError) {
      console.error("Erro ao buscar serviços da OS:", servicosError);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar serviços vinculados à OS." },
        { status: 500 }
      );
    }

    const rows = itens ?? [];
    // Mesma conta do gerador de rascunho (`nfeOrigemService`), para a tela já
    // mostrar o desconto que o servidor gravaria. `osproduto.subtotal` vem
    // líquido do desconto do item; o bruto é quantidade × preço unitário.
    const brutoPorItem = rows.map((i) => toNumber(i.quantidade) * toNumber(i.precounitario));
    const liquidoPorItem = rows.map((i, index) => {
      const liquido = toNumber(i.subtotal);
      return liquido > 0 ? Math.min(liquido, brutoPorItem[index]) : brutoPorItem[index];
    });
    // Só deduz o desconto geral com a OS fechada: sem a guarda, uma OS com
    // `orcamentototal` ainda zerado viraria 100% de desconto.
    const totalComDesconto = toNumber(os.orcamentototal);
    const descontoGeral = totalComDesconto > 0
      ? Math.max(0, toNumber(os.subtotal) - totalComDesconto)
      : 0;
    const pesosDosServicos = (servicos ?? []).map((servico: any) => toNumber(servico.subtotal));
    const descontoPorLinha = descontoPorItem(
      brutoPorItem.map((bruto, index) => ({ bruto, liquido: liquidoPorItem[index] })),
      descontoGeral,
      pesosDosServicos,
    );
    // O que a tela mostra no campo de desconto geral é só a fatia dos produtos:
    // numa OS com serviços, o resto do desconto da ordem sai na NFS-e.
    const descontoGeralDaNota = parcelaDoDescontoNaNota(
      descontoGeral,
      liquidoPorItem,
      pesosDosServicos,
    );

    const resposta: ProdutoParaNfeDTO[] = rows.map((i, index) => {
      const p = normalizarProduto(i.produto);

      const titulo = p?.titulo || `Produto #${i.produtoid}`;
      const descricao = p?.descricao || titulo;

      return {
        // PK composta real
        osProdutoId: `${i.ordemservicoid}-${i.produtoid}`,
        sourceItemId: `os:${i.ordemservicoid}:${i.produtoid}`,
        ordemservicoId: i.ordemservicoid,
        produtoId: i.produtoid,

        titulo,
        descricao,

        quantidade: Number(i.quantidade ?? 0),
        precoUnitario: Number(i.precounitario ?? 0),
        subtotal: brutoPorItem[index],
        valorDesconto: descontoPorLinha[index] ?? 0,
        valorDescontoProprio: Number(
          Math.max(0, brutoPorItem[index] - liquidoPorItem[index]).toFixed(2),
        ),

        ncm: p?.ncm ?? null,
        cfop: p?.cfop ?? null,
        csosn: p?.csosn ?? null,
        cst: p?.cst ?? null,
        cest: p?.cest ?? null,
        aliquotaicms:
          p?.aliquotaicms != null ? Number(p.aliquotaicms) : null,

        cst_pis: p?.cst_pis ?? null,
        aliquota_pis:
          p?.aliquota_pis != null ? Number(p.aliquota_pis) : null,
        modo_pis: p?.modo_pis ?? null,
        aliquota_por_unidade_pis:
          p?.aliquota_por_unidade_pis != null ? Number(p.aliquota_por_unidade_pis) : null,
        cst_cofins: p?.cst_cofins ?? null,
        aliquota_cofins:
          p?.aliquota_cofins != null ? Number(p.aliquota_cofins) : null,
        modo_cofins: p?.modo_cofins ?? null,
        aliquota_por_unidade_cofins:
          p?.aliquota_por_unidade_cofins != null ? Number(p.aliquota_por_unidade_cofins) : null,
        rtc_habilitado: Boolean(p?.rtc_habilitado),
        cst_ibscbs: p?.cst_ibscbs ?? null,
        cclass_trib: p?.cclass_trib ?? null,
        aliquota_ibs_uf: p?.aliquota_ibs_uf != null ? Number(p.aliquota_ibs_uf) : null,
        aliquota_ibs_municipio:
          p?.aliquota_ibs_municipio != null ? Number(p.aliquota_ibs_municipio) : null,
        aliquota_cbs: p?.aliquota_cbs != null ? Number(p.aliquota_cbs) : null,

        codigobarras: p?.codigobarras ?? null,
        referencia: p?.referencia ?? null,
        unidade: p?.unidade ?? "UN",
        origem_mercadoria: p?.origem_mercadoria ?? null,
      };
    });

    const { data: cliente } = os.clienteid
      ? await supabaseAdmin
          .from("cliente")
          .select("id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio")
          .eq("id", os.clienteid)
          .maybeSingle()
      : { data: null };

    return NextResponse.json({
      ok: true,
      osId: idOs,
      tipo_operacao: "SAIDA",
      natureza_operacao: "VENDA DE MERCADORIA",
      configuracao_fiscal: {
        consumidorFinal: true,
        indicadorPresenca: "1",
        modFrete: "9",
      },
      observacoes_fiscais: os.observacoes_fiscais ?? null,
      desconto_geral: descontoGeralDaNota,
      cliente: cliente
        ? {
            ...cliente,
            nome: cliente.nomerazaosocial,
            uf: cliente.estado,
          }
        : null,
      itens: resposta,
    });
  } catch (e: any) {
    console.error(
      "Erro em GET /api/ordens/[osId]/produtos-para-nfe:",
      e
    );
    const status = e?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para acessar esta OS."
            : "Erro interno ao buscar produtos da OS.",
        detalhe: String(e?.message ?? e),
      },
      { status }
    );
  }
}
