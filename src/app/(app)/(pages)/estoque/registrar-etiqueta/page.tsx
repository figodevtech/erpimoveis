"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { CheckCircle2, ChevronLeft, ChevronRight, LinkIcon, PackageSearch } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { QrCodeInput } from "../components/dialog-produto/qr-code-input";
import { DialogProduto } from "../components/dialog-produto/dialog-produto";
import { ProdutoIdentificadoCard } from "../components/produto-identificado-card";
import ProductSelect from "@/app/(app)/components/productSelect";
import type { Produto } from "../types";

type Step = 1 | 2 | 3 | 4;

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
  const [etiquetaDisponivel, setEtiquetaDisponivel] = useState(false);
  const [produto, setProduto] = useState<Produto | null>(null);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [productSelectOpen, setProductSelectOpen] = useState(false);
  const verificacaoIdRef = useRef(0);

  const verificarEtiqueta = async (value: string) => {
    const q = value.trim();
    const verificacaoId = ++verificacaoIdRef.current;
    setEtiquetaError(null);
    setEtiquetaVinculada(null);
    setEtiquetaDisponivel(false);

    if (!q) return "empty" as const;

    setChecandoEtiqueta(true);
    try {
      const res = await axios.get("/api/products", { params: { exactEtiqueta: q } });
      const items: Produto[] = res.data?.data ?? [];
      const match = findProductByEtiqueta(items, q);
      if (verificacaoId !== verificacaoIdRef.current) return "stale" as const;

      if (match) {
        setEtiquetaVinculada(match);
        return "linked" as const;
      }

      setEtiquetaDisponivel(true);
      return "available" as const;
    } catch (err: any) {
      if (verificacaoId !== verificacaoIdRef.current) return "stale" as const;
      const message = err?.response?.data?.error ?? "Nao foi possivel verificar a etiqueta.";
      setEtiquetaError(message);
      return "error" as const;
    } finally {
      if (verificacaoId === verificacaoIdRef.current) setChecandoEtiqueta(false);
    }
  };

  useEffect(() => {
    const q = etiqueta.trim();

    if (!q) {
      verificacaoIdRef.current += 1;
      setEtiquetaVinculada(null);
      setEtiquetaError(null);
      setChecandoEtiqueta(false);
      setEtiquetaDisponivel(false);
      return;
    }

    const timeout = window.setTimeout(async () => {
      await verificarEtiqueta(q);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [etiqueta]);

  const atualizarProdutoConsultado = async () => {
    if (!etiquetaVinculada?.id) return;
    try {
      const response = await axios.get(`/api/products/${etiquetaVinculada.id}`);
      const atualizado = response.data?.data as Produto;
      if (String(atualizado.etiqueta ?? "").trim().toLowerCase() === etiqueta.trim().toLowerCase()) {
        setEtiquetaVinculada(atualizado);
      } else {
        setEtiquetaVinculada(null);
        setEtiquetaDisponivel(true);
      }
    } catch {
      await verificarEtiqueta(etiqueta);
    }
  };

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

    const status = await verificarEtiqueta(q);
    if (status === "available") setStep(2);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Registro/Consulta de Etiqueta</h1>
        <p className="text-sm text-muted-foreground">Consulte uma etiqueta ou vincule-a a um produto.</p>
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
              uppercase
              onChange={setEtiqueta}
            />

            {etiquetaError ? <p className="text-sm text-destructive">{etiquetaError}</p> : null}
            {etiquetaDisponivel && !checandoEtiqueta ? (
              <p className="text-sm text-emerald-600">Etiqueta disponível para vínculo.</p>
            ) : null}
            {etiquetaVinculada ? (
              <ProdutoIdentificadoCard produto={etiquetaVinculada} onEdit={() => setEditOpen(true)} />
            ) : null}

            <Button
              className="w-full gap-2"
              disabled={!etiqueta.trim() || checandoEtiqueta || !etiquetaDisponivel || !!etiquetaVinculada}
              onClick={avancarParaProduto}
            >
              Proximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-medium">Selecione um produto</h2>
              <p className="text-sm text-muted-foreground">Pesquise e escolha um produto cadastrado no sistema.</p>
            </div>
            <ProductSelect
              open={productSelectOpen}
              setOpen={setProductSelectOpen}
              OnSelect={(item) => setProduto(item)}
            >
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2 font-normal"
              >
                <PackageSearch className="h-4 w-4" />
                {produto ? produto.titulo || `Produto #${produto.id}` : "Selecionar produto"}
              </Button>
            </ProductSelect>

            {produto ? <ProdutoIdentificadoCard produto={produto} /> : null}

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
                setProduto(null);
              }}
            >
              Registrar outra etiqueta
            </Button>
          </div>
        )}
      </div>

      {etiquetaVinculada?.id ? (
        <DialogProduto
          productId={etiquetaVinculada.id}
          isOpen={editOpen}
          setIsOpen={setEditOpen}
          onAfterSaveProduct={() => void atualizarProdutoConsultado()}
        />
      ) : null}
    </div>
  );
}
