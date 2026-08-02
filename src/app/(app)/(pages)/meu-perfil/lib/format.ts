// src/app/(app)/(pages)/meu-perfil/lib/format.ts
import { endOfMonth, startOfMonth } from "date-fns";
import type { Periodo } from "../types";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DATA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatarMoeda(valor: number): string {
  return MOEDA.format(Number.isFinite(valor) ? valor : 0);
}

export function formatarQuantidade(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace(".", ",");
}

function paraData(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function formatarData(valor: string | null | undefined): string {
  const data = paraData(valor);
  return data ? DATA.format(data) : "—";
}

export function formatarDataHora(valor: string | null | undefined): string {
  const data = paraData(valor);
  return data ? DATA_HORA.format(data) : "—";
}

/** Duracao entre inicio e fim, no formato "2h 15min". */
export function formatarDuracao(inicio: string | null, fim: string | null): string {
  const de = paraData(inicio);
  const ate = paraData(fim);
  if (!de || !ate) return "—";

  const minutos = Math.max(0, Math.round((ate.getTime() - de.getTime()) / 60000));
  if (minutos < 60) return `${minutos}min`;

  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas}h ${resto}min` : `${horas}h`;
}

export function paraInputDate(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function intervalo(de: Date, ate: Date): Periodo {
  return { de: paraInputDate(de), ate: paraInputDate(ate) };
}

export function periodoDesteMes(): Periodo {
  return intervalo(startOfMonth(new Date()), endOfMonth(new Date()));
}

/**
 * Periodo padrao da Central: o mes corrente — o mesmo intervalo do atalho
 * "Este mes", para a tela sempre abrir num estado que os botoes reproduzem.
 */
export const periodoPadrao = periodoDesteMes;

/** Troca `EM_ANDAMENTO` por `Em andamento` para exibicao. */
export function rotuloDeStatus(status: string | null | undefined): string {
  if (!status) return "—";
  const texto = status.replace(/_/g, " ").toLowerCase();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
