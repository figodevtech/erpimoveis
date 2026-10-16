import { z } from "zod";
import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";

export const valorUnitarioCompraSchema = z.number().finite().min(0).max(9999999999.9999)
  .refine((valor) => Number(valor.toFixed(4)) === valor,
    "O valor unitário aceita até quatro casas decimais.");

export const ajustesValoresEntradaSchema = z.object({
  motivo: z.string().trim().min(1, "Informe o motivo do ajuste.").max(1000),
  itens: z.array(z.object({
    inventory: z.enum(["produto", "usoconsumo"]),
    numeroItemFiscal: z.number().int().positive().optional(),
    consolidado: z.boolean().optional(),
    valorUnitarioCompra: valorUnitarioCompraSchema,
  }).strict().refine((item) => Boolean(item.numeroItemFiscal) !== (item.consolidado === true),
    "Identifique a linha fiscal ou o item consolidado.")).min(1).max(990),
}).strict().superRefine((value, ctx) => {
  const chaves = value.itens.map((item) => `${item.inventory}:${item.numeroItemFiscal ?? "consolidado"}`);
  if (new Set(chaves).size !== chaves.length) {
    ctx.addIssue({ code: "custom", path: ["itens"], message: "Há itens repetidos no ajuste." });
  }
});

export type AjustesValoresEntrada = z.infer<typeof ajustesValoresEntradaSchema>;

export const ajusteValoresEntradaSchema = z.object({
  inventory: z.enum(["produto", "usoconsumo"]),
  versaoEsperada: z.number().int().min(0),
  motivo: z.string().trim().min(1, "Informe o motivo do ajuste.").max(1000),
  itens: z.array(z.object({
    id: z.number().int().positive(),
    valorUnitarioCompra: valorUnitarioCompraSchema,
  }).strict()).min(1).max(990),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.itens.map((item) => item.id)).size !== value.itens.length) {
    ctx.addIssue({ code: "custom", path: ["itens"], message: "Há itens repetidos no ajuste." });
  }
});

export type ItemValoresEntrada = {
  quantidade: number;
  valor_unitario_compra: number;
  valor_desconto?: number | null;
  valor_frete?: number | null;
  outras_despesas?: number | null;
};

/** A mesma conta dos motores de entrada; o total é arredondado uma única vez. */
export function totalItemEntrada(item: ItemValoresEntrada, unitario = item.valor_unitario_compra) {
  return paraReais(paraCentavos(
    Number(item.quantidade) * unitario - Number(item.valor_desconto ?? 0)
      + Number(item.valor_frete ?? 0) + Number(item.outras_despesas ?? 0),
  ));
}

/** Preserva os acréscimos que existem no cabeçalho e não nas linhas. */
export function totalEntradaAjustado(totalAnterior: number, diferencas: number[]) {
  return paraReais(paraCentavos(totalAnterior)
    + diferencas.reduce((soma, diferenca) => soma + paraCentavos(diferenca), 0));
}

export type HistoricoValoresEntrada = {
  id: number;
  created_at: string;
  motivo: string;
  created_by: string;
  autor_nome: string | null;
  valor_anterior: number;
  valor_novo: number;
  itens: Array<{ id: number; titulo: string | null; unitario_anterior: number; unitario_novo: number;
    total_anterior: number; total_novo: number; custo_cadastro_atualizado: boolean }>;
};

export type ValoresCompraEntrada = {
  valorNota: number;
  totalCompra: number;
  totalFinanceiro: number;
  financeiroPreservado: boolean;
  versaoFinanceiro: string;
  historico: HistoricoValoresEntrada[];
};
