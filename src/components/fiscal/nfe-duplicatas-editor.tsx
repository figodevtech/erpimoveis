"use client";

import ValueInput from "@/components/ui/value-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { centavosDaDuplicata, dividirDuplicatasIgualmente, MAX_DUPLICATAS_NFE, numeroDaDuplicata, type NFeDuplicataInput } from "@/lib/nfe/duplicatas";

type Props = {
  value: NFeDuplicataInput[];
  onChange: (value: NFeDuplicataInput[]) => void;
  valorEsperado: number;
  disabled?: boolean;
};

const dinheiro = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function NfeDuplicatasEditor({ value, onChange, valorEsperado, disabled = false }: Props) {
  const total = value.reduce((sum, item) => sum + (centavosDaDuplicata(item.valor) || 0), 0);
  const esperado = centavosDaDuplicata(valorEsperado);
  const diferenca = esperado - total;
  const valorInsuficiente = value.length > 0 && Number.isSafeInteger(esperado) && esperado < value.length;
  const podeDividir = !disabled && value.length > 0 && Number.isSafeInteger(esperado) && esperado >= value.length;
  const renumerar = (items: NFeDuplicataInput[]) => onChange(items.map((item, index) => ({ ...item, numero: numeroDaDuplicata(index) })));

  return <div className="min-w-0 space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium">Duplicatas</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!podeDividir} onClick={() => {
          if (podeDividir) onChange(dividirDuplicatasIgualmente(value, valorEsperado));
        }}>Dividir igualmente</Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled || value.length >= MAX_DUPLICATAS_NFE} onClick={() => renumerar([...value, { vencimento: "", valor: 0 }])}>+ Adicionar duplicata</Button>
      </div>
    </div>
    {valorInsuficiente && <p className="text-xs text-muted-foreground">O valor não pode ser dividido entre estas duplicatas porque alguma parcela ficaria zerada.</p>}
    <div className="space-y-2">
      {value.map((item, index) => <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-end gap-2 rounded-md border p-2 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:rounded-none sm:border-0 sm:border-b sm:px-0" key={index}>
        <span className="self-center text-sm font-medium tabular-nums">{numeroDaDuplicata(index)}</span>
        <label className="min-w-0 space-y-1 text-xs">Vencimento<Input className="h-8 min-w-0" type="date" value={item.vencimento || ""} disabled={disabled} onChange={(event) => renumerar(value.map((row, rowIndex) => rowIndex === index ? { ...row, vencimento: event.target.value } : row))} /></label>
        <label className="col-start-2 row-start-2 min-w-0 space-y-1 text-xs sm:col-start-auto sm:row-start-auto">Valor<ValueInput disabled={disabled} price={Number(item.valor) || 0} setPrice={(valor) => renumerar(value.map((row, rowIndex) => rowIndex === index ? { ...row, valor } : row))} /></label>
        <Button className="col-start-3 row-span-2 sm:col-start-auto sm:row-span-1" type="button" variant="outline" size="sm" disabled={disabled} aria-label={`Excluir duplicata ${numeroDaDuplicata(index)}`} onClick={() => renumerar(value.filter((_, rowIndex) => rowIndex !== index))}>Excluir</Button>
      </div>)}
    </div>
    <div className="space-y-1 border-t pt-2 text-sm tabular-nums">
      <p className="flex justify-between gap-3"><span>Total das duplicatas</span><span>{dinheiro(total)}</span></p>
      <p className="flex justify-between gap-3"><span>Valor a distribuir</span><span>{dinheiro(esperado)}</span></p>
      <p className="flex justify-between gap-3 font-medium"><span>Diferença</span><span>{dinheiro(Math.abs(diferenca))}</span></p>
      <p className={diferenca === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
        {diferenca === 0 ? "✓ Valores conferem" : diferenca > 0 ? `Faltam ${dinheiro(diferenca)}` : `Excedem ${dinheiro(-diferenca)}`}
      </p>
    </div>
  </div>;
}
