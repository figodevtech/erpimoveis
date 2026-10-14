"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Italic, List, ListOrdered, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIMITE_HTML_TEXTO_RICO, paraHtmlDoEditor, textoPlanoDoHtml } from "@/lib/texto-rico";
import { CLASSES_TEXTO_RICO } from "./texto-rico";

type Props = {
  /** HTML gravado ou texto puro antigo (convertido ao abrir). */
  value: string;
  /** HTML do editor; vazio quando não há texto. */
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

function BotaoFerramenta({
  ativo,
  desabilitado,
  titulo,
  onClick,
  children,
}: {
  ativo?: boolean;
  desabilitado?: boolean;
  titulo: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      disabled={desabilitado}
      // Sem roubar o foco: a seleção do texto continua onde estava.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        ativo && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function BarraDeFerramentas({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const estado = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      negrito: e.isActive("bold"),
      italico: e.isActive("italic"),
      sublinhado: e.isActive("underline"),
      riscado: e.isActive("strike"),
      marcadores: e.isActive("bulletList"),
      numerada: e.isActive("orderedList"),
      podeDesfazer: e.can().undo(),
      podeRefazer: e.can().redo(),
    }),
  });
  const cadeia = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-1 py-1" role="toolbar" aria-label="Formatação do texto">
      <BotaoFerramenta titulo="Negrito (Ctrl+B)" ativo={estado.negrito} desabilitado={disabled} onClick={() => cadeia().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </BotaoFerramenta>
      <BotaoFerramenta titulo="Itálico (Ctrl+I)" ativo={estado.italico} desabilitado={disabled} onClick={() => cadeia().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </BotaoFerramenta>
      <BotaoFerramenta
        titulo="Sublinhado (Ctrl+U)"
        ativo={estado.sublinhado}
        desabilitado={disabled}
        onClick={() => cadeia().toggleUnderline().run()}
      >
        <Underline className="h-4 w-4" />
      </BotaoFerramenta>
      <BotaoFerramenta titulo="Riscado" ativo={estado.riscado} desabilitado={disabled} onClick={() => cadeia().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </BotaoFerramenta>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <BotaoFerramenta
        titulo="Lista com marcadores"
        ativo={estado.marcadores}
        desabilitado={disabled}
        onClick={() => cadeia().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </BotaoFerramenta>
      <BotaoFerramenta
        titulo="Lista numerada"
        ativo={estado.numerada}
        desabilitado={disabled}
        onClick={() => cadeia().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </BotaoFerramenta>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <BotaoFerramenta
        titulo="Desfazer (Ctrl+Z)"
        desabilitado={disabled || !estado.podeDesfazer}
        onClick={() => cadeia().undo().run()}
      >
        <Undo2 className="h-4 w-4" />
      </BotaoFerramenta>
      <BotaoFerramenta
        titulo="Refazer (Ctrl+Shift+Z)"
        desabilitado={disabled || !estado.podeRefazer}
        onClick={() => cadeia().redo().run()}
      >
        <Redo2 className="h-4 w-4" />
      </BotaoFerramenta>
    </div>
  );
}

/**
 * Campo de descrição com formatação básica: negrito, itálico, sublinhado,
 * riscado, listas, Enter para novo parágrafo e Shift+Enter para quebra de
 * linha. Grava HTML; quem exibe usa `TextoRico`, que higieniza.
 */
export function EditorTextoRico({ value, onChange, placeholder, disabled, className, ...rest }: Props) {
  // O pai recria a callback a cada render; o editor lê sempre a última.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  // Último HTML emitido: distingue a digitação de um valor novo vindo de fora.
  const [conteudoInicial] = useState(() => paraHtmlDoEditor(value));
  const emitidoRef = useRef<string>(conteudoInicial);

  const editor = useEditor({
    // Next renderiza no servidor; o editor só monta no navegador.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: conteudoInicial,
    editorProps: {
      attributes: {
        class: cn(
          CLASSES_TEXTO_RICO,
          "min-h-[110px] px-3 py-2 text-sm outline-none",
          "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
        ),
        ...(rest["aria-label"] ? { "aria-label": rest["aria-label"] } : {}),
        // Campo editável liga o corretor do navegador, que sem dicionário de
        // português sublinha o texto inteiro. Desligado, como nos inputs.
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.isEmpty ? "" : e.getHTML();
      emitidoRef.current = html;
      onChangeRef.current(html);
    },
  });

  // Valor trocado por fora (ex.: aluguel carregado depois de abrir o formulário).
  useEffect(() => {
    if (!editor) return;
    const novo = paraHtmlDoEditor(value);
    if (novo === emitidoRef.current) return;
    emitidoRef.current = novo;
    editor.commands.setContent(novo || "", { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const caracteres = textoPlanoDoHtml(value).length;
  const excedeu = value.length > LIMITE_HTML_TEXTO_RICO;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "opacity-60",
        excedeu && "border-red-500",
        className,
      )}
    >
      {editor ? <BarraDeFerramentas editor={editor} disabled={disabled} /> : <div className="h-[41px] border-b bg-muted/30" />}
      <EditorContent editor={editor} />
      <div className={cn("px-3 pb-1.5 text-right text-[11px] text-muted-foreground", excedeu && "text-red-600")}>
        {excedeu ? "Texto longo demais" : `${caracteres} caractere(s)`}
      </div>
    </div>
  );
}
