"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { ScanBarcode, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraScannerDialog } from "./camera-scanner-dialog";
import { onlyDigits } from "./lib/utils";

type ProdutoComMesmoCodigo = {
  id: number;
  titulo: string | null;
  referencia: string | null;
};

type Props = {
  /** Produto em edicao, para nao se acusar como duplicado. Vazio no cadastro. */
  produtoId?: number;
  value?: string | null;
  onChange: (value: string) => void;
};

/** Espera a digitacao parar antes de consultar; o leitor USB digita tudo de uma vez. */
const DEBOUNCE_MS = 400;

export function CodigoBarrasInput({ produtoId, value, onChange }: Props) {
  const [cameraOpen, setCameraOpen] = useState(false);
  // O resultado guarda o codigo consultado: enquanto o campo muda e a consulta
  // nova nao volta, o aviso do codigo anterior nao aparece para o novo.
  const [consulta, setConsulta] = useState<{
    codigo: string;
    produtoId?: number;
    produtos: ProdutoComMesmoCodigo[];
  } | null>(null);

  const codigo = value ?? "";
  const duplicados =
    consulta?.codigo === codigo && consulta.produtoId === produtoId ? consulta.produtos : [];

  useEffect(() => {
    if (codigo.length < 8) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await axios.get("/api/products/codigo-barras", {
          params: { codigo, excluir: produtoId },
          signal: controller.signal,
        });
        setConsulta({ codigo, produtoId, produtos: res.data?.produtos ?? [] });
      } catch (err) {
        // O aviso e uma conveniencia: se a consulta falhar, o cadastro segue.
        if (!axios.isCancel(err)) {
          console.error("Erro ao verificar codigo de barras:", err);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [codigo, produtoId]);

  return (
    <div className="space-y-2">
      <Label htmlFor="codigobarras">Código de Barras</Label>
      <div className="flex gap-2">
        <Input
          id="codigobarras"
          value={codigo}
          onChange={(e) => onChange(onlyDigits(e.target.value))}
          placeholder="7891234567890"
          inputMode="numeric"
          maxLength={14}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => setCameraOpen(true)}
          title="Ler código de barras pela câmera"
          aria-label="Ler código de barras pela câmera"
        >
          <ScanBarcode className="h-4 w-4" />
        </Button>
      </div>

      {duplicados.length > 0 ? (
        <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">
              {duplicados.length === 1 ? "Código já usado em outro produto:" : "Código já usado em outros produtos:"}
            </p>
            {duplicados.map((p) => (
              <p key={p.id} className="truncate">
                #{p.id} · {p.titulo || "Sem título"}
                {p.referencia ? ` · Ref. ${p.referencia}` : ""}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <CameraScannerDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        kind="barcode"
        title="Ler código de barras"
        description="Aponte a câmera para o código de barras da embalagem, centralizado na linha vermelha."
        onDetected={(scanned) => onChange(onlyDigits(scanned).slice(0, 14))}
      />
    </div>
  );
}
