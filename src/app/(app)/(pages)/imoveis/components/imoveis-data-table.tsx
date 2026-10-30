"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronsLeft,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRight,
  Loader,
  Loader2,
  Plus,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Imovel, Pagination } from "../types";
import { StatusBadge } from "@/components/imobiliario/shared";
import { money, rowStatus } from "@/components/imobiliario/model";
import { RowActions } from "@/components/imobiliario/row-actions";

interface ImoveisDataTableProps {
  imoveis: Imovel[];
  isLoading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
  onSelectImovel: (id: number) => void;
  onNewImovel?: () => void;
  onDeleteImovel?: (id: number) => Promise<unknown>;
  canCreate: boolean;
  canEdit: boolean;
}

export default function ImoveisDataTable({
  imoveis,
  isLoading,
  pagination,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onSelectImovel,
  onNewImovel,
  onDeleteImovel,
  canCreate,
  canEdit,
}: ImoveisDataTableProps) {
  return (
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de Imóveis</CardTitle>
            <CardDescription className="flex flex-col">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {canCreate && onNewImovel ? (
              <Button onClick={onNewImovel} className="hover:cursor-pointer">
                <Plus className="h-4 w-4" /> Imóvel
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${
            isLoading ? "opacity-100" : "opacity-0"
          } transition-all h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <Table className="mt-6 text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">ID</TableHead>
              <TableHead>Imóvel</TableHead>
              <TableHead>Proprietário / Localização</TableHead>
              <TableHead>Modalidade</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Valores</TableHead>
              <TableHead className="w-[50px]">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {imoveis.length === 0 && !isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  Nenhum imóvel encontrado.
                </TableCell>
              </TableRow>
            ) : (
              imoveis.map((imovel) => {
                const owner = imovel.proprietario?.nomerazaosocial ?? imovel.proprietario_nome ?? "—";
                const localizacao = [
                  imovel.endereco?.bairro ?? imovel.endereco_publico?.bairro,
                  imovel.endereco?.cidade ?? imovel.endereco_publico?.cidade,
                ]
                  .filter(Boolean)
                  .join(" · ");

                const valorPrincipal =
                  imovel.diaria && Number(imovel.diaria) > 0
                    ? `${money(imovel.diaria)} / diária`
                    : imovel.valor_locacao && Number(imovel.valor_locacao) > 0
                    ? `${money(imovel.valor_locacao)} / mês`
                    : imovel.valor_venda && Number(imovel.valor_venda) > 0
                    ? money(imovel.valor_venda)
                    : "—";

                return (
                  <TableRow
                    key={imovel.id}
                    className="hover:cursor-pointer"
                    onDoubleClick={() => onSelectImovel(imovel.id)}
                  >
                    <TableCell className="font-mono text-muted-foreground">#{imovel.id}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{imovel.titulo}</div>
                      <span className="text-[11px] text-muted-foreground">
                        {imovel.tipo ?? "Imóvel"}
                        {imovel.quartos ? ` · ${imovel.quartos} qto(s)` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>{owner}</div>
                      <span className="text-[11px] text-muted-foreground">
                        {localizacao || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {imovel.modalidades && imovel.modalidades.length > 0 ? (
                          imovel.modalidades.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                            >
                              {m}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={rowStatus(imovel)} />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {imovel.publicado ? "Publicado no site" : "Não publicado"}
                      </p>
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {valorPrincipal}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        canEdit={canEdit}
                        onOpen={() => onSelectImovel(imovel.id)}
                        onDelete={onDeleteImovel ? () => onDeleteImovel(imovel.id) : undefined}
                        deleteDescription="Sem reservas, locações, vendas ou lançamentos financeiros, o imóvel é excluído definitivamente, com fotos, anexos, tarifas e agenda. Com qualquer um desses vínculos, ele é apenas inativado e retirado do site."
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Paginação */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Total de {pagination.total} registros</span>
            <Loader
              className={`w-3.5 h-3.5 animate-spin transition-all opacity-0 ${
                isLoading ? "opacity-100" : ""
              }`}
            />
          </div>

          <div className="flex items-center justify-center space-x-1 sm:space-x-2">
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(1)}
              disabled={pagination.page <= 1 || isLoading}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1 || isLoading}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>

            <span className="text-[10px] sm:text-xs font-medium px-2">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>

            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(pagination.totalPages)}
              disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Por página:</span>
            <Select
              value={String(pagination.limit)}
              onValueChange={(val) => onPageSizeChange(Number(val))}
            >
              <SelectTrigger size="sm" className="w-[70px] hover:cursor-pointer">
                <SelectValue placeholder={pagination.limit} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="hover:cursor-pointer" value="10">10</SelectItem>
                <SelectItem className="hover:cursor-pointer" value="20">20</SelectItem>
                <SelectItem className="hover:cursor-pointer" value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

