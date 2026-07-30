"use client";

import axios, { isAxiosError } from "axios";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import { CancelMovementDialog, type CancelTarget } from "../components/cancel-movement-dialog";

type InventoryKind = "produtos" | "uso-consumo";
type Direction = "entrada" | "saida";

type MovementItem = {
  quantidade?: number | null;
  titulo?: string | null;
  unidade?: string | null;
  item?: { titulo?: string | null; unidade?: string | null } | null;
  produto?: { titulo?: string | null; unidade?: string | null } | null;
};

type RawMovement = {
  id: number;
  created_at: string;
  fiscal?: boolean | null;
  numero_nota?: string | null;
  origem?: string | null;
  tipo?: string | null;
  motivo?: string | null;
  observacao?: string | null;
  status?: string | null;
  valor_total?: number | null;
  funcionario?: string | null;
  setor?: string | null;
  fornecedor?: { nomerazaosocial?: string | null } | null;
  centro_custo?: { nome?: string | null } | null;
  itens?: MovementItem[] | null;
};

type Movement = {
  key: string;
  id: number;
  inventory: InventoryKind;
  direction: Direction;
  createdAt: string;
  description: string;
  party: string;
  items: string;
  total: number | null;
  status: string;
};

function errorText(error: unknown) {
  if (isAxiosError(error)) return error.response?.data?.error ?? error.message;
  return error instanceof Error ? error.message : "Erro inesperado.";
}

function label(value: string | null | undefined) {
  return value?.trim().replaceAll("_", " ") || "—";
}

function movementItems(lines?: MovementItem[] | null) {
  if (!lines?.length) return "—";
  return lines
    .map((line) => {
      const related = line.item ?? line.produto;
      const title = line.titulo || related?.titulo || "Item";
      const unit = line.unidade || related?.unidade || "";
      return `${title} (${Number(line.quantidade ?? 0)}${unit ? ` ${unit}` : ""})`;
    })
    .join(", ");
}

function normalizeMovement(
  raw: RawMovement,
  inventory: InventoryKind,
  direction: Direction,
): Movement {
  const entryDescription = raw.fiscal
    ? `NF ${raw.numero_nota || "não informada"}`
    : label(raw.origem || raw.tipo);
  const outputDescription = [label(raw.motivo), raw.observacao?.trim()].filter(Boolean).join(" - ");

  return {
    key: `${inventory}-${direction}-${raw.id}`,
    id: raw.id,
    inventory,
    direction,
    createdAt: raw.created_at,
    description: direction === "entrada" ? entryDescription : outputDescription,
    party:
      raw.fornecedor?.nomerazaosocial ||
      raw.funcionario ||
      raw.setor ||
      raw.centro_custo?.nome ||
      "—",
    items: movementItems(raw.itens),
    total: direction === "entrada" ? Number(raw.valor_total ?? 0) : null,
    status: raw.status || "CONFIRMADA",
  };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function MovementRow({
  movement,
  cancellable,
  isCanceling,
  showActions,
  onCancel,
}: {
  movement: Movement;
  cancellable: boolean;
  isCanceling: boolean;
  showActions: boolean;
  onCancel: (movement: Movement) => void;
}) {
  const isEntrada = movement.direction === "entrada";

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-start gap-2">
          <div
            className={`shrink-0 rounded-full p-2 ${
              isEntrada ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
            }`}
          >
            {isEntrada ? <ArrowDownToLine className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{movement.description}</span>
            <span className="truncate text-xs text-muted-foreground">{movement.party}</span>
            <span className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
              {formatDateTime(movement.createdAt)}
            </span>
            <span className="mt-0.5 line-clamp-2 max-w-xs text-xs text-muted-foreground lg:hidden">
              {movement.items}
            </span>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden whitespace-nowrap md:table-cell">
        {formatDateTime(movement.createdAt)}
      </TableCell>

      <TableCell className="hidden lg:table-cell">
        <span className="line-clamp-2 max-w-xs text-xs text-muted-foreground">{movement.items}</span>
      </TableCell>

      <TableCell>
        <Badge variant={isEntrada ? "default" : "secondary"} className="whitespace-nowrap">
          {isEntrada ? "Entrada" : "Saída"}
        </Badge>
      </TableCell>

      <TableCell className="whitespace-nowrap text-right">
        {movement.total === null
          ? "—"
          : movement.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </TableCell>

      <TableCell className="hidden sm:table-cell">
        <Badge variant={movement.status === "CONFIRMADA" ? "outline" : "secondary"}>
          {label(movement.status)}
        </Badge>
      </TableCell>

      {showActions ? (
        <TableCell className="text-right">
          {cancellable ? (
            <Button size="sm" variant="outline" disabled={isCanceling} onClick={() => onCancel(movement)}>
              {isCanceling ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RotateCcw className="mr-1 size-4" />}
              Cancelar
            </Button>
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function GroupHeaderRow({
  icon: Icon,
  title,
  count,
  colSpan,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  colSpan: number;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="bg-muted/50 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5" />
          {title}
          <Badge variant="outline" className="font-normal normal-case">
            {count}
          </Badge>
        </div>
      </TableCell>
    </TableRow>
  );
}

function MovementTable({
  products,
  useItems,
  loading,
  canCancel,
  canceling,
  onReload,
  onCancel,
}: {
  products: Movement[];
  useItems: Movement[];
  loading: boolean;
  canCancel: (movement: Movement) => boolean;
  canceling: string | null;
  onReload: () => void;
  onCancel: (movement: Movement) => void;
}) {
  const showActions = [...products, ...useItems].some((movement) => canCancel(movement));
  const colSpan = showActions ? 7 : 6;
  const isEmpty = !loading && products.length === 0 && useItems.length === 0;

  return (
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <CardTitle>Histórico de estoque</CardTitle>
        <CardDescription className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-1 text-foreground/50 hover:cursor-pointer hover:text-foreground/70"
          >
            <span>Recarregar</span>
            <Loader2 width={12} className={loading ? "animate-spin" : ""} />
          </button>
          <span className="text-foreground/60">
            Todas as entradas e saídas, separadas entre produtos e itens de uso/consumo.
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="relative -mt-[24px] min-h-[300px] px-4 pb-4 pt-0">
        <div
          className={`${
            loading ? "opacity-100" : ""
          } absolute left-0 right-0 top-0 h-0.5 w-full overflow-hidden bg-slate-400 opacity-0 transition-all`}
        >
          <div
            className={`absolute left-0 h-full w-1/2 -translate-x-[100%] rounded-lg bg-primary ${
              loading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <Table className="mt-6 text-xs">
          <TableHeader>
            <TableRow className="font-bold">
              <TableHead>Descrição</TableHead>
              <TableHead className="hidden md:table-cell">Data</TableHead>
              <TableHead className="hidden lg:table-cell">Itens</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              {showActions ? <TableHead className="w-24 text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length ? (
              <>
                <GroupHeaderRow icon={Package} title="Produtos" count={products.length} colSpan={colSpan} />
                {products.map((movement) => (
                  <MovementRow
                    key={movement.key}
                    movement={movement}
                    cancellable={canCancel(movement)}
                    isCanceling={canceling === movement.key}
                    showActions={showActions}
                    onCancel={onCancel}
                  />
                ))}
              </>
            ) : null}

            {useItems.length ? (
              <>
                <GroupHeaderRow icon={Boxes} title="Uso e consumo" count={useItems.length} colSpan={colSpan} />
                {useItems.map((movement) => (
                  <MovementRow
                    key={movement.key}
                    movement={movement}
                    cancellable={canCancel(movement)}
                    isCanceling={canceling === movement.key}
                    showActions={showActions}
                    onCancel={onCancel}
                  />
                ))}
              </>
            ) : null}

            {isEmpty ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-32 text-center text-muted-foreground">
                  Nenhuma movimentação encontrada.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {loading && isEmpty ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            Carregando histórico...
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function HistoricoEstoquePage() {
  const { data: session, status: sessionStatus } = useSession();
  const permissions = (session?.user as { permissoes?: unknown })?.permissoes;
  const canProducts = permissionSetHas(permissions, PERMS.ESTOQUE);
  const canUse = permissionSetHas(permissions, PERMS.USOCONSUMO);
  const canCancelUse = permissionSetHas(permissions, PERMS.USOCONSUMO_CANCELAR);
  const canCancelProducts = permissionSetHas(permissions, PERMS.ESTOQUE_EDITAR);

  const [products, setProducts] = useState<Movement[]>([]);
  const [useItems, setUseItems] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ movement: Movement; target: CancelTarget } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<void>[] = [];

      if (canProducts) {
        requests.push(
          Promise.all([
            axios.get("/api/entradas", { params: { page: 1, limit: 100 } }),
            axios.get("/api/estoque/saidas", { params: { page: 1, limit: 100 } }),
          ]).then(([entriesResponse, outputsResponse]) => {
            const entries = (entriesResponse.data.data ?? []) as RawMovement[];
            const outputs = (outputsResponse.data.data ?? []) as RawMovement[];
            setProducts([
              ...entries.map((entry) => normalizeMovement(entry, "produtos", "entrada")),
              ...outputs.map((output) => normalizeMovement(output, "produtos", "saida")),
            ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
          }),
        );
      } else {
        setProducts([]);
      }

      if (canUse) {
        requests.push(
          Promise.all([
            axios.get("/api/usoconsumo/entradas", { params: { page: 1, limit: 100 } }),
            axios.get("/api/usoconsumo/saidas", { params: { page: 1, limit: 100 } }),
          ]).then(([entriesResponse, outputsResponse]) => {
            const entries = (entriesResponse.data.data ?? []) as RawMovement[];
            const outputs = (outputsResponse.data.data ?? []) as RawMovement[];
            setUseItems([
              ...entries.map((entry) => normalizeMovement(entry, "uso-consumo", "entrada")),
              ...outputs.map((output) => normalizeMovement(output, "uso-consumo", "saida")),
            ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
          }),
        );
      } else {
        setUseItems([]);
      }

      await Promise.all(requests);
    } catch (error) {
      toast.error("Histórico de estoque não carregado", { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [canProducts, canUse]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    void load();
  }, [load, sessionStatus]);

  /** Produto usa a permissao de edicao de estoque; uso/consumo tem permissao propria. */
  function podeCancelar(movement: Movement) {
    if (movement.status !== "CONFIRMADA") return false;
    return movement.inventory === "uso-consumo" ? canCancelUse : canCancelProducts;
  }

  async function cancelMovement(motivo: string) {
    if (!cancelTarget) return;
    const { movement } = cancelTarget;

    setCanceling(movement.key);
    try {
      const path = movement.direction === "entrada" ? "entradas" : "saidas";
      const endpoint =
        movement.inventory === "uso-consumo"
          ? `/api/usoconsumo/${path}/${movement.id}/cancelar`
          : movement.direction === "entrada"
            ? `/api/entradas/${movement.id}/cancelar`
            : `/api/estoque/saidas/${movement.id}/cancelar`;
      await axios.post(endpoint, { motivo });
      toast.success("Movimentação cancelada.");
      setCancelTarget(null);
      await load();
    } catch (error) {
      toast.error("Cancelamento não realizado", { description: errorText(error) });
    } finally {
      setCanceling(null);
    }
  }

  return (
    <div className="mx-auto space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Histórico de estoque</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe entradas e saídas de produtos e de itens de uso/consumo em um só lugar.
          </p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <MovementTable
        products={products}
        useItems={useItems}
        loading={loading}
        canCancel={podeCancelar}
        canceling={canceling}
        onReload={() => void load()}
        onCancel={(movement) =>
          setCancelTarget({
            movement,
            target: {
              id: movement.id,
              kind: movement.direction,
              inventory: movement.inventory === "uso-consumo" ? "usoconsumo" : "produto",
            },
          })
        }
      />

      <CancelMovementDialog
        target={cancelTarget?.target ?? null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={cancelMovement}
        canceling={canceling !== null}
      />
    </div>
  );
}
