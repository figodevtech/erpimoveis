// src/app/(app)/(pages)/meu-perfil/components/divisao-servico.tsx
"use client";

import { Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatarMoeda } from "../lib/format";
import type { RealizadorDoServico } from "../types";

/**
 * Marca o serviço que foi executado por mais de uma pessoa.
 *
 * Sem isso a linha fica contraditória: a coluna "Valor" mostra o serviço
 * inteiro, mas a comissão saiu de uma fatia dele. O ícone diz que houve
 * divisão, e o tooltip mostra com quem, quanto coube a cada um e quanto cada um
 * recebeu de comissão.
 *
 * Os números vêm gravados de `osservico_realizador`, os mesmos que o relatório
 * de comissão paga — a tela não recalcula nada.
 */
export function DivisaoDoServico({
  realizadores,
  valorDoServico,
}: {
  realizadores: RealizadorDoServico[];
  valorDoServico: number;
}) {
  if (realizadores.length <= 1) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 cursor-help items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          aria-label={`Serviço dividido entre ${realizadores.length} realizadores`}
        >
          <Users className="size-3" aria-hidden />
          {realizadores.length}
        </span>
      </TooltipTrigger>

      <TooltipContent className="max-w-sm">
        <p className="font-medium">Serviço dividido entre {realizadores.length} realizadores</p>
        <p className="mt-0.5 text-xs">Valor do serviço: {formatarMoeda(valorDoServico)}</p>

        <ul className="mt-2 grid gap-1 text-xs">
          {realizadores.map((realizador) => (
            <li key={realizador.usuarioId} className="flex items-baseline justify-between gap-3">
              <span className="truncate">
                {realizador.nome}
                {realizador.euMesmo && <span className="ml-1 opacity-70">(você)</span>}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatarMoeda(realizador.valorBase)}
                {" · "}
                {formatarMoeda(realizador.valorComissao)} de comissão
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
