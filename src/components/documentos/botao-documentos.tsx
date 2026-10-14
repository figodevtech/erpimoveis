"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { FileText, Loader2, Printer, Settings2 } from "lucide-react";

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

/**
 * A impressora ao lado do X: lista os documentos ativos do módulo e abre o
 * escolhido numa aba nova. O documento sai com os dados salvos do registro.
 */
export function BotaoDocumentos({ modulo, registroId, className }: Props) {
  const { data: session } = useSession();
  const podeConfigurar = permissionSetHas((session?.user as any)?.permissoes, PERMS.CONFIG);
  const [itens, setItens] = useState<DocumentoParaEmitir[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
    <DropdownMenu
      onOpenChange={(aberto) => {
        // Recarrega a cada abertura: um documento criado agora em outra aba
        // já aparece, sem recarregar o diálogo.
        if (aberto) void carregar();
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
              <Printer className="h-4 w-4 text-muted-foreground" />
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
              onSelect={() => window.open(`/print/documento/${doc.id}/${registroId}`, "_blank")}
            >
              <FileText className="mr-2 h-4 w-4" />
              <span className="truncate">{doc.nome}</span>
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
  );
}
