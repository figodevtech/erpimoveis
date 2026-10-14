"use client";

import { FolhaA4, type ZoomFolha } from "@/components/documentos/folha-a4";

export type ZoomPrevia = ZoomFolha;

/** A prévia do editor: a folha A4 sobre um fundo neutro, com rolagem própria. */
export function PreviaDocumento({ html, zoom, titulo }: { html: string; zoom: ZoomPrevia; titulo: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-muted/60 px-4 py-5 dark:bg-black/30">
      <FolhaA4 html={html} zoom={zoom} titulo={titulo} />
    </div>
  );
}
