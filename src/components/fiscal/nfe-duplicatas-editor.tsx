"use client";

import ValueInput from "@/components/ui/value-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { centavosDaDuplicata, MAX_DUPLICATAS_NFE, numeroDaDuplicata, resolverCobrancaNFe, type NFeDuplicataInput } from "@/lib/nfe/duplicatas";

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
  const erros = resolverCobrancaNFe({
    modelo: 55, finNFe: 1, pagamentos: [{ tPag: "14", valor: valorEsperado }],
    cobranca: { duplicatas: value }, valorNota: valorEsperado,
  }).erros;
  const renumerar = (items: NFeDuplicataInput[]) => onChange(items.map((item, index) => ({ ...item, numero: numeroDaDuplicata(index) })));

  return <div className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4">
    <div><p className="font-medium">Duplicatas</p><p className="text-xs text-muted-foreground">Informe vencimento e valor de cada duplicata fiscal.</p></div>
    {value.map((item, index) => <div className="grid min-w-0 gap-2 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" key={index}>
      <span className="text-sm font-medium">{numeroDaDuplicata(index)}</span>
      <label className="space-y-1 text-xs">Vencimento<Input type="date" value={item.vencimento || ""} disabled={disabled} onChange={(event) => renumerar(value.map((row, rowIndex) => rowIndex === index ? { ...row, vencimento: event.target.value } : row))} /></label>
      <label className="space-y-1 text-xs">Valor<ValueInput disabled={disabled} price={Number(item.valor) || 0} setPrice={(valor) => renumerar(value.map((row, rowIndex) => rowIndex === index ? { ...row, valor } : row))} /></label>
      <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`Excluir duplicata ${numeroDaDuplicata(index)}`} onClick={() => renumerar(value.filter((_, rowIndex) => rowIndex !== index))}>Excluir</Button>
    </div>)}
    <Button type="button" variant="outline" size="sm" disabled={disabled || value.length >= MAX_DUPLICATAS_NFE} onClick={() => renumerar([...value, { vencimento: "", valor: 0 }])}>+ Adicionar duplicata</Button>
    <div className="space-y-1 text-sm">
      <p>Total das duplicatas: {dinheiro(total)}</p>
      <p>Valor de Duplicata Mercantil: {dinheiro(esperado)}</p>
      <p>{diferenca === 0 ? "✓ Valores conferem" : diferenca > 0 ? `Faltam ${dinheiro(diferenca)}` : `Excedem ${dinheiro(-diferenca)}`}</p>
    </div>
    {erros.length > 0 && <p className="text-xs text-destructive">{erros[0]}</p>}
  </div>;
}
