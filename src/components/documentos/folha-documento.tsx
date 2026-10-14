"use client";

import DOMPurify from "dompurify";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { htmlEditado, prepararEdicao } from "./editar";
import { paginarDocumento } from "./paginar";

/**
 * O HTML do modelo é escrito na tela de configurações, mas abre para todo
 * mundo que emite. Duas barreiras, nesta ordem:
 *  1) DOMPurify tira script, frame, formulário e atributo de evento, e mantém o
 *     que um documento precisa — `<style>`, `style`, `class`, tabelas, imagens;
 *  2) o iframe em sandbox sem `allow-scripts`: o que escapar não executa.
 *     `allow-same-origin` sem scripts é seguro e deixa a página medir a altura
 *     e chamar a impressão; `allow-modals` é o que permite o diálogo de
 *     impressão dentro do frame. O frame também isola o CSS do modelo.
 */
function higienizar(html: string) {
  const limpo = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    // `title` dá nome ao PDF salvo pela impressão.
    ADD_TAGS: ["style", "title"],
    FORBID_TAGS: ["script", "iframe", "frame", "object", "embed", "form", "input", "button", "textarea", "select", "base", "link", "meta"],
    FORBID_ATTR: ["srcset", "formaction", "action"],
    // `data-documento` marca cabeçalho, rodapé, quebra e número da folha.
    ALLOW_DATA_ATTR: true,
  });
  // O DOMPurify devolve o documento sem o doctype; sem ele o frame cai em
  // modo quirks e as tabelas perdem o tamanho de fonte.
  return `<!doctype html>${limpo}`;
}

export type FolhaDocumentoHandle = {
  imprimir: () => void;
  /** No modo de edição, o HTML com o que foi alterado; fora dele, `null`. */
  htmlAtual: () => string | null;
};

/** Folha A4 a 96 dpi. */
export const ALTURA_A4_PX = 1123;
export const LARGURA_A4_PX = 794;
/** Respiro em volta das folhas dentro do frame, para a sombra não ser cortada. */
const RESPIRO_PX = 12;
/** O frame tem a largura da folha mais o respiro; a altura mínima é a de uma folha. */
export const LARGURA_FRAME_PX = LARGURA_A4_PX + 2 * RESPIRO_PX;
export const ALTURA_MINIMA_FRAME_PX = ALTURA_A4_PX + 2 * RESPIRO_PX;

export type FolhaDocumentoProps = {
  html: string;
  className?: string;
  titulo?: string;
  /** Altura do conteúdo, medida a cada carga do frame. */
  onAltura?: (altura: number) => void;
  /** Reparte em folhas A4 (padrão). Desligado, o documento corre contínuo. */
  paginar?: boolean;
  /** Documento contínuo e editável (ver `editar.ts`); não pagina. */
  editavel?: boolean;
  onAlterado?: () => void;
  /** Ctrl+P pedido de dentro do frame em edição. */
  onPedirImpressao?: () => void;
  /** Depois de cada carga do frame, já paginado ou pronto para editar. */
  onCarregado?: () => void;
};

export const FolhaDocumento = forwardRef<FolhaDocumentoHandle, FolhaDocumentoProps>(function FolhaDocumento(
  { html, className, titulo = "Documento", onAltura, paginar = true, editavel = false, onAlterado, onPedirImpressao, onCarregado },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(ALTURA_MINIMA_FRAME_PX);
  // Os ouvintes de dentro do frame são postos uma vez por carga; leem sempre
  // a versão mais recente dos callbacks.
  const eventos = useRef({ onAltura, onAlterado, onPedirImpressao, onCarregado });
  useEffect(() => {
    eventos.current = { onAltura, onAlterado, onPedirImpressao, onCarregado };
  });
  // Só no navegador: o DOMPurify precisa do DOM, e no servidor o frame nasce
  // vazio. O conteúdo vai direto no elemento, sem passar por estado.
  useEffect(() => {
    if (frame.current) frame.current.srcdoc = higienizar(html);
  }, [html]);

  useImperativeHandle(ref, () => ({
    imprimir() {
      const janela = frame.current?.contentWindow;
      if (!janela) return;
      janela.focus();
      janela.print();
    },
    htmlAtual() {
      const doc = frame.current?.contentDocument;
      return editavel && doc?.documentElement ? htmlEditado(doc) : null;
    },
  }));

  // A caixa do <html>, e não o scrollHeight: este nunca fica menor que o
  // próprio frame, e a folha não encolheria quando o texto diminui.
  const aoCarregar = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement) return;
    const medir = () => {
      const medida = Math.max(ALTURA_MINIMA_FRAME_PX, Math.ceil(doc.documentElement.getBoundingClientRect().height));
      setAltura(medida);
      eventos.current.onAltura?.(medida);
    };
    // A página tem acesso ao frame (mesma origem, sem scripts dentro dele):
    // é daqui que o documento é repartido em folhas ou aberto para edição.
    if (editavel) {
      prepararEdicao(doc, {
        aoAlterar: () => {
          // O texto cresce ou encolhe enquanto se digita.
          medir();
          eventos.current.onAlterado?.();
        },
        aoPedirImpressao: () => eventos.current.onPedirImpressao?.(),
      });
    } else if (paginar) {
      paginarDocumento(doc);
    }
    medir();
    eventos.current.onCarregado?.();
  }, [editavel, paginar]);

  return (
    <iframe
      ref={frame}
      title={titulo}
      sandbox="allow-same-origin allow-modals"
      onLoad={aoCarregar}
      className={cn("block w-full border-0 bg-transparent", className)}
      style={{ height: `${altura}px` }}
    />
  );
});
