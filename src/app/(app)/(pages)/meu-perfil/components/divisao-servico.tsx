// src/app/(app)/(pages)/meu-perfil/components/divisao-servico.tsx
"use client";

import { Percent, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { explicarBaseDaComissao } from "@/lib/ordens/comissao-explicacao";
import { formatarMoeda } from "../lib/format";
import type { RealizadorDoServico } from "../types";

/**
 * Explica por que a comissão não é o percentual cheio sobre o valor do serviço.
 *
 * Sem isso a linha fica contraditória: a coluna "Valor" mostra o serviço
 * inteiro, mas a comissão saiu de uma fatia dele. São duas causas, e o marcador
 * muda conforme a que estiver valendo:
 *
 * - **Divisão** (ícone de pessoas): mais de um executor no mesmo serviço. O
 *   tooltip mostra com quem, quanto coube a cada um e quanto cada um recebeu.
 * - **Desconto da OS** (ícone de percentual): a comissão sai do líquido, então
 *   o desconto da ordem encolhe a base mesmo com um executor só.
 *
 * Os números vêm gravados de `osservico_realizador`, os mesmos que o relatório
 * de comissão paga — a tela não recalcula nada.
 */
export function DivisaoDoServico({
  realizadores,
  valorDoServico,
  valorBase,
}: {
  realizadores: RealizadorDoServico[];
  valorDoServico: number;
  /** A fatia desta pessoa, como gravada. */
  valorBase: number;
}) {
  const explicacao = explicarBaseDaComissao({
    subtotalServico: valorDoServico,
    valorBase,
    realizadores: realizadores.length,
  });

  if (!explicacao.dividido && !explicacao.descontoAplicado) return null;

  const Icone = explicacao.dividido ? Users : Percent;
  const rotuloCurto = explicacao.dividido ? String(realizadores.length) : "líq.";
  const titulo = explicacao.dividido
    ? `Serviço dividido entre ${realizadores.length} realizadores`
    : "Comissão sobre o valor líquido";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 cursor-help items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          aria-label={titulo}
        >
          <Icone className="size-3" aria-hidden />
          {rotuloCurto}
        </span>
      </TooltipTrigger>

      <TooltipContent className="max-w-sm">
        <p className="font-medium">{titulo}</p>
        <p className="mt-0.5 text-xs">Valor do serviço: {formatarMoeda(valorDoServico)}</p>

        {explicacao.descontoAplicado && (
          <p className="mt-1 text-xs text-muted-foreground">
            A comissão sai do líquido: o desconto da OS é rateado entre os itens antes do
            cálculo, então a base fica abaixo do valor cheio do serviço.
          </p>
        )}

        {explicacao.dividido && (
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
        )}

        {!explicacao.dividido && (
          <p className="mt-1 text-xs tabular-nums">
            Base da sua comissão: {formatarMoeda(valorBase)}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
