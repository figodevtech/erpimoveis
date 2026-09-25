"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  id: string;
  name: string;
  access: (id: string) => Promise<{ url: string }>;
  onClose: () => void;
  initialUrl?: string;
};

export function VideoViewerDialog({ id, name, access, onClose, initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialUrl) return;
    let active = true;
    void access(id)
      .then((result) => { if (active) setUrl(result.url); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível carregar o vídeo."); });
    return () => { active = false; };
  }, [id, access, initialUrl]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[90dvh] w-[95vw] max-w-6xl flex-col gap-3 border-border/40 bg-black/95 p-3 text-white sm:max-w-6xl">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle className="truncate text-sm font-medium text-white">{name}</DialogTitle>
          <DialogDescription className="sr-only">Reproduza o vídeo anexado sem sair desta página.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-black">
          {error ? <p role="alert" className="px-4 text-center text-sm text-white">{error}</p> : url ? (
            <video src={url} controls playsInline preload="metadata" className="max-h-full max-w-full" aria-label={name} onError={() => setError("Não foi possível reproduzir este vídeo. Tente abri-lo novamente.")} />
          ) : <p role="status" className="flex items-center gap-2 text-sm text-white"><Loader2 className="size-4 animate-spin" />Carregando vídeo...</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
