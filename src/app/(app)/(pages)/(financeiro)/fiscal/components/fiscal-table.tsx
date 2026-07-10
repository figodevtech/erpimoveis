"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import {
  Calendar,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  FileSearch,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Send,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";

import type { FiscalViewMode, NotaFiscal, Pagination } from "../types";

type FiscalTableProps = {
  notas: NotaFiscal[];
  pagination: Pagination;
  isLoading: boolean;
  search: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  modelo: string;
  viewMode: FiscalViewMode;
  setSearch: (value: string) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setStatus: (value: string) => void;
  setModelo: (value: string) => void;
  setViewMode: (value: FiscalViewMode) => void;
  handleGetNotas: (page?: number, limit?: number) => Promise<void>;
  onSyncTerceiros: () => Promise<void>;
  isSyncing: boolean;
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatCpfCnpj(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value || "-";
}

function statusClass(status: string) {
  const value = status.toUpperCase();
  if (["AUTORIZADA", "AUTORIZADO", "EMITIDA", "USO AUTORIZADO", "USO AUTORIZADO FORA DO PRAZO"].includes(value)) {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  }
  if (value === "CANCELADA" || value === "NF-E CANCELADA" || value === "CANCELADA FORA DO PRAZO") {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }
  if (value === "REJEITADA" || value === "USO DENEGADO") {
    return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function xmlStatusClass(status?: string | null) {
  if (status === "XML_COMPLETO") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  }
  if (status === "AGUARDANDO_XML") {
    return "border-blue-500/40 bg-blue-500/10 text-blue-700";
  }
  if (status === "NAO_AUTORIZADO") {
    return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function direcaoLabel(direcao: NotaFiscal["direcao"]) {
  return direcao === "EMITIDAS_POR_NOS" ? "Emitida por nós" : "Emitida por terceiro";
}

export default function FiscalTable({
  notas,
  pagination,
  isLoading,
  search,
  dateFrom,
  dateTo,
  status,
  modelo,
  viewMode,
  setSearch,
  setDateFrom,
  setDateTo,
  setStatus,
  setModelo,
  setViewMode,
  handleGetNotas,
  onSyncTerceiros,
  isSyncing,
}: FiscalTableProps) {
  const limitUid = React.useId();
  const limitListboxId = `${limitUid}-fiscal-limit-listbox`;

  const title =
    viewMode === "EMITIDAS_POR_NOS"
      ? "Notas emitidas por nós"
      : viewMode === "EMITIDAS_TERCEIROS"
        ? "Notas emitidas por terceiros"
        : "Notas fiscais";

  async function consultarStatus(id: number) {
    const toastId = toast.loading("Consultando status na SEFAZ...");
    try {
      const response = await axios.post(`/api/nfe/consultar/${id}`);
      toast.success("Consulta concluída", {
        id: toastId,
        description: response.data?.sefaz?.xMotivo ?? "Status fiscal atualizado.",
      });
      await handleGetNotas(pagination.page, pagination.limit);
    } catch (error) {
      const description = isAxiosError(error)
        ? error.response?.data?.message ?? error.response?.data?.error ?? error.message
        : "Erro ao consultar status.";
      toast.error("Falha na consulta", { id: toastId, description });
    }
  }

  async function baixarXml(id: number) {
    const endpoint =
      viewMode === "EMITIDAS_TERCEIROS"
        ? `/api/fiscal/notas-recebidas/${id}/xml`
        : `/api/fiscal/notas-emitidas/${id}/xml`;
    const toastId = toast.loading("Preparando XML...");

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("XML indisponível", {
          id: toastId,
          description: body?.detail ?? body?.error ?? "Não foi possível baixar o XML.",
        });
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const xmlCompleto = response.headers.get("X-DFe-Xml-Completo") !== "false";
      const motivo = decodeURIComponent(response.headers.get("X-DFe-Xml-Motivo") ?? "");
      const nextCheckAfter = response.headers.get("X-DFe-Xml-Next-Check-After");
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] ?? `nota-fiscal-${id}.xml`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      if (xmlCompleto) {
        toast.success("XML baixado", { id: toastId });
      } else {
        const nextCheckText = nextCheckAfter
          ? ` Próxima tentativa segura após ${new Date(nextCheckAfter).toLocaleString("pt-BR")}.`
          : "";
        toast.warning("Resumo XML baixado", {
          id: toastId,
          description:
            `${motivo || "O XML completo da NF-e ainda não está disponível na SEFAZ."}${nextCheckText}`,
        });
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : "Erro ao baixar XML.";
      toast.error("Falha no download", { id: toastId, description });
    }
  }

  async function manifestarTerceiros(
    id: number,
    tipo: "CIENCIA" | "CONFIRMACAO" | "DESCONHECIMENTO" | "OPERACAO_NAO_REALIZADA",
  ) {
    const labels = {
      CIENCIA: "Ciência da operação",
      CONFIRMACAO: "Confirmação da operação",
      DESCONHECIMENTO: "Desconhecimento da operação",
      OPERACAO_NAO_REALIZADA: "Operação não realizada",
    };
    const justificativa =
      tipo === "OPERACAO_NAO_REALIZADA"
        ? window.prompt("Informe a justificativa da operação não realizada:")
        : undefined;

    if (tipo === "OPERACAO_NAO_REALIZADA" && !justificativa?.trim()) return;

    const toastId = toast.loading("Enviando manifestação para a SEFAZ...");
    try {
      const response = await axios.post(`/api/fiscal/notas-recebidas/${id}/manifestar`, {
        tipo,
        justificativa,
      });

      toast.success(labels[tipo], {
        id: toastId,
        description: response.data?.xMotivo ?? "Manifestação enviada.",
      });
      await handleGetNotas(pagination.page, pagination.limit);
    } catch (error) {
      const description = isAxiosError(error)
        ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
        : "Erro ao enviar manifestação.";
      toast.error("Falha na manifestação", { id: toastId, description });
    }
  }

  return (
    <Card>
      <CardHeader className="border-b-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-lg font-medium">{title}</CardTitle>
            <CardDescription>
              <button
                type="button"
                onClick={() => handleGetNotas(pagination.page, pagination.limit)}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="grid w-full gap-2 lg:w-auto lg:grid-cols-[180px_150px_150px_150px_150px_auto]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar nota/chave"
              className="h-9"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-9"
            />
            <Select value={status || "TODOS"} onValueChange={(value) => setStatus(value === "TODOS" ? "" : value)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos status</SelectItem>
                <SelectItem value="RASCUNHO">Rascunho</SelectItem>
                <SelectItem value="AUTORIZADA">Autorizada</SelectItem>
                <SelectItem value="CANCELADA">Cancelada</SelectItem>
                <SelectItem value="REJEITADA">Rejeitada</SelectItem>
                <SelectItem value="DENEGADA">Denegada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={modelo || "TODOS"} onValueChange={(value) => setModelo(value === "TODOS" ? "" : value)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Modelo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos modelos</SelectItem>
                <SelectItem value="NFE">NF-e</SelectItem>
                <SelectItem value="NFCE">NFC-e</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => handleGetNotas(1, pagination.limit)}
            >
              <RefreshCw className="h-4 w-4" />
              Filtrar
            </Button>
            {viewMode === "EMITIDAS_TERCEIROS" ? (
              <Button
                type="button"
                className="h-9 lg:col-span-6"
                onClick={onSyncTerceiros}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                Sincronizar terceiros
              </Button>
            ) : null}
          </div>
        </div>

        <div className="w-full flex items-center justify-center">
          <div className="inline-flex h-10 items-center justify-center rounded-md rounded-b-none bg-muted p-1 text-muted-foreground">
            <button
              type="button"
              onClick={() =>
                setViewMode(viewMode === "EMITIDAS_POR_NOS" ? "TODAS" : "EMITIDAS_POR_NOS")
              }
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm rounded-b-none px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${
                viewMode === "EMITIDAS_POR_NOS"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/50 hover:text-foreground"
              }`}
            >
              Emitidas por nós
            </button>
            <button
              type="button"
              onClick={() =>
                setViewMode(viewMode === "EMITIDAS_TERCEIROS" ? "TODAS" : "EMITIDAS_TERCEIROS")
              }
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm rounded-b-none px-3 py-1.5 text-sm font-medium transition-all cursor-pointer ${
                viewMode === "EMITIDAS_TERCEIROS"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/50 hover:text-foreground"
              }`}
            >
              Emitidas por terceiros
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${
            isLoading && "opacity-100"
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading && "animate-slideIn"
            }`}
          />
        </div>

        <Table className="text-xs mt-6">
          <TableHeader>
            <TableRow className="font-bold">
              <TableHead>Nota</TableHead>
              <TableHead className="hidden md:table-cell">Emissão</TableHead>
              <TableHead className="hidden lg:table-cell">Pessoa</TableHead>
              <TableHead className="hidden xl:table-cell">Chave</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">Protocolo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {notas.length === 0 && !isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  Nenhuma nota fiscal encontrada.
                </TableCell>
              </TableRow>
            ) : null}

            {notas.map((nota) => {
              const pessoa = nota.destinatarioOuEmitente;
              const triggerId = `nota-${nota.id}-menu-btn`;
              const menuId = `nota-${nota.id}-menu`;
              const canManifestarTerceiros =
                viewMode === "EMITIDAS_TERCEIROS" &&
                nota.modelo !== "EVENTO" &&
                !nota.tipoDocumento?.includes("EVENTO");

              return (
                <TableRow key={nota.id} className="hover:cursor-pointer">
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {nota.modelo} {nota.numero}
                        </span>
                        {nota.serie ? <Badge variant="outline">Série {nota.serie}</Badge> : null}
                        <Badge variant="outline">{direcaoLabel(nota.direcao)}</Badge>
                        {nota.nsu ? <Badge variant="outline">NSU {nota.nsu}</Badge> : null}
                        {nota.xmlStatusLabel ? (
                          <Badge variant="outline" className={xmlStatusClass(nota.xmlStatus)}>
                            {nota.xmlStatusLabel}
                          </Badge>
                        ) : null}
                        {nota.statusManifestacao ? (
                          <Badge variant="outline">Manifestação {nota.statusManifestacao}</Badge>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">ID: {nota.id}</span>
                      <span className="text-xs text-muted-foreground md:hidden">
                        {formatDate(nota.dataemissao)}
                      </span>
                      <span className="text-xs text-muted-foreground lg:hidden">
                        {pessoa?.nomerazaosocial ?? "Pessoa não informada"}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatDate(nota.dataemissao)}
                    </span>
                  </TableCell>

                  <TableCell className="hidden lg:table-cell">
                    <div className="max-w-[260px]">
                      <div className="truncate font-medium">
                        {pessoa?.nomerazaosocial ?? "Pessoa não informada"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatCpfCnpj(pessoa?.cpfcnpj)}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden max-w-[260px] truncate font-mono text-[11px] xl:table-cell">
                    {nota.chave_acesso || "-"}
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline" className={statusClass(nota.status)}>
                      {nota.status}
                    </Badge>
                  </TableCell>

                  <TableCell className="hidden max-w-[180px] truncate lg:table-cell">
                    {nota.protocolo ?? "-"}
                  </TableCell>

                  <TableCell className="text-right font-medium">
                    {formatarEmReal(nota.total_nfe)}
                  </TableCell>

                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          id={triggerId}
                          aria-controls={menuId}
                          variant="ghost"
                          className="h-8 w-8 p-0 cursor-pointer"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent id={menuId} aria-labelledby={triggerId} align="end">
                        {viewMode !== "EMITIDAS_TERCEIROS" ? (
                          <DropdownMenuItem
                            onClick={() =>
                              window.open(`/nfe/${nota.id}/danfe`, "_blank", "noopener,noreferrer")
                            }
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Ver DANFE
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onClick={() => baixarXml(nota.id)}>
                          <Download className="mr-2 h-4 w-4" />
                          Baixar XML
                        </DropdownMenuItem>
                        {viewMode !== "EMITIDAS_TERCEIROS" ? (
                          <DropdownMenuItem onClick={() => consultarStatus(nota.id)}>
                            <FileSearch className="mr-2 h-4 w-4" />
                            Consultar SEFAZ
                          </DropdownMenuItem>
                        ) : null}
                        {canManifestarTerceiros ? (
                          <>
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "CIENCIA")}>
                              <Send className="mr-2 h-4 w-4" />
                              Ciência da operação
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "CONFIRMACAO")}>
                              <Send className="mr-2 h-4 w-4" />
                              Confirmar operação
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "DESCONHECIMENTO")}>
                              <Send className="mr-2 h-4 w-4" />
                              Desconhecer operação
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "OPERACAO_NAO_REALIZADA")}>
                              <Send className="mr-2 h-4 w-4" />
                              Operação não realizada
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            <span>{pagination.total === 0 ? 0 : pagination.limit * (pagination.page - 1) + 1}</span>
            {" - "}
            <span>{pagination.limit * (pagination.page - 1) + notas.length}</span>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetNotas(1, pagination.limit)}
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() => handleGetNotas(pagination.page - 1, pagination.limit)}
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
              onClick={() => handleGetNotas(pagination.page + 1, pagination.limit)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() => handleGetNotas(pagination.totalPages, pagination.limit)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <Select
            value={String(pagination.limit)}
            onValueChange={(value) => handleGetNotas(1, Number(value))}
          >
            <SelectTrigger className="hover:cursor-pointer ml-2 w-[82px]" aria-controls={limitListboxId}>
              <SelectValue placeholder={pagination.limit} />
            </SelectTrigger>
            <SelectContent id={limitListboxId}>
              <SelectItem className="hover:cursor-pointer" value="20">
                20
              </SelectItem>
              <SelectItem className="hover:cursor-pointer" value="50">
                50
              </SelectItem>
              <SelectItem className="hover:cursor-pointer" value="100">
                100
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
