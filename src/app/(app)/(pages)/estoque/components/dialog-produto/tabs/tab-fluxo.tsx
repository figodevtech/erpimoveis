"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { ChevronDown, Edit, Undo2, Receipt, ArrowRightLeft } from "lucide-react";
import { Produto } from "../../../types";
import { formatDate } from "@/utils/formatDate";
import { DialogEntradaGeral } from "../../dialog-entrada-geral/dialog-entrada-geral";
import { EmissaoNotaDialog } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";

export function TabFluxo({ produto }: { produto: Produto }) {
  const entradas = (produto as any).entrada ?? [];
  const [selectedEntradaId, setSelectedEntradaId] = useState<number | null>(null);
  const [openDialogEntradaGeral, setOpenDialogEntradaGeral] = useState(false);
  const [nfeDialogEntradaId, setNfeDialogEntradaId] = useState<number | null>(null);

  const getStatusBadge = (status: string) => {
    if (!status) return <Badge variant="outline">Desconhecido</Badge>;
    const upper = status.toUpperCase();
    const formatted = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, " ");

    switch (upper) {
      case "CONCLUIDA":
      case "CONCLUÍDA":
      case "EFETIVADA":
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">Efetivada</Badge>;
      case "PENDENTE":
      case "RASCUNHO":
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
      <DialogEntradaGeral
        selectedEntradaId={selectedEntradaId ?? undefined}
        open={openDialogEntradaGeral}
        onOpenChange={(v)=>{
          if(!v){
            setSelectedEntradaId(null)
            setOpenDialogEntradaGeral(false)
          }else{
            setOpenDialogEntradaGeral(true)
          }
        }}
      />

      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Movimentações de Entrada
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Histórico de entradas deste produto no estoque.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-background px-3 py-1.5 border shadow-sm">
            <span className="text-xs font-medium text-muted-foreground">Total:</span>
            <span className="text-sm font-bold">{entradas.length}</span>
          </div>
        </div>

        <div className="rounded-md border bg-card overflow-hidden">
          <Table className="text-xs">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[80px]">ID</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Fornecedor</TableHead>
                {/* <TableHead>Status</TableHead> */}
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {entradas.length > 0 ? (
                entradas.map((e: any) => {
                  const entradaInfo = e.entradainfo || {};
                  const fornecedorNome = entradaInfo.fornecedor?.nomerazaosocial || "Não informado";
                  
                  return (
                    <TableRow key={e.id} className="hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium text-muted-foreground">#{e.id}</TableCell>
                      <TableCell>{formatDate(e.created_at)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={fornecedorNome}>{fornecedorNome}</TableCell>
                      {/* <TableCell>{getStatusBadge(entradaInfo.status)}</TableCell> */}
                      <TableCell className="text-right font-bold text-green-600 dark:text-green-500">+ {e.quantidade}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer rounded-full">
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-[180px]">
                            <Button onClick={()=>{
                              if (entradaInfo.id) {
                                setSelectedEntradaId(entradaInfo.id)
                                setOpenDialogEntradaGeral(true)
                              }
                            }} variant="ghost" className="w-full justify-start cursor-pointer px-2 text-xs">
                              <Edit className="mr-2 h-4 w-4" />
                              Editar Entrada
                            </Button>
                            
                            <Button onClick={()=>{
                              if (entradaInfo.id) {
                                setNfeDialogEntradaId(entradaInfo.id)
                              }
                            }} variant="ghost" className="w-full justify-start cursor-pointer px-2 text-xs">
                              <Receipt className="mr-2 h-4 w-4 text-emerald-500" />
                              Emitir Nota
                            </Button>
                            
                            <Button variant="ghost" className="w-full justify-start cursor-pointer px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-500/10">
                              <Undo2 className="mr-2 h-4 w-4" />
                              Cancelar Entrada
                            </Button>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell className="text-center h-24 text-muted-foreground" colSpan={6}>
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
