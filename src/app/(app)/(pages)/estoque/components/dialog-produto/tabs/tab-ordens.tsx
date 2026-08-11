"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { ChevronDown, ClipboardList } from "lucide-react";
import { Produto } from "../../../types";

export function TabOrdens({ produto }: { produto: Produto }) {
  const ordens = (produto as any).ordensdoproduto ?? [];
  const [expandedOrdemId, setExpandedOrdemId] = useState<number | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value || 0);
  };

  const formatDate = (date: string | null | undefined) => {
    if (!date) return "-";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(date));
  };

  const getStatusBadge = (status: string) => {
    if (!status) return <Badge variant="outline">Desconhecido</Badge>;
    const upper = status.toUpperCase();
    const formatted = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, " ");

    switch (upper) {
      case "ORCAMENTO":
        return <Badge variant="outline" className="bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20">Orçamento</Badge>;
      case "ABERTA":
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20">Aberta</Badge>;
      case "PENDENTE":
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">Pendente</Badge>;
      case "FINALIZADA":
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">Finalizada</Badge>;
      case "CANCELADA":
      case "CANCELADO":
        return <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">Cancelada</Badge>;
      case "SEM_COBRANCA":
      case "SEM_COBRANÇA":
        return <Badge variant="outline" className="bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20">Sem Cobrança</Badge>;
      default:
        return <Badge variant="outline">{formatted}</Badge>;
    }
  };

  return (
    <TabsContent value="Ordens" className="h-full min-h-0 w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6 space-y-6">
      <div className="space-y-4">
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Ordens de Serviço
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Histórico de ordens de serviço onde este produto foi utilizado.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-background px-3 py-1.5 border shadow-sm">
            <span className="text-xs font-medium text-muted-foreground">Total:</span>
            <span className="text-sm font-bold">{ordens.length}</span>
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
                  <TableHead>Veículo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordens.length > 0 ? (
                  ordens.map((o: any, idx: number) => {
                    const ordem = o.ordem || {};
                    const clienteNome = ordem.cliente?.nomerazaosocial || "Não informado";
                    const veiculoPlaca = ordem.veiculo?.placa_formatada || ordem.veiculo?.placa;
                    const veiculoNome = ordem.veiculo ? `${ordem.veiculo.modelo ?? "Veículo"}${veiculoPlaca ? ` (${veiculoPlaca})` : ""}` : "-";
                    const expanded = expandedOrdemId === ordem.id;

                    return (
                      <Fragment key={`${ordem.id}-${idx}`}>
                        <TableRow
                          className="cursor-pointer transition-colors hover:bg-muted/50"
                          onClick={() => setExpandedOrdemId(expanded ? null : ordem.id)}
                        >
                          <TableCell className="font-medium text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                              #{ordem.id}
                            </span>
                          </TableCell>
                          <TableCell>{formatDate(ordem.dataentrada || ordem.createdat)}</TableCell>
                          <TableCell className="max-w-[150px] truncate" title={clienteNome}>{clienteNome}</TableCell>
                          <TableCell className="max-w-[180px] truncate" title={veiculoNome}>{veiculoNome}</TableCell>
                          <TableCell>{getStatusBadge(ordem.status)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(ordem.orcamentototal || 0)}</TableCell>
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
                                      <span className="font-medium">{o.quantidade ?? 0}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Preço unitário</span>
                                      <span className="font-medium">{formatCurrency(o.precounitario || 0)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Subtotal</span>
                                      <span className="font-medium">{formatCurrency(o.subtotal || 0)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-md border bg-background p-3">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Ordem de serviço
                                  </p>
                                  <div className="space-y-1 text-xs">
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Entrada</span>
                                      <span className="font-medium">{formatDate(ordem.dataentrada)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Criada em</span>
                                      <span className="font-medium">{formatDate(ordem.createdat)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <span className="text-muted-foreground">Total OS</span>
                                      <span className="font-medium">{formatCurrency(ordem.orcamentototal || 0)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-md border bg-background p-3">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Descrição
                                  </p>
                                  <p className="line-clamp-4 text-xs text-muted-foreground" title={ordem.descricao || ""}>
                                    {ordem.descricao || "Sem descrição."}
                                  </p>
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
                        <ClipboardList className="h-8 w-8 opacity-20" />
                        <p>Produto não possui histórico de Ordens de Serviço</p>
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
