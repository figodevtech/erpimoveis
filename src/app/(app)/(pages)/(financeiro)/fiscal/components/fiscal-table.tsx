"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios, { isAxiosError } from "axios";
import {
  Calendar,
  CheckCircle2,
  Copy,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  FileCode,
  FileSearch,
  FilePlus2,
  Loader2,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  RefreshCw,
  Send,
  SlidersHorizontal,
  UploadCloud,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "@/lib/toast";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import formatarEmReal from "@/utils/formatarEmReal";
import { traduzStatusNfe } from "@/lib/nfe/statusNfe";
import { EntradaFiscalDialog } from "@/components/entrada-fiscal/entrada-fiscal-dialog";

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
  const value = traduzStatusNfe(status).toUpperCase();
  if (["AUTORIZADA", "AUTORIZADO", "EMITIDA", "USO AUTORIZADO", "USO AUTORIZADO FORA DO PRAZO"].includes(value)) {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  }
  if (value.includes("CANCEL")) {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }
  if (value.includes("REJEI") || value.includes("DENEGAD") || value.includes("NÃO CONSTA")) {
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

function manifestacaoClass(status?: string | null) {
  if (status === "CIENCIA") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-700";
  }
  if (status === "CONFIRMACAO") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  }
  if (status === "DESCONHECIMENTO") {
    return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700";
  }
  if (status === "OPERACAO_NAO_REALIZADA") {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function formatManifestacao(status?: string | null) {
  const value = String(status ?? "");
  const labels: Record<string, string> = {
    CIENCIA: "Ciente da Operação",
    CONFIRMACAO: "Operação Confirmada",
    DESCONHECIMENTO: "Não Reconhecido",
    OPERACAO_NAO_REALIZADA: "Não Realizado",
  };

  return labels[value] ?? (value.replace(/_/g, " ") || "-");
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
  const copiarChave = async (chave: string) => {
    try {
      await navigator.clipboard.writeText(chave);
      toast.success("Chave da nota copiada.");
    } catch {
      toast.error("Não foi possível copiar a chave da nota.");
    }
  };
  const router = useRouter();
  const limitUid = React.useId();
  const limitListboxId = `${limitUid}-fiscal-limit-listbox`;
  const [notaCancelamento, setNotaCancelamento] = React.useState<NotaFiscal | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = React.useState("");
  const [cancelandoNota, setCancelandoNota] = React.useState(false);
  const [notaGerarEntrada, setNotaGerarEntrada] = React.useState<NotaFiscal | null>(null);
  const [notaForcarXml, setNotaForcarXml] = React.useState<NotaFiscal | null>(null);
  const [forcandoXml, setForcandoXml] = React.useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = React.useState(false);

  const title =
    viewMode === "EMITIDAS_POR_NOS"
      ? "Notas emitidas por nós"
      : viewMode === "EMITIDAS_TERCEIROS"
        ? "Notas emitidas por terceiros"
        : "Notas fiscais";

  async function consultarStatus(id: number) {
    const endpoint =
      viewMode === "EMITIDAS_TERCEIROS"
        ? `/api/fiscal/notas-recebidas/${id}/status`
        : `/api/nfe/consultar/${id}`;
    const toastId = toast.loading("Consultando status na SEFAZ...");
    try {
      const response = await axios.post(endpoint);
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

  async function baixarXml(
    nota: NotaFiscal,
    options: { toastId?: string | number; showForceAction?: boolean } = {},
  ): Promise<boolean> {
    const id = nota.id;
    const endpoint =
      viewMode === "EMITIDAS_TERCEIROS"
        ? `/api/fiscal/notas-recebidas/${id}/xml`
        : `/api/fiscal/notas-emitidas/${id}/xml`;
    const toastId = options.toastId ?? toast.loading("Preparando XML...");
    const showForceAction = options.showForceAction ?? true;

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const nextCheckText = body?.nextCheckAfter
          ? ` Próxima tentativa segura após ${new Date(body.nextCheckAfter).toLocaleString("pt-BR")}.`
          : "";
        const title = body?.xmlCompleto === false ? "XML ainda não disponível" : "XML indisponível";
        const description =
          `${body?.detail ?? body?.error ?? "Não foi possível baixar o XML."}${nextCheckText}`;
        const toastOptions = {
          id: toastId,
          description,
          action:
            showForceAction &&
            body?.xmlCompleto === false &&
            viewMode === "EMITIDAS_TERCEIROS" &&
            nota.chave_acesso
              ? {
                  label: "Forçar tentativa",
                  onClick: () => setNotaForcarXml(nota),
                }
              : undefined,
        };

        if (body?.xmlCompleto === false) {
          toast.warning(title, toastOptions);
        } else {
          toast.error(title, toastOptions);
        }
        return false;
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const xmlCompleto = response.headers.get("X-DFe-Xml-Completo") !== "false";
      const motivo = decodeURIComponent(response.headers.get("X-DFe-Xml-Motivo") ?? "");
      const nextCheckAfter = response.headers.get("X-DFe-Xml-Next-Check-After");
      if (!xmlCompleto) {
        const nextCheckText = nextCheckAfter
          ? ` Próxima tentativa segura após ${new Date(nextCheckAfter).toLocaleString("pt-BR")}.`
          : "";
        toast.warning("XML ainda não disponível", {
          id: toastId,
          description:
            `${motivo || "A SEFAZ ainda não disponibilizou o XML completo da NF-e."}${nextCheckText}`,
          action:
            showForceAction && viewMode === "EMITIDAS_TERCEIROS" && nota.chave_acesso
              ? {
                  label: "Forçar tentativa",
                  onClick: () => setNotaForcarXml(nota),
                }
              : undefined,
        });
        return false;
      }

      const blob = await response.blob();
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

      toast.success("XML baixado", { id: toastId });
      return true;
    } catch (error) {
      const description = error instanceof Error ? error.message : "Erro ao baixar XML.";
      toast.error("Falha no download", { id: toastId, description });
      return false;
    }
  }

  async function manifestarTerceiros(
    id: number,
    tipo: "CIENCIA" | "CONFIRMACAO" | "DESCONHECIMENTO" | "OPERACAO_NAO_REALIZADA",
  ) {
    const labels = {
      CIENCIA: "Ciente da Operação",
      CONFIRMACAO: "Operação Confirmada",
      DESCONHECIMENTO: "Não Reconhecido",
      OPERACAO_NAO_REALIZADA: "Não Realizado",
    };
    const justificativa =
      tipo === "OPERACAO_NAO_REALIZADA"
        ? window.prompt("Informe a justificativa da Operação não realizada:")
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
      const responseData = isAxiosError(error) ? error.response?.data : null;
      const motivoSefaz = responseData?.xMotivo
        ? `${responseData?.cStat ? `cStat ${responseData.cStat}: ` : ""}${responseData.xMotivo}`
        : null;
      const description = isAxiosError(error)
        ? motivoSefaz ??
          responseData?.detail ??
          responseData?.error ??
          "Erro ao enviar manifestação."
        : "Erro ao enviar manifestação.";
      toast.error("Falha na manifestação", { id: toastId, description });
    }
  }

  async function autorizarNfe(id: number) {
    const toastId = toast.loading("Enviando NF-e para autorização na SEFAZ...");
    try {
      const response = await axios.post(`/api/nfe/autorizar/${id}`);
      const data = response.data;
      const statusDb = String(data?.nfeDb?.status ?? "").toUpperCase();
      const motivo =
        data?.sefaz?.protocolo?.xMotivo ??
        data?.sefaz?.lote?.xMotivo ??
        "Retorno recebido da SEFAZ.";

      if (!data?.ok) {
        toast.error("Falha ao autorizar NF-e", {
          id: toastId,
          description: data?.mensagem ?? data?.detalhe ?? "A SEFAZ retornou uma falha na autorização.",
        });
        return;
      }

      if (statusDb === "AUTORIZADA") {
        toast.success("NF-e autorizada com sucesso!", { id: toastId, description: motivo });
      } else if (statusDb === "DENEGADA") {
        toast.error("NF-e denegada pela SEFAZ.", { id: toastId, description: motivo });
      } else if (statusDb === "REJEITADA") {
        toast.error("NF-e rejeitada pela SEFAZ.", { id: toastId, description: motivo });
      } else {
        toast.info("Retorno da SEFAZ recebido.", { id: toastId, description: motivo });
      }

      await handleGetNotas(pagination.page, pagination.limit);
    } catch (error) {
      const responseData = isAxiosError(error) ? error.response?.data : null;
      const description = isAxiosError(error)
        ? responseData?.mensagem ?? responseData?.detalhe ?? responseData?.error ?? error.message
        : "Erro ao autorizar NF-e.";
      toast.error("Falha ao autorizar NF-e", { id: toastId, description });
    }
  }

  async function excluirRascunho(id: number) {
    if (!window.confirm("Excluir este rascunho de NF-e?")) return;

    const toastId = toast.loading("Excluindo rascunho...");
    try {
      await axios.delete(`/api/fiscal/notas-emitidas/${id}`);
      toast.success("Rascunho excluído", { id: toastId });
      await handleGetNotas(pagination.page, pagination.limit);
    } catch (error) {
      const description = isAxiosError(error)
        ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
        : "Erro ao excluir rascunho.";
      toast.error("Falha ao excluir", { id: toastId, description });
    }
  }

  async function forcarTentativaXml() {
    if (!notaForcarXml) return;

    setForcandoXml(true);
    const toastId = toast.loading("Forçando nova tentativa na SEFAZ...");
    try {
      const nota = notaForcarXml;
      setNotaForcarXml(null);

      await axios.post("/api/fiscal/notas-recebidas/consultar-chave", {
        chave: nota.chave_acesso,
        empresaId: nota.empresaid,
        force: true,
      });

      await handleGetNotas(pagination.page, pagination.limit);
      await baixarXml(nota, { toastId, showForceAction: false });
    } catch (error) {
      const responseData = isAxiosError(error) ? error.response?.data : null;
      const blockedUntil = responseData?.consumoIndevidoUntil ?? responseData?.nextCheckAfter;
      const blockedText = blockedUntil
        ? ` Tente novamente após ${new Date(blockedUntil).toLocaleString("pt-BR")}.`
        : "";
      const description = isAxiosError(error)
        ? `${responseData?.xMotivo ?? responseData?.detail ?? responseData?.error ?? error.message}${blockedText}`
        : "Erro ao forçar nova tentativa.";
      toast.error("Falha na tentativa", { id: toastId, description });
    } finally {
      setForcandoXml(false);
    }
  }

  async function cancelarNotaAutorizada() {
    if (!notaCancelamento) return;

    const justificativa = motivoCancelamento.trim();
    if (justificativa.length < 15) {
      toast.error("Informe um motivo com pelo menos 15 caracteres.");
      return;
    }

    setCancelandoNota(true);
    const toastId = toast.loading("Solicitando cancelamento na SEFAZ...");
    try {
      const response = await axios.post(`/api/nfe/cancelar/${notaCancelamento.id}`, {
        justificativa,
      });
      const statusDb = String(response.data?.nfeDb?.status ?? "").toUpperCase();
      const retorno = response.data?.evento?.retorno;
      const lote = response.data?.evento?.lote;
      const motivo =
        retorno?.xMotivo ??
        lote?.xMotivo ??
        response.data?.mensagem ??
        "Retorno recebido da SEFAZ.";
      const detalhes = [
        retorno?.cStat ? `Evento ${retorno.cStat}` : null,
        lote?.cStat ? `Lote ${lote.cStat}` : null,
      ].filter(Boolean).join(" / ");
      const description = detalhes ? `${motivo} (${detalhes})` : motivo;

      if (statusDb === "CANCELADA") {
        toast.success("NF-e cancelada", { id: toastId, description });
        setNotaCancelamento(null);
        setMotivoCancelamento("");
        await handleGetNotas(pagination.page, pagination.limit);
      } else {
        toast.warning("Cancelamento não homologado", { id: toastId, description });
      }
    } catch (error) {
      const description = isAxiosError(error)
        ? error.response?.data?.mensagem ??
          error.response?.data?.detail ??
          error.response?.data?.error ??
          error.message
        : "Erro ao solicitar cancelamento.";
      toast.error("Falha no cancelamento", { id: toastId, description });
    } finally {
      setCancelandoNota(false);
    }
  }

  function limparFiltros() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setStatus("");
    setModelo("");
  }

  return (
    <>
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <div className="relative flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription className="flex items-center gap-2">
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

          <div className="flex flex-1 items-center justify-center xl:absolute xl:left-1/2 xl:top-1/2 xl:-translate-x-1/2 xl:-translate-y-1/2">
            <div className="inline-flex h-auto items-center justify-center gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setViewMode("EMITIDAS_POR_NOS")}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${
                  viewMode === "EMITIDAS_POR_NOS"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-background/50 hover:text-foreground"
                }`}
              >
                Próprias
              </button>
              <button
                type="button"
                onClick={() => setViewMode("EMITIDAS_TERCEIROS")}
                className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground ${
                  viewMode === "EMITIDAS_TERCEIROS"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-background/50 hover:text-foreground"
                }`}
              >
                Terceiros
              </button>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
            {viewMode === "EMITIDAS_TERCEIROS" ? (
              <Button
                type="button"
                className="h-9"
                onClick={onSyncTerceiros}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                Sincronizar
              </Button>
            ) : null}
            <Button asChild size="sm">
              <Link href="/fiscal/nfe-avulsa">
                <FilePlus2 className="h-4 w-4" />
                Emitir NF-e
              </Link>
            </Button>
            <Sheet open={filtrosAbertos} onOpenChange={setFiltrosAbertos}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-1">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filtros
                  {[search, dateFrom, dateTo, status, modelo].filter(Boolean).length > 0 ? (
                    <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1 text-[10px]">
                      {[search, dateFrom, dateTo, status, modelo].filter(Boolean).length}
                    </Badge>
                  ) : null}
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader><SheetTitle>Filtros fiscais</SheetTitle></SheetHeader>
                <div className="grid flex-1 auto-rows-min gap-6 px-4">
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Busca</p>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Nota, chave, pessoa, documento ou protocolo</p>
                      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar informações da nota" className="h-9 w-full" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Intervalo de datas</p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="flex-1 space-y-1"><p className="text-[11px] text-muted-foreground">Data inicial</p><DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Selecione" className="min-w-0" /></div>
                      <div className="flex-1 space-y-1"><p className="text-[11px] text-muted-foreground">Data final</p><DatePicker value={dateTo} onChange={setDateTo} placeholder="Selecione" className="min-w-0" /></div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Documento fiscal</p>
                    <div className="space-y-3">
                      <div className="space-y-1"><p className="text-[11px] text-muted-foreground">Status</p><Select value={status || "TODOS"} onValueChange={(value) => setStatus(value === "TODOS" ? "" : value)}><SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODOS">Todos status</SelectItem><SelectItem value="RASCUNHO">Rascunho</SelectItem><SelectItem value="AUTORIZADA">Autorizada</SelectItem><SelectItem value="CANCELADA">Cancelada</SelectItem><SelectItem value="REJEITADA">Rejeitada</SelectItem><SelectItem value="DENEGADA">Denegada</SelectItem></SelectContent></Select></div>
                      <div className="space-y-1"><p className="text-[11px] text-muted-foreground">Modelo</p><Select value={modelo || "TODOS"} onValueChange={(value) => setModelo(value === "TODOS" ? "" : value)}><SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TODOS">Todos modelos</SelectItem><SelectItem value="NFE">NF-e</SelectItem><SelectItem value="NFCE">NFC-e</SelectItem></SelectContent></Select></div>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between gap-2">
                    <Button type="button" variant="outline" onClick={limparFiltros} disabled={!search && !dateFrom && !dateTo && !status && !modelo}><XCircle className="h-4 w-4" />Limpar filtros</Button>
                    <SheetClose asChild><Button type="button" onClick={() => handleGetNotas(1, pagination.limit)}>Aplicar filtros</Button></SheetClose>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            
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
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {notas.length === 0 && !isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Nenhuma nota fiscal encontrada.
                </TableCell>
              </TableRow>
            ) : null}

            {notas.map((nota) => {
              const pessoa = nota.destinatarioOuEmitente;
              const triggerId = `nota-${nota.id}-menu-btn`;
              const menuId = `nota-${nota.id}-menu`;
              const manifestacao = String(nota.statusManifestacao ?? "");
              const canManifestarTerceiros =
                viewMode === "EMITIDAS_TERCEIROS" &&
                nota.modelo !== "EVENTO" &&
                !nota.tipoDocumento?.includes("EVENTO");
              const podeSolicitarCiencia = canManifestarTerceiros && !manifestacao;
              const podeManifestarOperacao =
                canManifestarTerceiros && (!manifestacao || manifestacao === "CIENCIA");
              const podeVerDanfe =
                viewMode !== "EMITIDAS_TERCEIROS" || nota.xmlStatus === "XML_COMPLETO";
              const isRascunho = String(nota.status).toUpperCase() === "RASCUNHO";
              // Rejeição não consome a numeração: a nota pode ser corrigida e
              // retransmitida com o mesmo número e série.
              const isRejeitada = String(nota.status).toUpperCase() === "REJEITADA";
              const statusTraduzido = traduzStatusNfe(nota.status).toUpperCase();
              const podeConsultarSefaz = !isRascunho;
              const podeExcluirRascunho = viewMode !== "EMITIDAS_TERCEIROS" && isRascunho;
              const podeEditar = viewMode !== "EMITIDAS_TERCEIROS" && (isRascunho || isRejeitada);
              const podeCancelarNota =
                viewMode !== "EMITIDAS_TERCEIROS" &&
                !isRascunho &&
                (String(nota.status).toUpperCase() === "AUTORIZADA" ||
                  statusTraduzido === "AUTORIZADA");
// a
              return (
                <TableRow key={nota.id} className="hover:cursor-pointer">
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2 max-w-[200px] lg:max-w-[400px]">
                        <span className="font-medium ">
                          {nota.modelo} {nota.numero}
                        </span>
                        {nota.serie ? <Badge variant="outline">Série {nota.serie}</Badge> : null}
                        {nota.xmlStatusLabel ? (
                          <Badge variant="outline" className={xmlStatusClass(nota.xmlStatus)}>
                            {nota.xmlStatusLabel}
                          </Badge>
                        ) : null}
                        {nota.statusManifestacao ? (
                          <Badge variant="outline" className={manifestacaoClass(nota.statusManifestacao)}>
                            {formatManifestacao(nota.statusManifestacao)}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">ID: {nota.id}</span>
                      <span className="text-xs text-muted-foreground md:hidden">
                        {formatDate(nota.dataemissao)}
                      </span>
                      <span className="text-xs text-wrap text-muted-foreground lg:hidden">
                        {pessoa?.nomerazaosocial ?? "Pessoa não informada"}
                      </span>

                      <Badge variant="outline" className={statusClass(nota.status)}>
                      {traduzStatusNfe(nota.status)}
                    </Badge>
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

                  <TableCell className="hidden max-w-[260px] xl:table-cell">
                    {nota.chave_acesso ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          aria-label="Copiar chave da nota"
                          title="Copiar chave"
                          onClick={() => void copiarChave(nota.chave_acesso)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <span className="truncate font-mono text-[11px]">{nota.chave_acesso}</span>
                      </div>
                    ) : "-"}
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline" className={statusClass(nota.status)}>
                      {traduzStatusNfe(nota.status)}
                    </Badge>
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
                        {podeVerDanfe ? (
                          <DropdownMenuItem
                            onClick={() =>
                              window.open(
                                viewMode === "EMITIDAS_TERCEIROS"
                                  ? `/nfe/${nota.id}/danfe?origem=terceiros`
                                  : `/nfe/${nota.id}/danfe`,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Ver DANFE
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onClick={() => baixarXml(nota)}>
                          <Download className="mr-2 h-4 w-4" />
                          Baixar XML
                        </DropdownMenuItem>
                        {viewMode === "EMITIDAS_TERCEIROS" && nota.xmlStatus === "XML_COMPLETO" ? (
                          <DropdownMenuItem onClick={() => setNotaGerarEntrada(nota)}>
                            <PackagePlus className="mr-2 h-4 w-4" />
                            Gerar Entrada
                          </DropdownMenuItem>
                        ) : null}
                        {podeConsultarSefaz ? (
                          <DropdownMenuItem onClick={() => consultarStatus(nota.id)}>
                            <FileSearch className="mr-2 h-4 w-4" />
                            Consultar SEFAZ
                          </DropdownMenuItem>
                        ) : null}
                        {podeEditar ? (
                          <>
                            <DropdownMenuItem onClick={() => router.push(`/fiscal/nfe-avulsa?id=${nota.id}`)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              {isRejeitada ? "Corrigir dados" : "Editar rascunho"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(`/nfe/${nota.id}/editor`, "_blank", "noopener,noreferrer")
                              }
                            >
                              <FileCode className="mr-2 h-4 w-4" />
                              Editar XML
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => autorizarNfe(nota.id)}>
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              Autorizar NFe
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        {podeExcluirRascunho ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => excluirRascunho(nota.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir rascunho
                          </DropdownMenuItem>
                        ) : null}
                        {podeCancelarNota ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setNotaCancelamento(nota);
                              setMotivoCancelamento("");
                            }}
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Solicitar cancelamento
                          </DropdownMenuItem>
                        ) : null}
                        {canManifestarTerceiros ? (
                          <>
                            {podeSolicitarCiencia ? (
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "CIENCIA")}>
                              <Send className="mr-2 h-4 w-4" />
                              Ciente da Operação
                            </DropdownMenuItem>
                            ) : null}
                            {podeManifestarOperacao ? (
                            <>
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "CONFIRMACAO")}>
                              <Send className="mr-2 h-4 w-4" />
                              Operação Confirmada
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "DESCONHECIMENTO")}>
                              <Send className="mr-2 h-4 w-4" />
                              Não Reconhecido
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => manifestarTerceiros(nota.id, "OPERACAO_NAO_REALIZADA")}>
                              <Send className="mr-2 h-4 w-4" />
                              Não Realizado
                            </DropdownMenuItem>
                            </>
                            ) : null}
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
    <AlertDialog
      open={Boolean(notaCancelamento)}
      onOpenChange={(open) => {
        if (cancelandoNota) return;
        if (!open) {
          setNotaCancelamento(null);
          setMotivoCancelamento("");
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Solicitar cancelamento da NF-e?</AlertDialogTitle>
          <AlertDialogDescription>
            O cancelamento será enviado como evento para a SEFAZ. Informe uma justificativa fiscal
            com no mínimo 15 caracteres.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 bg-card p-3 rounded-2xl">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              NF-e {notaCancelamento?.numero ?? "-"} - Série {notaCancelamento?.serie ?? "-"}
            </p>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              Chave {notaCancelamento?.chave_acesso || "-"}
            </p>
          </div>
          <Textarea
            value={motivoCancelamento}
            onChange={(event) => setMotivoCancelamento(event.target.value.slice(0, 255))}
            placeholder="Ex.: Erro de emissão nos dados fiscais da nota."
            disabled={cancelandoNota}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            {motivoCancelamento.trim().length}/255 caracteres. Mínimo: 15.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelandoNota}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={cancelandoNota || motivoCancelamento.trim().length < 15}
            onClick={(event) => {
              event.preventDefault();
              void cancelarNotaAutorizada();
            }}
          >
            {cancelandoNota ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirmar cancelamento
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog
      open={Boolean(notaForcarXml)}
      onOpenChange={(open) => {
        if (forcandoXml) return;
        if (!open) setNotaForcarXml(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Forçar nova tentativa agora?</AlertDialogTitle>
          <AlertDialogDescription>
            A consulta será enviada novamente para a SEFAZ antes do horário sugerido para esta nota.
            Se a SEFAZ responder com consumo indevido, novas consultas serão bloqueadas pelo prazo informado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">
            NF-e {notaForcarXml?.numero ?? "-"} - Série {notaForcarXml?.serie ?? "-"}
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            Chave {notaForcarXml?.chave_acesso || "-"}
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={forcandoXml}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={forcandoXml}
            onClick={(event) => {
              event.preventDefault();
              void forcarTentativaXml();
            }}
          >
            {forcandoXml ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Forçar tentativa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <EntradaFiscalDialog
      open={Boolean(notaGerarEntrada)}
      onOpenChange={(open) => {
        if (!open) setNotaGerarEntrada(null);
      }}
      notaFiscalRecebidaId={notaGerarEntrada?.id}
    />
    </>
  );
}


