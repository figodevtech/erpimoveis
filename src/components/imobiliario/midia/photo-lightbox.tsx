"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { downloadImage, photoFileName } from "./download";

export type LightboxPhoto = {
  key: string;
  src: string;
  nome?: string;
  /** Ainda no computador, não enviada: não há o que baixar do servidor. */
  pending?: boolean;
};

/** Foto inteira, sem corte, com navegação pelas setas da tela ou do teclado. */
export function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: LightboxPhoto[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const open = index != null && photos.length > 0;
  const current = open ? photos[Math.min(index, photos.length - 1)] : null;
  const position = open ? Math.min(index, photos.length - 1) : 0;
  const many = photos.length > 1;
  const go = (step: number) => onIndexChange((position + step + photos.length) % photos.length);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92dvh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden border-none bg-black/95 p-0 text-white sm:max-w-[96vw]"
        onKeyDown={(event) => {
          if (!many) return;
          if (event.key === "ArrowRight") go(1);
          if (event.key === "ArrowLeft") go(-1);
        }}
      >
        <DialogTitle className="sr-only">
          Foto {position + 1} de {photos.length}
        </DialogTitle>
        <DialogDescription className="sr-only">Use as setas para ver as outras fotos.</DialogDescription>

        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <p className="min-w-0 truncate text-sm text-white/80">
            <span className="font-semibold text-white">
              {position + 1} de {photos.length}
            </span>
            {current?.nome ? <span className="ml-2">· {current.nome}</span> : null}
            {current?.pending ? <span className="ml-2 text-amber-300">· Pendente de envio</span> : null}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {current && !current.pending ? (
              <button
                type="button"
                disabled={downloading}
                onClick={async () => {
                  setDownloading(true);
                  try {
                    await downloadImage(current.src, photoFileName(position + 1, current.src, current.nome));
                  } finally {
                    setDownloading(false);
                  }
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-white/10 disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Baixar
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-md hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current.key}
              src={current.src}
              alt={current.nome ?? `Foto ${position + 1}`}
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
            />
          ) : null}

          {many ? (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Foto anterior"
                className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:left-4"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Próxima foto"
                className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:right-4"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
