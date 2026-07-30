"use client";

import { useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lookupInventoryLabel, type InventoryLabelItem, type InventoryLabelKind } from "@/lib/inventory-labels";
import { toast } from "@/lib/toast";
import { InventoryItemFoundCard } from "../components/inventory-item-found-card";
import { QrCodeInput } from "../components/dialog-produto/qr-code-input";

type Step = 1 | 2 | 3 | 4;
type MovementTarget = { kind: InventoryLabelKind; item: InventoryLabelItem };

function errorText(error: unknown, fallback: string) {
  if (isAxiosError(error)) return error.response?.data?.error ?? fallback;
  return error instanceof Error ? error.message : fallback;
}

export default function MovimentacaoPage() {
  const [step, setStep] = useState<Step>(1);
  const [codigoItem, setCodigoItem] = useState("");
  const [target, setTarget] = useState<MovementTarget | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [buscandoItem, setBuscandoItem] = useState(false);
  const [local, setLocal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const code = codigoItem.trim();
    setItemError(null);

    if (!code) {
      setBuscandoItem(false);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      setBuscandoItem(true);
      try {
        const lookup = await lookupInventoryLabel(code);
        if (!active) return;

        if (lookup.status === "CONFLICT") {
          setTarget(null);
          setItemError("Este código está vinculado a mais de um item. Corrija o conflito de etiquetas antes de movimentar.");
          return;
        }

        const match = lookup.matches[0];
        if (!match) {
          setTarget(null);
          setItemError("Etiqueta ou código de barras não vinculado a produto nem a item de uso/consumo.");
          return;
        }

        if (match.restricted || !match.item) {
          setTarget(null);
          setItemError(`A etiqueta pertence ao módulo ${match.kind === "PRODUTO" ? "de produtos" : "de uso/consumo"}, mas seu perfil não possui acesso.`);
          return;
        }

        setTarget({ kind: match.kind, item: match.item });
      } catch (error) {
        if (!active) return;
        setTarget(null);
        setItemError(errorText(error, "Não foi possível consultar a etiqueta."));
      } finally {
        if (active) setBuscandoItem(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [codigoItem]);

  const confirmar = async () => {
    if (!target || !local.trim()) return;

    setSaving(true);
    try {
      if (target.kind === "PRODUTO") {
        await axios.patch(`/api/products/${target.item.id}`, {
          changes: { local: { original: target.item.local ?? null, value: local.trim() } },
        });
      } else {
        await axios.patch(`/api/usoconsumo/itens/${target.item.id}`, {
          local: local.trim(),
          ...(target.item.updated_at ? { expectedUpdatedAt: target.item.updated_at } : {}),
        });
      }
      toast.success("Local atualizado", {
        description: `${target.kind === "PRODUTO" ? "Produto" : "Item de uso/consumo"} direcionado para ${local.trim()}.`,
      });
      setStep(4);
    } catch (error) {
      toast.error("Não foi possível registrar a movimentação", {
        description: errorText(error, "Tente novamente."),
      });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStep(1);
    setCodigoItem("");
    setTarget(null);
    setItemError(null);
    setLocal("");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
            <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-center justify-between text-sm">
          <span>Passo {step} de 4</span>
          <span className="text-muted-foreground">
            {step === 1 && "Item"}
            {step === 2 && "Local"}
            {step === 3 && "Conferência"}
            {step === 4 && "Finalizado"}
          </span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <QrCodeInput
              id="mov-item"
              label="Etiqueta ou código de barras"
              value={codigoItem}
              placeholder="Leia o QR Code, código de barras ou digite"
              uppercase
              onChange={(value) => {
                setCodigoItem(value);
                setTarget(null);
              }}
            />

            {buscandoItem ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando nos estoques de produtos e uso/consumo...
              </div>
            ) : null}

            {itemError ? <p className="text-sm text-destructive">{itemError}</p> : null}
            {target ? <InventoryItemFoundCard kind={target.kind} item={target.item} subtitle="Pronto para movimentação" /> : null}

            <Button className="w-full gap-2" disabled={!target || buscandoItem} onClick={() => setStep(2)}>
              Próximo
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
                Próximo
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
                Conferir movimentação
              </div>
              {target ? <InventoryItemFoundCard kind={target.kind} item={target.item} subtitle="Confira os dados antes de confirmar" /> : null}
              <div className="mt-3 space-y-1">
                <p>Local atual: <b>{target?.item.local || "—"}</b></p>
                <p>Novo local: <b>{local}</b></p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button className="flex-1" disabled={saving || !target} onClick={confirmar}>
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
              <p className="text-sm text-muted-foreground">
                {target?.kind === "USOCONSUMO" ? "O item de uso/consumo" : "O produto"} foi direcionado para {local}.
              </p>
            </div>
            <Button className="w-full" onClick={reset}>Registrar outra movimentação</Button>
          </div>
        )}

        <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          A movimentação atualiza somente o local do registro identificado, sem alterar a quantidade em estoque.
        </div>
      </div>
    </div>
  );
}
