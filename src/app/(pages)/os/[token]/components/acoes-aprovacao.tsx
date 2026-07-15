"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { CheckCircle2, XCircle } from "lucide-react";

const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v) || 0
  );

export function AcoesAprovacao({
  token,
  totalGeral,
  docConfirmado,
  onAprovado,
  onReprovado,
  disabled,
}: {
  token: string;
  totalGeral: number;
  docConfirmado: string | null;
  onAprovado: () => void;
  onReprovado: () => void;
  disabled?: boolean;
}) {
  const [enviando, setEnviando] = useState<false | "aprovar" | "reprovar">(false);

  async function enviar(acao: "aprovar" | "reprovar") {
    if (!docConfirmado) {
      toast.error("Confirme seu CPF/CNPJ antes de prosseguir.");
      return;
    }
    setEnviando(acao);
    try {
      const r = await fetch(`/api/ordens/aprovacao/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, doc: docConfirmado }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Falha ao enviar resposta");

      if (acao === "aprovar") onAprovado();
      else onReprovado();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar resposta");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="text-right sm:text-left">
        <div className="text-xs text-muted-foreground">Total do orçamento</div>
        <div className="text-lg font-semibold">{money(totalGeral)}</div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={disabled || enviando !== false}
          onClick={() => enviar("reprovar")}
          className="min-w-[140px]"
        >
          {enviando === "reprovar" ? (
            <>
              <XCircle className="mr-2 h-4 w-4 animate-pulse" /> Enviando…
            </>
          ) : (
            <>
              <XCircle className="mr-2 h-4 w-4" /> Recusar
            </>
          )}
        </Button>

        <Button
          disabled={disabled || enviando !== false}
          onClick={() => enviar("aprovar")}
          className="min-w-[160px]"
        >
          {enviando === "aprovar" ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4 animate-pulse" /> Enviando…
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
