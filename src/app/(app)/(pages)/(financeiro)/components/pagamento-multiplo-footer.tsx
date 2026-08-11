"use client";

import { Split, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import formatarEmReal from "@/utils/formatarEmReal";

import { somarSaldos, type DocumentoSelecionavel } from "./pagamento-multiplo";

/**
 * Rodapé fixo do pagamento múltiplo.
 *
 * Mesmo gesto da baixa múltipla de Transações: a barra fica acima da lista e só
 * existe enquanto o modo está ligado, para o usuário ver o que marca e o total ao
 * mesmo tempo. Por isso é barra fixa, e não um dialog.
 *
 * O total somado é o **saldo em aberto** dos documentos — o que ainda falta
 * receber deles, não o valor cheio. Somar o cheio ofereceria receber de novo o
 * que já foi pago.
 */
export function PagamentoMultiploFooter({
  documentos,
  totalNaPagina,
  processando,
  onCancelar,
  children,
}: {
  documentos: DocumentoSelecionavel[];
  totalNaPagina: number;
  processando: boolean;
  onCancelar: () => void;
  /** O gatilho do diálogo de transação, injetado pela tabela. */
  children?: React.ReactNode;
}) {
  const total = somarSaldos(documentos);
  const nada = documentos.length === 0;
  const clientes = new Set(
    documentos.map((documento) => documento.cliente ?? "").filter(Boolean),
  );

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card/95 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur supports-[backdrop-filter]:bg-card/85"
      role="region"
      aria-label="Pagamento múltiplo"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Selecionados
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {documentos.length}{" "}
              <span className="font-normal text-muted-foreground">
                de {totalNaPagina} na página
              </span>
            </p>
          </div>

          {nada ? (
            <p className="text-sm text-muted-foreground">
              Marque os documentos que serão pagos juntos.
            </p>
          ) : (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Total em aberto
              </p>
              <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatarEmReal(total)}
              </p>
            </div>
          )}

          {/*
            Um pagamento que cobre documentos de clientes diferentes é permitido —
            empresa quitando várias contas, por exemplo — mas não pode passar
            despercebido, porque quase sempre é seleção errada.
          */}
          {clientes.size > 1 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {clientes.size} clientes diferentes nesta seleção.
            </p>
          ) : null}
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
          {nada ? (
            <Button size="sm" className="h-9" disabled>
              <Split className="h-4 w-4" aria-hidden />
              Registrar pagamento
            </Button>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
