"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INDICADORES_IE_DEST,
  normalizarIndIEDest,
  type IndIEDest,
} from "@/lib/nfe/indIEDest";

const SEM_SELECAO = "NAO_CLASSIFICADO";

interface IndicadorIeSelectProps {
  id?: string;
  value: number | string | null | undefined;
  onChange: (value: IndIEDest | null) => void;
  disabled?: boolean;
  /** Mostra a opção "não classificado" — só no cadastro, nunca na emissão. */
  permitirVazio?: boolean;
  label?: string;
}

/**
 * Seletor do `indIEDest` — a situação fiscal do destinatário perante o ICMS.
 *
 * É um dado declarado, não deduzido: ter texto no campo de inscrição estadual
 * não significa que a inscrição esteja ativa na UF, e era essa dedução que
 * gerava a rejeição 306 da SEFAZ.
 */
export function IndicadorIeSelect({
  id = "ind-ie-dest",
  value,
  onChange,
  disabled = false,
  permitirVazio = true,
  label = "Indicador de Inscrição Estadual",
}: IndicadorIeSelectProps) {
  const indicador = normalizarIndIEDest(value);
  const descricao = INDICADORES_IE_DEST.find(
    (opcao) => opcao.valor === indicador,
  )?.descricao;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Select
        disabled={disabled}
        value={indicador == null ? SEM_SELECAO : String(indicador)}
        onValueChange={(escolha) =>
          onChange(escolha === SEM_SELECAO ? null : normalizarIndIEDest(escolha))
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          {permitirVazio ? (
            <SelectItem value={SEM_SELECAO}>Não classificado</SelectItem>
          ) : null}
          {INDICADORES_IE_DEST.map((opcao) => (
            <SelectItem key={opcao.valor} value={String(opcao.valor)}>
              {opcao.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {descricao ??
          "Defina antes de emitir NF-e: é o que decide se a inscrição estadual vai na nota."}
      </p>
    </div>
  );
}
