"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Produto } from "../types";

type Props = {
  selected?: Produto | null;
  onSelect: (produto: Produto) => void;
};

export function ProdutoSearchPicker({ selected, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Produto[]>([]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setItems([]);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get("/api/products", {
          params: { search: query, limit: 8 },
        });
        if (active) setItems(res.data?.data ?? []);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquise por nome, código de barras, etiqueta ou referência"
          className="pl-9"
        />
      </div>

      {selected ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="font-medium">{selected.titulo}</div>
          <div className="text-xs text-muted-foreground">
            Código: {selected.codigobarras || "-"} | Etiqueta: {selected.etiqueta || "-"} | Local: {selected.local || "-"}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Buscando...</p> : null}
        {items.map((produto) => (
          <button
            key={produto.id}
            type="button"
            className="w-full rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-muted"
            onClick={() => onSelect(produto)}
          >
            <div className="font-medium">{produto.titulo}</div>
            <div className="text-xs text-muted-foreground">
              Código: {produto.codigobarras || "-"} | Estoque: {produto.estoque ?? 0}
            </div>
          </button>
        ))}
      </div>

      {selected ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setQ(selected.titulo ?? "")}>
          Pesquisar novamente
        </Button>
      ) : null}
    </div>
  );
}
