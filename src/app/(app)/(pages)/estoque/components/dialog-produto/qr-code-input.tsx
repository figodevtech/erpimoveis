"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  label: string;
  value?: string | null;
  placeholder?: string;
  loading?: boolean;
  loadingLabel?: string;
  uppercase?: boolean;
  onChange: (value: string) => void;
  onScan?: (value: string) => void;
};

/** Largura maxima do quadro analisado pelo jsQR, em pixels. */
const MAX_SCAN_WIDTH = 640;

function normalizeQrValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("ERP:ETQ:")) return trimmed.slice("ERP:ETQ:".length);
  return trimmed;
}

export function QrCodeInput({
  id,
  label,
  value,
  placeholder,
  loading = false,
  loadingLabel,
  uppercase = false,
  onChange,
  onScan,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Os callbacks chegam como arrow inline dos pais, ou seja, com identidade nova
  // a cada render deles. Lidos por ref, eles ficam fora das dependencias do
  // efeito abaixo — senao qualquer render do pai derrubaria a camera no meio da
  // leitura e pediria um getUserMedia novo.
  const onChangeRef = useRef(onChange);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onChangeRef.current = onChange;
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!open) return;

    let active = true;

    async function startCamera() {
      setError(null);

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(
            window.isSecureContext === false
              ? "A camera exige uma conexao segura (https). Abra o sistema por https ou digite o codigo manualmente."
              : "Camera nao disponivel neste navegador. Digite o codigo manualmente.",
          );
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
          // play() nao pode ser aguardado aqui: no Android ele rejeita com
          // AbortError enquanto o dialog ainda esta animando, e o await levava
          // esse erro ao catch de baixo, matando o loop de leitura inteiro.
          void videoRef.current.play().catch(() => undefined);
        }

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        const detector = BarcodeDetectorCtor
          ? new BarcodeDetectorCtor({ formats: ["qr_code"] })
          : null;
        const { default: decodeQr } = await import("jsqr");

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
            // A analise roda numa copia reduzida: getImageData + jsQR sobre um
            // quadro 1080p a cada frame trava celular intermediario, e o QR de
            // uma etiqueta continua legivel nessa escala.
            const scale = Math.min(1, MAX_SCAN_WIDTH / (video.videoWidth || 1));
            const width = Math.round(video.videoWidth * scale);
            const height = Math.round(video.videoHeight * scale);

            if (canvas && width > 0 && height > 0) {
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });

              if (ctx) {
                ctx.drawImage(video, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const result = decodeQr(imageData.data, width, height, {
                  inversionAttempts: "dontInvert",
                });
                rawValue = result?.data;
              }
            }
          }

          if (rawValue) {
            const normalized = normalizeQrValue(rawValue);
            const scannedValue = uppercase ? normalized.toUpperCase() : normalized;
            onChangeRef.current(scannedValue);
            onScanRef.current?.(scannedValue);
            setOpen(false);
            return;
          }

          rafRef.current = window.requestAnimationFrame(scan);
        };

        rafRef.current = window.requestAnimationFrame(scan);
      } catch (cameraError) {
        // O motivo importa no diagnostico: permissao negada, camera ocupada por
        // outro app e navegador sem suporte tem solucoes diferentes.
        const name = cameraError instanceof Error ? cameraError.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("Permissao de camera negada. Libere a camera para este site nas configuracoes do navegador.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("Nenhuma camera encontrada neste aparelho.");
        } else if (name === "NotReadableError") {
          setError("A camera esta em uso por outro aplicativo. Feche-o e tente de novo.");
        } else {
          setError(`Nao foi possivel acessar a camera${name ? ` (${name})` : ""}. Verifique as permissoes do navegador.`);
        }
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
  }, [open, uppercase]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            value={value ?? ""}
            placeholder={placeholder}
            className={loading ? "pr-10" : undefined}
            onChange={(event) => onChange(uppercase ? event.target.value.toUpperCase() : event.target.value)}
          />
          {loading ? (
            <Loader2
              aria-label={loadingLabel ?? "Carregando"}
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>
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
              <video ref={videoRef} className="aspect-square w-full object-cover" autoPlay muted playsInline />
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
