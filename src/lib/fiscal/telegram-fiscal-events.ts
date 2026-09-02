/**
 * Catálogo de avisos fiscais do Telegram.
 *
 * Os três documentos vivem em tabelas diferentes e mudam de estado por caminhos
 * diferentes — a NF-e pelas rotas da SEFAZ, a NFS-e também pelo webhook da Focus
 * e a nota de terceiros dentro da RPC de sincronização. O catálogo é único
 * porque quem escolhe os avisos escolhe por assunto, não por tabela.
 */
export const FISCAL_NOTIFICATION_EVENT_GROUPS = [
  {
    id: "NFE",
    label: "NF-e e NFC-e",
    description: "Retorno da SEFAZ para as notas emitidas pela empresa",
    events: [
      ["NFE_AUTORIZADA", "Autorizada"],
      ["NFE_REJEITADA", "Rejeitada"],
      ["NFE_DENEGADA", "Denegada"],
      ["NFE_CANCELADA", "Cancelada"],
      ["NFE_RESULTADO_INCERTO", "Resultado incerto"],
    ],
  },
  {
    id: "NFSE",
    label: "NFS-e",
    description: "Notas de serviço, pelo padrão nacional ou pela prefeitura",
    events: [
      ["NFSE_AUTORIZADA", "Autorizada"],
      ["NFSE_REJEITADA", "Rejeitada ou denegada"],
      ["NFSE_CANCELADA", "Cancelada"],
    ],
  },
  {
    id: "DFE",
    label: "Notas de terceiros",
    description: "Documentos reconhecidos na distribuição da SEFAZ",
    events: [
      ["DFE_RECEBIDA", "Nota reconhecida"],
      ["DFE_CANCELADA", "Cancelada ou denegada pelo emitente"],
    ],
  },
] as const;

export const FISCAL_NOTIFICATION_EVENT_VALUES = FISCAL_NOTIFICATION_EVENT_GROUPS.flatMap(
  (group) => group.events.map(([id]) => id),
);

export type FiscalNotificationEvent = (typeof FISCAL_NOTIFICATION_EVENT_VALUES)[number];

export type FiscalDocumentType = "NFE" | "NFSE" | "DFE";

export function isFiscalNotificationEvent(value: unknown): value is FiscalNotificationEvent {
  return FISCAL_NOTIFICATION_EVENT_VALUES.includes(value as FiscalNotificationEvent);
}

export function fiscalDocumentTypeOf(event: FiscalNotificationEvent): FiscalDocumentType {
  if (event.startsWith("NFSE_")) return "NFSE";
  if (event.startsWith("DFE_")) return "DFE";
  return "NFE";
}

/**
 * Traduz o status gravado no banco para o evento do catálogo.
 *
 * Espelha, em TypeScript, o `CASE` dos gatilhos — a mesma regra escrita duas
 * vezes, uma para enfileirar e outra para os testes e para quem lê o fluxo sem
 * abrir a migration.
 */
export function classifyNfeNotificationEvent(status: unknown): FiscalNotificationEvent | null {
  switch (String(status ?? "").trim().toUpperCase()) {
    case "AUTORIZADA":
      return "NFE_AUTORIZADA";
    case "REJEITADA":
      return "NFE_REJEITADA";
    case "DENEGADA":
      return "NFE_DENEGADA";
    case "CANCELADA":
      return "NFE_CANCELADA";
    case "RESULTADO_INCERTO":
      return "NFE_RESULTADO_INCERTO";
    default:
      return null;
  }
}

/**
 * A NFS-e não distingue denegação de rejeição na prática: as duas voltam com o
 * motivo dentro de `erros` e exigem a mesma correção. Ficam no mesmo evento.
 */
export function classifyNfseNotificationEvent(status: unknown): FiscalNotificationEvent | null {
  switch (String(status ?? "").trim().toUpperCase()) {
    case "AUTORIZADA":
      return "NFSE_AUTORIZADA";
    case "REJEITADA":
    case "DENEGADA":
      return "NFSE_REJEITADA";
    case "CANCELADA":
      return "NFSE_CANCELADA";
    default:
      return null;
  }
}

/** Códigos de cStat que tiram a validade da nota de terceiros. */
export const DFE_STATUS_SEM_VALIDADE = ["101", "110"];

export function classifyDfeStatusNotificationEvent(status: unknown): FiscalNotificationEvent | null {
  return DFE_STATUS_SEM_VALIDADE.includes(String(status ?? "").trim())
    ? "DFE_CANCELADA"
    : null;
}
