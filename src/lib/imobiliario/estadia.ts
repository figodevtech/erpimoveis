import "server-only";
import { db, ImobError } from "./server";

/**
 * Aba "Check-in / Check-out" da reserva: o previsto (datas e horários), o que foi registrado em
 * cada ação (momento, quem, observações) e a limpeza pedida no check-out.
 *
 * Cada parte tolera a migration correspondente ainda não aplicada: sem 20261118150000 não há
 * quem registrou nem observações; sem 20261119160000 (imovel_servico) não há limpeza.
 *
 * Só o check-out grava reserva_id em imovel_servico, e no máximo uma vez por reserva
 * (imovel_servico_reserva_uidx): o serviço da reserva é a limpeza da saída.
 */
const colunaAusente = (error: { code?: string } | null) => ["42703", "PGRST200", "PGRST204"].includes(String(error?.code));
const tabelaAusente = (error: { code?: string } | null) => ["42P01", "PGRST205"].includes(String(error?.code));

const RESERVA_BASE = "id,status,inicio,fim,horario_checkin,horario_checkout,checkin_em,checkout_em";
const RESERVA_REGISTRO = `${RESERVA_BASE},checkin_observacoes,checkout_observacoes,registrou_checkin:checkin_por(id,nome,email),registrou_checkout:checkout_por(id,nome,email)`;

const LIMPEZA_BASE = "id,status,solicitada_em,concluida_em,observacoes,responsavel:responsavel_id(id,nome,email),solicitante:solicitada_por(id,nome),concluinte:concluida_por(id,nome)";

export async function estadiaDaReserva(id: number) {
  let reserva = await db.from("reserva_imovel").select(RESERVA_REGISTRO).eq("id", id).maybeSingle();
  if (reserva.error && colunaAusente(reserva.error)) {
    reserva = await db.from("reserva_imovel").select(RESERVA_BASE).eq("id", id).maybeSingle();
  }
  if (reserva.error) throw reserva.error;
  if (!reserva.data) throw new ImobError(404, "Reserva não encontrada.");

  let limpeza = await db.from("imovel_servico").select(`descricao,${LIMPEZA_BASE}`).eq("reserva_id", id).maybeSingle();
  if (limpeza.error && colunaAusente(limpeza.error)) {
    limpeza = await db.from("imovel_servico").select(LIMPEZA_BASE).eq("reserva_id", id).maybeSingle();
  }
  if (limpeza.error && !tabelaAusente(limpeza.error)) throw limpeza.error;

  return { item: { ...reserva.data, limpeza: limpeza.error ? null : limpeza.data ?? null } };
}
