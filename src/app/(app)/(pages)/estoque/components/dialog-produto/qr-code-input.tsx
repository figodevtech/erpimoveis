"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  label: string;
  value?: string | null;
  placeholder?: string;
  onChange: (value: string) => void;
};

function normalizeQrValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("ERP:ETQ:")) return trimmed.slice("ERP:ETQ:".length);
  return trimmed;
}

export function QrCodeInput({ id, label, value, placeholder, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    let active = true;

    async function startCamera() {
      setError(null);

      const BarcodeDetectorCtor = (window as any).BarcodeDetector;
      if (!BarcodeDetectorCtor) {
        setError("Leitura por câmera não suportada neste navegador. Digite o código manualmente.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });

        const scan = async () => {
          if (!active || !videoRef.current) return;

          try {
            const codes = await detector.detect(videoRef.current);
            const rawValue = codes?.[0]?.rawValue;
            if (rawValue) {
              onChange(normalizeQrValue(String(rawValue)));
              setOpen(false);
              return;
            }
          } catch {
            // Mantem a câmera aberta e tenta novamente no próximo frame.
          }

          rafRef.current = window.requestAnimationFrame(scan);
        };

        rafRef.current = window.requestAnimationFrame(scan);
      } catch {
        setError("Não foi possível acessar a câmera. Verifique as permissões do navegador.");
      }
    }

    void startCamera();

    return () => {
      active = false;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [onChange, open]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => setOpen(true)}>
          <Camera className="h-4 w-4" />
          QR
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ler QR Code</DialogTitle>
            <DialogDescription>Aponte a câmera para a etiqueta.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border bg-muted">
              <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="button" variant="outline" className="w-full gap-2" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
              Fechar câmera
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
