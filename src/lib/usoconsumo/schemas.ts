import { z } from "zod";
import { ESCOPOS_USOCONSUMO, ESCOPO_MISTO, ESCOPO_PADRAO } from "./escopo";

// Qual dos dois estoques simples a requisicao endereca. O default preserva todo
// cliente anterior ao estoque geral: sem o parametro, a rota continua em uso e
// consumo. Trocar o escopo de um item ja cadastrado nao e oferecido de proposito
// -- mudaria de estoque um saldo que ja tem historico --, entao ele fica fora do patch.
export const escopoSchema = z.enum(ESCOPOS_USOCONSUMO).default(ESCOPO_PADRAO);

// So o cabecalho de ENTRADA aceita MISTO: uma NF-e mistura os dois estoques e nao
// pode virar duas entradas. Item e saida seguem com escopo unico.
export const escopoDeEntradaSchema = z
  .enum([...ESCOPOS_USOCONSUMO, ESCOPO_MISTO])
  .default(ESCOPO_PADRAO);

const emptyToUndefined = (value: unknown) => value === "" || value === null ? undefined : value;
const emptyToNull = (value: unknown) => value === "" || value === null ? null : value;
const createText = z.preprocess(emptyToUndefined, z.string().trim().max(500).optional());
const patchText = z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional());
const createNumber = (max?: number) => z.preprocess(
  emptyToUndefined,
  (max === undefined ? z.coerce.number().min(0) : z.coerce.number().min(0).max(max)).optional(),
);
const patchNumber = (max?: number) => z.preprocess(
  emptyToNull,
  (max === undefined ? z.coerce.number().min(0) : z.coerce.number().min(0).max(max)).nullable().optional(),
);

const fiscalCreate = {
  ncm: createText, cest: createText, cfop_entrada: createText, origem_mercadoria: createText,
  csosn: createText, cst: createText, aliquotaicms: createNumber(100),
  cst_pis: createText, aliquota_pis: createNumber(100), modo_pis: createText,
  aliquota_por_unidade_pis: createNumber(), cst_cofins: createText,
  aliquota_cofins: createNumber(100), modo_cofins: createText,
  aliquota_por_unidade_cofins: createNumber(), cst_ibscbs: createText, cclass_trib: createText,
  aliquota_ibs_uf: createNumber(100), aliquota_ibs_municipio: createNumber(100), aliquota_cbs: createNumber(100),
};

export const usoConsumoItemCreateSchema = z.object({
  escopo: escopoSchema,
  titulo: z.string().trim().min(1, "Informe o título.").max(200),
  descricao: createText, referencia: createText, fabricante: createText,
  grupo_id: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  unidade: z.enum(["UN","JGO","KIT","PAR","CX","PCT"]).default("UN"),
  conservacao: z.enum(["NOVO","USADO","RECONDICIONADO"]).default("NOVO"),
  codigobarras: createText, etiqueta: createText, local: createText,
  estoqueInicial: z.coerce.number().int().min(0).default(0),
  estoqueminimo: z.coerce.number().int().min(0).default(0),
  precocompra: z.coerce.number().min(0).default(0),
  ...fiscalCreate,
}).strict();

export const usoConsumoItemPatchSchema = z.object({
  titulo: z.string().trim().min(1).max(200).optional(),
  descricao: patchText, referencia: patchText, fabricante: patchText,
  grupo_id: z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable().optional()),
  unidade: z.enum(["UN","JGO","KIT","PAR","CX","PCT"]).optional(),
  conservacao: z.enum(["NOVO","USADO","RECONDICIONADO"]).optional(),
  codigobarras: patchText, etiqueta: patchText, local: patchText,
  estoqueminimo: z.coerce.number().int().min(0).optional(),
  precocompra: z.coerce.number().min(0).optional(),
  ncm: patchText, cest: patchText, cfop_entrada: patchText, origem_mercadoria: patchText,
  csosn: patchText, cst: patchText, aliquotaicms: patchNumber(100),
  cst_pis: patchText, aliquota_pis: patchNumber(100), modo_pis: patchText,
  aliquota_por_unidade_pis: patchNumber(), cst_cofins: patchText,
  aliquota_cofins: patchNumber(100), modo_cofins: patchText,
  aliquota_por_unidade_cofins: patchNumber(), cst_ibscbs: patchText, cclass_trib: patchText,
  aliquota_ibs_uf: patchNumber(100), aliquota_ibs_municipio: patchNumber(100), aliquota_cbs: patchNumber(100),
  // PostgREST serializa timestamptz com offset (por exemplo, +00:00).
  // O padrão do Zod aceita somente o sufixo Z e rejeitava timestamps
  // válidos retornados pelo próprio Supabase como "Invalid datetime".
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedUpdatedAt"), "Nada para atualizar.");

export const entradaItemSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  numero_item_fiscal: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  codigo_fornecedor: createText,
  quantidade: z.coerce.number().int().positive(),
  valor_unitario_compra: z.coerce.number().min(0),
  valor_desconto: z.coerce.number().min(0).default(0),
  valor_frete: z.coerce.number().min(0).default(0),
  outras_despesas: z.coerce.number().min(0).default(0),
  unidade: createText, ncm: createText, cest: createText, csosn: createText,
  referencia: createText, titulo: createText, cst: createText, aliquotaicms: createNumber(100),
  cfop: createText, cst_pis: createText, aliquota_pis: createNumber(100),
  cst_cofins: createText, aliquota_cofins: createNumber(100), cst_ibscbs: createText,
  cclass_trib: createText, aliquota_ibs_uf: createNumber(100),
  aliquota_ibs_municipio: createNumber(100), aliquota_cbs: createNumber(100),
}).strict();

export const transacaoUsoConsumoSchema = z.object({
  descricao: z.string().trim().min(1).max(500), valor: z.coerce.number().positive(),
  data: z.string().min(1), vencimento_em: z.string().optional().nullable(),
  metodopagamento: z.string().optional().nullable(), categoria: z.string().trim().min(1),
  categoria_id: z.number().int().positive().optional().nullable(), banco_id: z.number().int().positive().optional().nullable(),
  nomepagador: z.string().trim().min(1), cpfcnpjpagador: z.string().trim().min(1), pendente: z.boolean(),
  plano_de_conta_id: z.number().int().positive().optional().nullable(), plano_de_conta: z.string().optional().nullable(),
  centro_custo_id: z.number().int().positive().optional().nullable(), centro_custo: z.string().optional().nullable(),
}).strict();

export const entradaUsoConsumoSchema = z.object({
  escopo: escopoDeEntradaSchema,
  fornecedor_id: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  fiscal: z.boolean().default(false), chave_nfe: createText, numero_nota: createText, serie_nota: createText,
  data_emissao: createText,
  // Codigo livre: os tipos vivem em tipos_entrada (Configuracoes > Tipos) e quem
  // valida existencia/escopo e o trigger de usoconsumo_entrada.
  tipo: z.string().trim().min(1).transform((value) => value.toUpperCase()).default("COMPRA_FORNECEDOR"),
  origem: z.enum(["AJUSTE_RAPIDO","MANUAL","NFE_TERCEIRO","INVENTARIO"]).default("MANUAL"),
  documento_fiscal_recebido_id: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  observacao: createText,
  // Total da nota quando ele passa da soma dos itens — frete no cabeçalho, por
  // exemplo. É contra ele que a RPC confere as parcelas; ausente, vale a soma.
  valor_total_documento: z.preprocess(emptyToUndefined, z.coerce.number().nonnegative().optional()),
  itens: z.array(entradaItemSchema).min(1),
  transacoes: z.array(transacaoUsoConsumoSchema).default([]),
}).strict().superRefine((value, ctx) => {
  if (!value.fiscal) return;
  if (!/^\d{44}$/.test(String(value.chave_nfe ?? "").replace(/\D/g,""))) {
    ctx.addIssue({ code: "custom", path: ["chave_nfe"], message: "Informe uma chave de NF-e com 44 dígitos." });
  }
  if (!value.fornecedor_id) ctx.addIssue({ code: "custom", path: ["fornecedor_id"], message: "A entrada fiscal exige fornecedor." });
  if (value.documento_fiscal_recebido_id && value.itens.some((item) => !item.numero_item_fiscal)) {
    ctx.addIssue({ code: "custom", path: ["itens"], message: "Todos os itens do XML precisam do número fiscal." });
  }
});

// Os motivos válidos vêm da tabela tipos_motivo_saida (cadastro dinâmico em
// configuracoes/tipos), não dá mais pra enumerar estaticamente aqui. A
// existência/escopo do código é checada em src/app/api/usoconsumo/saidas/route.ts
// antes de chamar a RPC.
const saidaMotivo = z.string().trim().min(1, "Selecione o motivo da saída.").transform((value) => value.toUpperCase());
export const saidaUsoConsumoSchema = z.object({
  escopo: escopoSchema,
  motivo: saidaMotivo, observacao: createText, setor: createText, funcionario: createText,
  centro_custo_id: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  itens: z.array(z.object({ item_id: z.coerce.number().int().positive(), quantidade: z.coerce.number().int().positive() }).strict()).min(1),
}).strict().superRefine((value, ctx) => {
  if (value.motivo === "OUTRO" && !value.observacao) ctx.addIssue({ code: "custom", path: ["observacao"], message: "Informe a observação." });
});

export const inventarioUsoConsumoSchema = z.object({
  novo_saldo: z.coerce.number().int().min(0), observacao: z.string().trim().min(3).max(500),
}).strict();

export const grupoUsoConsumoSchema = z.object({
  nome: z.string().trim().min(1).max(100),
  descricao: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
  ativo: z.boolean().optional(),
}).strict();

export function zodMessage(error: z.ZodError) {
  return error.issues.map((issue) => issue.message).join(" ");
}
