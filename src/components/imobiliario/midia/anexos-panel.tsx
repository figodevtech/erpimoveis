"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
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
import {
  Download,
  ExternalLink,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FileDropZone } from "./midia-panel";

type Anexo = {
  id: number;
  nome: string;
  mime: string | null;
  tamanho: number | null;
  created_at: string;
};

type Envio = { id: string; file: File; progresso: number; erro?: string };

const MAX_BYTES = 50 * 1024 * 1024;
const EXTENSOES = ["pdf", "jpg", "jpeg", "png", "webp", "doc", "docx", "xls", "xlsx", "odt", "ods", "txt", "csv"];
const ACCEPT = EXTENSOES.map((ext) => `.${ext}`).join(",");

function apiError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 413) return "arquivo muito grande para envio.";
    return String(error.response?.data?.error ?? "").trim() || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function tamanho(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function IconeAnexo({ mime }: { mime: string | null }) {
  if (mime?.startsWith("image/")) return <FileImage className="h-5 w-5 text-sky-600" />;
  if (mime && /sheet|excel|csv/.test(mime)) return <FileSpreadsheet className="h-5 w-5 text-emerald-600" />;
  return <FileText className="h-5 w-5 text-primary" />;
}

/** Documentos privados do imóvel (escritura, contratos, plantas, planilhas). Nunca vão para o site. */
export function AnexosPanel({ imovelId, editable }: { imovelId: number; editable: boolean }) {
  const base = `/api/imoveis/${imovelId}/arquivos`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const [removendo, setRemovendo] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState<Anexo | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await axios.get(base, { params: { tipo: "DOCUMENTO" } });
      setAnexos((res.data?.items ?? []) as Anexo[]);
    } catch (error) {
      toast.error("Erro", { description: apiError(error, "Não foi possível carregar os anexos.") });
    } finally {
      setCarregando(false);
    }
  }, [base]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const enviar = async (files: File[]) => {
    if (!files.length || enviando) return;
    const fila: Envio[] = files.map((file) => {
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      const erro = !EXTENSOES.includes(ext)
        ? "formato não aceito."
        : file.size > MAX_BYTES
        ? "excede o limite de 50 MB."
        : !file.size
        ? "arquivo vazio."
        : undefined;
      return { id: crypto.randomUUID(), file, progresso: 0, erro };
    });
    setEnvios(fila);
    setEnviando(true);
    let enviados = 0;

    for (const item of fila) {
      if (item.erro) continue;
      try {
        const fd = new FormData();
        fd.append("file", item.file);
        fd.append("tipo", "DOCUMENTO");
        fd.append("titulo", item.file.name);
        await axios.post(base, fd, {
          onUploadProgress: (event) => {
            const total = event.total ?? item.file.size;
            const pct = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
            setEnvios((current) => current.map((e) => (e.id === item.id ? { ...e, progresso: pct } : e)));
          },
        });
        enviados += 1;
        setEnvios((current) => current.filter((e) => e.id !== item.id));
      } catch (error) {
        const erro = apiError(error, "falha no envio.");
        setEnvios((current) => current.map((e) => (e.id === item.id ? { ...e, progresso: 0, erro } : e)));
      }
    }

    setEnviando(false);
    if (enviados > 0) {
      toast.success(enviados === 1 ? "Anexo enviado" : `${enviados} anexos enviados`);
      await carregar();
    }
  };

  /** Pede um link novo na hora: o assinado expira em poucos minutos. */
  const abrir = async (anexo: Anexo, download: boolean) => {
    // A janela abre já no clique; depois de um await o navegador bloquearia o pop-up.
    const janela = download ? null : window.open("", "_blank");
    setAbrindo(anexo.id);
    try {
      const res = await axios.get(`${base}/${anexo.id}`, { params: download ? { download: 1 } : {} });
      const url = String(res.data?.url ?? "");
      if (!url) throw new Error("Link indisponível.");
      if (janela) janela.location.href = url;
      else window.location.assign(url);
    } catch (error) {
      janela?.close();
      toast.error("Erro", { description: apiError(error, "Não foi possível abrir o anexo.") });
    } finally {
      setAbrindo(null);
    }
  };

  const remover = async (anexo: Anexo) => {
    setRemovendo(anexo.id);
    try {
      await axios.delete(`${base}/${anexo.id}`);
      setAnexos((current) => current.filter((a) => a.id !== anexo.id));
      toast.success("Anexo excluído");
    } catch (error) {
      toast.error("Erro", { description: apiError(error, "Não foi possível excluir o anexo.") });
    } finally {
      setRemovendo(null);
      setConfirmar(null);
    }
  };

  return (
    <FileDropZone disabled={!editable || enviando} onFiles={(files) => void enviar(files)} hint="Solte os arquivos para anexar">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Anexos do imóvel</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Documentos privados: escritura, contratos, plantas, planilhas. Não aparecem no site.
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, imagens, Word, Excel, OpenDocument, TXT ou CSV, até 50 MB cada.
            </p>
          </div>

          {editable ? (
            <>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept={ACCEPT}
                multiple
                onChange={(event) => {
                  void enviar(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="gap-2 hover:cursor-pointer sm:min-w-[200px]"
                disabled={enviando}
                onClick={() => inputRef.current?.click()}
              >
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {enviando ? "Enviando..." : "Selecionar arquivos"}
              </Button>
            </>
          ) : null}
        </div>

        {envios.length > 0 ? (
          <ul className="space-y-2">
            {envios.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-2">
                <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.file.name}</p>
                  {item.erro ? (
                    <p className="text-xs text-destructive">Não enviado: {item.erro}</p>
                  ) : (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${item.progresso}%` }} />
                    </div>
                  )}
                </div>
                {item.erro ? (
                  <button
                    type="button"
                    aria-label={`Dispensar ${item.file.name}`}
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:cursor-pointer"
                    onClick={() => setEnvios((current) => current.filter((e) => e.id !== item.id))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground">{item.progresso}%</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {carregando && anexos.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando anexos...
          </div>
        ) : anexos.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center text-muted-foreground">
            <Paperclip className="h-9 w-9 opacity-25" />
            <p className="text-sm">{editable ? "Nenhum anexo. Selecione ou arraste arquivos para cá." : "Nenhum anexo."}</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {anexos.map((anexo) => (
              <li key={anexo.id} className="flex items-center gap-3 px-3 py-2.5">
                <IconeAnexo mime={anexo.mime} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={anexo.nome}>
                    {anexo.nome}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tamanho(anexo.tamanho)} · {new Date(anexo.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 hover:cursor-pointer"
                    disabled={abrindo === anexo.id}
                    onClick={() => void abrir(anexo, false)}
                    title="Abrir"
                    aria-label={`Abrir ${anexo.nome}`}
                  >
                    {abrindo === anexo.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 hover:cursor-pointer"
                    disabled={abrindo === anexo.id}
                    onClick={() => void abrir(anexo, true)}
                    title="Baixar"
                    aria-label={`Baixar ${anexo.nome}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  {editable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive hover:cursor-pointer"
                      disabled={removendo === anexo.id}
                      onClick={() => setConfirmar(anexo)}
                      title="Excluir"
                      aria-label={`Excluir ${anexo.nome}`}
                    >
                      {removendo === anexo.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={confirmar != null} onOpenChange={(open) => !open && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir anexo?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmar?.nome}” será removido permanentemente. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo != null}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removendo != null}
              onClick={(event) => {
                event.preventDefault();
                if (confirmar) void remover(confirmar);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FileDropZone>
  );
}
