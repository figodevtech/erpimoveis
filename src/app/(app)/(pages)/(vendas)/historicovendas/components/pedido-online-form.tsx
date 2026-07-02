"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link as LinkIcon, Loader2, Paperclip, Truck } from "lucide-react";
import { toast } from "sonner";

type TrackingEvent = {
  at: string | null;
  title: string;
  location?: string | null;
  details?: string | null;
};

type VendaOnlineData = {
  id: number;
  canal?: string | null;
  status?: string | null;
  status_entrega?: "SEPARACAO" | "ENVIO" | "ENTREGUE" | null;
  codigo_rastreio?: string | null;
  transportadora_rastreio?: string | null;
  ultimo_evento_rastreio?: string | null;
  ultimo_evento_rastreio_em?: string | null;
  status_rastreio?: string | null;
  eventos_rastreio?: TrackingEvent[] | null;
  rastreio_atualizado_em?: string | null;
  nfe_chave_acesso?: string | null;
  danfe_url?: string | null;
};

function formatPtBR(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function entregaBadge(statusEntrega?: string | null) {
  const s = String(statusEntrega ?? "").toUpperCase();
  const label = s || "NAO_INICIADA";
  if (label === "ENTREGUE") return <Badge className="bg-emerald-600 text-white text-xs">ENTREGUE</Badge>;
  if (label === "ENVIO") return <Badge className="bg-indigo-600 text-white text-xs">ENVIO</Badge>;
  if (label === "SEPARACAO") return <Badge className="bg-sky-600 text-white text-xs">SEPARACAO</Badge>;
  return (
    <Badge variant="outline" className="text-xs">
      {label}
    </Badge>
  );
}

export function PedidoOnlineForm({
  vendaId,
  open,
  exposeSave,
  onSavingChange,
  onDataChange,
  onDone,
  onSaved,
}: {
  vendaId: number | null;
  open: boolean;
  exposeSave: (fn: () => Promise<void>) => void;
  onSavingChange: (saving: boolean) => void;
  onDataChange: (
    data: {
      id: number;
      status?: string | null;
      status_entrega?: string | null;
      ultimo_evento_rastreio?: string | null;
    } | null,
  ) => void;
  onDone: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uploadingDanfe, setUploadingDanfe] = useState(false);

  const [data, setData] = useState<VendaOnlineData | null>(null);

  const canEdit = useMemo(() => isMarketplaceCanal(data?.canal), [data?.canal]);
  const [codigoRastreio, setCodigoRastreio] = useState("");
  const [transportadora, setTransportadora] = useState("CORREIOS");
  const [nfeChave, setNfeChave] = useState("");
  const [danfeUrl, setDanfeUrl] = useState("");
  const [danfeFileInputKey, setDanfeFileInputKey] = useState(0);
  const danfeInputRef = useRef<HTMLInputElement | null>(null);

  const correiosTrackingUrl = useMemo(() => {
    const code = codigoRastreio.trim();
    if (!code) return null;
    return `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(code)}`;
  }, [codigoRastreio]);

  const refreshVenda = async () => {
    if (!vendaId) return;
    const res = await fetch(`/api/venda/${vendaId}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Erro ao carregar pedido de marketplace.");

    const v = json?.data as VendaOnlineData;
    setData(v);
    setCodigoRastreio(v?.codigo_rastreio ?? "");
    setTransportadora(String(v?.transportadora_rastreio ?? "CORREIOS").toUpperCase());
    setNfeChave(v?.nfe_chave_acesso ?? "");
    setDanfeUrl(v?.danfe_url ?? "");
  };

  const handleUploadDanfe = async (file: File) => {
    if (!vendaId) return;
    if (!canEdit) {
      toast.error("Este pedido nao e de marketplace.");
      return;
    }

    setUploadingDanfe(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const r = await fetch(`/api/venda/${vendaId}/danfe/upload`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Falha ao anexar DANFE.");

      const url = String(j?.danfeUrl ?? j?.danfe_url ?? j?.url ?? "");
      if (url) setDanfeUrl(url);

      toast.success("DANFE anexada.");
      await refreshVenda();
    } catch (e: any) {
      toast.error("Nao foi possivel anexar a DANFE", { description: e?.message });
    } finally {
      setUploadingDanfe(false);
      // limpa input para permitir selecionar o mesmo arquivo novamente
      setDanfeFileInputKey((k) => k + 1);
    }
  };

  useEffect(() => {
    setSaving(false);
    setChecking(false);
  }, [open, vendaId]);

  useEffect(() => {
    onSavingChange(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    // no-op: checking is used locally (button inside the form)
  }, [checking]);

  useEffect(() => {
    onDataChange(
      data
        ? {
            id: data.id,
            status: data.status,
            status_entrega: data.status_entrega,
            ultimo_evento_rastreio: data.ultimo_evento_rastreio,
          }
        : null,
    );
  }, [data, onDataChange]);

  useEffect(() => {
    if (!open || !vendaId) return;
    const run = async () => {
      setLoading(true);
      try {
        await refreshVenda();
      } catch (e: any) {
        toast.error("Erro ao carregar pedido", { description: e?.message });
        setData(null);
      } finally {
        setLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendaId]);

  const handleSave = async () => {
    if (!vendaId) return;
    if (!canEdit) {
      toast.error("Este pedido nao e de marketplace.");
      return;
    }
    if (nfeChave.trim() && nfeChave.trim().length !== 44) {
      toast.error("A chave de acesso da NF-e deve ter 44 digitos.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/venda/${vendaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigoRastreio: codigoRastreio.trim() || null,
          transportadoraRastreio: transportadora.trim() || null,
          nfeChaveAcesso: nfeChave.trim() || null,
          danfeUrl: danfeUrl.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Erro ao salvar pedido.");

      toast.success("Pedido de marketplace atualizado.");
      await refreshVenda();
      onSaved();
      onDone();
    } catch (e: any) {
      toast.error("Nao foi possivel salvar", { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const handleCheckTracking = async (opts?: { silent?: boolean }) => {
    if (!vendaId) return;
    if (!codigoRastreio.trim()) {
      if (!opts?.silent) toast.error("Informe o codigo de rastreio.");
      return;
    }
    if (!canEdit) {
      if (!opts?.silent) toast.error("Este pedido nao e de marketplace.");
      return;
    }

    setChecking(true);
    try {
      // persistir codigo/transportadora antes de consultar
      await fetch(`/api/venda/${vendaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigoRastreio: codigoRastreio.trim() || null,
          transportadoraRastreio: transportadora.trim() || "CORREIOS",
        }),
      });

      const res = await fetch("/api/rastreio/consultar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendaId, transportadora }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Erro ao consultar rastreio.");

      await refreshVenda();

      if (!opts?.silent) {
        if (json?.warning) toast.warning("Rastreio atualizado com aviso", { description: String(json.warning) });
        else toast.success("Rastreio atualizado.");
      }
    } catch (e: any) {
      if (!opts?.silent) toast.error("Nao foi possivel consultar o rastreio", { description: e?.message });
    } finally {
      setChecking(false);
    }
  };

  // expor acoes para o footer do DialogShell
  useEffect(() => {
    exposeSave(handleSave);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendaId, canEdit, codigoRastreio, transportadora, nfeChave, danfeUrl]);

  // Consulta de rastreio e atualizacao de status_entrega sao manuais (botao "Consultar rastreio").

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Truck className="h-4 w-4 text-muted-foreground" />
        Carregando...
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Nao foi possivel carregar o pedido.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Entrega & rastreio</CardTitle>
              <button
                type="button"
                onClick={() => handleCheckTracking()}
                disabled={checking || !canEdit || !codigoRastreio.trim()}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                {checking ? "Consultando..." : "Consultar rastreio"}
              </button>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Transportadora</Label>
                  <Select value={transportadora} onValueChange={setTransportadora} disabled={!canEdit}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CORREIOS">Correios</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Codigo de rastreio</Label>
                  <Input
                    value={codigoRastreio}
                    onChange={(e) => setCodigoRastreio(e.target.value)}
                    placeholder="Ex: AM101610575BR"
                    disabled={!canEdit}
                  />
                  {correiosTrackingUrl && (
                    <a
                      href={correiosTrackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <LinkIcon className="h-3 w-3" />
                      Abrir nos Correios
                    </a>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Truck className="h-4 w-4" />
                    <span>Rastreio</span>
                  </div>
                  <div className="mt-1 font-medium">Atualizado em: {formatPtBR(data.rastreio_atualizado_em)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Evento em: {formatPtBR(data.ultimo_evento_rastreio_em)}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Status da entrega</Label>
                  <div className="h-10 flex items-center">{entregaBadge(data.status_entrega)}</div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">Eventos</div>
                <ScrollArea className="h-48 rounded-md border">
                  <div className="space-y-2 p-3">
                    {(data.eventos_rastreio ?? []).length === 0 ? (
                      <div className="text-sm text-muted-foreground">Sem eventos de rastreio no momento.</div>
                    ) : (
                      (data.eventos_rastreio ?? []).map((ev, idx) => (
                        <div key={idx} className="rounded-md border bg-card p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">{ev.title}</div>
                            <div className="text-xs text-muted-foreground">{formatPtBR(ev.at)}</div>
                          </div>
                          {(ev.location || ev.details) && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {[ev.location, ev.details].filter(Boolean).join(" - ")}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Nota fiscal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="space-y-2">
                <Label>Chave NF-e (44 digitos)</Label>
                <Input
                  value={nfeChave}
                  onChange={(e) => setNfeChave(e.target.value)}
                  placeholder="Somente numeros"
                  inputMode="numeric"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label>DANFE (PDF)</Label>
                <div className="flex items-center gap-2">
                  <input
                    key={danfeFileInputKey}
                    ref={danfeInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadDanfe(f);
                    }}
                    disabled={!canEdit || uploadingDanfe}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full bg-transparent"
                    disabled={!canEdit || uploadingDanfe}
                    onClick={() => danfeInputRef.current?.click()}
                  >
                    {uploadingDanfe ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Paperclip className="mr-2 h-4 w-4" />
                        Anexar DANFE (PDF)
                      </>
                    )}
                  </Button>
                </div>

                {danfeUrl.trim() ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-muted-foreground">Link</div>
                        <div className="truncate font-medium">{danfeUrl.trim()}</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="bg-transparent"
                        onClick={async () => {
                          const url = danfeUrl.trim();
                          try {
                            await navigator.clipboard.writeText(url);
                            toast.success("Link copiado.");
                          } catch {
                            toast.error("Nao foi possivel copiar o link.");
                          }
                        }}
                      >
                        Copiar
                      </Button>
                    </div>
                    <a
                      href={danfeUrl.trim()}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <LinkIcon className="h-3 w-3" />
                      Abrir DANFE
                    </a>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">Nenhuma DANFE anexada.</div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground leading-relaxed">
            O status da entrega e atualizado automaticamente conforme o ultimo evento do rastreio.
          </div>
        </div>
      </div>
    </div>
  );
}

function isMarketplaceCanal(canal: unknown) {
  const value = String(canal ?? "").toUpperCase();
  return value === "ONLINE" || value === "MERCADO_LIVRE" || value === "SHOPEE";
}
