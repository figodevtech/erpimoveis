"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import ReservasDataTable from "@/app/(app)/(pages)/reservas/components/reservas-data-table";
import { StatusReserva, type Pagination, type Reserva, type ReservasTab } from "@/app/(app)/(pages)/reservas/types";
import { requestJson, useModulePermission } from "./shared";
import type { Entity } from "./model";

// Import dinâmico: a ficha da reserva é a mesma EntityDialog que abriu esta aba.
const EntityDialog = dynamic(() => import("./entity-dialog"), {
  loading: () => (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span>Carregando reserva…</span>
    </div>
  ),
});

const tabStatus = (tab: ReservasTab) => (tab === "ABERTAS" ? StatusReserva.ABERTAS : StatusReserva.FINALIZADAS);

/**
 * Aba Reservas da ficha do imóvel: o mesmo card do módulo de Reservas (abas Abertas/Finalizadas,
 * lista e calendário, paginação, abrir e criar reserva), sempre filtrado por este imóvel.
 */
export function PropertyReservations({ item }: { item: Entity }) {
  const { can } = useModulePermission();
  const imovelId = Number(item.id);
  const [tab, setTab] = useState<ReservasTab>("ABERTAS");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [counts, setCounts] = useState<{ ativas?: number; finalizadas?: number }>({});
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [dialog, setDialog] = useState<{ id?: number; seed?: Entity } | null>(null);
  // Só a resposta da última busca vale (trocar de aba ou página rápido não mistura listas).
  const sequence = useRef(0);

  const load = useCallback(
    async (page: number, limit: number, currentTab: ReservasTab) => {
      const request = ++sequence.current;
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          imovel_id: String(imovelId),
          page: String(page),
          pageSize: String(limit),
          status: tabStatus(currentTab),
        });
        const response = await requestJson(`/api/reservas?${params}`);
        if (request !== sequence.current) return;
        const total = Number(response.total ?? 0);
        setReservas(response.items ?? []);
        setPagination({ page, limit, total, totalPages: Math.ceil(total / limit) });
      } catch (error) {
        if (request === sequence.current) console.error("Erro ao buscar reservas do imóvel:", error);
      } finally {
        if (request === sequence.current) setIsLoading(false);
      }
    },
    [imovelId]
  );

  // Contadores das abas, só deste imóvel (o contador do módulo é de todos os imóveis).
  const loadCounts = useCallback(async () => {
    const total = async (status: StatusReserva) => {
      const params = new URLSearchParams({ imovel_id: String(imovelId), status, page: "1", pageSize: "1" });
      return Number((await requestJson(`/api/reservas?${params}`)).total ?? 0);
    };
    try {
      const [ativas, finalizadas] = await Promise.all([total(StatusReserva.ABERTAS), total(StatusReserva.FINALIZADAS)]);
      setCounts({ ativas, finalizadas });
    } catch {
      setCounts({});
    }
  }, [imovelId]);

  useEffect(() => {
    if (!can("reservas:visualizar")) return;
    void load(1, pagination.limit, tab);
    // Recarrega só quando muda a aba ou o imóvel; página e tamanho chamam load direto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, imovelId, can]);
  useEffect(() => {
    if (can("reservas:visualizar")) void loadCounts();
  }, [loadCounts, can]);

  const refresh = () => {
    void load(pagination.page, pagination.limit, tab);
    void loadCounts();
    setCalendarVersion((v) => v + 1);
  };

  if (!can("reservas:visualizar"))
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
        Seu perfil não tem acesso às reservas.
      </div>
    );

  // A reserva nova já vem com este imóvel (e com as datas, quando criada pelo calendário).
  const seedFor = (extra?: Entity) => ({ ...extra, imovel_id: imovelId, imovel: item });

  return (
    <>
      <ReservasDataTable
        reservas={reservas}
        isLoading={isLoading}
        pagination={pagination}
        view={view}
        onViewChange={setView}
        tab={tab}
        onTabChange={(next) => {
          setTab(next);
          setPagination((current) => ({ ...current, page: 1 }));
        }}
        ativasCount={counts.ativas}
        finalizadasCount={counts.finalizadas}
        onPageChange={(page) => void load(page, pagination.limit, tab)}
        onPageSizeChange={(limit) => void load(1, limit, tab)}
        onRefresh={refresh}
        onSelectReserva={(id) => setDialog({ id })}
        // Imóvel inativo não recebe reserva nova.
        onNewReserva={
          can("reservas:criar") && item.ativo !== false
            ? (seed?: Entity) => setDialog({ seed: seedFor(seed) })
            : undefined
        }
        canCreate={can("reservas:criar") && item.ativo !== false}
        canEdit={can("reservas:editar")}
        propertyId={imovelId}
        calendarVersion={calendarVersion}
      />

      {dialog ? (
        <EntityDialog
          key={dialog.id ?? "nova"}
          kind="reservas"
          id={dialog.id}
          initial={dialog.seed}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSaved={refresh}
        />
      ) : null}
    </>
  );
}
