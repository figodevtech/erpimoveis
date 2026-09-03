"use client";

import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVO_CANCELAMENTO_MAX } from "@/lib/cancelamento";

export type CancelTarget = {
  id: number;
  /** entrada/saida define o texto e o endpoint chamado pelo componente pai. */
  kind: "entrada" | "saida";
  inventory: "produto" | "usoconsumo";
  /**
   * OS que gerou a saida, quando ela veio de um consumo registrado na ordem.
   *
   * Preenchida, o dialogo deixa de oferecer o cancelamento: o banco recusa por
   * aqui, porque devolver o saldo sem encerrar a despesa deixaria a OS com um
   * custo de um movimento que nao existe mais. O caminho e a propria OS.
   */
  ordemServicoId?: number | null;
};

const MOTIVO_MIN = 3;

const CONSEQUENCIA: Record<"entrada" | "saida", string> = {
  entrada:
    "O estoque recebido será retirado. Parcelas financeiras pendentes serão anuladas e pagamentos já realizados receberão um lançamento inverso. O cancelamento será impedido se o estoque atual não comportar o estorno.",
  saida:
    "A quantidade retirada voltará ao estoque. A movimentação permanecerá no histórico como cancelada e não poderá ser revertida.",
};

/**
 * Confirmacao de cancelamento com motivo obrigatorio. O motivo fica gravado em
 * `motivo_cancelamento` e e exibido depois no dialog de detalhes do movimento.
 */
export function CancelMovementDialog({
  target,
  onOpenChange,
  onConfirm,
  canceling,
}: {
  target: CancelTarget | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (motivo: string) => void | Promise<void>;
  canceling: boolean;
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && !canceling && onOpenChange(false)}>
      {/* A `key` remonta o formulario a cada alvo, zerando o motivo digitado sem
          precisar de um efeito de reset (regra react-hooks/set-state-in-effect). */}
      {target && target.ordemServicoId ? (
        <ConsumoDeOsAviso ordemServicoId={target.ordemServicoId} />
      ) : target ? (
        <CancelForm key={`${target.inventory}-${target.kind}-${target.id}`} kind={target.kind} onConfirm={onConfirm} canceling={canceling} />
      ) : null}
    </AlertDialog>
  );
}

function CancelForm({
  kind,
  onConfirm,
  canceling,
}: {
  kind: CancelTarget["kind"];
  onConfirm: (motivo: string) => void | Promise<void>;
  canceling: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  const [tocado, setTocado] = useState(false);

  const motivoLimpo = motivo.trim();
  const motivoValido = motivoLimpo.length >= MOTIVO_MIN;
  const rotulo = kind === "entrada" ? "entrada" : "saída";

  return (
    <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar esta {rotulo}?</AlertDialogTitle>
          <AlertDialogDescription>{CONSEQUENCIA[kind]}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 bg-card p-4 rounded-xl">
          <Label htmlFor="motivo-cancelamento">
            Motivo do cancelamento <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="motivo-cancelamento"
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            onBlur={() => setTocado(true)}
            placeholder={`Explique por que esta ${rotulo} está sendo cancelada`}
            rows={3}
            maxLength={MOTIVO_CANCELAMENTO_MAX}
            disabled={canceling}
            aria-invalid={tocado && !motivoValido}
          />
          <div className="flex items-center justify-between gap-3">
            <p className={`text-xs ${tocado && !motivoValido ? "text-destructive" : "text-muted-foreground"}`}>
              {tocado && !motivoValido
                ? `Informe ao menos ${MOTIVO_MIN} caracteres.`
                : "Este motivo fica registrado no histórico da movimentação."}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {motivoLimpo.length}/{MOTIVO_CANCELAMENTO_MAX}
            </span>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={canceling}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={canceling || !motivoValido}
            onClick={(event) => {
              event.preventDefault();
              setTocado(true);
              if (!motivoValido) return;
              void onConfirm(motivoLimpo);
            }}
          >
            {canceling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
            {canceling ? "Cancelando..." : `Cancelar ${rotulo}`}
          </AlertDialogAction>
        </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/**
 * Saida que nasceu de um consumo de OS: o cancelamento mora la, nao aqui.
 *
 * A trava de verdade e a RPC `cancelar_saida_estoque`, que recusa qualquer
 * chamador sem o portao aberto. Este aviso existe so para o operador nao
 * descobrir a regra esbarrando num erro.
 */
function ConsumoDeOsAviso({ ordemServicoId }: { ordemServicoId: number }) {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Esta saída pertence à OS #{ordemServicoId}</AlertDialogTitle>
        <AlertDialogDescription>
          Ela foi gerada pelo consumo registrado na ordem de serviço. Para devolver o item ao
          estoque, cancele a despesa na OS — assim o saldo volta e o custo sai da ordem no
          mesmo passo. Cancelar por aqui devolveria o saldo e deixaria a despesa viva na OS.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Entendi</AlertDialogCancel>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
