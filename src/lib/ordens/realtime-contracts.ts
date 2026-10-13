import { z } from "zod";

export const ORDENS_REALTIME_TABLES = ["ordemservico", "osservico", "osservico_realizador"] as const;
export const ordensRealtimeTableSchema = z.enum(ORDENS_REALTIME_TABLES);
export const ordensRealtimeCredentialsSchema = z.object({
  userId: z.string().uuid(),
  token: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  tenantId: z.number().int().positive(),
  topic: z.string().regex(/^ordens:tenant:\d+$/),
}).refine(value => value.topic === `ordens:tenant:${value.tenantId}`, "Tópico de outra empresa");
export type OrdensRealtimeCredentials = z.infer<typeof ordensRealtimeCredentialsSchema>;
export type OrdensRealtimeTable = z.infer<typeof ordensRealtimeTableSchema>;
