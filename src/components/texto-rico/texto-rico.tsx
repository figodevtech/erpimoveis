"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { TAGS_TEXTO_RICO, pareceHtml, textoPlanoDoHtml } from "@/lib/texto-rico";

/**
 * Estilo do conteúdo, igual no editor e na leitura: espaços e quebras
 * preservados, parágrafo vazio (Enter duas vezes) com altura de uma linha e
 * listas com marcador — o reset do Tailwind tira os marcadores.
 */
export const CLASSES_TEXTO_RICO =
  "whitespace-pre-wrap break-words [&_p]:min-h-[1.25em] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>p]:min-h-0 [&_strong]:font-semibold";

/**
 * Exibe o conteúdo de um campo de texto rico. HTML passa pelo DOMPurify só com
 * as tags do editor e sem atributos; texto puro (gravado antes do editor) sai
 * como está, com as quebras de linha.
 */
export function TextoRico({ valor, className, vazio = "—" }: { valor?: string | null; className?: string; vazio?: string }) {
  const html = useMemo(() => {
    if (!pareceHtml(valor)) return null;
    // Sem DOM (render no servidor) não há como higienizar: cai no texto puro.
    if (typeof window === "undefined" || !DOMPurify.isSupported) return null;
    return DOMPurify.sanitize(String(valor), { ALLOWED_TAGS: [...TAGS_TEXTO_RICO], ALLOWED_ATTR: [] });
  }, [valor]);

  if (!valor || !textoPlanoDoHtml(valor)) return <span className={className}>{vazio}</span>;
  if (html === null) {
    return (
      <div className={cn("whitespace-pre-wrap break-words", className)}>
        {pareceHtml(valor) ? textoPlanoDoHtml(valor) : valor}
      </div>
    );
  }
  return <div className={cn(CLASSES_TEXTO_RICO, className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
