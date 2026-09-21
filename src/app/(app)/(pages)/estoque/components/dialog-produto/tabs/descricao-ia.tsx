"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Produto } from "../../../types";

export function DescricaoIA({ produto, onChange, field = "descricao" }: {
  produto: Produto;
  onChange: (field: keyof Produto, value: string) => void;
  field?: "descricao" | "descricaoMarketplace";
}) {
  const [gerandoDescricao, setGerandoDescricao] = useState(false);
  const [sugestaoIA, setSugestaoIA] = useState<string | null>(null);
  const [erroIA, setErroIA] = useState<string | null>(null);
  const geracaoEmAndamento = useRef(false);
  const dadosIA = JSON.stringify({
    titulo: produto.titulo?.trim() || produto.tituloMarketplace?.trim() || "",
    descricao: produto.descricao || undefined,
    fabricante: produto.fabricante || undefined,
    referencia: produto.referencia || undefined,
    conservacao: produto.conservacao || undefined,
    unidade: produto.unidade || undefined,
    grupo: produto.grupo?.nome || undefined,
  });
  const contextoIA = `${produto.id ?? "novo"}:${dadosIA}:${produto[field] ?? ""}`;
  const contextoAtualIA = useRef(contextoIA);

  useEffect(() => {
    contextoAtualIA.current = contextoIA;
    setSugestaoIA(null);
    setErroIA(null);
    return () => { contextoAtualIA.current = ""; };
  }, [contextoIA]);

  async function gerarDescricao() {
    if (geracaoEmAndamento.current) return;
    geracaoEmAndamento.current = true;
    setGerandoDescricao(true);
    setErroIA(null);
    setSugestaoIA(null);
    try {
      const response = await fetch("/api/ia/descricao-produto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), produto: JSON.parse(dadosIA) }),
      });
      const result = await response.json();
      if (contextoAtualIA.current !== contextoIA) return;
      if (!response.ok) throw new Error(result.error || "Não foi possível gerar a descrição.");
      setSugestaoIA(result.descricao);
    } catch (error) {
      if (contextoAtualIA.current === contextoIA) {
        setErroIA(error instanceof Error ? error.message : "Não foi possível gerar a descrição.");
      }
    } finally {
      geracaoEmAndamento.current = false;
      setGerandoDescricao(false);
    }
  }

  return <>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={gerarDescricao}
                disabled={gerandoDescricao || (produto.titulo?.trim() || produto.tituloMarketplace?.trim() || "").length < 3}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                {gerandoDescricao ? "Gerando descrição..." : "Gerar descrição com IA"}
              </Button>
              <span className="text-xs text-muted-foreground">Revise a sugestão antes de aplicar.</span>
            </div>
            {erroIA && <p role="alert" className="text-xs text-destructive">{erroIA}</p>}
            {sugestaoIA && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3" aria-live="polite">
                <p className="text-xs font-medium">Sugestão da IA</p>
                <p className="whitespace-pre-wrap text-sm">{sugestaoIA}</p>
                <p className="text-xs text-muted-foreground">
                  Confira as informações. Aplicar substitui a descrição acima; salve o produto para confirmar.
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => {
                    onChange(field, sugestaoIA);
                    setSugestaoIA(null);
                  }}>Aplicar descrição</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSugestaoIA(null)}>Descartar</Button>
                </div>
              </div>
            )}
  </>;
}
