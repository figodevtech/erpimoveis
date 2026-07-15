"use client";

import { useEffect } from "react";
import { toast } from "@/lib/toast";
import { supabase } from "@/lib/supabase";

/**
 * NFSeRealtimeListener
 *
 * Este componente não renderiza nada visualmente, mas mantém uma conexão
 * aberta com o Supabase Realtime para capturar atualizações na tabela `nfse`.
 * Quando uma NFS-e é autorizada ou rejeitada, um toast é disparado.
 */
export function NFSeRealtimeListener() {
  useEffect(() => {
    const channel = supabase
      .channel("nfse-status-updates")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "nfse",
        },
        (payload) => {
          const { new: newRow, old: oldRow } = payload;

          if (newRow.status !== oldRow.status) {
            if (newRow.status === "AUTORIZADA") {
              toast.success("NFS-e Autorizada!", {
                description: `Nota nº ${newRow.numero} para a referência ${newRow.referencia.split("_")[1] || newRow.referencia}`,
                duration: 10000,
                action: newRow.url_pdf
                  ? {
                      label: "Ver PDF",
                      onClick: () => window.open(newRow.url_pdf, "_blank"),
                    }
                  : undefined,
              });
            } else if (newRow.status === "REJEITADA") {
              const erroMsg = Array.isArray(newRow.erros)
                ? newRow.erros[0]?.mensagem
                : typeof newRow.erros === "string"
                  ? newRow.erros
                  : "Erro desconhecido";

              toast.error("NFS-e Rejeitada", {
                description: `Motivo: ${erroMsg}`,
                duration: 10000,
              });
            } else if (newRow.status === "CANCELADA") {
              toast.warning("NFS-e Cancelada", {
                description: `A nota ${newRow.numero} foi cancelada com sucesso.`,
                duration: 8000,
              });
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
