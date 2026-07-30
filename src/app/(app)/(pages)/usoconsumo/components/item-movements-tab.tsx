"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowRightLeft, ChevronDown, Eye, Undo2 } from "lucide-react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "@/lib/toast";
import { formatDate } from "@/utils/formatDate";
import { EntryDetailsDialog } from "../../estoque/components/entry-details-dialog";
import { ExitDetailsDialog } from "../../estoque/components/exit-details-dialog";
import { CancelMovementDialog, type CancelTarget } from "../../estoque/components/cancel-movement-dialog";

type MovimentoCriador = { id: string; nome: string | null } | null;

export type UsoConsumoEntradaMovimento = {
  id: number;
  quantidade: number;
  valor_unitario_compra: number;
  saldo_anterior?: number;
  saldo_resultante: number;
  created_at: string;
  entrada?: { id?: number; status?: string; origem?: string; numero_nota?: string; created_at?: string; criador?: MovimentoCriador; fornecedor?: { nomerazaosocial?: string } | null };
};

export type UsoConsumoSaidaMovimento = {
  id: number;
  quantidade: number;
  saldo_anterior?: number;
  saldo_resultante: number;
  created_at: string;
  saida?: { id?: number; status?: string; motivo?: string; observacao?: string; created_at?: string; criador?: MovimentoCriador };
};

type Props = {
  entradas?: UsoConsumoEntradaMovimento[];
  saidas?: UsoConsumoSaidaMovimento[];
  onAfterChange: () => void | Promise<void>;
};

function statusBadge(status?: string) {
  const value = status?.toUpperCase();
  if (value === "CONFIRMADA") return <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Confirmada</Badge>;
  if (value === "CANCELADA") return <Badge variant="outline" className="border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400">Cancelada</Badge>;
  return <Badge variant="outline">Desconhecido</Badge>;
}

export function ItemMovementsTab({ entradas = [], saidas = [], onAfterChange }: Props) {
  const { data: session } = useSession();
  const canCancel = permissionSetHas((session?.user as { permissoes?: unknown })?.permissoes, PERMS.USOCONSUMO_CANCELAR);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [detailsEntradaId, setDetailsEntradaId] = useState<number | null>(null);
  const [detailsSaidaId, setDetailsSaidaId] = useState<number | null>(null);
  const [canceling, setCanceling] = useState(false);

  const movements = [
    ...entradas.map((line) => ({
      key: `entrada-${line.id}`,
      id: line.entrada?.id ?? line.id,
      type: "entrada" as const,
      date: line.entrada?.created_at ?? line.created_at,
      description: line.entrada?.fornecedor?.nomerazaosocial || (line.entrada?.numero_nota ? `NF ${line.entrada.numero_nota}` : "Entrada sem fornecedor"),
      status: line.entrada?.status,
      quantity: line.quantidade,
      balance: line.saldo_resultante,
      usuario: line.entrada?.criador?.nome ?? null,
    })),
    ...saidas.map((line) => ({
      key: `saida-${line.id}`,
      id: line.saida?.id ?? line.id,
      type: "saida" as const,
      date: line.saida?.created_at ?? line.created_at,
      description: String(line.saida?.observacao || line.saida?.motivo || "Saída").replaceAll("_", " "),
      status: line.saida?.status,
      quantity: line.quantidade,
      balance: line.saldo_resultante,
      usuario: line.saida?.criador?.nome ?? null,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  async function cancel(motivo: string) {
    if (!cancelTarget) return;
    setCanceling(true);
    try {
      const response = await fetch(
        `/api/usoconsumo/${cancelTarget.kind === "entrada" ? "entradas" : "saidas"}/${cancelTarget.id}/cancelar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível cancelar a movimentação.");
      toast.success(cancelTarget.kind === "entrada" ? "Entrada cancelada e estoque estornado." : "Saída cancelada e estoque devolvido.");
      setCancelTarget(null);
      await onAfterChange();
    } catch (error) {
      toast.error("Erro ao cancelar movimentação", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setCanceling(false);
    }
  }

  return (
    <TabsContent value="Fluxo" className="h-full min-h-0 space-y-6 overflow-auto px-2 py-3 dark:bg-muted-foreground/5 md:px-6 md:py-6">
      <EntryDetailsDialog
        entryId={detailsEntradaId}
        inventory="usoconsumo"
        open={detailsEntradaId !== null}
        onOpenChange={(open) => !open && setDetailsEntradaId(null)}
      />
      <ExitDetailsDialog
        exitId={detailsSaidaId}
        inventory="usoconsumo"
        open={detailsSaidaId !== null}
        onOpenChange={(open) => !open && setDetailsSaidaId(null)}
      />
      <CancelMovementDialog
        target={cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={cancel}
        canceling={canceling}
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1"><div className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Movimentações do estoque</h3></div><p className="text-xs text-muted-foreground">Histórico de entradas e saídas deste item.</p></div>
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 shadow-sm"><span className="text-xs font-medium text-muted-foreground">Total:</span><span className="text-sm font-bold">{movements.length}</span></div>
        </div>

        <div className="overflow-hidden rounded-md border bg-card">
          <Table className="text-xs">
            <TableHeader className="bg-muted/50"><TableRow><TableHead className="w-[80px]">ID</TableHead><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Origem / Descrição</TableHead><TableHead>Usuário</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Quantidade</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead className="w-[50px]" /></TableRow></TableHeader>
            <TableBody>
              {movements.map((movement) => (
                <TableRow key={movement.key} className="transition-colors hover:bg-muted/50">
                  <TableCell className="font-medium text-muted-foreground">#{movement.id}</TableCell>
                  <TableCell>{formatDate(movement.date)}</TableCell>
                  <TableCell><Badge variant="outline" className={movement.type === "entrada" ? "border-emerald-500/20 text-emerald-700" : "border-red-500/20 text-red-700"}>{movement.type === "entrada" ? "Entrada" : "Saída"}</Badge></TableCell>
                  <TableCell className="max-w-[220px] truncate capitalize" title={movement.description}>{movement.description.toLocaleLowerCase("pt-BR")}</TableCell>
                  <TableCell className="max-w-[140px] truncate" title={movement.usuario ?? undefined}>{movement.usuario || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{statusBadge(movement.status)}</TableCell>
                  <TableCell className={`text-right font-bold ${movement.type === "entrada" ? "text-emerald-600" : "text-red-600"}`}>{movement.type === "entrada" ? "+" : "-"} {movement.quantity}</TableCell>
                  <TableCell className="text-right font-medium">{movement.balance}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-full"><ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => (movement.type === "entrada" ? setDetailsEntradaId(movement.id) : setDetailsSaidaId(movement.id))}
                        >
                          <Eye className="mr-2 h-4 w-4" />Detalhes
                        </DropdownMenuItem>
                        {canCancel && movement.status === "CONFIRMADA" ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setCancelTarget({ id: movement.id, kind: movement.type, inventory: "usoconsumo" })}
                          >
                            <Undo2 className="mr-2 h-4 w-4" />Cancelar {movement.type}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {movements.length === 0 ? <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground"><div className="flex flex-col items-center justify-center gap-2"><ArrowRightLeft className="h-8 w-8 opacity-20" /><p>Item não possui histórico de movimentação no estoque</p></div></TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
      </div>
    </TabsContent>
  );
}
