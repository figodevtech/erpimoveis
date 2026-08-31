"use client";

import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function LinhaComplementar({ texto, prefixo }: { texto: string; prefixo?: string }) {
  const conteudo = prefixo ? `${prefixo}: ${texto}` : texto;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-full cursor-help truncate text-xs text-muted-foreground">
          {conteudo}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{conteudo}</TooltipContent>
    </Tooltip>
  );
}

export function DescricaoServico({
  descricao,
  subdescricao,
  observacao,
  identificador,
  className,
}: {
  descricao: string;
  subdescricao?: string | null;
  observacao?: string | null;
  identificador?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="block truncate">
        {descricao}
        {identificador && (
          <span className="ml-2 text-xs text-muted-foreground">{identificador}</span>
        )}
      </span>
      {subdescricao && <LinhaComplementar texto={subdescricao} />}
      {observacao && <LinhaComplementar texto={observacao} prefixo="Execução" />}
    </div>
  );
}
