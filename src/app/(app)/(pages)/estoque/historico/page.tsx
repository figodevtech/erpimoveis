"use client";

import axios, { isAxiosError } from "axios";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/lib/toast";

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

function MovementTable({
  movements,
  loading,
  canCancelUse,
  canceling,
  onCancel,
}: {
  movements: Movement[];
  loading: boolean;
  canCancelUse: boolean;
  canceling: string | null;
  onCancel: (movement: Movement) => void;
}) {
  const showActions = canCancelUse && movements.some((movement) => movement.inventory === "uso-consumo");

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Movimento</TableHead>
              <TableHead>Origem/Motivo</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead>Fornecedor/Responsável</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
              {showActions ? <TableHead className="w-24" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((movement) => {
              const isCanceling = canceling === movement.key;
              const cancellable =
                canCancelUse &&
                movement.inventory === "uso-consumo" &&
                movement.status === "CONFIRMADA";

              return (
                <TableRow key={movement.key}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(movement.createdAt).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={movement.direction === "entrada" ? "default" : "secondary"}>
                      {movement.direction === "entrada" ? (
                        <ArrowDownToLine className="mr-1 size-3" />
                      ) : (
                        <ArrowUpFromLine className="mr-1 size-3" />
                      )}
                      {movement.direction === "entrada" ? "Entrada" : "Saída"}
                    </Badge>
                  </TableCell>
                  <TableCell>{movement.description}</TableCell>
                  <TableCell className="min-w-64 max-w-xl whitespace-normal">{movement.items}</TableCell>
                  <TableCell>{movement.party}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {movement.total === null
                      ? "—"
                      : movement.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={movement.status === "CONFIRMADA" ? "outline" : "secondary"}>
                      {label(movement.status)}
                    </Badge>
                  </TableCell>
                  {showActions ? (
                    <TableCell>
                      {cancellable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isCanceling}
                          onClick={() => onCancel(movement)}
                        >
                          {isCanceling ? (
                            <Loader2 className="mr-1 size-4 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-1 size-4" />
                          )}
                          Cancelar
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {!loading && movements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showActions ? 8 : 7}
                  className="h-32 text-center text-muted-foreground"
                >
                  Nenhuma movimentação encontrada.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {loading ? (
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

  const [products, setProducts] = useState<Movement[]>([]);
  const [useItems, setUseItems] = useState<Movement[]>([]);
  const [tab, setTab] = useState<InventoryKind>("produtos");
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState<string | null>(null);

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
    setTab(canProducts ? "produtos" : "uso-consumo");
    void load();
  }, [canProducts, load, sessionStatus]);

  const activeMovements = useMemo(
    () => (tab === "produtos" ? products : useItems),
    [products, tab, useItems],
  );

  async function cancelMovement(movement: Movement) {
    if (
      movement.inventory !== "uso-consumo" ||
      !canCancelUse ||
      !window.confirm(`Cancelar esta ${movement.direction}?`)
    ) return;

    setCanceling(movement.key);
    try {
      const path = movement.direction === "entrada" ? "entradas" : "saidas";
      await axios.post(`/api/usoconsumo/${path}/${movement.id}/cancelar`);
      toast.success("Movimentação cancelada.");
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
            Todas as entradas e saídas, separadas entre produtos e itens de uso/consumo.
          </p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as InventoryKind)}>
        <TabsList>
          {canProducts ? <TabsTrigger value="produtos">Produtos</TabsTrigger> : null}
          {canUse ? <TabsTrigger value="uso-consumo">Uso/Consumo</TabsTrigger> : null}
        </TabsList>
      </Tabs>

      <MovementTable
        movements={activeMovements}
        loading={loading}
        canCancelUse={canCancelUse}
        canceling={canceling}
        onCancel={(movement) => void cancelMovement(movement)}
      />
    </div>
  );
}
