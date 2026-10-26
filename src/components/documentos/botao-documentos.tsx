"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { FileText, Loader2, Printer, Settings2 } from "lucide-react";

import { FolhaDocumento, LARGURA_FRAME_PX, type FolhaDocumentoHandle } from "@/components/documentos/folha-documento";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import type { DocumentoParaEmitir, ModuloDocumento } from "@/lib/documentos/tipos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const NOME_NO_PLURAL: Record<ModuloDocumento, string> = {
  venda: "vendas",
  os: "ordens de serviço",
  aluguel: "aluguéis",
};

type Props = {
  modulo: ModuloDocumento;
  registroId: number;
  className?: string;
};

type Impressao = { chave: number; html: string; titulo: string };

/**
 * A impressora ao lado do X: lista os documentos ativos do módulo e abre o
 * escolhido numa aba nova. O documento sai com os dados salvos do registro.
 *
 * Modelo com impressão rápida tem uma impressora no próprio item: o documento
 * é preenchido num frame fora da tela e vai direto para o diálogo de
 * impressão, sem a aba.
 */
export function BotaoDocumentos({ modulo, registroId, className }: Props) {
  const { data: session } = useSession();
  const podeConfigurar = permissionSetHas((session?.user as any)?.permissoes, PERMS.CONFIG);
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<DocumentoParaEmitir[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [impressao, setImpressao] = useState<Impressao | null>(null);
  const folha = useRef<FolhaDocumentoHandle>(null);
  const caixaDaFolha = useRef<HTMLDivElement>(null);

  async function imprimirDireto(doc: DocumentoParaEmitir) {
    if (preparando) return;
    setAberto(false);
    setPreparando(true);
    try {
      const resposta = await fetch(`/api/documentos/${doc.id}/${registroId}`, { cache: "no-store" });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo?.error || "Não foi possível preparar o documento.");
      // Chave nova: cada impressão monta o frame do zero, mesmo repetindo o documento.
      setImpressao({ chave: Date.now(), html: String(corpo.html ?? ""), titulo: String(corpo.titulo ?? doc.nome) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível preparar o documento.");
      setPreparando(false);
    }
  }

  function aoCarregarFolha() {
    // O frame nasce em about:blank; só o documento preenchido vai para a impressora.
    const frame = caixaDaFolha.current?.querySelector("iframe");
    if (!preparando || frame?.contentDocument?.URL !== "about:srcdoc") return;
    setPreparando(false);
    folha.current?.imprimir();
  }

  async function carregar() {
    if (carregando) return;
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/documentos?modulo=${modulo}`, { cache: "no-store" });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo?.error || "Não foi possível carregar os documentos.");
      setItens(Array.isArray(corpo.items) ? corpo.items : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os documentos.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <DropdownMenu
        open={aberto}
        onOpenChange={(abrir) => {
          setAberto(abrir);
          // Recarrega a cada abertura: um documento criado agora em outra aba
          // já aparece, sem recarregar o diálogo.
          if (abrir) void carregar();
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Emitir documento"
                className={cn(
                  "flex size-6 items-center justify-center rounded transition-colors hover:cursor-pointer hover:bg-muted",
                  className,
                )}
              >
                {preparando ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Printer className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Emitir documento (com os dados salvos)</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Emitir documento</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {carregando && !itens ? (
            <DropdownMenuItem disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando...
            </DropdownMenuItem>
          ) : erro ? (
            <DropdownMenuItem
              onSelect={(evento) => {
                evento.preventDefault();
                void carregar();
              }}
            >
              <span className="text-destructive">{erro}</span>
              <span className="ml-auto pl-2 text-[10px] text-muted-foreground">tentar de novo</span>
            </DropdownMenuItem>
          ) : itens && itens.length === 0 ? (
            <DropdownMenuItem disabled>Nenhum documento de {NOME_NO_PLURAL[modulo]}</DropdownMenuItem>
          ) : (
            (itens ?? []).map((doc) => (
              <DropdownMenuItem
                key={doc.id}
                className={doc.impressao_rapida ? "py-1 pr-1" : undefined}
                onSelect={() => window.open(`/print/documento/${doc.id}/${registroId}`, "_blank")}
              >
                <FileText className="mr-2 h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{doc.nome}</span>
                {doc.impressao_rapida ? (
                  // O item abre a aba; este botão não pode deixar o clique chegar nele.
                  <button
                    type="button"
                    title="Imprimir direto"
                    aria-label={`Imprimir ${doc.nome} direto`}
                    className="ml-2 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:cursor-pointer hover:border-primary hover:bg-primary hover:text-primary-foreground"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void imprimirDireto(doc);
                    }}
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </DropdownMenuItem>
            ))
          )}

          {podeConfigurar ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => window.open(`/configuracoes/documentos?modulo=${modulo}`, "_blank")}>
                <Settings2 className="mr-2 h-4 w-4" />
                Gerenciar documentos
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

    {/* Fora do diálogo e da tela: a paginação precisa do frame com layout, mas ninguém o vê. */}
    {impressao
      ? createPortal(
          <div
            ref={caixaDaFolha}
            aria-hidden
            className="pointer-events-none fixed top-0"
            style={{ left: -10_000, width: LARGURA_FRAME_PX }}
          >
            <FolhaDocumento
              key={impressao.chave}
              ref={folha}
              html={impressao.html}
              titulo={impressao.titulo}
              onCarregado={aoCarregarFolha}
            />
          </div>,
          document.body,
        )
      : null}
    </>
  );
}
