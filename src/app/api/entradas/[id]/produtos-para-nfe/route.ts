import { NextResponse } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import { resolverPadraoFiscalItem } from "@/lib/nfe/padraoFiscalItem";
import { buscarContextoPadraoFiscal } from "@/services/fiscal/nfeConfigService";
import {
  isValidCnpj,
  isValidCpf,
  normalizeCpfOrCnpj,
} from "@/lib/fiscal-identifiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numero(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function somenteDigitos(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function validarFornecedor(fornecedor: any) {
  const erros: string[] = [];
  const documento = normalizeCpfOrCnpj(fornecedor?.cpfcnpj);
  if (!(isValidCpf(documento) || isValidCnpj(documento))) {
    erros.push("CPF/CNPJ do fornecedor inválido ou ausente.");
  }
  if (!String(fornecedor?.nomerazaosocial ?? "").trim()) erros.push("Razão social do fornecedor ausente.");
  if (!String(fornecedor?.endereco ?? "").trim()) erros.push("Endereço do fornecedor ausente.");
  if (!String(fornecedor?.bairro ?? "").trim()) erros.push("Bairro do fornecedor ausente.");
  if (!String(fornecedor?.cidade ?? "").trim()) erros.push("Cidade do fornecedor ausente.");
  if (String(fornecedor?.estado ?? "").trim().length !== 2) erros.push("UF do fornecedor inválida ou ausente.");
  if (somenteDigitos(fornecedor?.cep).length !== 8) erros.push("CEP do fornecedor deve ter 8 dígitos.");
  if (somenteDigitos(fornecedor?.codigomunicipio).length !== 7) {
    erros.push("Código IBGE do município do fornecedor deve ter 7 dígitos.");
  }
  return erros;
}

export async function GET(_request: Request, context: Context) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const entradaId = Number(rawId);

    if (!Number.isInteger(entradaId) || entradaId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da entrada inválido." }, { status: 400 });
    }

    const { data: entrada, error: entradaError } = await supabaseAdmin
      .from("entrada")
      .select(`
        id,
        fornecedorid,
        tipo,
        status,
        origem,
        fornecedor:fornecedorid (
          id,
          cpfcnpj,
          nomerazaosocial,
          nomefantasia,
          endereco,
          endereconumero,
          enderecocomplemento,
          bairro,
          cidade,
          estado,
          cep,
          contato,
          codigomunicipio
        )
      `)
      .eq("id", entradaId)
      .maybeSingle();

    if (entradaError) throw entradaError;
    if (!entrada) {
      return NextResponse.json({ ok: false, message: "Entrada não encontrada." }, { status: 404 });
    }
    if (entrada.status !== "CONFIRMADA") {
      return NextResponse.json({ ok: false, message: "Somente entradas confirmadas podem originar uma NF-e." }, { status: 409 });
    }
    if (entrada.origem === "NFE_TERCEIRO") {
      return NextResponse.json(
        { ok: false, message: "Uma NF-e recebida de terceiro não pode originar outra NF-e de entrada." },
        { status: 409 },
      );
    }

    const fornecedor = relationOne<any>(entrada.fornecedor);
    const { data: rows, error: itensError } = await supabaseAdmin
      .from("entradaitens")
      .select(`
        id,
        entrada_id,
        produto_id,
        unidade,
        quantidade,
        precovenda,
        valor_unitario_compra,
        ncm,
        cest,
        csosn,
        referencia,
        titulo,
        "cClassTrib",
        "cstIbs",
        "cstCbs",
        cst,
        aliquotaicms,
        cfop,
        cst_pis,
        aliquota_pis,
        cst_cofins,
        aliquota_cofins,
        produto:produto_id (
          id,
          titulo,
          descricao,
          referencia,
          codigobarras,
          unidade,
          ncm,
          cfop,
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
      `)
      .eq("entrada_id", entradaId)
      .order("id", { ascending: true });

    if (itensError) throw itensError;

    // NF-e de entrada é sempre modelo 55: a NFC-e não existe como documento de
    // entrada, e `salvarNFeDeOrigem` já recusa a combinação.
    const { padrao, crt } = await buscarContextoPadraoFiscal(MODELO_NFE, "ENTRADA");

    const itens = (rows ?? []).map((row: any) => {
      const produto = relationOne<any>(row.produto);
      const titulo = String(row.titulo || produto?.titulo || `Produto #${row.produto_id}`);
      const quantidade = numero(row.quantidade);
      const valorUnitario = numero(row.valor_unitario_compra ?? row.precovenda);

      // Aqui a precedência tem um degrau a mais: o item da entrada carrega o
      // fiscal que veio na nota do fornecedor, e ele descreve esta operação
      // melhor do que o cadastro do produto.
      const { campos: fiscal, procedencia } = resolverPadraoFiscalItem({
        fontes: [
          {
            origem: "ENTRADA",
            valores: {
              cfop: row.cfop,
              csosn: row.csosn,
              cst: row.cst,
              aliquotaicms: row.aliquotaicms,
              cst_pis: row.cst_pis,
              aliquota_pis: row.aliquota_pis,
              cst_cofins: row.cst_cofins,
              aliquota_cofins: row.aliquota_cofins,
              cst_ibscbs: row.cstIbs ?? row.cstCbs,
              cclass_trib: row.cClassTrib,
            },
          },
          { origem: "PRODUTO", valores: produto },
        ],
        padrao,
        crt,
      });

      return {
        osProdutoId: String(row.id),
        sourceItemId: `entrada:${entradaId}:${row.id}`,
        produtoId: Number(row.produto_id),
        titulo,
        // xProd é o título; a descrição do cadastro é texto de vitrine.
        descricao: titulo,
        quantidade,
        precoUnitario: valorUnitario,
        subtotal: Number((quantidade * valorUnitario).toFixed(2)),
        ncm: row.ncm ?? produto?.ncm ?? null,
        cest: row.cest ?? produto?.cest ?? null,
        ...fiscal,
        cfopCandidates: [
          { value: row.cfop ?? null, origin: "ENTRADA" },
          { value: produto?.cfop ?? null, origin: "PRODUTO" },
          { value: padrao?.cfop ?? null, origin: "PADRAO" },
        ],
        codigobarras: produto?.codigobarras ?? null,
        referencia: row.referencia ?? produto?.referencia ?? null,
        unidade: row.unidade ?? produto?.unidade ?? "UN",
        procedenciaFiscal: procedencia,
      };
    });

    return NextResponse.json({
      ok: true,
      entradaId,
      tipo_operacao: "ENTRADA",
      natureza_operacao:
        entrada.tipo === "DEVOLUCAO"
          ? "ENTRADA POR DEVOLUCAO"
          : entrada.tipo === "COMPRA_PF"
            ? "COMPRA DE PESSOA FISICA"
            : "COMPRA PARA COMERCIALIZACAO",
      observacoes_fiscais: null,
      cliente: null,
      fornecedor: {
        id: fornecedor?.id ?? null,
        nome: fornecedor?.nomerazaosocial ?? null,
        uf: fornecedor?.estado ?? null,
      },
      parceiro_erros: validarFornecedor(fornecedor),
      destinatario: {
        fornecedorId: fornecedor?.id ?? null,
        tipoPessoa:
          normalizeCpfOrCnpj(fornecedor?.cpfcnpj).length === 11 ? "FISICA" : "JURIDICA",
        cpfCnpj: normalizeCpfOrCnpj(fornecedor?.cpfcnpj),
        nomeRazaoSocial: fornecedor?.nomerazaosocial ?? "",
        indicadorIe: "9",
        inscricaoEstadual: "",
        inscricaoMunicipal: "",
        email: "",
        telefone: fornecedor?.contato ?? "",
        endereco: fornecedor?.endereco ?? "",
        numero: fornecedor?.endereconumero ?? "",
        complemento: fornecedor?.enderecocomplemento ?? "",
        bairro: fornecedor?.bairro ?? "",
        cidade: fornecedor?.cidade ?? "",
        estado: fornecedor?.estado ?? "",
        cep: somenteDigitos(fornecedor?.cep),
        codigoMunicipio: somenteDigitos(fornecedor?.codigomunicipio),
        codigoPais: "1058",
        nomePais: "BRASIL",
      },
      itens,
    });
  } catch (error: any) {
    console.error("GET /api/entradas/[id]/produtos-para-nfe", error);
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para acessar esta entrada."
            : "Erro ao carregar os produtos da entrada.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}
