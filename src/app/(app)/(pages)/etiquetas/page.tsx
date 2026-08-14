"use client";

import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LABEL_SIZES, type LabelSizeKey } from "@/lib/etiquetas/label-sizes";

const PRINT_STORAGE_PREFIX = "erpoficina:etiquetas-print:";
/** Teto de etiquetas por geracao, o mesmo para faixa numerada e apenas prefixo. */
const MAX_ETIQUETAS = 500;

export default function EtiquetasPage() {
  const [prefixo, setPrefixo] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [apenasPrefixo, setApenasPrefixo] = useState(false);
  const [quantidade, setQuantidade] = useState("");
  const [tamanho, setTamanho] = useState<LabelSizeKey | "">("");

  const codigos = useMemo(() => {
    const cleanPrefix = prefixo.trim().toLocaleUpperCase("pt-BR");
    if (!cleanPrefix) return [];

    // Apenas prefixo: N etiquetas iguais, sem sufixo numerico. Sao codigos
    // repetidos de proposito — quem cola e que define o que cada uma identifica.
    if (apenasPrefixo) {
      const quantidadeRaw = Number(quantidade);
      if (quantidade === "" || !Number.isFinite(quantidadeRaw)) return [];
      const total = Math.min(Math.max(0, Math.trunc(quantidadeRaw)), MAX_ETIQUETAS);
      return Array.from({ length: total }, () => cleanPrefix);
    }

    const startRaw = Number(inicio);
    const endRaw = Number(fim);
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw) || inicio === "" || fim === "") return [];
    const start = Math.max(0, Math.trunc(startRaw));
    const end = Math.max(start, Math.trunc(endRaw));
    const size = Math.min(end - start + 1, MAX_ETIQUETAS);
    return Array.from({ length: size }, (_, index) => `${cleanPrefix}-${start + index}`);
  }, [apenasPrefixo, fim, inicio, prefixo, quantidade]);

  function gerarEtiquetas() {
    if (!tamanho || codigos.length === 0) return;
    const draftId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(`${PRINT_STORAGE_PREFIX}${draftId}`, JSON.stringify({
      codes: codigos,
      size: LABEL_SIZES[tamanho],
      createdAt: new Date().toISOString(),
    }));
    window.open(`/print/etiquetas?draft=${encodeURIComponent(draftId)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Etiquetas</h1>
        <p className="text-sm text-muted-foreground">Gere etiquetas para produtos e itens de uso/consumo.</p>
      </div>
      <div className="space-y-8 rounded-lg border bg-card p-5">
        <div className="space-y-4">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="prefixo">Prefixo</Label>
              <Input id="prefixo" value={prefixo} onChange={(event) => setPrefixo(event.target.value.toLocaleUpperCase("pt-BR"))} placeholder="CX" className="rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0" />
            </div>
            {apenasPrefixo ? (
              <div className="space-y-2">
                <Label htmlFor="quantidade">Quantidade</Label>
                <Input id="quantidade" type="number" min={1} max={MAX_ETIQUETAS} value={quantidade} placeholder="10" onChange={(event) => setQuantidade(event.target.value)} className="rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="inicio">De</Label>
                  <Input id="inicio" type="number" min={0} value={inicio} placeholder="1" onChange={(event) => setInicio(event.target.value)} className="rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fim">Até</Label>
                  <Input id="fim" type="number" min={inicio || 0} value={fim} placeholder="20" onChange={(event) => setFim(event.target.value)} className="rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0" />
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="apenas-prefixo" checked={apenasPrefixo} onCheckedChange={(value) => setApenasPrefixo(value === true)} />
            <Label htmlFor="apenas-prefixo" className="cursor-pointer font-normal">Apenas prefixo</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {apenasPrefixo
              ? `Gera etiquetas iguais, só com o prefixo e sem numeração. Máximo de ${MAX_ETIQUETAS} por vez.`
              : `Gera a faixa numerada PREFIXO-1, PREFIXO-2 e assim por diante. Máximo de ${MAX_ETIQUETAS} por vez.`}
          </p>
        </div>
        <div className="max-w-xs space-y-2">
          <Label>Tamanho da etiqueta*</Label>
          <Select value={tamanho} onValueChange={(value) => setTamanho(value as LabelSizeKey)}>
            <SelectTrigger className="rounded-none border-x-0 border-t-0 px-0 shadow-none focus:ring-0"><SelectValue placeholder="Selecione o tamanho" /></SelectTrigger>
            <SelectContent>{Object.entries(LABEL_SIZES).map(([value, item]) => <SelectItem key={value} value={value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="rounded-lg bg-muted/60 px-4 py-4 text-sm font-semibold uppercase">{codigos.length} etiqueta{codigos.length === 1 ? "" : "s"} para gerar</div>
        <div className="flex justify-center">
          <Button type="button" className="min-w-40 gap-2" disabled={!tamanho || !codigos.length} onClick={gerarEtiquetas}><Printer className="h-4 w-4" />Gerar etiquetas</Button>
        </div>
      </div>
    </div>
  );
}
