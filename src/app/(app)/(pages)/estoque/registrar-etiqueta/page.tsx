"use client";

import { useState } from "react";
import axios from "axios";
import { CheckCircle2, ChevronLeft, ChevronRight, LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCodeInput } from "../components/dialog-produto/qr-code-input";
import { ProdutoSearchPicker } from "../components/produto-search-picker";
import type { Produto } from "../types";

type Step = 1 | 2 | 3 | 4;

export default function RegistrarEtiquetaPage() {
  const [step, setStep] = useState<Step>(1);
  const [etiqueta, setEtiqueta] = useState("");
  const [codigoProduto, setCodigoProduto] = useState("");
  const [produto, setProduto] = useState<Produto | null>(null);
  const [saving, setSaving] = useState(false);

  const buscarPorCodigo = async () => {
    const q = codigoProduto.trim();
    if (!q) return;

    const res = await axios.get("/api/products", { params: { search: q, limit: 5 } });
    const items: Produto[] = res.data?.data ?? [];
    const match =
      items.find((item) => item.codigobarras === q || String(item.id) === q || item.etiqueta === q) ??
      items[0];

    if (!match) {
      toast.error("Produto não encontrado");
      return;
    }

    setProduto(match);
  };

  const confirmar = async () => {
    if (!produto?.id || !etiqueta.trim()) return;

    setSaving(true);
    try {
      await axios.patch(`/api/products/${produto.id}`, { etiqueta: etiqueta.trim() });
      toast.success("Etiqueta vinculada");
      setStep(4);
    } catch (err: any) {
      toast.error("Não foi possível vincular", {
        description: err?.response?.data?.error ?? "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
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
            {step === 3 && "Conferência"}
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
              onChange={setEtiqueta}
            />
            <Button className="w-full gap-2" disabled={!etiqueta.trim()} onClick={() => setStep(2)}>
              Próximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="codigo-produto">Código do produto ou código de barras</Label>
              <div className="flex gap-2">
                <Input
                  id="codigo-produto"
                  value={codigoProduto}
                  onChange={(e) => setCodigoProduto(e.target.value)}
                  placeholder="Digite ou leia o código do produto"
                />
                <Button type="button" variant="outline" onClick={buscarPorCodigo}>
                  Buscar
                </Button>
              </div>
            </div>

            <ProdutoSearchPicker selected={produto} onSelect={setProduto} />

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button className="flex-1 gap-2" disabled={!produto} onClick={() => setStep(3)}>
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
                <LinkIcon className="h-4 w-4" />
                Conferir vínculo
              </div>
              <p>Etiqueta: <b>{etiqueta}</b></p>
              <p>Produto: <b>{produto?.titulo}</b></p>
              <p>Código de barras: <b>{produto?.codigobarras || "-"}</b></p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button className="flex-1" disabled={saving} onClick={confirmar}>
                {saving ? "Salvando..." : "Confirmar vínculo"}
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
                setCodigoProduto("");
                setProduto(null);
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
