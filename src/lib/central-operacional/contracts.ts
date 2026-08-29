import { z } from "zod";

export const OPERATIONAL_MODULES = [
  "VENDAS",
  "ORDENS",
  "FINANCEIRO",
  "CONTAS_RECEBER",
  "CONTAS_PAGAR",
  "ESTOQUE",
  "FISCAL",
] as const;

export const OPERATIONAL_EVENT_MODULES = [
  "VENDAS",
  "ORDENS",
  "FINANCEIRO",
  "CONTAS_PAGAR",
  "ESTOQUE",
  "FISCAL",
] as const;

export const OPERATIONAL_NODE_MODULES = [
  "VENDAS",
  "ORDENS",
  "CONTAS_RECEBER",
  "CONTAS_PAGAR",
  "FINANCEIRO",
  "FISCAL",
] as const;

export const OPERATIONAL_PERIODS = ["DIARIO", "SEMANAL", "MENSAL"] as const;

export const OPERATIONAL_EVENT_TYPES = [
  "OS_CRIADA",
  "OS_INICIO_EXECUCAO",
  "OS_FINALIZADA",
  "OS_CANCELADA",
  "OS_AGUARDANDO_PAGAMENTO",
  "VENDA_CRIADA",
  "VENDA_CONFIRMADA",
  "VENDA_CANCELADA",
  "PAGAMENTO_RECEBIDO",
  "TRANSACAO_CRIADA",
  "TRANSACAO_PAGA",
  "PIX_RECEBIDO",
  "ESTOQUE_ENTRADA",
  "ESTOQUE_SAIDA",
  "ESTOQUE_BAIXO",
  "NFE_EMISSAO_INICIADA",
  "NFE_AUTORIZADA",
  "NFE_REJEITADA",
  "NFSE_EMISSAO_INICIADA",
  "NFSE_AUTORIZADA",
  "NFSE_REJEITADA",
  "CONTA_CRIADA",
  "CONTA_PAGA",
  "CONTA_VENCIDA",
] as const;

export const operationalModuleSchema = z.enum(OPERATIONAL_MODULES);
export const operationalEventModuleSchema = z.enum(OPERATIONAL_EVENT_MODULES);
export const operationalNodeModuleSchema = z.enum(OPERATIONAL_NODE_MODULES);
export const operationalEventTypeSchema = z.enum(OPERATIONAL_EVENT_TYPES);
export const operationalPrioritySchema = z.enum(["INFO", "ATENCAO", "CRITICO"]);
export const operationalPeriodSchema = z.enum(OPERATIONAL_PERIODS);

const finiteNumber = z.number().finite();

export const operationalEventSchema = z.object({
  id: z.string().uuid(),
  tipo: operationalEventTypeSchema,
  modulo: operationalEventModuleSchema,
  entidadeTipo: z.string().min(1),
  entidadeId: z.string().nullable(),
  titulo: z.string().min(1),
  descricao: z.string().nullable(),
  valor: finiteNumber.nullable(),
  quantidade: finiteNumber.nullable(),
  prioridade: operationalPrioritySchema,
  metadata: z.record(z.string(), z.unknown()),
  ocorridoEm: z.string().datetime({ offset: true }),
});

export const operationalIndicatorSchema = z.object({
  tipo: z.enum(["MOEDA", "CONTAGEM", "QUANTIDADE"]),
  valor: finiteNumber,
  sufixo: z.string().nullable(),
});

export const operationalNodeSchema = z.object({
  modulo: operationalNodeModuleSchema,
  disponivel: z.boolean(),
  estado: z.string().min(1),
  indicador: operationalIndicatorSchema.nullable(),
  detalhe: z.string().nullable(),
  alerta: z.boolean(),
});

export const operationalAttentionSchema = z.object({
  id: z.string().min(1),
  modulo: operationalModuleSchema,
  titulo: z.string().min(1),
  detalhe: z.string().nullable(),
  prioridade: operationalPrioritySchema,
  valor: finiteNumber.nullable(),
  ocorridoEm: z.string().datetime({ offset: true }),
});

export const operationalSnapshotSchema = z.object({
  meta: z.object({
    tenantId: z.number().int().positive(),
    empresa: z.string().min(1),
    atualizadoEm: z.string().datetime({ offset: true }),
    status: z.literal("SINCRONIZADO"),
    periodo: operationalPeriodSchema,
    periodoInicio: z.string().datetime({ offset: true }),
    periodoFimExclusivo: z.string().datetime({ offset: true }),
    modulosPermitidos: z.array(operationalModuleSchema),
  }),
  geral: z.object({
    usuariosAtivos: z.number().int().nonnegative().nullable(),
    operacoesPeriodo: z.number().int().nonnegative(),
    osAtivas: z.number().int().nonnegative().nullable(),
  }),
  modulos: z.object({
    VENDAS: operationalNodeSchema,
    ORDENS: operationalNodeSchema,
    FINANCEIRO: operationalNodeSchema,
    CONTAS_RECEBER: operationalNodeSchema,
    CONTAS_PAGAR: operationalNodeSchema,
    FISCAL: operationalNodeSchema,
  }),
  eventosPeriodo: z.number().int().nonnegative(),
  eventosRecentes: z.array(operationalEventSchema),
  atencoes: z.array(operationalAttentionSchema),
});

export const operationalRealtimeCredentialsSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  tenantId: z.number().int().positive(),
  topic: z.string().regex(/^operational:tenant:\d+$/),
});

export type OperationalModule = z.infer<typeof operationalModuleSchema>;
export type OperationalEventModule = z.infer<typeof operationalEventModuleSchema>;
export type OperationalNodeModule = z.infer<typeof operationalNodeModuleSchema>;
export type OperationalEventType = z.infer<typeof operationalEventTypeSchema>;
export type OperationalPriority = z.infer<typeof operationalPrioritySchema>;
export type OperationalPeriod = z.infer<typeof operationalPeriodSchema>;
export type OperationalEvent = z.infer<typeof operationalEventSchema>;
export type OperationalIndicator = z.infer<typeof operationalIndicatorSchema>;
export type OperationalNode = z.infer<typeof operationalNodeSchema>;
export type OperationalAttention = z.infer<typeof operationalAttentionSchema>;
export type OperationalSnapshot = z.infer<typeof operationalSnapshotSchema>;
export type OperationalRealtimeCredentials = z.infer<typeof operationalRealtimeCredentialsSchema>;

export type OperationalConnectionStatus = "CONNECTING" | "LIVE" | "RECONNECTING" | "OFFLINE";

export function isOperationalNodeModule(module: OperationalModule): module is OperationalNodeModule {
  return (OPERATIONAL_NODE_MODULES as readonly OperationalModule[]).includes(module);
}
