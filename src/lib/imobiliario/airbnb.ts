/**
 * Reserva do Airbnb no ERP: o Airbnb manda. Cancelar ou excluir é feito lá; a sincronização do
 * calendário traz o cancelamento para cá. As mesmas frases saem da rota, do banco e da tela.
 */
export const AIRBNB_CANCELAR_NO_AIRBNB =
  "Reservas do Airbnb são canceladas no Airbnb. Cancele a reserva lá: na próxima sincronização do calendário, o ERP a cancela aqui.";
export const AIRBNB_EXCLUIR_NO_AIRBNB =
  "Reservas do Airbnb não podem ser excluídas no ERP. Cancele a reserva no Airbnb: na próxima sincronização do calendário, o ERP a cancela aqui.";

/** Reserva que veio do Airbnb (registrada a partir do calendário dele). */
export const ehReservaAirbnb = (reserva: { origem?: unknown; codigo_externo?: unknown } | null | undefined) =>
  Boolean(reserva && (reserva.origem === "AIRBNB" || reserva.codigo_externo));

/** Página da reserva no painel de anfitrião do Airbnb. */
export const airbnbReservationUrl = (codigo: string) =>
  `https://www.airbnb.com.br/hosting/reservations/details/${encodeURIComponent(codigo)}`;
