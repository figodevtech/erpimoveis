"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { RemoteState, SelectField, StatusBadge, useModulePermission, useRemote } from "@/components/imobiliario/shared";
import { dateLabel, listFrom, money, propertyName } from "@/components/imobiliario/model";
import type { Customer } from "../../types";
const EntityDialog = dynamic(() => import("@/components/imobiliario/entity-dialog"), { loading: () => <p role="status">Carregando reserva…</p> });

export default function CustomerReservasTab({ customer }: { customer: Customer }) {
  const { can } = useModulePermission(); const [page, setPage] = useState(1); const [status, setStatus] = useState(""); const [selected, setSelected] = useState<number | "new" | null>(null);
  const remote = useRemote(can("reservas:visualizar") ? `/api/clientes/${customer.id}/reservas?page=${page}&pageSize=10&status=${status}` : null); const list = listFrom(remote.data);
  return <TabsContent value="Reservas" className="h-full min-h-0 overflow-auto p-4 sm:px-6"><div className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><SelectField label="Situação da reserva" value={status} options={["CONFIRMADA", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"]} onChange={value => { setStatus(value); setPage(1); }} />{can("reservas:criar") ? <Button onClick={() => setSelected("new")}>Nova reserva para este cliente</Button> : null}</div><RemoteState loading={remote.loading} error={remote.error} retry={remote.reload} empty={!list.items.length}><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/40"><tr>{["Imóvel", "Período", "Hóspedes", "Situação", "Total", ""].map((title, index) => <th key={index} className="p-3 font-medium">{title}</th>)}</tr></thead><tbody>{list.items.map(row => <tr key={row.id} className="border-t"><td className="p-3">{propertyName(row)}<span className="block text-xs text-muted-foreground">Reserva #{row.id}</span></td><td className="p-3 whitespace-nowrap">{dateLabel(row.inicio)} a {dateLabel(row.fim)}</td><td className="p-3">{row.hospedes}</td><td className="p-3"><StatusBadge status={row.status} /></td><td className="p-3">{money(row.valor_total)}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => setSelected(Number(row.id))}>Abrir</Button></td></tr>)}</tbody></table></div></RemoteState><div className="flex justify-end gap-3 text-sm"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(current => current - 1)}>Anterior</Button><span className="self-center">Página {page}</span><Button size="sm" variant="outline" disabled={page * 10 >= list.total} onClick={() => setPage(current => current + 1)}>Próxima</Button></div></div>{selected ? <EntityDialog key={selected} kind="reservas" id={selected === "new" ? undefined : selected} initial={{ cliente_id: customer.id, cliente: customer }} open onOpenChange={open => { if (!open) setSelected(null); }} onSaved={remote.reload} /> : null}</TabsContent>;
}
