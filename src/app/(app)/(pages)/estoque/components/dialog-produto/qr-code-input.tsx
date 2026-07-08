"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    let active = true;

    async function startCamera() {
      setError(null);

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Camera nao disponivel neste navegador. Digite o codigo manualmente.");
          return;
        }

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

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        const detector = BarcodeDetectorCtor
          ? new BarcodeDetectorCtor({ formats: ["qr_code"] })
          : null;

        const scan = async () => {
          if (!active || !videoRef.current) return;

          let rawValue: string | undefined;

          if (detector) {
            try {
              const codes = await detector.detect(videoRef.current);
              rawValue = codes?.[0]?.rawValue ? String(codes[0].rawValue) : undefined;
            } catch {
              rawValue = undefined;
            }
          }

          if (!rawValue) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const width = video.videoWidth;
            const height = video.videoHeight;

            if (canvas && width > 0 && height > 0) {
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });

              if (ctx) {
                ctx.drawImage(video, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const result = jsQR(imageData.data, width, height, {
                  inversionAttempts: "dontInvert",
                });
                rawValue = result?.data;
              }
            }
          }

          if (rawValue) {
            onChange(normalizeQrValue(rawValue));
            setOpen(false);
            return;
          }

          rafRef.current = window.requestAnimationFrame(scan);
        };

        rafRef.current = window.requestAnimationFrame(scan);
      } catch {
        setError("Nao foi possivel acessar a camera. Verifique as permissoes do navegador.");
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
            <DialogDescription>Aponte a camera para a etiqueta.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border bg-muted">
              <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <p className="text-xs text-muted-foreground">
              Se a camera nao abrir, confira as permissoes do navegador ou digite o codigo manualmente.
            </p>
            <Button type="button" variant="outline" className="w-full gap-2" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
              Fechar camera
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
