"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RemoteState, StatusBadge, useAllPages } from "./shared";
import { type Entity, clientName, dateLabel, listFrom, propertyName } from "./model";

const civil = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function ReservationsCalendar({ propertyId, ownerId, onOpen, onNew }: { propertyId?: string; ownerId?: string; onOpen: (id: number) => void; onNew?: (initial: Entity) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [day, setDay] = useState<string | null>(null);
  const first = new Date(month.getFullYear(), month.getMonth(), 1); const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const params = new URLSearchParams({ inicio: civil(first), fim: civil(new Date(month.getFullYear(), month.getMonth() + 1, 1)) });
  if (propertyId) params.set("imovel_id", propertyId); if (ownerId) params.set("proprietario_id", ownerId);
  const remote = useAllPages(`/api/reservas?${params}`); const list = listFrom(remote.data);
  const rows = list.items.filter(row => row.status !== "CANCELADA");
  const days = Array.from({ length: first.getDay() + last.getDate() }, (_, index) => index < first.getDay() ? null : new Date(month.getFullYear(), month.getMonth(), index - first.getDay() + 1));
  const matching = (key: string) => rows.filter(row => String(row.inicio).slice(0, 10) <= key && String(row.fim).slice(0, 10) > key);
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><Button aria-label="Mês anterior" variant="outline" size="icon" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); setDay(null); }}><ChevronLeft /></Button><h2 className="text-lg font-semibold capitalize">{month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</h2><Button aria-label="Próximo mês" variant="outline" size="icon" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); setDay(null); }}><ChevronRight /></Button></div><RemoteState loading={remote.loading} error={remote.error} retry={remote.reload}><div className="overflow-x-auto rounded-xl border"><div className="grid min-w-[700px] grid-cols-7 bg-muted/30">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(label => <div key={label} className="border-b p-3 text-center text-xs font-semibold">{label}</div>)}{days.map((date, index) => {
    if (!date) return <div key={`blank-${index}`} className="min-h-28 border-b border-r bg-muted/20" />;
    const key = civil(date); const entries = matching(key); const today = key === civil(new Date());
    return <div key={key} className={`min-h-28 space-y-1 border-b border-r p-2 ${today ? "bg-primary/5" : "bg-background"}`}><button onClick={() => setDay(key)} aria-label={`Ver reservas em ${dateLabel(key)}`} className={`mb-1 flex size-7 items-center justify-center rounded-full text-sm ${today ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{date.getDate()}</button>{entries.slice(0, 3).map(row => <button key={row.id} onClick={() => onOpen(Number(row.id))} className="block w-full truncate rounded border border-primary/20 bg-primary/10 px-1.5 py-1 text-left text-xs text-primary" title={`${propertyName(row)} · ${clientName(row)}`}>{propertyName(row)}</button>)}{entries.length > 3 ? <button className="text-xs text-muted-foreground underline" onClick={() => setDay(key)}>+{entries.length - 3} reservas</button> : null}</div>;
  })}</div></div>{list.total > list.items.length ? <p role="alert" className="text-sm text-amber-700">Este mês tem mais de {list.items.length} reservas. Filtre por imóvel ou proprietário para visualizar todas no calendário.</p> : null}</RemoteState>{day ? <section className="space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Reservas em {dateLabel(day)}</h3>{onNew ? <Button size="sm" onClick={() => { const next = new Date(`${day}T12:00:00`); next.setDate(next.getDate() + 1); onNew({ inicio: day, fim: civil(next), ...(propertyId ? { imovel_id: Number(propertyId) } : {}) }); }}>Nova reserva nesta data</Button> : null}</div>{matching(day).map(row => <button key={row.id} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/30" onClick={() => onOpen(Number(row.id))}><div><p className="text-sm font-medium">{propertyName(row)} · {clientName(row)}</p><p className="text-xs text-muted-foreground">#{row.id} · {dateLabel(row.inicio)} a {dateLabel(row.fim)}</p></div><StatusBadge status={row.status} /></button>)}{!matching(day).length ? <p className="text-sm text-muted-foreground">Sem reservas para esta data.</p> : null}</section> : null}</div>;
}
