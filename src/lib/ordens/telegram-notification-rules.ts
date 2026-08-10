export type TelegramNotificationEvent = {
  tipo: "CRIADA" | "STATUS_ALTERADO";
  status_novo: string;
};

export type TelegramNotificationPreference = {
  modo: "CRIACAO" | "CRIACAO_FINALIZACAO" | "TODOS" | "PERSONALIZADO";
  notificar_criacao: boolean;
  status_selecionados: string[];
};

const FINAL_STATUSES = new Set(["CONCLUIDO", "SEM_COBRANCA"]);

export function eventMatchesPreference(
  event: TelegramNotificationEvent,
  preference: TelegramNotificationPreference,
) {
  if (preference.modo === "CRIACAO") return event.tipo === "CRIADA";
  if (preference.modo === "CRIACAO_FINALIZACAO") {
    return event.tipo === "CRIADA" || FINAL_STATUSES.has(event.status_novo);
  }
  if (preference.modo === "TODOS") return true;
  if (event.tipo === "CRIADA") return preference.notificar_criacao;
  return preference.status_selecionados.includes(event.status_novo);
}
