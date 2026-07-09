"use client";

import { useState } from "react";
import axios from "axios";
import { CheckCircle2, ChevronLeft, ChevronRight, MapPinned } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QrCodeInput } from "../components/dialog-produto/qr-code-input";
import { ProdutoSearchPicker } from "../components/produto-search-picker";
import type { Produto } from "../types";

type Step = 1 | 2 | 3 | 4;

export default function MovimentacaoPage() {
  const [step, setStep] = useState<Step>(1);
  const [codigoProduto, setCodigoProduto] = useState("");
  const [produto, setProduto] = useState<Produto | null>(null);
  const [local, setLocal] = useState("");
  const [saving, setSaving] = useState(false);

  const buscarProduto = async () => {
    const q = codigoProduto.trim();
    if (!q) return;

    const res = await axios.get("/api/products", { params: { search: q, limit: 5 } });
    const items: Produto[] = res.data?.data ?? [];
    const match =
      items.find((item) => item.etiqueta === q || item.codigobarras === q || String(item.id) === q) ??
      items[0];

    if (!match) {
      toast.error("Produto não encontrado");
      return;
    }

    setProduto(match);
  };

  const confirmar = async () => {
    if (!produto?.id || !local.trim()) return;

    setSaving(true);
    try {
      await axios.patch(`/api/products/${produto.id}`, { local: local.trim() });
      toast.success("Local atualizado");
      setStep(4);
    } catch (err: any) {
      toast.error("Não foi possível registrar movimentação", {
        description: err?.response?.data?.error ?? "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Movimentação</h1>
        <p className="text-sm text-muted-foreground">Atualize o local de armazenamento de um produto.</p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-center justify-between text-sm">
          <span>Passo {step} de 4</span>
          <span className="text-muted-foreground">
            {step === 1 && "Produto"}
            {step === 2 && "Local"}
            {step === 3 && "Conferência"}
            {step === 4 && "Finalizado"}
          </span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <QrCodeInput
              id="mov-produto"
              label="Etiqueta/código do produto"
              value={codigoProduto}
              placeholder="Leia o QR, código de barras ou digite"
              onChange={setCodigoProduto}
            />
            <Button type="button" variant="outline" className="w-full" onClick={buscarProduto}>
              Buscar por código
            </Button>
            <ProdutoSearchPicker selected={produto} onSelect={setProduto} />
            <Button className="w-full gap-2" disabled={!produto} onClick={() => setStep(2)}>
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
              <p>Produto: <b>{produto?.titulo}</b></p>
              <p>Etiqueta: <b>{produto?.etiqueta || "-"}</b></p>
              <p>Local atual: <b>{produto?.local || "-"}</b></p>
              <p>Novo local: <b>{local}</b></p>
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
                setLocal("");
              }}
            >
              Registrar outra movimentação
            </Button>
          </div>
        )}

        <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Esta versão simples atualiza apenas o campo local do produto. Histórico e quantidade por caixa podem ser adicionados depois.
        </div>
      </div>
    </div>
  );
}
