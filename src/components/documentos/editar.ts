// Edição do documento na hora da impressão, feita no DOM do frame (sem script
// dentro dele). O documento corre contínuo numa folha só, com a largura e as
// margens do A4: editar sobre as folhas já repartidas esconderia o texto que
// passasse do pé, e repaginar a cada tecla tiraria o cursor do lugar. Ao
// concluir, o HTML editado volta a ser paginado.
//
// A alteração vale só para aquela impressão: não muda o modelo nem o registro.

import { margensDoModelo } from "./paginar";

/** Marca o que a edição põe no documento e tira ao devolver o HTML. */
const MARCA = "data-documento-edicao";

function estiloDaEdicao(doc: Document) {
  const m = margensDoModelo(doc);
  return `
html { padding: 12px 0 !important; margin: 0 !important; background: transparent !important; }
body {
  box-sizing: border-box !important; width: 210mm !important; min-height: 297mm;
  margin: 0 auto !important; padding: ${m.top} ${m.right} ${m.bottom} ${m.left} !important;
  background: #fff; outline: none; caret-color: #2563eb;
  box-shadow: 0 1px 2px rgba(15,23,42,.10), 0 10px 28px -12px rgba(15,23,42,.40);
}`;
}

export type EventosDaEdicao = {
  /** A cada alteração do texto. */
  aoAlterar: () => void;
  /** Ctrl+P dentro do frame: a impressão tem de sair das folhas, não da edição. */
  aoPedirImpressao: () => void;
};

export function prepararEdicao(doc: Document, eventos: EventosDaEdicao) {
  const body = doc.body;
  if (!body) return;

  const css = doc.createElement("style");
  css.setAttribute(MARCA, "");
  css.textContent = estiloDaEdicao(doc);
  doc.head.appendChild(css);

  body.contentEditable = "true";
  // Sem corretor: o dicionário é o do navegador, quase nunca o de português,
  // e sublinhava o contrato inteiro de vermelho.
  body.spellcheck = false;

  // Colar entra como texto: a formatação de outro programa (Word, navegador)
  // desmancharia o layout do modelo.
  doc.addEventListener("paste", (evento) => {
    evento.preventDefault();
    const texto = evento.clipboardData?.getData("text/plain") ?? "";
    if (texto) doc.execCommand("insertText", false, texto);
  });
  // Soltar arquivo ou trecho arrastado de fora também traria marcação.
  doc.addEventListener("drop", (evento) => evento.preventDefault());

  doc.addEventListener("input", eventos.aoAlterar);
  doc.addEventListener("keydown", (evento) => {
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "p") {
      evento.preventDefault();
      eventos.aoPedirImpressao();
    }
  });
}

/** O documento como está agora, sem o que a edição acrescentou. */
export function htmlEditado(doc: Document): string {
  const copia = doc.documentElement.cloneNode(true) as HTMLElement;
  copia.querySelectorAll(`[${MARCA}]`).forEach((no) => no.remove());
  const body = copia.querySelector("body");
  body?.removeAttribute("contenteditable");
  body?.removeAttribute("spellcheck");
  return `<!doctype html>${copia.outerHTML}`;
}
