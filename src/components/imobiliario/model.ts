export type ModuleKind = "proprietarios" | "imoveis" | "reservas";
export type Entity = Record<string, any>;
export type EntityList = { items: Entity[]; total: number; page: number; pageSize: number };
export const MODULES = {
  proprietarios: { title: "Proprietários", singular: "proprietário", permission: "proprietarios" },
  imoveis: { title: "Imóveis", singular: "imóvel", permission: "imoveis" },
  reservas: { title: "Reservas", singular: "reserva", permission: "reservas" },
} as const;
export function titleCase(value: unknown) {
  const labels: Record<string, string> = { DISPONIVEL: "Disponível", TEMPORADA: "Temporada", EM_ANDAMENTO: "Em andamento", MANUTENCAO: "Manutenção", LIMPEZA: "Limpeza", CONCLUIDA: "Concluída", CONFIRMADA: "Confirmada", CANCELADA: "Cancelada", PAGO: "Pago", PARCIAL: "Parcial", PENDENTE: "Pendente", ESTORNADO: "Estornado" };
  const text = String(value ?? "");
  return labels[text] ?? text.replaceAll("_", " ").toLocaleLowerCase("pt-BR").replace(/^./, c => c.toUpperCase());
}
export const money = (value: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
export const dateLabel = (value: unknown) => value ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : "—";
export const dateInput = (value: unknown) => String(value ?? "").slice(0, 10);
export function entityName(row: Entity | null | undefined) { return row?.titulo ?? row?.nomerazaosocial ?? row?.nome ?? row?.codigo ?? (row?.id ? `#${row.id}` : "—"); }
export function propertyName(row: Entity) { return entityName(row.imovel ?? { titulo: row.imovel_titulo ?? row.titulo_imovel, id: row.imovel_id }); }
export function clientName(row: Entity) { return entityName(row.cliente ?? { nomerazaosocial: row.cliente_nome, id: row.cliente_id }); }
export function ownerName(row: Entity) { return entityName(row.proprietario ?? { nomerazaosocial: row.proprietario_nome, id: row.proprietario_id }); }
export function rowStatus(row: Entity) { return row.status ?? row.situacao_operacional ?? row.situacao ?? (row.ativo === false ? "INATIVO" : "ATIVO"); }
export const endpoint = (kind: ModuleKind, id?: number | string) => `/api/${kind}${id ? `/${id}` : ""}`;
export function listFrom(payload: any): EntityList { const items = payload?.items ?? payload?.data?.items ?? (Array.isArray(payload?.data) ? payload.data : []); return { items, total: payload?.total ?? payload?.pagination?.total ?? items.length, page: payload?.page ?? 1, pageSize: payload?.pageSize ?? 20 }; }
export function itemFrom(payload: any): Entity { return payload?.item ?? payload?.data ?? payload ?? {}; }
