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
import { Pagination, Proprietario } from "../types";
import { StatusBadge } from "@/components/imobiliario/shared";
import { RowActions } from "@/components/imobiliario/row-actions";

interface ProprietariosDataTableProps {
  proprietarios: Proprietario[];
  isLoading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
  onSelectProprietario: (id: number) => void;
  onNewProprietario?: () => void;
  onDeleteProprietario?: (id: number) => Promise<unknown>;
  canCreate: boolean;
  canEdit: boolean;
}

export default function ProprietariosDataTable({
  proprietarios,
  isLoading,
  pagination,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onSelectProprietario,
  onNewProprietario,
  onDeleteProprietario,
  canCreate,
  canEdit,
}: ProprietariosDataTableProps) {
  return (
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de Proprietários</CardTitle>
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
            {canCreate && onNewProprietario ? (
              <Button onClick={onNewProprietario} className="hover:cursor-pointer">
                <Plus className="h-4 w-4" /> Proprietário
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
              <TableHead>Proprietário</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>CPF/CNPJ</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead className="text-right">Taxa Adm</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-[50px]">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {proprietarios.length === 0 && !isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  Nenhum proprietário encontrado.
                </TableCell>
              </TableRow>
            ) : (
              proprietarios.map((prop) => (
                <TableRow
                  key={prop.id}
                  className="hover:cursor-pointer"
                  onDoubleClick={() => onSelectProprietario(prop.id)}
                >
                  <TableCell className="font-mono text-muted-foreground">#{prop.id}</TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{prop.nomerazaosocial}</div>
                    <span className="text-[11px] text-muted-foreground">
                      {prop.tipopessoa === "JURIDICA" ? "Pessoa Jurídica" : "Pessoa Física"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div>{prop.email || "—"}</div>
                    <span className="text-[11px] text-muted-foreground">{prop.telefone || "—"}</span>
                  </TableCell>
                  <TableCell className="font-mono">{prop.cpfcnpj || "—"}</TableCell>
                  <TableCell>
                    {[prop.cidade, prop.estado].filter(Boolean).join(" / ") || "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {Number(prop.percentual_admin ?? 0)}%
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={prop.ativo ? "ATIVO" : "INATIVO"} />
                  </TableCell>
                  <TableCell>
                    <RowActions
                      canEdit={canEdit}
                      onOpen={() => onSelectProprietario(prop.id)}
                      onDelete={onDeleteProprietario ? () => onDeleteProprietario(prop.id) : undefined}
                      deleteDescription="Esta ação não pode ser desfeita. Proprietários com histórico serão inativados em vez de excluídos."
                    />
                  </TableCell>
                </TableRow>
              ))
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

