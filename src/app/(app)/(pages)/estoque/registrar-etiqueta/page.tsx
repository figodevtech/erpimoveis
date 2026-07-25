"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, ChevronLeft, ChevronRight, LinkIcon, Loader2 } from "lucide-react";
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
        String(item.codigobarras ?? "").trim().toLowerCase() === normalized ||
        String(item.id ?? "").trim().toLowerCase() === normalized ||
        String(item.etiqueta ?? "").trim().toLowerCase() === normalized
    ) ?? null
  );
}

function findProductByEtiqueta(items: Produto[], etiqueta: string) {
  const normalized = etiqueta.trim().toLowerCase();
  return items.find((item) => String(item.etiqueta ?? "").trim().toLowerCase() === normalized) ?? null;
}

export default function RegistrarEtiquetaPage() {
  const [step, setStep] = useState<Step>(1);
  const [etiqueta, setEtiqueta] = useState("");
  const [etiquetaVinculada, setEtiquetaVinculada] = useState<Produto | null>(null);
  const [etiquetaError, setEtiquetaError] = useState<string | null>(null);
  const [checandoEtiqueta, setChecandoEtiqueta] = useState(false);
  const [codigoProduto, setCodigoProduto] = useState("");
  const [produto, setProduto] = useState<Produto | null>(null);
  const [produtoError, setProdutoError] = useState<string | null>(null);
  const [buscandoProduto, setBuscandoProduto] = useState(false);
  const [saving, setSaving] = useState(false);

  const verificarEtiqueta = async (value: string) => {
    const q = value.trim();
    setEtiquetaError(null);
    setEtiquetaVinculada(null);

    if (!q) return null;

    setChecandoEtiqueta(true);
    try {
      const res = await axios.get("/api/products", { params: { search: q, limit: 10 } });
      const items: Produto[] = res.data?.data ?? [];
      const match = findProductByEtiqueta(items, q);

      if (match) {
        setEtiquetaVinculada(match);
        setEtiquetaError("Esta etiqueta ja esta vinculada a um produto.");
        return match;
      }

      return null;
    } catch (err: any) {
      const message = err?.response?.data?.error ?? "Nao foi possivel verificar a etiqueta.";
      setEtiquetaError(message);
      return null;
    } finally {
      setChecandoEtiqueta(false);
    }
  };

  useEffect(() => {
    const q = etiqueta.trim();

    if (!q) {
      setEtiquetaVinculada(null);
      setEtiquetaError(null);
      setChecandoEtiqueta(false);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      await verificarEtiqueta(q);
      if (!active) return;
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [etiqueta]);

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
          setProdutoError("Produto nao encontrado para este codigo.");
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
    if (!produto?.id || !etiqueta.trim()) return;

    setSaving(true);
    try {
      await axios.patch(`/api/products/${produto.id}`, {
        changes: {
          etiqueta: {
            original: produto.etiqueta ?? null,
            value: etiqueta.trim(),
          },
        },
      });
      toast.success("Etiqueta vinculada");
      setStep(4);
    } catch (err: any) {
      const apiMessage = err?.response?.data?.error as string | undefined;
      const concurrentConflict = err?.response?.status === 409 && apiMessage?.includes("alterado por outro");
      toast.error("Nao foi possivel vincular", {
        description: concurrentConflict
          ? "A etiqueta deste produto foi alterada por outra pessoa. Busque o produto novamente."
          : apiMessage ?? "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  const avancarParaProduto = async () => {
    const q = etiqueta.trim();
    if (!q) return;

    const match = await verificarEtiqueta(q);
    if (match) {
      toast.error("Etiqueta ja vinculada a um produto");
      return;
    }

    setStep(2);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Registrar Etiqueta</h1>
        <p className="text-sm text-muted-foreground">Vincule uma etiqueta impressa a um produto.</p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-center justify-between text-sm">
          <span>Passo {step} de 4</span>
          <span className="text-muted-foreground">
            {step === 1 && "Etiqueta"}
            {step === 2 && "Produto"}
            {step === 3 && "Conferencia"}
            {step === 4 && "Finalizado"}
          </span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <QrCodeInput
              id="registrar-etiqueta"
              label="Etiqueta"
              value={etiqueta}
              placeholder="Ex: PRD-000123"
              loading={checandoEtiqueta}
              loadingLabel="Verificando etiqueta"
              onChange={setEtiqueta}
            />

            {etiquetaError ? <p className="text-sm text-destructive">{etiquetaError}</p> : null}
            {etiquetaVinculada ? <ProdutoIdentificadoCard produto={etiquetaVinculada} /> : null}

            <Button
              className="w-full gap-2"
              disabled={!etiqueta.trim() || checandoEtiqueta || !!etiquetaVinculada}
              onClick={avancarParaProduto}
            >
              Proximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <QrCodeInput
              id="codigo-produto"
              label="Codigo do produto ou codigo de barras"
              value={codigoProduto}
              placeholder="Digite ou leia o codigo do produto"
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

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button className="flex-1 gap-2" disabled={!produto} onClick={() => setStep(3)}>
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
                <LinkIcon className="h-4 w-4" />
                Conferir vinculo
              </div>
              <p className="mb-3">Etiqueta: <b>{etiqueta}</b></p>
              {produto ? <ProdutoIdentificadoCard produto={produto} /> : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button className="flex-1" disabled={saving} onClick={confirmar}>
                {saving ? "Salvando..." : "Confirmar vinculo"}
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <div>
              <h2 className="font-semibold">Etiqueta vinculada</h2>
              <p className="text-sm text-muted-foreground">{etiqueta} foi vinculada ao produto.</p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setStep(1);
                setEtiqueta("");
                setEtiquetaVinculada(null);
                setEtiquetaError(null);
                setCodigoProduto("");
                setProduto(null);
                setProdutoError(null);
              }}
            >
              Registrar outra etiqueta
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
