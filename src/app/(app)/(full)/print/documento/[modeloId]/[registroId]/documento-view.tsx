"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileWarning, Pencil, Power, Printer, Undo2 } from "lucide-react";

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

const CONFIRMAR_DESCARTE = "As alterações feitas neste documento serão perdidas. Continuar?";

export function DocumentoView({ voltar, titulo, html, aviso }: Props) {
  const folha = useRef<FolhaDocumentoHandle>(null);
  // O texto editado vale só para esta impressão: não volta ao modelo nem ao registro.
  const [atual, setAtual] = useState(html ?? "");
  const [editando, setEditando] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const imprimirAoCarregar = useRef(false);

  const concluir = useCallback(() => {
    const editado = folha.current?.htmlAtual();
    if (editado) setAtual(editado);
    setEditando(false);
  }, []);

  // Em edição o documento corre contínuo; a impressão sai das folhas
  // paginadas, então conclui antes e imprime quando o frame novo carregar.
  const imprimir = useCallback(() => {
    if (!editando) return folha.current?.imprimir();
    imprimirAoCarregar.current = true;
    concluir();
  }, [concluir, editando]);

  const aoCarregar = useCallback(() => {
    if (editando || !imprimirAoCarregar.current) return;
    imprimirAoCarregar.current = false;
    folha.current?.imprimir();
  }, [editando]);

  function desfazer() {
    if (!window.confirm(CONFIRMAR_DESCARTE)) return;
    setAtual(html ?? "");
    setAlterado(false);
    setEditando(false);
  }

  // Ctrl+P fora do frame também imprime as folhas, não a tela.
  useEffect(() => {
    if (!html) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        imprimir();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [html, imprimir]);

  // Fechar ou recarregar a aba com o documento alterado pede confirmação.
  useEffect(() => {
    if (!alterado) return;
    const aoSair = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [alterado]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 text-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-slate-100/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[210mm] items-center justify-between gap-2 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-700">{titulo ?? "Documento"}</span>
            {alterado ? (
              <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                Editado
              </span>
            ) : null}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
              <Link
                href={voltar}
                onClick={(e) => {
                  if (alterado && !window.confirm(CONFIRMAR_DESCARTE)) e.preventDefault();
                }}
              >
                <Power className="h-3 w-3" />
                Sair
              </Link>
            </Button>
            {html ? (
              <>
                {alterado ? (
                  <Button size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS} onClick={desfazer}>
                    <Undo2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Desfazer</span>
                  </Button>
                ) : null}
                {editando ? (
                  <Button size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS} onClick={concluir}>
                    <Check className="h-4 w-4" />
                    <span className="hidden sm:inline">Concluir</span>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS} onClick={() => setEditando(true)}>
                    <Pencil className="h-4 w-4" />
                    <span className="hidden sm:inline">Editar texto</span>
                  </Button>
                )}
                <Button size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS} onClick={imprimir}>
                  <Printer className="h-4 w-4" />
                  <span className="hidden sm:inline">Imprimir</span>
                </Button>
              </>
            ) : null}
          </div>
        </div>
        {editando ? (
          <p className="mx-auto w-full max-w-[210mm] px-3 pb-2 text-xs text-slate-600">
            Clique em qualquer texto para apagar ou escrever. A alteração vale só para esta impressão: o modelo e o
            registro não mudam. Ao concluir, o documento volta a ser dividido em folhas.
          </p>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-[210mm] px-3 py-5">
        {html ? (
          <FolhaA4
            ref={folha}
            html={atual}
            titulo={titulo ?? "Documento"}
            editavel={editando}
            onAlterado={() => setAlterado(true)}
            onPedirImpressao={imprimir}
            onCarregado={aoCarregar}
          />
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
