"use client";

import { useId } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ValueInput from "@/components/ui/value-input";
import formatarEmReal from "@/utils/formatarEmReal";

export type TipoAjuste = {
  id: number;
  codigo: string;
  nome: string;
  natureza: "ACRESCIMO" | "DESCONTO";
  codigo_sistema: string | null;
};

export function FormularioDeAjuste({
  tipos, tipoId, onTipoChange, modo, onModoChange, valor, onValorChange,
  base, onAdicionar, disabled = false, salvando = false, rotulo = "Lançar",
}: {
  tipos: TipoAjuste[];
  tipoId: string;
  onTipoChange: (valor: string) => void;
  modo: "FIXO" | "PORCENTAGEM";
  onModoChange: (valor: "FIXO" | "PORCENTAGEM") => void;
  valor: string;
  onValorChange: (valor: string) => void;
  base: number;
  onAdicionar: () => void;
  disabled?: boolean;
  salvando?: boolean;
  rotulo?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-tipo`} className="text-xs">Tipo</Label>
          <Select value={tipoId} onValueChange={onTipoChange} disabled={disabled || salvando}>
            <SelectTrigger id={`${id}-tipo`} className="w-full"><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent>
              {tipos.map((tipo) => (
                <SelectItem key={tipo.id} value={String(tipo.id)}>
                  {tipo.natureza === "ACRESCIMO" ? "+ " : "− "}{tipo.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-modo`} className="text-xs">Modo</Label>
          <Select value={modo} onValueChange={(novo) => onModoChange(novo as typeof modo)} disabled={disabled || salvando}>
            <SelectTrigger id={`${id}-modo`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FIXO">Em reais</SelectItem>
              <SelectItem value="PORCENTAGEM">Percentual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-valor`} className="text-xs">{modo === "PORCENTAGEM" ? "Percentual" : "Valor"}</Label>
          {modo === "PORCENTAGEM" ? (
            <Input id={`${id}-valor`} inputMode="decimal" value={valor} onChange={(e) => onValorChange(e.target.value)} placeholder="10" disabled={disabled || salvando} />
          ) : (
            <ValueInput id={`${id}-valor`} value={Number(valor.replace(",", ".")) || 0} onValueChange={(novo) => onValorChange(String(novo))} disabled={disabled || salvando} />
          )}
        </div>
        <Button type="button" onClick={onAdicionar} disabled={disabled || salvando} className="self-end">
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : rotulo}
        </Button>
      </div>
      {modo === "PORCENTAGEM" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          O percentual incide sobre o valor de face ({formatarEmReal(base)}), não sobre o acumulado.
        </p>
      ) : null}
    </div>
  );
}
