"use client";

import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LABEL_SIZES = {
  "50x30": { label: "50 x 30 mm", widthMm: 50, heightMm: 30 },
  "60x30": { label: "60 x 30 mm", widthMm: 60, heightMm: 30 },
  "60x40": { label: "60 x 40 mm", widthMm: 60, heightMm: 40 },
  "80x40": { label: "80 x 40 mm", widthMm: 80, heightMm: 40 },
  "100x50": { label: "100 x 50 mm", widthMm: 100, heightMm: 50 },
};

type LabelSizeKey = keyof typeof LABEL_SIZES;

const ETIQUETAS_PRINT_STORAGE_PREFIX = "erpoficina:etiquetas-print:";

export default function EtiquetasPage() {
  const [prefixo, setPrefixo] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [tamanho, setTamanho] = useState<LabelSizeKey | "">("");

  const codigos = useMemo(() => {
    const cleanPrefix = prefixo.trim().toUpperCase();
    const startRaw = Number(inicio);
    const endRaw = Number(fim);

    if (!cleanPrefix || !Number.isFinite(startRaw) || !Number.isFinite(endRaw) || inicio === "" || fim === "") {
      return [];
    }

    const start = Math.max(0, Math.trunc(startRaw));
    const end = Math.max(start, Math.trunc(endRaw));
    const size = Math.min(end - start + 1, 500);

    return Array.from({ length: size }, (_, index) => {
      const n = start + index;
      return `${cleanPrefix}-${n}`;
    });
  }, [fim, inicio, prefixo]);

  const gerarEtiquetas = () => {
    if (!tamanho || codigos.length === 0) return;

    const selectedSize = LABEL_SIZES[tamanho];
    const draftId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const draft = {
      codes: codigos,
      size: selectedSize,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(`${ETIQUETAS_PRINT_STORAGE_PREFIX}${draftId}`, JSON.stringify(draft));
    window.open(`/print/estoque/etiquetas?draft=${encodeURIComponent(draftId)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Etiquetas</h1>
        <p className="text-sm text-muted-foreground">
          Gere etiquetas soltas para impressão em impressora de etiquetas.
        </p>
      </div>

      <div className="space-y-8 rounded-lg border bg-card p-5">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="prefixo">Prefixo</Label>
            <Input
              id="prefixo"
              value={prefixo}
              onChange={(e) => setPrefixo(e.target.value.toUpperCase())}
              placeholder="CX"
              className="border-x-0 border-t-0 rounded-none px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inicio">De</Label>
            <Input
              id="inicio"
              type="number"
              min={0}
              value={inicio}
              placeholder="1"
              onChange={(e) => setInicio(e.target.value)}
              className="border-x-0 border-t-0 rounded-none px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fim">Até</Label>
            <Input
              id="fim"
              type="number"
              min={inicio || 0}
              value={fim}
              placeholder="20"
              onChange={(e) => setFim(e.target.value)}
              className="border-x-0 border-t-0 rounded-none px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="max-w-xs space-y-2">
          <Label>Tamanho Etiqueta*</Label>
          <Select value={tamanho} onValueChange={(value) => setTamanho(value as LabelSizeKey)}>
            <SelectTrigger className="border-x-0 border-t-0 rounded-none px-0 shadow-none focus:ring-0">
              <SelectValue placeholder="Selecione o tamanho" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LABEL_SIZES).map(([value, item]) => (
                <SelectItem key={value} value={value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg bg-muted/60 px-4 py-4 text-sm font-semibold uppercase">
          {codigos.length} etiqueta{codigos.length === 1 ? "" : "s"} para gerar
        </div>

        <div className="flex justify-center">
          <Button
            type="button"
            className="min-w-40 gap-2"
            disabled={!tamanho || !codigos.length}
            onClick={gerarEtiquetas}
          >
            <Printer className="h-4 w-4" />
            Gerar etiquetas
          </Button>
        </div>
      </div>
    </div>
  );
}
