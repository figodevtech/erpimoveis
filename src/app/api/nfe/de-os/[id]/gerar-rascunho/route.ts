// src/app/api/nfe/de-os/[osId]/gerar-rascunho/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildNFePreviewXml } from "@/lib/nfe/buildNFe";
import { mapClienteToDestinatario } from "@/lib/nfe/mapClienteToDestinatario";
import type { ClienteRow, EmpresaRow, NFeItem } from "@/lib/nfe/types";
import { resolverNomeMunicipioIbge } from "@/lib/ibge/municipio";

export const runtime = "nodejs";

type BodyRequest = {
  itens: number[];
  observacoesFiscais?: string | null;
};

// Extrai o osId direto da URL: /api/nfe/de-os/95/gerar-rascunho
function getOsIdFromUrl(req: Request): number | null {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  // ex: ["", "api", "nfe", "de-os", "95", "gerar-rascunho"]
  const idx = parts.indexOf("de-os");
  if (idx === -1 || idx + 1 >= parts.length) return null;

  const raw = parts[idx + 1];
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return n;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isPisCofinsTributado(cst: unknown): boolean {
  const value = String(cst ?? "").trim().padStart(2, "0");
  return value === "01" || value === "02";
}

function calcularTributoPercentual(
  valorInformado: number | null,
  base: number,
  aliquota: number | null
): number | null {
  if (aliquota === null) return valorInformado;
  if (valorInformado !== null && valorInformado > 0) return valorInformado;
  return Number((base * (aliquota / 100)).toFixed(2));
}

async function criarRascunhoNFeDeOs(idOs: number): Promise<number> {
  const { data: os, error: osError } = await supabaseAdmin
    .from("ordemservico")
    .select("id, clienteid")
    .eq("id", idOs)
    .maybeSingle();

  if (osError) {
    throw new Error(`Erro ao buscar OS ${idOs}: ${osError.message}`);
  }

  if (!os) {
    throw new Error(`OS ${idOs} nao encontrada.`);
  }

  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("id, empresaid, modelo, serie, ultimo_numero, ambiente")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (configError) {
    throw new Error(`Erro ao buscar configuracao de NF-e: ${configError.message}`);
  }

  if (!config) {
    throw new Error("Configuracao de NF-e (nfe_config) nao encontrada.");
  }

  const numero = Number(config.ultimo_numero ?? 0) + 1;

  const { data: nfe, error: insertError } = await supabaseAdmin
    .from("nfe")
    .insert({
      modelo: config.modelo ?? "NFE",
      serie: Number(config.serie ?? 1),
      numero,
      chave_acesso: "0".repeat(44),
      ambiente: config.ambiente ?? "HOMOLOGACAO",
      status: "RASCUNHO",
      ordemservicoid: os.id,
      vendaid: null,
      clienteid: os.clienteid,
      empresaid: config.empresaid,
      dataemissao: new Date().toISOString(),
      total_produtos: 0,
      total_servicos: 0,
      total_nfe: 0,
      xml_assinado: null,
      xml_autorizado: null,
    })
    .select("id")
    .single();

  if (insertError || !nfe) {
    throw new Error(`Erro ao criar rascunho de NF-e: ${insertError?.message ?? "id nao retornado"}`);
  }

  const { error: updateConfigError } = await supabaseAdmin
    .from("nfe_config")
    .update({
      ultimo_numero: numero,
      updatedat: new Date().toISOString(),
    })
    .eq("id", config.id);

  if (updateConfigError) {
    throw new Error(`Erro ao atualizar numero da NF-e: ${updateConfigError.message}`);
  }

  return Number(nfe.id);
}

export async function POST(req: Request) {
  try {
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

    const body = (await req.json().catch(() => null)) as BodyRequest | null;

    console.log("gerar-rascunho body", body)

    if (!body || !Array.isArray(body.itens) || body.itens.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Body inválido. Envie um JSON com { itens: number[] } contendo pelo menos um item.",
        },
        { status: 400 }
      );
    }

    const itensSelecionados = body.itens
      .map((n) => Number(n))
      .filter((n) => !Number.isNaN(n));

    if (itensSelecionados.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "Nenhum item válido foi enviado para gerar a NF-e.",
        },
        { status: 400 }
      );
    }

    // 1) Criar cabeçalho da NF-e
    const nfeId = await criarRascunhoNFeDeOs(idOs);

    if (!nfeId) {
      return NextResponse.json(
        {
          ok: false,
          message: "Função criar_nfe_de_os não retornou id",
        },
        { status: 500 }
      );
    }

    // 2) Preencher itens na nfe_item com base em TODOS os produtos da OS
    const { error: itensError } = await supabaseAdmin.rpc(
      "preencher_itens_nfe_de_os",
      {
        p_nfe_id: nfeId,
      }
    );

    if (itensError) {
      console.error("[preencher_itens_nfe_de_os] erro:", itensError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao preencher itens da NF-e",
          detalhe: itensError.message,
        },
        { status: 500 }
      );
    }

    // 3) Buscar itens da nfe_item para esse nfeId (TODOS os campos fiscais)
    const { data: itensNfe, error: itensNfeError } = await supabaseAdmin
      .from("nfe_item")
      .select(
        `
        n_item,
        produtoid,
        descricao,
        ncm,
        cfop,
        unidade,
        quantidade,
        valor_unitario,
        valor_total,
        csosn,
        cest,
        aliquotaicms,
        valor_bc_icms,
        valor_icms,
        cst_pis,
        aliquota_pis,
        valor_pis,
        cst_cofins,
        aliquota_cofins,
        valor_cofins,
        cst
      `
      )
      .eq("nfe_id", nfeId);

    if (itensNfeError) {
      console.error("[select nfe_item] erro:", itensNfeError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar itens da NF-e recém criada.",
          detalhe: itensNfeError.message,
        },
        { status: 500 }
      );
    }

    // Se por algum motivo não veio item nenhum, não faz sentido seguir
    if (!itensNfe || itensNfe.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Nenhum item foi gerado em nfe_item pela função preencher_itens_nfe_de_os.",
        },
        { status: 500 }
      );
    }

    // 4) Determinar quais produtos precisam ser removidos da nota
    const todosProdutosDaNfe = Array.from(
      new Set(
        itensNfe
          .map((i: any) => Number(i.produtoid))
          .filter((n) => !Number.isNaN(n))
      )
    );

    const produtosParaRemover = todosProdutosDaNfe.filter(
      (pid) => !itensSelecionados.includes(pid)
    );

    if (produtosParaRemover.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from("nfe_item")
        .delete()
        .eq("nfe_id", nfeId)
        .in("produtoid", produtosParaRemover);

      if (deleteError) {
        console.error("[delete nfe_item] erro:", deleteError);
        return NextResponse.json(
          {
            ok: false,
            message: "Erro ao remover itens não selecionados da NF-e.",
            detalhe: deleteError.message,
          },
          { status: 500 }
        );
      }
    }

    // 5) Atualizar totais da NF-e com base nos itens que sobraram (lado banco)
    const { error: totalError } = await supabaseAdmin.rpc(
      "atualizar_totais_nfe",
      {
        p_nfe_id: nfeId,
      }
    );

    if (totalError) {
      console.error("[atualizar_totais_nfe] erro:", totalError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao atualizar totais da NF-e",
          detalhe: totalError.message,
        },
        { status: 500 }
      );
    }

    // 6) Buscar a NF-e completa pra montar XML de rascunho
    const { data: nfe, error: nfeError } = await supabaseAdmin
      .from("nfe")
      .select(
        `
        id,
        modelo,
        serie,
        numero,
        chave_acesso,
        ambiente,
        status,
        ordemservicoid,
        vendaid,
        clienteid,
        empresaid,
        dataemissao
      `
      )
      .eq("id", nfeId)
      .maybeSingle();

    if (nfeError || !nfe) {
      console.error("[select nfe] erro:", nfeError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar NF-e recém criada.",
          detalhe: nfeError?.message ?? "NF-e não encontrada",
        },
        { status: 500 }
      );
    }

    // 7) Montar XML de rascunho (sem assinatura) com itens e destinatário
    const { data: empresa, error: empError } = await supabaseAdmin
      .from("empresa")
      .select("*")
      .eq("id", nfe.empresaid)
      .single<EmpresaRow>();

    if (empError || !empresa) {
      console.error("[empresa] erro ao buscar empresa da NF-e:", empError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar empresa da NF-e.",
          detalhe: empError?.message ?? "Empresa não encontrada",
        },
        { status: 500 }
      );
    }

    const { data: cliente, error: cliError } = await supabaseAdmin
      .from("cliente")
      .select(
        `
        id,
        cpfcnpj,
        nomerazaosocial,
        telefone,
        email,
        endereco,
        endereconumero,
        enderecocomplemento,
        bairro,
        cidade,
        estado,
        cep,
        inscricaoestadual,
        inscricaomunicipal,
        codigomunicipio
      `
      )
      .eq("id", nfe.clienteid)
      .single<ClienteRow>();

    if (cliError || !cliente) {
      console.error("[cliente] erro ao buscar cliente da NF-e:", cliError);
      return NextResponse.json(
        {
          ok: false,
          message: "Erro ao buscar cliente da NF-e.",
          detalhe: cliError?.message ?? "Cliente não encontrado",
        },
        { status: 500 }
      );
    }

    const itensNfeSelecionados = (itensNfe as any[]).filter((row) =>
      itensSelecionados.includes(Number(row.produtoid))
    );

    if (itensNfeSelecionados.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Nenhum item selecionado foi encontrado para montar o XML da NF-e.",
        },
        { status: 400 }
      );
    }

    // 8) Mapear nfe_item -> NFeItem (com impostos)
    const itens: NFeItem[] = itensNfeSelecionados.map((row, idx) => {
      const numeroItem = Number(row.n_item ?? idx + 1);
      const quantidade = toNumberOrNull(row.quantidade) ?? 0;
      const valorUnitario = toNumberOrNull(row.valor_unitario) ?? 0;
      const valorTotal = toNumberOrNull(row.valor_total) ?? 0;

      // ICMS
      const aliquotaIcms = toNumberOrNull(row.aliquotaicms);
      let baseCalculoIcms = toNumberOrNull(row.valor_bc_icms);
      let valorIcms = toNumberOrNull(row.valor_icms);

      if (aliquotaIcms !== null) {
        if (baseCalculoIcms === null) {
          baseCalculoIcms = valorTotal;
        }
        if (valorIcms === null) {
          valorIcms = Number(
            (baseCalculoIcms * (aliquotaIcms / 100)).toFixed(2)
          );
        }
      }

      // PIS
      const aliquotaPis = toNumberOrNull(row.aliquota_pis);
      let valorPis = toNumberOrNull(row.valor_pis);

      if (isPisCofinsTributado(row.cst_pis)) {
        valorPis = calcularTributoPercentual(valorPis, valorTotal, aliquotaPis);
      } else if (aliquotaPis !== null && valorPis === null) {
        valorPis = Number((valorTotal * (aliquotaPis / 100)).toFixed(2));
      }

      // COFINS
      const aliquotaCofins = toNumberOrNull(row.aliquota_cofins);
      let valorCofins = toNumberOrNull(row.valor_cofins);

      if (isPisCofinsTributado(row.cst_cofins)) {
        valorCofins = calcularTributoPercentual(
          valorCofins,
          valorTotal,
          aliquotaCofins
        );
      } else if (aliquotaCofins !== null && valorCofins === null) {
        valorCofins = Number((valorTotal * (aliquotaCofins / 100)).toFixed(2));
      }

      const item: NFeItem = {
        numeroItem,
        codigoProduto:
          row.produtoid != null
            ? String(row.produtoid)
            : String(row.n_item ?? idx + 1),
        descricao: row.descricao,
        ncm: row.ncm || "00000000",
        cfop: row.cfop,
        unidade: row.unidade,
        quantidade,
        valorUnitario,
        valorTotal,
        codigoBarras: null, // se quiser puxar GTIN depois, terá que vir da tabela produto
        // ICMS
        cstIcms: row.cst ?? null,
        csosn: row.csosn ?? null,
        aliquotaIcms: aliquotaIcms ?? undefined,
        baseCalculoIcms: baseCalculoIcms ?? undefined,
        valorIcms: valorIcms ?? undefined,
        // PIS
        cstPis: row.cst_pis ?? null,
        aliquotaPis: aliquotaPis ?? undefined,
        valorPis: valorPis ?? undefined,
        // COFINS
        cstCofins: row.cst_cofins ?? null,
        aliquotaCofins: aliquotaCofins ?? undefined,
        valorCofins: valorCofins ?? undefined,
      };

      return item;
    });

    const destinatario = mapClienteToDestinatario(cliente, empresa);

    const observacoesFiscais = body.observacoesFiscais
      ? body.observacoesFiscais.slice(0, 500)
      : undefined;

    const nomeMunicipioEmitente = await resolverNomeMunicipioIbge(empresa.codigomunicipio, empresa.uf);
    const { xml: xmlRascunho, chave } = buildNFePreviewXml(
      empresa,
      Number(nfe.numero),
      Number(nfe.serie),
      itens,
      destinatario,
      { observacoesFiscais, nomeMunicipioEmitente }
    );

    console.log(
      "[gerar-rascunho] chave_acesso gerada:",
      chave,
      "len:",
      (chave || "").length
    );

    // 9) Gravar XML de rascunho (não assinado) em xml_assinado e chave
    await supabaseAdmin
      .from("nfe")
      .update({
        xml_assinado: xmlRascunho,
        chave_acesso: chave,
        updatedat: new Date().toISOString(),
      })
      .eq("id", nfeId);

    return NextResponse.json(
      {
        ok: true,
        message:
          "NF-e criada a partir da OS com sucesso (apenas itens selecionados).",
        nfeId,
        nfe,
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error("[api/nfe/de-os/[osId]/gerar-rascunho] erro inesperado", e);
    return NextResponse.json(
      {
        ok: false,
        message: "Erro interno ao gerar NF-e a partir da OS.",
        detalhe: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}
