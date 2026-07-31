"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { ChevronDown, Undo2, Receipt, ArrowRightLeft, Eye } from "lucide-react";
import { Produto } from "../../../types";
import { formatDate } from "@/utils/formatDate";
import { EmissaoNotaDialog } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { toast } from "@/lib/toast";
import { EntryDetailsDialog } from "../../entry-details-dialog";
import { ExitDetailsDialog } from "../../exit-details-dialog";
import { CancelMovementDialog, type CancelTarget } from "../../cancel-movement-dialog";
import { CancelarEntradaDialog } from "@/components/entrada-fiscal/cancelar-entrada-dialog";

export function TabFluxo({ produto, onAfterChange }: { produto: Produto; onAfterChange?: () => void | Promise<void> }) {
  const entradas = (produto as any).entrada ?? [];
  const saidas = (produto as any).saidas ?? [];
  const movimentacoes = [
    ...entradas.map((item: any) => ({
      id: item.entradainfo?.id ?? item.id,
      key: `entrada-${item.id}`,
      tipo: "ENTRADA" as const,
      data: item.created_at,
      descricao: item.entradainfo?.fornecedor?.nomerazaosocial || "Entrada sem fornecedor",
      status: item.entradainfo?.status,
      quantidade: item.quantidade,
      entrada: item.entradainfo,
      usuario: item.entradainfo?.criador?.nome ?? null,
    })),
    ...saidas.map((item: any) => ({
      id: item.saida?.id ?? item.id,
      key: `saida-${item.id}`,
      tipo: "SAIDA" as const,
      data: item.saida?.created_at ?? item.created_at,
      descricao: String(item.saida?.observacao || item.saida?.motivo || "SAIDA").replace(/_/g, " "),
      status: item.saida?.status,
      quantidade: item.quantidade,
      entrada: null,
      usuario: item.saida?.criador?.nome ?? null,
    })),
  ].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  const [nfeDialogEntradaId, setNfeDialogEntradaId] = useState<number | null>(null);
  const [detailsEntradaId, setDetailsEntradaId] = useState<number | null>(null);
  const [detailsSaidaId, setDetailsSaidaId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelando, setCancelando] = useState(false);
  /** Entradas usam o dialogo detalhado, que resolve nota mista e lista o que sera desfeito. */
  const [entradaCancelamentoId, setEntradaCancelamentoId] = useState<number | null>(null);

  const cancelarMovimento = async (motivo: string) => {
    if (!cancelTarget) return;
    setCancelando(true);
    try {
      const endpoint =
        cancelTarget.kind === "entrada"
          ? `/api/entradas/${cancelTarget.id}/cancelar`
          : `/api/estoque/saidas/${cancelTarget.id}/cancelar`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível cancelar a movimentação.");
      toast.success(
        cancelTarget.kind === "entrada"
          ? "Entrada cancelada e estoque estornado."
          : "Saída cancelada e estoque devolvido.",
      );
      setCancelTarget(null);
      await onAfterChange?.();
    } catch (error: any) {
      toast.error("Erro ao cancelar movimentação", { description: error?.message });
    } finally {
      setCancelando(false);
    }
  };

  const getStatusBadge = (status: string) => {
    if (!status) return <Badge variant="outline">Desconhecido</Badge>;
    const upper = status.toUpperCase();
    const formatted = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, " ");

    switch (upper) {
      case "CONCLUIDA":
      case "CONCLUÍDA":
      case "EFETIVADA":
      case "CONFIRMADA":
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">Confirmada</Badge>;
      case "PENDENTE":
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">{formatted}</Badge>;
      case "CANCELADA":
        return <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">Cancelada</Badge>;
      default:
        return <Badge variant="outline">{formatted}</Badge>;
    }
  };

  return (
    <TabsContent value="Fluxo" className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6 space-y-6">
      <EmissaoNotaDialog 
        open={!!nfeDialogEntradaId}
        onOpenChange={(v) => !v && setNfeDialogEntradaId(null)}
        entradaId={nfeDialogEntradaId}
      />
      <EntryDetailsDialog
        entryId={detailsEntradaId}
        inventory="produto"
        open={detailsEntradaId !== null}
        onOpenChange={(open) => !open && setDetailsEntradaId(null)}
      />
      <ExitDetailsDialog
        exitId={detailsSaidaId}
        inventory="produto"
        open={detailsSaidaId !== null}
        onOpenChange={(open) => !open && setDetailsSaidaId(null)}
      />
      <CancelMovementDialog
        target={cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={cancelarMovimento}
        canceling={cancelando}
      />
      <CancelarEntradaDialog
        open={entradaCancelamentoId !== null}
        onOpenChange={(open) => !open && setEntradaCancelamentoId(null)}
        entradaId={entradaCancelamentoId}
        origem="ESTOQUE"
        onCancelada={() => onAfterChange?.()}
      />
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Movimentações do Estoque
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Histórico de entradas e saídas deste produto.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-background px-3 py-1.5 border shadow-sm">
            <span className="text-xs font-medium text-muted-foreground">Total:</span>
            <span className="text-sm font-bold">{movimentacoes.length}</span>
          </div>
        </div>

        <div className="rounded-md border bg-card overflow-hidden">
          <Table className="text-xs">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[80px]">ID</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem / Descrição</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {movimentacoes.length > 0 ? (
                movimentacoes.map((movimento) => {
                  const entradaInfo = movimento.entrada || {};
                  
                  return (
                    <TableRow key={movimento.key} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium text-muted-foreground">
                        #{movimento.id}
                      </TableCell>
                      <TableCell>{formatDate(movimento.data)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={movimento.tipo === "ENTRADA" ? "text-emerald-700 border-emerald-500/20" : "text-red-700 border-red-500/20"}>
                          {movimento.tipo === "ENTRADA" ? "Entrada" : "Saída"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate capitalize" title={movimento.descricao}>
                        {movimento.descricao.toLowerCase()}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate" title={movimento.usuario ?? undefined}>
                        {movimento.usuario || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{getStatusBadge(movimento.status)}</TableCell>
                      <TableCell className={`text-right font-bold ${movimento.tipo === "ENTRADA" ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"}`}>
                        {movimento.tipo === "ENTRADA" ? "+" : "-"} {movimento.quantidade}
                      </TableCell>
                      <TableCell>
                        {movimento.tipo === "SAIDA" ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer rounded-full">
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[180px]">
                              <DropdownMenuItem onClick={() => setDetailsSaidaId(movimento.id)}>
                                <Eye className="mr-2 h-4 w-4" />
                                Detalhes
                              </DropdownMenuItem>
                              {movimento.status === "CONFIRMADA" ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    setCancelTarget({ id: movimento.id, kind: "saida", inventory: "produto" })
                                  }
                                >
                                  <Undo2 className="mr-2 h-4 w-4" />
                                  Cancelar Saída
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        {movimento.tipo === "ENTRADA" ? <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer rounded-full">
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-[180px]">
                            <DropdownMenuItem onClick={() => setDetailsEntradaId(movimento.id)}>
                              <Eye className="mr-2 h-4 w-4" />
                              Detalhes
                            </DropdownMenuItem>
                            {entradaInfo.status === "CONFIRMADA" && entradaInfo.origem !== "NFE_TERCEIRO" ? <Button onClick={()=>{
                              if (entradaInfo.id) {
                                setNfeDialogEntradaId(entradaInfo.id)
                              }
                            }} variant="ghost" className="w-full justify-start cursor-pointer px-2 text-xs">
                              <Receipt className="mr-2 h-4 w-4 text-emerald-500" />
                              Emitir Nota
                            </Button> : null}
                            
                            {entradaInfo.status === "CONFIRMADA" ? (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  setEntradaCancelamentoId(entradaInfo.id)
                                }
                              >
                                <Undo2 className="mr-2 h-4 w-4" />
                                Cancelar Entrada
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu> : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell className="text-center h-24 text-muted-foreground" colSpan={8}>
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ArrowRightLeft className="h-8 w-8 opacity-20" />
                      <p>Produto não possui histórico de movimentação no estoque</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </TabsContent>
  );
}
