import { z } from "zod";
import { ajustesValoresEntradaSchema } from "@/lib/estoque/entrada-valores";
import { registrarEntradaComValores } from "./entradaValoresService";

import { classificarLinhasEntradaHibrida } from "@/lib/nfe/entrada-fiscal-hibrida";
import { ratearCustoPersonalizado } from "@/lib/nfe/entrada-fiscal-personalizada";
import { linhaEmQuantidadeInteira } from "@/lib/nfe/quantidade-inteira-da-linha";
import {
  lancamentosDreDaEntrada,
  payloadDosLancamentos,
  type FonteDosLancamentos,
} from "@/lib/nfe/lancamento-dre-entrada";
import { calcularValorFiscalDaEntrada } from "@/lib/nfe/valor-fiscal-entrada";
import {
  lerItensDaNota,
  lerNFeDoXml,
  lerTotaisDaNota,
  type ItemFiscalDaNota,
} from "@/lib/nfe/totais-nfe";
import { parseDfeXml } from "@/services/fiscal/dfeXmlParser";
import { escopoDeEntradaDe } from "@/lib/usoconsumo/escopo";
import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { normalizarUnidadeMedidaEntrada } from "./entradaService";
import {
  carregarDocumentoFiscalEFornecedor,
  destinoEntradaFiscalPersonalizadaSchema,
  financeiroEntradaFiscalSchema,
  montarTransacoesEntradaFiscal,
} from "./entradaFiscalPersonalizadaService";

const itemNormalSchema = z
  .object({
    numeroItem: z.number().int().min(1).max(990),
    destino: destinoEntradaFiscalPersonalizadaSchema,
    itemReferenciaId: z.number().int().positive(),
  })
  .strict();

export const entradaFiscalHibridaSchema = z
  .object({
    documentoFiscalRecebidoId: z.number().int().positive(),
    fornecedorId: z.number().int().positive(),
    itensNormais: z.array(itemNormalSchema).min(1),
    personalizado: z
      .object({
        destino: destinoEntradaFiscalPersonalizadaSchema,
        itemReferenciaId: z.number().int().positive(),
        quantidade: z.number().int().positive(),
      })
      .strict(),
    financeiro: financeiroEntradaFiscalSchema.nullable(),
    ajustesValores: ajustesValoresEntradaSchema.optional(),
  })
  .strict();

export type EntradaFiscalHibrida = z.infer<typeof entradaFiscalHibridaSchema>;

function texto(value: unknown) {
  const normalizado = String(value ?? "").trim();
  return normalizado || null;
}

function digitos(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Quantidade, unitário, desconto e outras despesas que a linha leva ao estoque.
 * Fração da NF-e vira o inteiro mais próximo com o mesmo custo da linha.
 */
function valoresDeEstoque(item: ItemFiscalDaNota) {
  const inteira = linhaEmQuantidadeInteira(item.quantidade, item.valorUnitario);
  return {
    quantidade: inteira.quantidade,
    valor_unitario_compra: inteira.valorUnitario,
    valor_desconto: paraReais(
      paraCentavos(item.valorDesconto) + paraCentavos(inteira.ajusteDesconto),
    ),
    outras_despesas: paraReais(
      paraCentavos(item.valorSeguro) +
        paraCentavos(item.outrasDespesas) +
        paraCentavos(item.valorIpi) +
        paraCentavos(inteira.ajusteOutrasDespesas),
    ),
  };
}

function itemProdutoNormal(item: ItemFiscalDaNota, produtoId: number) {
  return {
    produto_id: produtoId,
    ...valoresDeEstoque(item),
    valor_frete: item.valorFrete,
    unidade: normalizarUnidadeMedidaEntrada(item.unidade),
    ncm: texto(item.ncm),
    cest: texto(item.cest),
    cfop: texto(item.cfop),
    referencia: texto(item.codigo),
    titulo: texto(item.descricao),
    numero_item_fiscal: item.numeroItem,
  };
}

function itemSimplesNormal(item: ItemFiscalDaNota, itemId: number) {
  return {
    item_id: itemId,
    numero_item_fiscal: item.numeroItem,
    codigo_fornecedor: texto(item.codigo),
    ...valoresDeEstoque(item),
    valor_frete: item.valorFrete,
    unidade: normalizarUnidadeMedidaEntrada(item.unidade),
    ncm: texto(item.ncm),
    cest: texto(item.cest),
    cfop: texto(item.cfop),
    referencia: texto(item.codigo),
    titulo: texto(item.descricao),
  };
}

async function carregarDestinoPersonalizado(
  destino: EntradaFiscalHibrida["personalizado"]["destino"],
  itemReferenciaId: number,
) {
  if (destino === "ESTOQUE") {
    const { data, error } = await supabaseAdmin
      .from("produto")
      .select("id,titulo,descricao,referencia,unidade")
      .eq("id", itemReferenciaId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw Object.assign(new Error("Produto personalizado nao encontrado."), {
        statusCode: 404,
      });
    }
    return {
      id: Number(data.id),
      titulo: texto(data.titulo) ?? texto(data.descricao) ?? `Produto #${data.id}`,
      referencia: texto(data.referencia),
      unidade: texto(data.unidade),
    };
  }

  const { data, error } = await supabaseAdmin
    .from("usoconsumo_item")
    .select("id,titulo,referencia,unidade,escopo,ativo")
    .eq("id", itemReferenciaId)
    .eq("escopo", destino)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw Object.assign(new Error("Item personalizado nao encontrado neste estoque."), {
      statusCode: 404,
    });
  }
  return {
    id: Number(data.id),
    titulo: texto(data.titulo) ?? `Item #${data.id}`,
    referencia: texto(data.referencia),
    unidade: texto(data.unidade),
  };
}

export async function registrarEntradaFiscalHibrida(
  body: unknown,
  createdBy?: string | null,
) {
  const parsed = entradaFiscalHibridaSchema.safeParse(body);
  if (!parsed.success) {
    throw Object.assign(
      new Error(parsed.error.issues.map((issue) => issue.message).join(" ")),
      { statusCode: 400 },
    );
  }

  const input = parsed.data;
  const numerosNormais = input.itensNormais.map((item) => item.numeroItem);
  if (new Set(numerosNormais).size !== numerosNormais.length) {
    throw Object.assign(new Error("Um item fiscal normal foi informado mais de uma vez."), {
      statusCode: 400,
    });
  }

  const { documento, fornecedor } = await carregarDocumentoFiscalEFornecedor(
    input.documentoFiscalRecebidoId,
    input.fornecedorId,
  );
  const identificacaoFiscal = parseDfeXml(documento.xml, documento.schema);
  const chave = digitos(identificacaoFiscal.chaveAcesso);
  if (chave.length !== 44) {
    throw Object.assign(new Error("O documento recebido nao possui uma chave de NF-e valida."), {
      statusCode: 400,
    });
  }

  const { infNFe } = lerNFeDoXml(documento.xml);
  if (!infNFe) {
    throw Object.assign(new Error("O XML armazenado nao contem uma NF-e completa."), {
      statusCode: 400,
    });
  }
  const itens = lerItensDaNota(infNFe);
  if (
    !itens.length ||
    itens.some(
      (item) =>
        !Number.isInteger(item.numeroItem) ||
        Number(item.numeroItem) <= 0 ||
        !Number.isFinite(item.quantidade) ||
        item.quantidade <= 0,
    ) ||
    new Set(itens.map((item) => item.numeroItem)).size !== itens.length
  ) {
    throw Object.assign(
      new Error("Os numeros ou quantidades dos itens da NF-e sao invalidos."),
      { statusCode: 400 },
    );
  }

  const totais = lerTotaisDaNota(infNFe);
  const analise = calcularValorFiscalDaEntrada(
    totais,
    itens,
    itens.map((item) => ({ numeroItem: item.numeroItem })),
  );
  if (!analise.notaInteira || !Number.isFinite(totais.totalNota) || totais.totalNota < 0) {
    throw Object.assign(new Error("Nao foi possivel reconciliar a NF-e inteira."), {
      statusCode: 400,
    });
  }

  let classificacao: ReturnType<typeof classificarLinhasEntradaHibrida>;
  try {
    classificacao = classificarLinhasEntradaHibrida(
      analise.linhas.map((linha) => ({
        numeroItem: linha.numeroItem,
        custoEstoque: linha.custoEstoque,
      })),
      numerosNormais,
    );
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error("A selecao hibrida e invalida."),
      { statusCode: 400 },
    );
  }
  if (!classificacao.normais.length || !classificacao.personalizadas.length) {
    throw Object.assign(
      new Error("A rota hibrida exige ao menos um item normal e um item personalizado."),
      { statusCode: 400 },
    );
  }
  if (
    paraCentavos(classificacao.custoTotal) !==
    paraCentavos(analise.custoEstoqueDestinado)
  ) {
    throw Object.assign(new Error("O custo de estoque da NF-e nao foi reconciliado."), {
      statusCode: 400,
    });
  }

  const destinoSelecionado = new Map(
    input.itensNormais.map((item) => [item.numeroItem, item]),
  );
  const numerosPersonalizados = new Set(
    classificacao.personalizadas.map((linha) => Number(linha.numeroItem)),
  );
  const destinoEfetivo = (numeroItem: number) =>
    destinoSelecionado.get(numeroItem)?.destino ?? input.personalizado.destino;

  const destinoPersonalizado = await carregarDestinoPersonalizado(
    input.personalizado.destino,
    input.personalizado.itemReferenciaId,
  );
  const rateio = ratearCustoPersonalizado(
    classificacao.custoPersonalizado,
    input.personalizado.quantidade,
  );

  const itensProduto = itens
    .filter((item) => destinoSelecionado.get(Number(item.numeroItem))?.destino === "ESTOQUE")
    .map((item) =>
      itemProdutoNormal(
        item,
        destinoSelecionado.get(Number(item.numeroItem))!.itemReferenciaId,
      ),
    );
  const itensSimples = itens
    .filter((item) => {
      const destino = destinoSelecionado.get(Number(item.numeroItem))?.destino;
      return destino === "USOCONSUMO" || destino === "GERAL";
    })
    .map((item) =>
      itemSimplesNormal(
        item,
        destinoSelecionado.get(Number(item.numeroItem))!.itemReferenciaId,
      ),
    );

  const itemPersonalizado = {
    quantidade: input.personalizado.quantidade,
    valor_unitario_compra: rateio.custoUnitario,
    valor_desconto: rateio.valorDesconto,
    valor_frete: 0,
    outras_despesas: rateio.outrasDespesas,
    unidade: normalizarUnidadeMedidaEntrada(destinoPersonalizado.unidade),
    referencia: destinoPersonalizado.referencia,
    titulo: destinoPersonalizado.titulo,
  };
  if (input.personalizado.destino === "ESTOQUE") {
    itensProduto.push({
      ...itemPersonalizado,
      produto_id: input.personalizado.itemReferenciaId,
      ncm: null,
      cest: null,
      cfop: null,
      numero_item_fiscal: null,
    });
  } else {
    itensSimples.push({
      ...itemPersonalizado,
      item_id: input.personalizado.itemReferenciaId,
      codigo_fornecedor: null,
      ncm: null,
      cest: null,
      cfop: null,
      numero_item_fiscal: null,
    });
  }

  const numerosProduto = itens
    .filter((item) => destinoEfetivo(Number(item.numeroItem)) === "ESTOQUE")
    .map((item) => Number(item.numeroItem));
  const numerosSimples = itens
    .filter((item) => destinoEfetivo(Number(item.numeroItem)) !== "ESTOQUE")
    .map((item) => Number(item.numeroItem));
  const fonteDre: FonteDosLancamentos = {
    linhas: analise.linhas.map((linha) => ({
      numeroItem: linha.numeroItem,
      proporcao: linha.proporcao,
      componentes: linha.componentes,
      valorFiscalDoItem: linha.valorFiscalDoItem,
      custoEstoque: linha.custoEstoque,
    })),
    naoAlocados: analise.naoAlocados,
  };
  const tributosProduto = itensProduto.length
    ? payloadDosLancamentos(
        lancamentosDreDaEntrada(fonteDre, {
          numerosDeItem: numerosProduto,
          incluirNaoAlocados: true,
        }),
      )
    : [];
  const tributosSimples = itensSimples.length
    ? payloadDosLancamentos(
        lancamentosDreDaEntrada(fonteDre, {
          numerosDeItem: numerosSimples,
          incluirNaoAlocados: itensProduto.length === 0,
        }),
      )
    : [];

  const numeroNota = texto(identificacaoFiscal.resumo.nNF);
  const serieNota = texto(identificacaoFiscal.resumo.serie);
  const transacoes = montarTransacoesEntradaFiscal(
    input.financeiro,
    totais.totalNota,
    fornecedor,
    numeroNota,
    Boolean(input.ajustesValores),
  );
  const entradaComum = {
    fiscal: true,
    tipo: "COMPRA_FORNECEDOR",
    origem: "NFE_TERCEIRO",
    numero_nota: numeroNota,
    serie_nota: serieNota,
    data_emissao: texto(identificacaoFiscal.dataEmissao),
    valor_total_documento: totais.totalNota,
    created_by: createdBy ?? null,
  };
  const entradaProduto = itensProduto.length
    ? {
        ...entradaComum,
        fornecedorid: input.fornecedorId,
        notachave: chave,
        fiscal_dfe_documento_id: documento.id,
        tributos: tributosProduto,
      }
    : {};
  const destinosSimples = itens
    .map((item) => destinoEfetivo(Number(item.numeroItem)))
    .filter((destino): destino is "USOCONSUMO" | "GERAL" => destino !== "ESTOQUE");
  const entradaSimples = itensSimples.length
    ? {
        ...entradaComum,
        escopo: escopoDeEntradaDe(destinosSimples),
        fornecedor_id: input.fornecedorId,
        chave_nfe: chave,
        documento_fiscal_recebido_id: documento.id,
        tributos: tributosSimples,
      }
    : {};

  const custoPorNumero = new Map(
    analise.linhas.map((linha) => [Number(linha.numeroItem), linha.custoEstoque]),
  );
  const itensOriginais = itens
    .filter((item) => numerosPersonalizados.has(Number(item.numeroItem)))
    .map((item) => ({
      numero_item: item.numeroItem,
      codigo: item.codigo,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade,
      valor_unitario: item.valorUnitario,
      valor_total: item.valorProdutos,
      custo_estoque: custoPorNumero.get(Number(item.numeroItem)) ?? 0,
    }));
  const apropriacoes = itens.map((item) => {
    const destino = destinoEfetivo(Number(item.numeroItem));
    return {
      numero_item: item.numeroItem,
      destino: destino === "ESTOQUE" ? "PRODUTO" : "USOCONSUMO",
      quantidade: item.quantidade,
    };
  });

  const { data, error } = await registrarEntradaComValores("registrar_entrada_fiscal_hibrida", "HIBRIDA", {
    p_entrada_produto: entradaProduto,
    p_itens_produto: itensProduto,
    p_entrada_usoconsumo: entradaSimples,
    p_itens_usoconsumo: itensSimples,
    p_apropriacoes: apropriacoes,
    p_auditoria: {
      destino: input.personalizado.destino,
      produto_id:
        input.personalizado.destino === "ESTOQUE"
          ? input.personalizado.itemReferenciaId
          : null,
      usoconsumo_item_id:
        input.personalizado.destino === "ESTOQUE"
          ? null
          : input.personalizado.itemReferenciaId,
      quantidade_personalizada: input.personalizado.quantidade,
      custo_unitario: rateio.custoUnitario,
      itens_originais: itensOriginais,
      item_destino_snapshot: destinoPersonalizado,
    },
    p_custo_total: classificacao.custoTotal,
    p_custo_personalizado: rateio.custoTotal,
    p_total_documento: totais.totalNota,
    p_transacoes: transacoes,
  }, input.ajustesValores, createdBy);
  if (error) throw error;

  return data as {
    entrada_id: number | null;
    usoconsumo_entrada_id: number | null;
    valor_total: number;
    custo_total_estoque: number;
    custo_personalizado: number;
  };
}
