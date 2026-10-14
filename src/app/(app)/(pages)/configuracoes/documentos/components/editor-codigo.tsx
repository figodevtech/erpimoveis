"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type EditorCodigoHandle = {
  /** Insere no cursor (ou no lugar da seleção) e devolve o foco ao editor. */
  inserir: (trecho: string) => void;
};

type Props = {
  value: string;
  onChange: (valor: string) => void;
  readOnly?: boolean;
  limite: number;
};

const INDENTACAO = "  ";

/**
 * Textarea de código com numeração de linhas. Sem quebra automática: a linha
 * do número e a do texto ficam sempre alinhadas.
 *
 * A inserção passa por `execCommand("insertText")` quando o navegador aceita:
 * assim ela entra no histórico do campo e o Ctrl+Z desfaz a variável inserida.
 */
export const EditorCodigo = forwardRef<EditorCodigoHandle, Props>(function EditorCodigo(
  { value, onChange, readOnly, limite },
  ref,
) {
  const campo = useRef<HTMLTextAreaElement>(null);
  const numeros = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ linha: 1, coluna: 1 });

  const totalLinhas = useMemo(() => value.split("\n").length, [value]);

  function atualizarCursor() {
    const el = campo.current;
    if (!el) return;
    const antes = el.value.slice(0, el.selectionStart);
    const linhas = antes.split("\n");
    setCursor({ linha: linhas.length, coluna: linhas[linhas.length - 1].length + 1 });
  }

  function escrever(trecho: string) {
    const el = campo.current;
    if (!el || readOnly) return;
    el.focus();
    const aceito = typeof document.execCommand === "function" && document.execCommand("insertText", false, trecho);
    if (!aceito) {
      const inicio = el.selectionStart;
      const fim = el.selectionEnd;
      onChange(el.value.slice(0, inicio) + trecho + el.value.slice(fim));
      requestAnimationFrame(() => el.setSelectionRange(inicio + trecho.length, inicio + trecho.length));
    }
    requestAnimationFrame(atualizarCursor);
  }

  useImperativeHandle(ref, () => ({ inserir: escrever }));

  const excedeu = value.length > limite;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background font-mono text-[12.5px] leading-5">
        <div
          ref={numeros}
          aria-hidden="true"
          className="pointer-events-none shrink-0 select-none overflow-hidden border-r bg-muted/40 pb-8 pt-3 pl-3 pr-2 text-right text-muted-foreground/70 tabular-nums"
        >
          {Array.from({ length: totalLinhas }, (_, i) => (
            <div key={i} className={cn(i + 1 === cursor.linha && "font-semibold text-foreground")}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={campo}
          value={value}
          readOnly={readOnly}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="HTML do documento"
          aria-describedby="editor-codigo-ajuda"
          onChange={(e) => {
            onChange(e.target.value);
            atualizarCursor();
          }}
          onScroll={(e) => {
            if (numeros.current) numeros.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onSelect={atualizarCursor}
          onClick={atualizarCursor}
          onKeyDown={(e) => {
            // Tab indenta; Esc devolve o Tab à navegação (o editor não prende o teclado).
            if (e.key === "Escape") {
              e.currentTarget.blur();
              return;
            }
            if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !readOnly) {
              e.preventDefault();
              escrever(INDENTACAO);
            }
          }}
          className="min-h-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 text-foreground outline-none selection:bg-primary/20 [tab-size:2]"
        />
      </div>

      <div
        id="editor-codigo-ajuda"
        className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground"
      >
        <span className="tabular-nums">
          Ln {cursor.linha}, Col {cursor.coluna}
          <span className="mx-2 text-border">|</span>
          <span className={cn(excedeu && "font-medium text-destructive")}>
            {value.length.toLocaleString("pt-BR")} / {limite.toLocaleString("pt-BR")} caracteres
          </span>
        </span>
        <span className="hidden sm:inline">
          {readOnly ? "Somente leitura" : "Tab indenta · Esc sai do editor · Ctrl+S salva"}
        </span>
      </div>
    </div>
  );
});
