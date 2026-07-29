"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Car,
  User,
  Wrench,
  MoreHorizontal,
  Box,
  ChevronsLeft,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "./badge-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrdemRoot } from "../types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pagination } from "@/app/(app)/(pages)/veiculos/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface OrdensListProps {
  ordens: OrdemRoot[];
  activeTab: string;
  onTabChange: (val: string) => void;
  isLoading: boolean;
  pagination: Pagination;
  handleGetOrdens: (page: number, limit: number) => void;
}

function formatDate(dateString?: Date) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const tabTheme =
  " dark:data-[state=active]:bg-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

import { useState } from "react";
import { OrdemDetailsDialog } from "./ordem-details-dialog";
import { Badge } from "@/components/ui/badge";

export function OrdensList({
  ordens,
  activeTab,
  onTabChange,
  isLoading,
  pagination,
  handleGetOrdens,
}: OrdensListProps) {
  const [selectedOsId, setSelectedOsId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleRowDoubleClick = (id: number) => {
    setSelectedOsId(id);
    setDetailsOpen(true);
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardHeader className="border-b-2 flex flex-col">
        <CardTitle className="text-xl font-semibold">
          Últimas Ordens de Serviço
        </CardTitle>
        <Tabs
          value={activeTab}
          onValueChange={onTabChange}
          className="w-full items-center mt-5"
        >
          <TabsList className="rounded-b-none">
            <TabsTrigger
              value="abertas"
              className={" rounded-b-none cursor-pointer" + tabTheme}
            >
              Abertas
            </TabsTrigger>
            <TabsTrigger
              value="finalizadas"
              className={" rounded-b-none cursor-pointer" + tabTheme}
            >
              Concluídas
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative flex flex-col justify-between">
        <div
          className={`${
            isLoading && "opacity-100"
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading && "animate-slideIn "
            }`}
          />
        </div>
        <div className="overflow-x-auto pt-5">
          <Table className="w-full max-w-full text-xs">
            <TableHeader>
              <TableRow className="border-b border-border/50">
                <TableHead className="hidden md:table-cell px-6 py-3 text-left font-medium text-muted-foreground uppercase tracking-wider">
                  OS / Cliente
                </TableHead>
                <TableHead className="hidden md:table-cell px-6 py-3 text-left font-medium text-muted-foreground uppercase tracking-wider">
                  Veículo / Peça
                </TableHead>
                <TableHead className="hidden md:table-cell px-6 py-3 text-left font-medium text-muted-foreground uppercase tracking-wider">
                  Setor / Responsável
                </TableHead>
                <TableHead className="hidden md:table-cell text-center px-6 py-3 font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </TableHead>
                <TableHead className="hidden md:table-cell px-6 py-3 text-right font-medium text-muted-foreground uppercase tracking-wider">
                  Valor
                </TableHead>
                <TableHead className="hidden md:table-cell px-6 py-3 text-right font-medium text-muted-foreground uppercase tracking-wider">
                  Cadastro
                </TableHead>
                <TableHead className="hidden md:table-cell px-6 py-3 text-right font-medium text-muted-foreground uppercase tracking-wider">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/30">
              {ordens.map((ordem) => (
                <TableRow
                  key={ordem.id}
                  className="hover:bg-secondary/30 transition-colors cursor-pointer group"
                  onDoubleClick={() => handleRowDoubleClick(ordem.id)}
                >
                  <TableCell className="max-w-[300px]f md:max-w-[350px] truncate py-6 md:py-1">
                    <div className="flex items-center gap-3">
                      <div className="hidden md:block p-2 md:p-4 bg-primary/20 rounded-lg md:rounded-xl">
                        <p className="font-bold text-primary">
                          {ordem.numero || `#${ordem.id}`}
                        </p>
                      </div>
                      <div>
                        <div className="flex flex-row items-center gap-1 mt-3 md:mt-0 ">
                          <div className=" md:hidden p-2 md:p-4 bg-primary/20 rounded-lg md:rounded-xl">
                            <p className="font-bold text-primary">
                              {ordem.numero || `#${ordem.id}`}
                            </p>
                          </div>
                          <StatusBadge
                            className="md:hidden"
                            status={ordem.status}
                          />
                        </div>
                        <div className="flex flex-row items-center gap-1 mt-3 md:mt-0 ">
                          <span>
                            <User className="w-3 h-3" />
                          </span>
                          <p className="text-xs text-muted-foreground flex flex-row items-center gap-1 whitespace-break-spaces md:whitespace-nowrap break-words md:break-normal">
                            {ordem.cliente?.nome || "Cliente não informado"}
                          </p>
                        </div>

                        <div className="flex flex-row items-center gap-1 mt-1">
                          <span>
                            {ordem.veiculo ? (
                              <Car className="w-3 h-3 md:hidden" />
                            ) : ordem.peca ? (
                              <Box className="w-3 h-3 md:hidden" />
                            ) : null}
                          </span>
                          <p className=" md:hidden whitespace-pre-wrap break-words text-xs text-muted-foreground flex flex-row items-center gap-1">
                            {ordem.veiculo ? (
                              <>{ordem.veiculo.modelo}</>
                            ) : ordem.peca ? (
                              <>{ordem.peca.titulo.toUpperCase()}</>
                            ) : (
                              "-"
                            )}
                          </p>
                        </div>
                        {ordem.peca?.descricao && (
                          <div className="md:hidden flex flex-row items-center gap-1 mt-1">
                            <div className="p-3 bg-muted-foreground/10 rounded-lg">
                              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground flex flex-row items-center gap-1">
                                {ordem.peca?.descricao}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="md:hidden flex flex-col gap-2 mt-2">
                          <div className="flex flex-row items-center gap-1">
                            {ordem.execucao_inicio_em && (
                              <>
                                <Badge variant={"secondary"} className=" h-4">
                                  Início em:
                                </Badge>
                                <span className="">
                                  {formatDate(
                                    ordem.execucao_inicio_em || undefined,
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                          <div className="flex flex-row items-center gap-1">
                            {ordem.execucao_fim_em && (
                              <>
                                <Badge className=" h-4">Fim em:</Badge>
                                <span className="">
                                  {formatDate(
                                    ordem.execucao_fim_em || undefined,
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="pt-2 text-muted-foreground">
                          {"Criado por: " + ordem.responsavel?.nome ||
                            "Usuário indefinido"}
                        </p>
                        <p className="pt-2 text-muted-foreground">
                          {"Cadastrado em: " +
                            formatDate(ordem.createdAt || undefined) || ""}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:flex max-w-70 flex-row items-center gap-2">
                    <div>
                      {ordem.alvo_tipo !== "VEICULO" ? (
                        <Box className="w-4 h-4" />
                      ) : (
                        <Car className="w-4 h-4" />
                      )}
                    </div>
                    <div className="whitespace-normal break-words text-xs text-foreground">
                      <p className="">
                        {ordem.veiculo?.placa ||
                          ordem.peca?.titulo.toUpperCase() ||
                          ordem.equipamento?.nome ||
                          "-"}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-[10px] text-muted-foreground">
                        {ordem.veiculo &&
                          `${ordem.veiculo.marca} ${ordem.veiculo.modelo}`}
                        {ordem.peca &&
                          `${ordem.peca.descricao?.toUpperCase() || ""}`}
                        {ordem.equipamento &&
                          [
                            ordem.equipamento.patrimonio
                              ? `Patrimônio ${ordem.equipamento.patrimonio}`
                              : null,
                            ordem.equipamento.horimetro != null
                              ? `${ordem.equipamento.horimetro} h`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs font-medium text-foreground">
                          {ordem.setor?.nome || "-"}
                        </p>
                        <p className=" text-xs text-muted-foreground">
                          {ordem.responsavel?.nome || "-"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell px-6 py-4 text-center">
                    <StatusBadge status={ordem.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell px-6 py-4 text-right">
                    <p className="text-xs font-semibold text-foreground">
                      {formatCurrency(ordem.orcamentototal)}
                    </p>
                    {ordem.transacoes && ordem.transacoes.length > 0 && (
                      <p className=" text-success">
                        {formatCurrency(
                          ordem.transacoes
                            .filter((t) => t.tipo === "RECEITA")
                            .reduce((acc, t) => acc + t.valor, 0),
                        )}{" "}
                        pago
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell px-6 py-4 text-right">
                    <p className="text-xs text-muted-foreground">
                      {formatDate(ordem.createdAt || undefined) || ""}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell px-6 py-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Abrir menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleRowDoubleClick(ordem.id)}
                        >
                          Ver detalhes
                        </DropdownMenuItem>
                        <DropdownMenuItem>Editar</DropdownMenuItem>
                        <DropdownMenuItem>Imprimir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center mt-4 justify-between">
            <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
              <span>{pagination.limit * (pagination.page - 1) + 1}</span>
              {" - "}
              <span>
                {pagination.limit * (pagination.page - 1) + ordens.length}
              </span>
            </div>

            <div className="flex items-center justify-center space-x-2">
              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() => handleGetOrdens(1, pagination.limit)}
                disabled={pagination.page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() =>
                  handleGetOrdens(pagination.page - 1, pagination.limit)
                }
                disabled={pagination.page === 1}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>

              <span className="text-xs font-medium text-nowrap">
                Pg. {pagination.page} de {pagination.totalPages || 1}
              </span>

              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() =>
                  handleGetOrdens(pagination.page + 1, pagination.limit)
                }
                disabled={
                  pagination.page === pagination.totalPages ||
                  pagination.totalPages === 0
                }
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>

              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() =>
                  handleGetOrdens(pagination.totalPages, pagination.limit)
                }
                disabled={
                  pagination.page === pagination.totalPages ||
                  pagination.totalPages === 0
                }
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Select de itens por página com IDs estáveis */}
            <div>
              <Select>
                <SelectTrigger className="hover:cursor-pointer ml-2">
                  <SelectValue placeholder={`${pagination.limit}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="hover:cursor-pointer" value="20">
                    {pagination.limit}
                  </SelectItem>
                  {/* adicione mais opções se desejar (10/20/50/100...) */}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>

      <OrdemDetailsDialog
        osId={selectedOsId}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </Card>
  );
}
