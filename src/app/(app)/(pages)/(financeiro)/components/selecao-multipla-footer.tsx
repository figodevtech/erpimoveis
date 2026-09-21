"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Rodapé fixo da seleção múltipla das listas de pagamento.
 *
 * Mesmo gesto da baixa múltipla de Transações: a barra fica acima da lista e só
 * existe enquanto o modo está ligado, para o usuário ver o que marca e o total
 * ao mesmo tempo. Por isso é barra fixa, e não um dialog.
 *
 * Nasceu só para o pagamento múltiplo. Agora atende também a emissão de nota,
 * então o que é específico de cada ação — o título, a métrica do resumo, o
 * aviso e os botões — entra por prop. O que é comum fica aqui: a contagem, o
 * cancelar e o posicionamento.
 */
export function SelecaoMultiplaFooter({
  titulo,
  selecionados,
  totalNaPagina,
  resumo,
  aviso,
  vazioLabel,
  processando,
  onCancelar,
  acoes,
}: {
  /** Rótulo da região, lido por leitor de tela. */
  titulo: string;
  selecionados: number;
  totalNaPagina: number;
  /** A métrica da ação: total em aberto, total a faturar… */
  resumo?: React.ReactNode;
  /** Alerta contextual, como clientes diferentes na seleção. */
  aviso?: React.ReactNode;
  /** O que dizer enquanto nada está marcado. */
  vazioLabel: string;
  processando?: boolean;
  onCancelar: () => void;
  /** Os gatilhos da ação, injetados por quem usa o rodapé. */
  acoes: React.ReactNode;
}) {
  const nada = selecionados === 0;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card/95 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur supports-[backdrop-filter]:bg-card/85"
      role="region"
      aria-label={titulo}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Selecionados</p>
            <p className="text-sm font-semibold tabular-nums">
              {selecionados}{" "}
              <span className="font-normal text-muted-foreground">
                de {totalNaPagina} na página
              </span>
            </p>
          </div>

          {nada ? <p className="text-sm text-muted-foreground">{vazioLabel}</p> : resumo}

          {aviso}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 hover:cursor-pointer"
            onClick={onCancelar}
            disabled={processando}
          >
            <X className="h-4 w-4" aria-hidden />
            Cancelar
          </Button>
          {acoes}
        </div>
      </div>
    </div>
  );
}
