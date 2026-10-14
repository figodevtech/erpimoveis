"use client";

import Link from "next/link";
import { useRef } from "react";
import { FileWarning, Power, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FolhaA4 } from "@/components/documentos/folha-a4";
import type { FolhaDocumentoHandle } from "@/components/documentos/folha-documento";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";

type Props = {
  voltar: string;
  titulo?: string;
  html?: string;
  /** Em vez do documento, um aviso (modelo excluído ou desativado). */
  aviso?: string;
};

export function DocumentoView({ voltar, titulo, html, aviso }: Props) {
  const folha = useRef<FolhaDocumentoHandle>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 text-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-slate-100/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[210mm] items-center justify-between gap-2 px-3 py-2.5">
          <span className="truncate text-sm font-medium text-slate-700">{titulo ?? "Documento"}</span>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
              <Link href={voltar}>
                <Power className="h-3 w-3" />
                Sair
              </Link>
            </Button>
            {html ? (
              <Button size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS} onClick={() => folha.current?.imprimir()}>
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[210mm] px-3 py-5">
        {html ? (
          <FolhaA4 ref={folha} html={html} titulo={titulo ?? "Documento"} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md bg-white p-10 text-center shadow-lg">
            <FileWarning className="h-8 w-8 text-amber-500" />
            <p className="text-sm text-slate-700">{aviso}</p>
          </div>
        )}
      </div>
    </div>
  );
}
