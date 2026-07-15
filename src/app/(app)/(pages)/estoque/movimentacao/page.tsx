"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, MapPinned } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { QrCodeInput } from "../components/dialog-produto/qr-code-input";
import { ProdutoIdentificadoCard } from "../components/produto-identificado-card";
import { ProdutoSearchPicker } from "../components/produto-search-picker";
import type { Produto } from "../types";

type Step = 1 | 2 | 3 | 4;

function findExactProduct(items: Produto[], code: string) {
  const normalized = code.trim().toLowerCase();
  return (
    items.find(
      (item) =>
        String(item.etiqueta ?? "").trim().toLowerCase() === normalized ||
        String(item.codigobarras ?? "").trim().toLowerCase() === normalized ||
        String(item.id ?? "").trim().toLowerCase() === normalized
    ) ?? null
  );
}

export default function MovimentacaoPage() {
  const [step, setStep] = useState<Step>(1);
  const [codigoProduto, setCodigoProduto] = useState("");
  const [produto, setProduto] = useState<Produto | null>(null);
  const [produtoError, setProdutoError] = useState<string | null>(null);
  const [buscandoProduto, setBuscandoProduto] = useState(false);
  const [local, setLocal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = codigoProduto.trim();
    setProdutoError(null);

    if (!q) {
      setProduto(null);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      setBuscandoProduto(true);
      try {
        const res = await axios.get("/api/products", { params: { search: q, limit: 10 } });
        const items: Produto[] = res.data?.data ?? [];
        const match = findExactProduct(items, q);

        if (!active) return;

        if (!match) {
          setProduto(null);
          setProdutoError("Etiqueta nao vinculada a um produto.");
          toast.error("Nao existem produtos vinculados a esta etiqueta");
          return;
        }

        setProduto(match);
      } catch (err: any) {
        if (!active) return;
        setProduto(null);
        setProdutoError(err?.response?.data?.error ?? "Nao foi possivel buscar o produto.");
      } finally {
        if (active) setBuscandoProduto(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [codigoProduto]);

  const confirmar = async () => {
    if (!produto?.id || !local.trim()) return;

    setSaving(true);
    try {
      await axios.patch(`/api/products/${produto.id}`, { local: local.trim() });
      toast.success("Local atualizado");
      setStep(4);
    } catch (err: any) {
      toast.error("Nao foi possivel registrar movimentacao", {
        description: err?.response?.data?.error ?? "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Movimentacao</h1>
        <p className="text-sm text-muted-foreground">Atualize o local de armazenamento de um produto.</p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-center justify-between text-sm">
          <span>Passo {step} de 4</span>
          <span className="text-muted-foreground">
            {step === 1 && "Produto"}
            {step === 2 && "Local"}
            {step === 3 && "Conferencia"}
            {step === 4 && "Finalizado"}
          </span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <QrCodeInput
              id="mov-produto"
              label="Etiqueta/codigo do produto"
              value={codigoProduto}
              placeholder="Leia o QR, codigo de barras ou digite"
              onChange={setCodigoProduto}
            />

            {buscandoProduto ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando produto...
              </div>
            ) : null}

            {produtoError ? <p className="text-sm text-destructive">{produtoError}</p> : null}
            {produto ? <ProdutoIdentificadoCard produto={produto} /> : null}

            <ProdutoSearchPicker
              selected={produto}
              onSelect={(item) => {
                setProduto(item);
                setProdutoError(null);
              }}
              showSelected={false}
            />

            <Button className="w-full gap-2" disabled={!produto} onClick={() => setStep(2)}>
              Proximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <QrCodeInput
              id="mov-local"
              label="Local de destino"
              value={local}
              placeholder="Ex: CX-001"
              onChange={setLocal}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button className="flex-1 gap-2" disabled={!local.trim()} onClick={() => setStep(3)}>
                Proximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <MapPinned className="h-4 w-4" />
                Conferir movimentacao
              </div>
              {produto ? <ProdutoIdentificadoCard produto={produto} /> : null}
              <div className="mt-3 space-y-1">
                <p>Local atual: <b>{produto?.local || "-"}</b></p>
                <p>Novo local: <b>{local}</b></p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button className="flex-1" disabled={saving} onClick={confirmar}>
                {saving ? "Salvando..." : "Confirmar"}
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <div>
              <h2 className="font-semibold">Local atualizado</h2>
              <p className="text-sm text-muted-foreground">O produto foi direcionado para {local}.</p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setStep(1);
                setCodigoProduto("");
                setProduto(null);
                setProdutoError(null);
                setLocal("");
              }}
            >
              Registrar outra movimentacao
            </Button>
          </div>
        )}

        <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Esta versao simples atualiza apenas o campo local do produto. Historico e quantidade por caixa podem ser adicionados depois.
        </div>
      </div>
    </div>
  );
}
