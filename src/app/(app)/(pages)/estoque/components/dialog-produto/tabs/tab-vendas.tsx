"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { ChevronDown, ShoppingCart } from "lucide-react";
import { Produto } from "../../../types";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";

export function TabVendas({ produto }: { produto: Produto }) {
  const vendas = (produto as any).vendasdoproduto ?? [];
  const [expandedVendaId, setExpandedVendaId] = useState<number | null>(null);

  const getStatusBadge = (status: string) => {
    if (!status) return <Badge variant="outline">Desconhecido</Badge>;
    const upper = status.toUpperCase();
    const formatted = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, " ");

    switch (upper) {
      case "CONCLUIDA":
      case "CONCLUÍDA":
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">Concluída</Badge>;
      case "PENDENTE":
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">Pendente</Badge>;
      case "CANCELADA":
        return <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">Cancelada</Badge>;
      default:
        return <Badge variant="outline">{formatted}</Badge>;
    }
  };

  return (
    <TabsContent value="Vendas" className="h-full min-h-0 w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6 space-y-6">
      <div className="space-y-4">
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Vendas Realizadas
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Histórico de vendas diretas onde este produto foi comercializado.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-background px-3 py-1.5 border shadow-sm">
            <span className="text-xs font-medium text-muted-foreground">Total:</span>
            <span className="text-sm font-bold">{vendas.length}</span>
          </div>
        </div>

        <div className="w-full max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-card sm:max-w-full">
          <div className="max-w-full overflow-x-auto">
            <Table className="max-w-none text-xs">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[80px]">ID</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor Venda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendas.length > 0 ? (
                  vendas.map((v: any, idx: number) => {
                    const venda = v.venda || {};
                    const clienteNome = venda.cliente?.nomerazaosocial || "Não informado";
                    const expanded = expandedVendaId === v.venda_id;

                    return (
                      <Fragment key={`${v.venda_id}-${idx}`}>
                        <TableRow
                          className="cursor-pointer transition-colors hover:bg-muted/50"
                          onClick={() => setExpandedVendaId(expanded ? null : v.venda_id)}
                        >
                          <TableCell className="font-medium text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                              #{v.venda_id}
                            </span>
                          </TableCell>
                          <TableCell>{formatDate(venda.datavenda || venda.createdat)}</TableCell>
                          <TableCell className="max-w-[150px] truncate" title={clienteNome}>{clienteNome}</TableCell>
                          <TableCell className="font-medium">{v.quantidade}</TableCell>
                          <TableCell>{getStatusBadge(venda.status)}</TableCell>
                          <TableCell className="text-right font-medium">{formatarEmReal(v.valor_total || venda.valortotal)}</TableCell>
                        </TableRow>
                        {expanded ? (
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={6} className="p-3">
                              <div className="grid min-w-[700px] grid-cols-3 gap-3">
                                <div className="rounded-md border bg-background p-3">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Uso do produto
                                  </p>
                                  <div className="space-y-1 text-xs">
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Quantidade</span>
                                      <span className="font-medium">{v.quantidade ?? 0}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Subtotal</span>
                                      <span className="font-medium">{formatarEmReal(v.sub_total || 0)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Valor total</span>
                                      <span className="font-medium">{formatarEmReal(v.valor_total || 0)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-md border bg-background p-3">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Venda
                                  </p>
                                  <div className="space-y-1 text-xs">
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Data</span>
                                      <span className="font-medium">{formatDate(venda.datavenda || venda.createdat)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Subtotal</span>
                                      <span className="font-medium">{formatarEmReal(venda.sub_total || 0)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Total venda</span>
                                      <span className="font-medium">{formatarEmReal(venda.valortotal || 0)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-md border bg-background p-3">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Descontos
                                  </p>
                                  <div className="space-y-1 text-xs">
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">No item</span>
                                      <span className="font-medium">{formatarEmReal(v.valor_desconto || 0)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Tipo</span>
                                      <span className="font-medium">{v.tipo_desconto || "-"}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Na venda</span>
                                      <span className="font-medium">{formatarEmReal(venda.desconto_valor || 0)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell className="text-center h-24 text-muted-foreground" colSpan={6}>
                      <div className="flex flex-col items-center justify-center gap-2">
                        <ShoppingCart className="h-8 w-8 opacity-20" />
                        <p>Produto não possui histórico de vendas diretas</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </TabsContent>
  );
}
