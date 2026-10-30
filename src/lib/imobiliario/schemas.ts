import { z } from "zod";
import { isValidCnpj, isValidCpf, normalizeCnpj, normalizeCpf } from "@/lib/fiscal-identifiers";

const text = z.string().trim();
const optionalText = text.max(2000).nullish();
const money = z.coerce.number().finite().nonnegative().max(1e12);
const percentage = z.coerce.number().finite().min(0).max(100);
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const civilDate = text.regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Data inválida");
const json = z.record(z.string(), z.unknown());

export const proprietarioSchema = z.object({
  nomerazaosocial: text.min(2).max(200), tipopessoa: z.enum(["FISICA", "JURIDICA"]),
  cpfcnpj: text.max(18), email: text.email().max(254).transform((v) => v.toLowerCase()).nullish(),
  telefone: optionalText, endereco: optionalText, bairro: optionalText, cidade: optionalText,
  estado: text.length(2).transform((v) => v.toUpperCase()).nullish(), cep: optionalText,
  endereconumero: optionalText, enderecocomplemento: optionalText, observacoes: optionalText,
  ativo: z.boolean().default(true), percentual_admin: percentage.default(0),
  dados_bancarios: json.default({}), telefones: z.array(json).max(20).default([]),
}).superRefine((v, ctx) => {
  if (!(v.tipopessoa === "FISICA" ? isValidCpf(normalizeCpf(v.cpfcnpj)) : isValidCnpj(normalizeCnpj(v.cpfcnpj)))) {
    ctx.addIssue({ code: "custom", path: ["cpfcnpj"], message: "CPF/CNPJ inválido" });
  }
});

export const imovelSchema = z.object({
  proprietario_id: id, titulo: text.min(2).max(200),
  // O imóvel é identificado pelo ID; o código ficou só para cadastros antigos que já o tinham.
  codigo: text.max(50).nullish().transform((v) => v || null),
  slug: text.min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), tipo: text.min(1).max(50), descricao: text.max(20000).default(""),
  modalidades: z.array(z.enum(["TEMPORADA", "LOCACAO", "VENDA"])).min(1).max(3), ativo: z.boolean().default(true), publicado: z.boolean().default(false),
  selo_anuncio: text.max(60).nullish().transform((v) => v || null), fotos_reais: z.boolean().default(false),
  endereco: json.default({}), endereco_publico: json.default({}), caracteristicas: json.default({}),
  comodidades: z.array(text.max(120)).max(100).default([]), capacidade: z.coerce.number().int().min(1).max(1000).default(1),
  quartos: z.coerce.number().int().min(0).max(1000).default(0), banheiros: z.coerce.number().int().min(0).max(1000).default(0),
  vagas: z.coerce.number().int().min(0).max(1000).default(0), area: money.default(0), diaria: money.default(0),
  valor_locacao: money.default(0), valor_venda: money.default(0), taxa_limpeza: money.default(0), percentual_admin: percentage.default(0),
  min_noites: z.coerce.number().int().min(1).max(365).default(1), max_noites: z.coerce.number().int().min(1).max(730).default(60),
  regras: text.max(20000).default(""), cancelamento: json.default({}), horario_checkin: text.regex(/^\d{2}:\d{2}(?::\d{2})?$/).default("14:00"), horario_checkout: text.regex(/^\d{2}:\d{2}(?::\d{2})?$/).default("11:00"),
}).refine((v) => v.max_noites >= v.min_noites, { path: ["max_noites"], message: "Máximo de noites menor que o mínimo" });

export const reservaSchema = z.object({
  imovel_id: id, cliente_id: id, inicio: civilDate, fim: civilDate,
  hospedes: z.coerce.number().int().min(1).max(1000), observacoes: text.max(10000).default(""),
  cotacao_id: z.string().uuid().optional(), expected_total: money.optional(),
  idempotency_key: text.min(8).max(200), origem: z.enum(["ERP", "SITE"]).default("ERP"),
}).refine((v) => v.fim > v.inicio, { path: ["fim"], message: "Saída deve ser posterior à entrada" });

export const locacaoSchema = z.object({
  imovel_id: id, cliente_id: id, inicio: civilDate, fim: civilDate.nullish(), valor_mensal: money.positive(),
  dia_vencimento: z.coerce.number().int().min(1).max(31), percentual_admin: percentage.default(0),
  indice_reajuste: optionalText, proximo_reajuste: civilDate.nullish(), observacoes: text.max(20000).default(""),
  contrato_numero: optionalText,
}).refine((v) => !v.fim || v.fim > v.inicio, { path: ["fim"], message: "Fim deve ser posterior ao início" });

export const vendaImovelSchema = z.object({
  imovel_id: id, comprador_id: id, valor_total: money.positive(), comissao_percentual: percentage.default(0),
  comissao_valor: money.optional(), data_venda: civilDate.optional(), observacoes: text.max(20000).default(""),
  novo_proprietario_id: id.nullish(), vigencia_beneficiario: civilDate.nullish(),
  parcelas: z.array(z.object({ valor: money.positive(), vencimento: civilDate })).max(360).optional(),
});

export const tarifaSchema = z.object({ inicio: civilDate, fim: civilDate, diaria: money.positive(), min_noites: z.coerce.number().int().min(1).max(365).default(1), prioridade: z.coerce.number().int().min(0).max(1000).default(0), ativo: z.boolean().default(true) })
  .refine((v) => v.fim > v.inicio, { path: ["fim"], message: "Fim deve ser posterior ao início" });

export const visitaSchema = z.object({ imovel_id: id, cliente_id: id.nullish(), inicio: text.datetime({ offset: true }), fim: text.datetime({ offset: true }).nullish(), status: z.enum(["SOLICITADA", "CONFIRMADA", "REALIZADA", "CANCELADA"]).default("SOLICITADA"), responsavel_id: z.string().uuid().nullish(), observacoes: text.max(10000).default("") });
