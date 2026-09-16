"use client";

import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { PendenciaDre, RespostaDre } from "../types";
import { escopoEmTexto, motivoDaPendencia } from "./pendencias-catalogo";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);

/**
 * O que a DRE avisa antes de alguém ler os números, e por onde consertar.
 *
 * Cada pendência é um cartão que abre a lista dos itens: o caminho do aviso até
 * o conserto tem um clique. Antes, a tarja repetia a mesma informação em lista e
 * em tabela, e usava a descrição do banco — sem acento e escrita para quem
 * conhece o SQL.
 *
 * Aviso e problema ficam separados. OS em execução é estado normal de oficina;
 * misturá-la com "despesa fora do relatório" ensina a ignorar a tarja inteira.
 */
export function TarjaPendencias({
  alertas,
  pendencias,
  onAbrir,
}: {
  alertas: RespostaDre["alertas"] | undefined;
  pendencias: RespostaDre["pendencias"] | undefined;
  onAbrir: (pendencia: PendenciaDre) => void;
}) {
  const fila = pendencias?.indisponivel ? [] : (pendencias?.porMotivo ?? []);
  const problemas = fila.filter((linha) => motivoDaPendencia(linha.motivo, linha.descricao).tom === "PROBLEMA");
  const avisos = fila.filter((linha) => motivoDaPendencia(linha.motivo, linha.descricao).tom === "AVISO");

  /*
   * Avisos que não vêm da fila: um é falha de consulta, o outro é a ausência de
   * despesa, que nenhuma linha de pendência representa. `null` é diferente de
   * zero — não foi possível apurar, e a tela não pode dizer "está tudo certo".
   */
  const solto: string[] = [];
  if (alertas?.filaIndisponivel) {
    solto.push(
      "Não foi possível apurar as pendências deste período. O relatório pode estar incompleto sem que este aviso saiba dizer quanto.",
    );
  }
  if (alertas?.semDespesaOperacional === true) {
    solto.push("Nenhuma despesa operacional foi lançada no período — o lucro aparece maior do que é.");
  }
  if (alertas?.itensSemCusto === null) {
    solto.push("Não foi possível conferir itens vendidos sem custo cadastrado.");
  }

  if (!problemas.length && !avisos.length && !solto.length) return null;

  const temProblema = problemas.length > 0 || solto.length > 0;
  const valorPendente = problemas.reduce((total, linha) => total + (linha.valor ?? 0), 0);

  return (
    <motion.section
      aria-label="Pendências da DRE"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-lg border p-3",
        temProblema ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/30",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {temProblema ? (
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          ) : (
            <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          {temProblema ? "Este resultado está incompleto" : "Nada a corrigir neste período"}
        </p>
        {valorPendente > 0 && (
          <p className="text-xs text-muted-foreground">
            Fora do relatório: <span className="font-medium text-foreground tabular-nums">{brl(valorPendente)}</span>
          </p>
        )}
      </div>

      {solto.length > 0 && (
        <ul className="mt-2 ml-6 list-disc space-y-0.5 text-xs text-muted-foreground">
          {solto.map((aviso) => (
            <li key={aviso}>{aviso}</li>
          ))}
        </ul>
      )}

      {(problemas.length > 0 || avisos.length > 0) && (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[...problemas, ...avisos].map((linha) => (
            <CartaoPendencia key={linha.motivo} pendencia={linha} onAbrir={onAbrir} />
          ))}
        </div>
      )}
    </motion.section>
  );
}

function CartaoPendencia({
  pendencia,
  onAbrir,
}: {
  pendencia: PendenciaDre;
  onAbrir: (pendencia: PendenciaDre) => void;
}) {
  const catalogo = motivoDaPendencia(pendencia.motivo, pendencia.descricao);
  const Icone = catalogo.icone;
  const aviso = catalogo.tom === "AVISO";

  return (
    <button
      type="button"
      onClick={() => onAbrir(pendencia)}
      aria-label={`${catalogo.titulo}: ${pendencia.quantidade} item(ns)`}
      className="flex items-start gap-2.5 rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
          aviso ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        )}
      >
        <Icone className="size-4" aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{catalogo.titulo}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{pendencia.quantidade}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{catalogo.resumo}</span>
        <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
            {escopoEmTexto(pendencia.escopo)}
          </Badge>
          {pendencia.valor ? <span className="tabular-nums">{brl(pendencia.valor)}</span> : null}
          <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-foreground">
            {catalogo.acao ?? "Ver"}
            <ChevronRight className="size-3" aria-hidden />
          </span>
        </span>
      </span>
    </button>
  );
}
