import { z } from "zod";
import { ajustesValoresEntradaSchema } from "@/lib/estoque/entrada-valores";
import { registrarEntradaComValores } from "./entradaValoresService";

import { dataDoCalendario } from "@/lib/data-calendario";
import { paraCentavos } from "@/lib/financeiro/rateio";
import { parseDfeXml } from "@/services/fiscal/dfeXmlParser";
import {
  lancamentosDreDaEntrada,
  payloadDosLancamentos,
  type FonteDosLancamentos,
} from "@/lib/nfe/lancamento-dre-entrada";
import { lerItensDaNota, lerNFeDoXml, lerTotaisDaNota } from "@/lib/nfe/totais-nfe";
import { calcularValorFiscalDaEntrada } from "@/lib/nfe/valor-fiscal-entrada";
import { ratearCustoPersonalizado } from "@/lib/nfe/entrada-fiscal-personalizada";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const destinoEntradaFiscalPersonalizadaSchema = z.enum([
  "ESTOQUE",
  "USOCONSUMO",
  "GERAL",
]);

const idOpcional = z.number().int().positive().nullable().optional();

export const financeiroEntradaFiscalSchema = z
  .object({
    parcelas: z
      .array(
        z
          .object({
            dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            valor: z.number().positive(),
          })
          .strict(),
      )
      .min(1),
    categoria: z.string().trim().min(1).max(200),
    categoriaId: idOpcional,
    bancoId: idOpcional,
    metodoPagamento: z.string().trim().min(1).max(100).nullable().optional(),
    planoContaId: idOpcional,
    centroCustoId: idOpcional,
  })
  .strict();

const entradaFiscalPersonalizadaSchema = z
  .object({
    documentoFiscalRecebidoId: z.number().int().positive(),
    fornecedorId: z.number().int().positive(),
    destino: destinoEntradaFiscalPersonalizadaSchema,
    itemReferenciaId: z.number().int().positive(),
    quantidade: z.number().int().positive(),
    financeiro: financeiroEntradaFiscalSchema.nullable(),
    ajustesValores: ajustesValoresEntradaSchema.optional(),
  })
  .strict();

type DocumentoFiscal = {
  id: number;
  schema: string;
  xml: string;
};

function texto(value: unknown) {
  const normalizado = String(value ?? "").trim();
  return normalizado || null;
}

function digitos(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export async function carregarDocumentoFiscalEFornecedor(documentoId: number, fornecedorId: number) {
  const [documentoResult, fornecedorResult] = await Promise.all([
    supabaseAdmin
      .from("fiscal_dfe_documento")
      .select("id,schema,xml")
      .eq("id", documentoId)
      .maybeSingle(),
    supabaseAdmin
      .from("fornecedor")
      .select("id,cpfcnpj,nomerazaosocial,nomefantasia")
      .eq("id", fornecedorId)
      .maybeSingle(),
  ]);

  if (documentoResult.error) throw documentoResult.error;
  if (fornecedorResult.error) throw fornecedorResult.error;
  if (!documentoResult.data) {
    throw Object.assign(new Error("Documento fiscal recebido nao encontrado."), { statusCode: 404 });
  }
  if (!fornecedorResult.data) {
    throw Object.assign(new Error("Fornecedor nao encontrado."), { statusCode: 404 });
  }

  return {
    documento: documentoResult.data as DocumentoFiscal,
    fornecedor: fornecedorResult.data as {
      id: number;
      cpfcnpj: string | null;
      nomerazaosocial: string | null;
      nomefantasia: string | null;
    },
  };
}

export function montarTransacoesEntradaFiscal(
  financeiro: z.infer<typeof financeiroEntradaFiscalSchema> | null,
  totalNota: number,
  fornecedor: {
    cpfcnpj: string | null;
    nomerazaosocial: string | null;
    nomefantasia: string | null;
  },
  numeroNota: string | null,
  permitirTotalAjustado = false,
) {
  if (!financeiro) return [];

  const soma = financeiro.parcelas.reduce(
    (total, parcela) => total + paraCentavos(parcela.valor),
    0,
  );
  // Com ajuste, a comparação definitiva ocorre no banco após recalcular os itens,
  // na mesma transação que cria a entrada e as parcelas.
  if (!permitirTotalAjustado && soma !== paraCentavos(totalNota)) {
    throw Object.assign(
      new Error("A soma das parcelas deve corresponder ao valor integral da NF-e."),
      { statusCode: 400 },
    );
  }

  const descricao = numeroNota ? `Compra NF ${numeroNota}` : "Compra de mercadorias";
  const nomePagador = fornecedor.nomerazaosocial || fornecedor.nomefantasia || "Fornecedor";
  const documentoPagador = digitos(fornecedor.cpfcnpj) || "NAO INFORMADO";

  return financeiro.parcelas.map((parcela, indice) => ({
    descricao: `${descricao}${financeiro.parcelas.length > 1 ? ` - Parcela ${indice + 1}/${financeiro.parcelas.length}` : ""}`,
    valor: parcela.valor,
    data: dataDoCalendario(parcela.dataVencimento),
    pendente: true,
    metodopagamento: financeiro.metodoPagamento ?? null,
    categoria: financeiro.categoria,
    categoria_id: financeiro.categoriaId ?? null,
    banco_id: financeiro.bancoId ?? null,
    plano_de_conta_id: financeiro.planoContaId ?? null,
    centro_custo_id: financeiro.centroCustoId ?? null,
    nomepagador: nomePagador,
    cpfcnpjpagador: documentoPagador,
  }));
}

export async function registrarEntradaFiscalPersonalizada(
  body: unknown,
  createdBy?: string | null,
) {
  const parsed = entradaFiscalPersonalizadaSchema.safeParse(body);
  if (!parsed.success) {
    throw Object.assign(
      new Error(parsed.error.issues.map((issue) => issue.message).join(" ")),
      { statusCode: 400 },
    );
  }

  const input = parsed.data;
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
  if (!itens.length) {
    throw Object.assign(new Error("A NF-e nao possui itens que possam ser apropriados."), {
      statusCode: 400,
    });
  }
  const numeros = itens.map((item) => item.numeroItem);
  if (
    numeros.some((numero) => !Number.isInteger(numero) || Number(numero) <= 0) ||
    new Set(numeros).size !== numeros.length ||
    itens.some((item) => !Number.isFinite(item.quantidade) || item.quantidade <= 0)
  ) {
    throw Object.assign(new Error("Os numeros ou quantidades dos itens da NF-e sao invalidos."), {
      statusCode: 400,
    });
  }

  const totais = lerTotaisDaNota(infNFe);
  const analise = calcularValorFiscalDaEntrada(
    totais,
    itens,
    itens.map((item) => ({ numeroItem: item.numeroItem })),
  );
  const totalNota = totais.totalNota;
  if (!Number.isFinite(totalNota) || totalNota < 0 || !analise.notaInteira) {
    throw Object.assign(new Error("Nao foi possivel reconciliar a NF-e inteira."), {
      statusCode: 400,
    });
  }

  const rateio = ratearCustoPersonalizado(
    analise.custoEstoqueDestinado,
    input.quantidade,
  );
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
  const tributos = payloadDosLancamentos(lancamentosDreDaEntrada(fonteDre));

  const numeroNota = texto(identificacaoFiscal.resumo.nNF);
  const serieNota = texto(identificacaoFiscal.resumo.serie);
  const transacoes = montarTransacoesEntradaFiscal(
    input.financeiro,
    totalNota,
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
    valor_total_documento: totalNota,
    created_by: createdBy ?? null,
    tributos,
  };
  const entrada =
    input.destino === "ESTOQUE"
      ? {
          ...entradaComum,
          fornecedorid: input.fornecedorId,
          notachave: chave,
          fiscal_dfe_documento_id: documento.id,
        }
      : {
          ...entradaComum,
          escopo: input.destino,
          fornecedor_id: input.fornecedorId,
          chave_nfe: chave,
          documento_fiscal_recebido_id: documento.id,
        };
  const item =
    input.destino === "ESTOQUE"
      ? {
          produto_id: input.itemReferenciaId,
          quantidade: input.quantidade,
          valor_unitario_compra: rateio.custoUnitario,
          valor_desconto: rateio.valorDesconto,
          valor_frete: 0,
          outras_despesas: rateio.outrasDespesas,
        }
      : {
          item_id: input.itemReferenciaId,
          quantidade: input.quantidade,
          valor_unitario_compra: rateio.custoUnitario,
          valor_desconto: rateio.valorDesconto,
          valor_frete: 0,
          outras_despesas: rateio.outrasDespesas,
        };
  const custoPorNumeroItem = new Map(
    analise.linhas.map((linha) => [linha.numeroItem, linha.custoEstoque]),
  );
  const itensOriginais = itens.map((itemFiscal) => ({
    numero_item: itemFiscal.numeroItem,
    codigo: itemFiscal.codigo,
    descricao: itemFiscal.descricao,
    unidade: itemFiscal.unidade,
    quantidade: itemFiscal.quantidade,
    valor_unitario: itemFiscal.valorUnitario,
    valor_total: itemFiscal.valorProdutos,
    custo_estoque: custoPorNumeroItem.get(itemFiscal.numeroItem) ?? 0,
  }));

  const { data, error } = await registrarEntradaComValores("registrar_entrada_fiscal_personalizada", "PERSONALIZADA", {
    p_destino: input.destino,
    p_entrada: entrada,
    p_item: item,
    p_itens_fiscais: itensOriginais,
    p_custo_total: rateio.custoTotal,
    p_transacoes: transacoes,
  }, input.ajustesValores, createdBy);
  if (error) throw error;

  return data as {
    destino: z.infer<typeof destinoEntradaFiscalPersonalizadaSchema>;
    entrada_id: number | null;
    usoconsumo_entrada_id: number | null;
    valor_total: number;
    custo_total_estoque: number;
  };
}
