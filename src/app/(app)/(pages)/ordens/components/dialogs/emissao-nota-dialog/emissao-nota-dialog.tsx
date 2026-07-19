"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/lib/toast";
import { supabase } from "@/lib/supabase";
import { Loader2, Receipt, AlertCircle, CheckCircle2, XCircle, Info, X, Plus, RotateCw, Ellipsis, Download } from "lucide-react";
import { AutorizarNfeButton } from "./autorizarNfe-button";
import { GerarNotaDeOsDialog } from "./gerarNotaDeOsDialog/gerarNotaDeOsDialog";
import { EmissaoNfseDialog } from "./emissao-nfse-dialog/emissao-nfse-dialog";
import { CancelarNfeButton } from "./cancelarNfeButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExcluirRascunhoNfeButton } from "./excluirRascunhoNfeButton";
import { CancelarNotaDialog } from "./cancelar-nota-dialog";

type NfeResumo = {
  id: number;
  modelo: string | null;
  serie: number | null;
  numero: number | null;
  chave_acesso: string | null;
  ambiente: string | null;
  status: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
  clienteid: number | null;
  dataemissao: string | null;
  dataautorizacao: string | null;
  protocolo: string | null;
  total_produtos: number | null;
  total_servicos: number | null;
  total_nfe: number | null;
  xml_assinado: string | null;
  xml_autorizado: string | null;
  justificativacancelamento: string | null;
  createdat: string | null;
  updatedat: string | null;
  empresaid: number | null;
  url_pdf?: string;
  codigo_verificacao?: string;
};

type ListarNfeResponsePorOs = {
  ok: boolean;
  message?: string;
  osId?: number;
  nfes: NfeResumo[];
};

type ListarNfeResponsePorVenda = {
  ok: boolean;
  message?: string;
  vendaId?: number;
  nfes: NfeResumo[];
};

type ListarNfeResponsePorEntrada = {
  ok: boolean;
  message?: string;
  entradaId?: number;
  nfes: NfeResumo[];
};

const nfeStatusClasses: Record<string, string> = {
  AUTORIZADA: "bg-emerald-600/15 text-emerald-400",
  AUTORIZADO: "bg-emerald-600/15 text-emerald-400",
  EMITIDA: "bg-emerald-600/15 text-emerald-400",
  REJEITADA: "bg-red-600/15 text-red-400",
  RASCUNHO: "bg-slate-500/20 text-slate-400",
  CANCELADA: "bg-amber-500/20 text-amber-400",
  CANCELADO: "bg-amber-500/20 text-amber-400",
  PROCESSANDO: "bg-sky-600/15 text-sky-400 animate-pulse",
  PROCESSANDO_AUTORIZACAO: "bg-sky-600/15 text-sky-400 animate-pulse",
};

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function buildObservacao(nfe: NfeResumo): string {
  const statusUpper = (nfe.status || "").toUpperCase();

  if (statusUpper === "CANCELADA" || statusUpper === "CANCELADO") {
    if (nfe.justificativacancelamento && nfe.justificativacancelamento.trim()) {
      return `NF-e cancelada. Justificativa: ${nfe.justificativacancelamento}`;
    }
    return "NF-e cancelada. Nenhuma justificativa registrada.";
  }

  if (statusUpper === "AUTORIZADA" || statusUpper === "AUTORIZADO" || statusUpper === "EMITIDA") {
    const base = "NF-e autorizada pela SEFAZ.";
    if (nfe.protocolo) {
      return `${base} Protocolo: ${nfe.protocolo}.`;
    }
    return base;
  }

  if (statusUpper === "REJEITADA") {
    return "NF-e rejeitada pela SEFAZ. Motivo não está registrado na tabela de NF-e. Verifique o histórico de retorno da SEFAZ.";
  }

  if (statusUpper === "RASCUNHO") {
    return "NF-e em rascunho. Ainda não foi enviada para a SEFAZ.";
  }

  if (statusUpper === "PROCESSANDO" || statusUpper === "PROCESSANDO_AUTORIZACAO") {
    return "NFS-e em processamento na Focus NFe. Aguarde a autorização automática.";
  }

  return "Nenhuma observação registrada.";
}

export function EmissaoNotaDialog({
  open,
  onOpenChange,
  osId,
  vendaId,
  entradaId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;

  /** opcional: uso na tela de OS */
  osId?: number | null;

  /** opcional: uso na tela de venda */
  vendaId?: number | null;

  /** opcional: uso na tela de entrada */
  entradaId?: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [nfes, setNfes] = useState<NfeResumo[] | null>(null);
  const [openGerarNfe, setOpenGerarNfe] = useState(false);
  const [openGerarNfse, setOpenGerarNfse] = useState(false);
  const [generatingEntryParams, setGeneratingEntryParams] = useState(false);
  const [ambienteEmpresa, setAmbienteEmpresa] = useState<string | null>(null);
  const [openCancelNfseDialog, setOpenCancelNfseDialog] = useState(false);
  const [selectedNfseId, setSelectedNfseId] = useState<number | null>(null);
  const [downloadingXmlId, setDownloadingXmlId] = useState<number | null>(null);

  const origem = osId ? "OS" : vendaId ? "VENDA" : entradaId ? "ENTRADA" : null;
  const origemId = osId ?? vendaId ?? entradaId ?? null;

  const canFetch = open && !!origem && !!origemId;

  const endpointListar = useMemo(() => {
    if (!origem || !origemId) return null;
    if (origem === "OS") return `/api/nfe/por-os/${origemId}`;
    if (origem === "VENDA") return `/api/nfe/por-venda/${origemId}`;
    return `/api/nfe/por-entrada/${origemId}`;
  }, [origem, origemId]);

  const baixarXmlNfe = async (nfe: NfeResumo) => {
    if (downloadingXmlId === nfe.id) return;

    const toastId = toast.loading("Preparando XML da NF-e...");
    setDownloadingXmlId(nfe.id);

    try {
      const response = await fetch(`/api/fiscal/notas-emitidas/${nfe.id}/xml`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || body?.error || "Não foi possível baixar o XML da NF-e.");
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const fallbackName = `nfe-${nfe.chave_acesso || nfe.id}.xml`;
      const filename = filenameMatch?.[1] || fallbackName;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success("XML da NF-e baixado com sucesso.", { id: toastId });
    } catch (error: any) {
      toast.error("Não foi possível baixar o XML da NF-e.", {
        id: toastId,
        description: error?.message,
      });
    } finally {
      setDownloadingXmlId(null);
    }
  };

  /**
   * Busca NF-e da origem (OS/Venda) no backend.
   */
  const fetchNfes = async (signal?: AbortSignal) => {
    if (!endpointListar) return;

    setLoading(true);
    try {
      const res = await fetch(endpointListar, {
        method: "GET",
        signal,
      });

      const json = (await res.json().catch(() => null)) as
        | ListarNfeResponsePorOs
        | ListarNfeResponsePorVenda
        | ListarNfeResponsePorEntrada
        | null;

      if (!res.ok || !json?.ok) {
        const msg = (json as any)?.message || `Erro ao buscar NF-e (HTTP ${res.status}).`;
        throw new Error(msg);
      }

      let fetchedNfes = (json as any).nfes ?? [];

      if (origem === "OS" && osId) {
        const nfseRes = await fetch(`/api/nfse/por-os/${osId}`, { signal });
        const nfseJson = await nfseRes.json().catch(() => null);
        const mappedNfses = (nfseJson?.nfses ?? []).map((n: any) => ({
          id: n.id,
          modelo: "NFSE",
          serie: null,
          numero: n.numero || null,
          chave_acesso: n.referencia,
          ambiente: "Produção / Sefaz",
          status: n.status || null,
          ordemservicoid: n.ordemservicoid,
          vendaid: null,
          clienteid: n.clienteid,
          dataemissao: n.dataemissao,
          dataautorizacao: n.status === "AUTORIZADO" ? n.updatedat : null,
          protocolo: n.protocolo || null,
          total_produtos: 0,
          total_servicos: n.valor_total || 0,
          total_nfe: n.valor_total || 0,
          justificativacancelamento: n.erros ? JSON.stringify(n.erros) : null,
          createdat: n.createdat,
          empresaid: n.empresaid,
          url_pdf: n.url_pdf,
        }));
        fetchedNfes = [...fetchedNfes, ...mappedNfses].sort(
          (a, b) => new Date(b.createdat || 0).getTime() - new Date(a.createdat || 0).getTime(),
        );
      }

      if (!signal?.aborted) {
        setNfes(fetchedNfes);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error(e);
      if (!signal?.aborted) {
        toast.error(e?.message || "Erro ao carregar NF-e.");
        setNfes([]);
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const fetchEmpresa = async () => {
    try {
      const res = await fetch("/api/empresa");
      const json = await res.json();
      if (json.ok && json.empresas?.length > 0) {
        setAmbienteEmpresa(json.empresas[0].ambiente);
      }
    } catch (e) {
      console.error("Erro ao buscar ambiente da empresa:", e);
    }
  };

  useEffect(() => {
    if (!canFetch) return;

    const ac = new AbortController();
    fetchNfes(ac.signal);
    fetchEmpresa();

    return () => {
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, endpointListar]);

  /**
   * Assina atualizações em tempo real para as notas desta OS
   */
  useEffect(() => {
    if (!open || !osId) return;

    console.log(`[EmissaoNotaDialog] Subscribing to NFSe for OS #${osId}`);

    const channel = supabase
      .channel(`nfse-os-${osId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "nfse",
          filter: `ordemservicoid=eq.${osId}`,
        },
        () => {
          console.log(`[EmissaoNotaDialog] Update detected on NFSe for OS #${osId}. Refreshing...`);
          fetchNfes();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, osId]);

  const titulo = useMemo(() => {
    if (!origem || !origemId) return "Emissão de Nota Fiscal";
    if (origem === "OS") return `Emissão de Nota Fiscal - OS #${origemId}`;
    if (origem === "VENDA") return `Emissão de Nota Fiscal - Venda #${origemId}`;
    return `Emissão de Nota Fiscal - Entrada #${origemId}`;
  }, [origem, origemId]);

  const handleGerarNotaEntrada = async () => {
    if (!entradaId) return;
    try {
      setGeneratingEntryParams(true);
      const res = await fetch(`/api/nfe/de-entrada/${entradaId}/gerar-rascunho`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json.message || "Erro ao gerar nota da entrada");
        return;
      }

      toast.success("Rascunho criado com sucesso!");
      fetchNfes();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar nota.");
    } finally {
      setGeneratingEntryParams(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setNfes([]);
        }
      }}
    >
      <DialogContent
        className="
          w-[95vw] sm:max-w-3xl
          max-h-[85vh] sm:max-h-[85vh] supports-[height:100svh]:max-h-[85svh]
          overflow-y-auto overscroll-contain min-h-[85vh]
          p-0
        "
      >
        <div className="top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 hover:cursor-pointer"
              aria-label="Fechar"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>

          <DialogHeader className="px-5 pt-5 pb-3 border-b-1">
            <DialogTitle className="flex items-center justify-between gap-2 pr-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" />
                {titulo}
              </div>

              {ambienteEmpresa && (
                <Badge
                  variant="outline"
                  className={`text-[10px] uppercase font-bold py-0 h-5 ${
                    ambienteEmpresa === "PRODUCAO"
                      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-600 border-amber-500/30"
                  }`}
                >
                  Ambiente: {ambienteEmpresa === "PRODUCAO" ? "PRODUÇÃO" : "HOMOLOGAÇÃO"}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>Visualize as NF-e vinculadas e gere novas NF-e a partir dos produtos.</DialogDescription>

            {!!origemId && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  disabled={loading}
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNfes()}
                  className="h-8 gap-2 text-xs hover:cursor-pointer"
                >
                  <RotateCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  Recarregar
                </Button>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={loading || generatingEntryParams}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (origem === "ENTRADA") {
                        handleGerarNotaEntrada();
                      } else {
                        setOpenGerarNfe(true);
                      }
                    }}
                    className="h-8 gap-2 text-xs hover:cursor-pointer"
                  >
                    {generatingEntryParams && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <Plus className={generatingEntryParams ? "hidden" : "h-3.5 w-3.5"} /> NF-e (Produto)
                  </Button>

                  {origem === "OS" && (
                    <Button
                      disabled={loading || generatingEntryParams}
                      variant="secondary"
                      size="sm"
                      onClick={() => setOpenGerarNfse(true)}
                      className="h-8 gap-2 text-xs hover:cursor-pointer"
                    >
                      <Plus className="h-4 w-4 mr-1" /> NFS-e (Serviço)
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="pt-5 pb-5 space-y-4 relative">
            <div
              className={`${
                origemId && loading && "opacity-100"
              } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
            >
              <div
                className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
                  origemId && loading && "animate-slideIn "
                }`}
              ></div>
            </div>

            {!origemId && (
              <div className="h-24 grid place-items-center text-sm text-muted-foreground">
                Nenhuma origem selecionada.
              </div>
            )}

            {!!origemId && !loading && nfes && nfes.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-sm flex gap-3 mx-5">
                <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="font-medium">Nenhuma NF-e encontrada</div>
                  <div className="text-muted-foreground text-xs">
                    Clique em <b>Nova Nota</b> para gerar um rascunho a partir dos produtos.
                  </div>
                </div>
              </div>
            )}

            {!!origemId && nfes && nfes.length > 0 && (
              <div className="px-5">
                <ul className="text-sm">
                  {nfes.map((nfe, idx) => {
                    const statusUpper = (nfe.status || "").toUpperCase();
                    const statusClass = nfeStatusClasses[statusUpper] || "bg-muted/40";

                    const isAutorizada =
                      statusUpper === "AUTORIZADA" || statusUpper === "AUTORIZADO" || statusUpper === "EMITIDA";
                    const isRejeitada = statusUpper === "REJEITADA";
                    const isCancelada = statusUpper === "CANCELADA" || statusUpper === "CANCELADO";
                    const isProcessing = statusUpper === "PROCESSANDO" || statusUpper === "PROCESSANDO_AUTORIZACAO";

                    const observacao = buildObservacao(nfe);

                    return (
                      <li key={`${nfe.modelo}-${nfe.id}`}>
                        {idx > 0 && <Separator className="my-3" />}

                        <div className="flex items-start p-3 hover:bg-muted/15 rounded-xl relative">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                className="text-xs hover:cursor-pointer absolute top-2 right-2"
                                size="sm"
                              >
                                <Ellipsis className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>

                            <DropdownMenuContent>
                              {nfe.modelo === "NFSE" ? (
                                <div className="flex flex-col gap-1">
                                  <Button
                                    className="text-xs hover:cursor-pointer"
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                      toast(
                                        <div className="flex flex-row flex-nowrap items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                          <span>Consultando NFS-e</span>
                                        </div>,
                                      );
                                      const res = await fetch(`/api/nfse/consultar/${nfe.id}`, { method: "POST" });
                                      const json = await res.json().catch(() => null);
                                      if (!res.ok || !json?.ok) {
                                        toast.error(json?.message || "Erro ao consultar NFS-e.");
                                        return;
                                      }
                                      toast.success(`SEFAZ (API Focus): ${json.status || ""}`);
                                      fetchNfes();
                                    }}
                                  >
                                    Consultar NFS-e
                                  </Button>

                                  {isAutorizada && (
                                    <Button
                                      className="text-xs hover:cursor-pointer text-destructive border-destructive"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedNfseId(nfe.id);
                                        setOpenCancelNfseDialog(true);
                                      }}
                                    >
                                      Cancelar NFS-e
                                    </Button>
                                  )}

                                  {nfe.url_pdf && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-xs hover:cursor-pointer"
                                      onClick={() => window.open(nfe.url_pdf, "_blank")}
                                    >
                                      Baixar NFS-e (PDF)
                                    </Button>
                                  )}

                                  {!nfe.url_pdf && statusUpper === "CANCELADA" && (
                                    <span className="text-xs px-2 py-1 text-muted-foreground text-center">
                                      Nota Cancelada.
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {nfe.status === "RASCUNHO" && (
                                    <div className="flex flex-col gap-1">
                                      <AutorizarNfeButton
                                        nfeId={nfe.id}
                                        size="sm"
                                        variant="outline"
                                        className="text-xs hover:cursor-pointer"
                                        onAfterAuthorize={() => fetchNfes()}
                                      >
                                        Autorizar NF-e
                                      </AutorizarNfeButton>

                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/danfe`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Ver DANFE
                                      </Button>

                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/editor`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Editar XML
                                      </Button>

                                      <ExcluirRascunhoNfeButton
                                        nfeId={nfe.id}
                                        status={nfe.status ?? ""}
                                        onAfterDelete={() => fetchNfes()}
                                      />
                                    </div>
                                  )}

                                  {isAutorizada && (
                                    <div className="flex flex-col gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/danfe`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Ver DANFE
                                      </Button>

                                      <Button
                                        className="text-xs hover:cursor-pointer"
                                        variant="outline"
                                        size="sm"
                                        disabled={downloadingXmlId === nfe.id}
                                        onClick={() => void baixarXmlNfe(nfe)}
                                      >
                                        {downloadingXmlId === nfe.id ? (
                                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Download className="mr-1.5 h-3.5 w-3.5" />
                                        )}
                                        Baixar XML
                                      </Button>

                                      <Button
                                        className="text-xs hover:cursor-pointer"
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          toast(
                                            <div className="flex flex-row flex-nowrap items-center gap-2">
                                              <Loader2 className="w-4 h-4 animate-spin" />
                                              <span>Consultando Nota Fiscal</span>
                                            </div>,
                                          );

                                          const res = await fetch(`/api/nfe/consultar/${nfe.id}`, { method: "POST" });
                                          const json = await res.json().catch(() => null);

                                          if (!res.ok || !json?.ok) {
                                            toast.error(json?.message || "Erro ao consultar NF-e na SEFAZ.");
                                            return;
                                          }

                                          toast.success(`SEFAZ: ${json.sefaz?.cStat} - ${json.sefaz?.xMotivo || ""}`);
                                        }}
                                      >
                                        Consultar NF-e
                                      </Button>

                                      <CancelarNfeButton
                                        nfeId={nfe.id}
                                        status={nfe.status ?? ""}
                                        onAfterCancel={() => fetchNfes()}
                                      />
                                    </div>
                                  )}

                                  {nfe.status === "CANCELADA" && (
                                    <div className="flex flex-col gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs hover:cursor-pointer"
                                        onClick={() =>
                                          window.open(`/nfe/${nfe.id}/danfe`, "_blank", "noopener,noreferrer")
                                        }
                                      >
                                        Ver DANFE
                                      </Button>

                                      <Button
                                        className="text-xs hover:cursor-pointer"
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          toast(
                                            <div className="flex flex-row flex-nowrap items-center gap-2">
                                              <Loader2 className="w-4 h-4 animate-spin" />
                                              <span>Consultando Nota Fiscal</span>
                                            </div>,
                                          );

                                          const res = await fetch(`/api/nfe/consultar/${nfe.id}`, { method: "POST" });
                                          const json = await res.json().catch(() => null);

                                          if (!res.ok || !json?.ok) {
                                            toast.error(json?.message || "Erro ao consultar NF-e na SEFAZ.");
                                            return;
                                          }

                                          toast.success(`SEFAZ: ${json.sefaz?.cStat} - ${json.sefaz?.xMotivo || ""}`);
                                        }}
                                      >
                                        Consultar NF-e
                                      </Button>
                                    </div>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <div className="mr-1.5">
                            {isAutorizada ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                            ) : isRejeitada ? (
                              <XCircle className="h-5 w-5 text-red-400" />
                            ) : isCancelada ? (
                              <AlertCircle className="h-5 w-5 text-amber-400" />
                            ) : isProcessing ? (
                              <Loader2 className="h-5 w-5 text-sky-400 animate-spin" />
                            ) : (
                              <Info className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium">
                                {nfe.modelo === "NFSE" ? "NFS-e" : "NF-e"} {nfe.numero ?? "—"}
                                {nfe.serie ? `/Série ${nfe.serie}` : ""}
                              </div>

                              <Badge className={statusClass}>{statusUpper || "—"}</Badge>

                              {nfe.ambiente && (
                                <Badge variant="outline" className="text-[10px]">
                                  {nfe.ambiente}
                                </Badge>
                              )}
                            </div>

                            <div className="text-xs text-muted-foreground space-y-0.5">
                              <div>
                                <span className="text-xs text-muted-foreground">ID: {nfe.id}</span> Emissão:{" "}
                                {fmtDate(nfe.dataemissao)}{" "}
                                {nfe.dataautorizacao && (
                                  <>
                                    {" · "}Autorização: {fmtDate(nfe.dataautorizacao)}
                                  </>
                                )}{" "}
                                {" · "}Total NF-e: <b>{fmtMoney(nfe.total_nfe)}</b>
                              </div>

                              {nfe.chave_acesso && (
                                <div className="break-all">
                                  Chave de acesso: <span className="font-mono text-[11px]">{nfe.chave_acesso}</span>
                                </div>
                              )}

                              {nfe.protocolo && <div>Protocolo: {nfe.protocolo}</div>}
                            </div>

                            <div className="mt-2 text-xs">
                              <span className="font-medium">Observações: </span>
                              <span className="text-muted-foreground">{observacao}</span>
                            </div>

                            {nfe.createdat && (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Registrada em: {fmtDate(nfe.createdat)}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        {!!origemId && (
          <GerarNotaDeOsDialog
            open={openGerarNfe}
            onOpenChange={(v) => {
              setOpenGerarNfe(v);
              if (!v) fetchNfes();
            }}
            osId={osId ?? null}
            vendaId={vendaId ?? null}
            onAfterGenerate={() => fetchNfes()}
          />
        )}

        {!!origemId && origem === "OS" && (
          <EmissaoNfseDialog
            open={openGerarNfse}
            onOpenChange={(v) => {
              setOpenGerarNfse(v);
              if (!v) fetchNfes();
            }}
            osId={osId ?? null}
            onAfterGenerate={() => fetchNfes()}
          />
        )}

        <CancelarNotaDialog
          open={openCancelNfseDialog}
          onOpenChange={setOpenCancelNfseDialog}
          tipo="NFSE"
          id={selectedNfseId ?? 0}
          onSuccess={() => fetchNfes()}
        />
      </DialogContent>
    </Dialog>
  );
}
