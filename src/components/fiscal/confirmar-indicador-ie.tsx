"use client";

import { useState } from "react";
import axios, { isAxiosError } from "axios";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import {
  IND_IE_DEST_CONTRIBUINTE,
  normalizarIndIEDest,
  sugerirIndIEDest,
  type IndIEDest,
} from "@/lib/nfe/indIEDest";

import { IndicadorIeSelect } from "./indicador-ie-select";

interface ConfirmarIndicadorIeProps {
  clienteId: number;
  nomeCliente?: string | null;
  inscricaoEstadual?: string | null;
  /** Valor já gravado no cadastro. `null`/ausente dispara a confirmação. */
  indIeDest?: number | null;
  onConfirmado: (indicador: IndIEDest) => void;
}

/**
 * Aviso de destinatário sem situação fiscal definida.
 *
 * Cadastros antigos não têm `ind_ie_dest` — e converter todos em massa seria
 * repetir o erro que gerou a rejeição 306, só que de uma vez. Em vez disso, a
 * emissão para. O seletor abre numa sugestão, o usuário confirma, e aí sim o
 * valor vira dado de cadastro.
 */
export function ConfirmarIndicadorIe({
  clienteId,
  nomeCliente,
  inscricaoEstadual,
  indIeDest,
  onConfirmado,
}: ConfirmarIndicadorIeProps) {
  const [indicador, setIndicador] = useState<IndIEDest>(
    () => normalizarIndIEDest(indIeDest) ?? sugerirIndIEDest(inscricaoEstadual),
  );
  const [salvando, setSalvando] = useState(false);

  // Já classificado: nada a confirmar.
  if (normalizarIndIEDest(indIeDest) != null) return null;

  const faltaIe =
    indicador === IND_IE_DEST_CONTRIBUINTE &&
    !String(inscricaoEstadual ?? "").trim();

  const confirmar = async () => {
    if (faltaIe) {
      toast.error("Informe a inscrição estadual do destinatário contribuinte do ICMS.", {
        description: "Edite o cadastro do cliente antes de emitir.",
      });
      return;
    }

    setSalvando(true);
    try {
      await axios.patch(`/api/customers/${clienteId}`, { ind_ie_dest: indicador });
      toast.success("Situação fiscal salva no cadastro do cliente.");
      onConfirmado(indicador);
    } catch (error) {
      toast.error("Não foi possível salvar a situação fiscal", {
        description: isAxiosError(error)
          ? (error.response?.data?.error ?? error.message)
          : "Tente novamente.",
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Confirme se o destinatário é contribuinte, contribuinte isento ou não
            contribuinte do ICMS.
          </p>
          <p className="text-xs text-muted-foreground">
            {nomeCliente ? `${nomeCliente} ainda não foi classificado. ` : ""}
            Enviar a inscrição estadual de quem não é contribuinte, ou de quem tem
            inscrição baixada na UF, faz a SEFAZ rejeitar a nota (306).
          </p>
        </div>
      </div>

      <IndicadorIeSelect
        id={`ind-ie-dest-cliente-${clienteId}`}
        value={indicador}
        onChange={(valor) => valor && setIndicador(valor)}
        permitirVazio={false}
        disabled={salvando}
      />

      {faltaIe ? (
        <p className="text-xs text-destructive">
          Este cliente não tem inscrição estadual cadastrada. Escolha outra opção ou
          preencha a IE no cadastro.
        </p>
      ) : null}

      <Button type="button" size="sm" onClick={() => void confirmar()} disabled={salvando}>
        {salvando ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Salvando...
          </>
        ) : (
          "Confirmar e salvar no cadastro"
        )}
      </Button>
    </div>
  );
}
