"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ScanKind = "qr" | "barcode";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ScanKind;
  title: string;
  description: string;
  /** Recebe o valor lido, sem tratamento. O dialog fecha sozinho em seguida. */
  onDetected: (value: string) => void;
};

/** Largura maxima do quadro analisado pelo jsQR, em pixels. */
const MAX_QR_SCAN_WIDTH = 640;
/**
 * Codigo de barras precisa de mais resolucao horizontal que o QR: a 640px as
 * barras finas de um EAN-13 a um palmo de distancia ja se fundem.
 */
const MAX_BARCODE_SCAN_WIDTH = 1280;
/** O zxing varre linhas do quadro inteiro; rodar a cada frame trava celular. */
const BARCODE_SCAN_INTERVAL_MS = 120;

/** Formatos de produto no varejo: EAN-13/8, UPC-A, ITF-14 (caixa) e Code 128. */
const BARCODE_DETECTOR_FORMATS = ["ean_13", "ean_8", "upc_a", "itf", "code_128"];

/** GTIN tem 8, 12, 13 ou 14 digitos; leitura fora disso e engano do decodificador. */
const GTIN_PATTERN = /^\d{8,14}$/;

type FrameDecoder = (video: HTMLVideoElement, canvas: HTMLCanvasElement | null) => Promise<string | undefined>;

function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement | null, maxWidth: number) {
  if (!canvas) return null;
  const scale = Math.min(1, maxWidth / (video.videoWidth || 1));
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  if (width <= 0 || height <= 0) return null;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function rotateClockwise(luminances: Uint8ClampedArray, width: number, height: number) {
  const rotated = new Uint8ClampedArray(luminances.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) rotated[x * height + (height - 1 - y)] = luminances[row + x];
  }
  return rotated;
}

async function createNativeDetector(formats: string[]) {
  const BarcodeDetectorCtor = (window as any).BarcodeDetector;
  if (!BarcodeDetectorCtor) return null;

  try {
    // Chrome no Windows e no Linux expoe a classe sem nenhum formato suportado;
    // so vale usar o nativo se ele de fato le o que precisamos.
    const supported: string[] = (await BarcodeDetectorCtor.getSupportedFormats?.()) ?? formats;
    const usable = formats.filter((format) => supported.includes(format));
    return usable.length ? new BarcodeDetectorCtor({ formats: usable }) : null;
  } catch {
    return null;
  }
}

async function detectNative(detector: any, video: HTMLVideoElement) {
  try {
    const codes = await detector.detect(video);
    return codes?.[0]?.rawValue ? String(codes[0].rawValue) : undefined;
  } catch {
    return undefined;
  }
}

async function createQrDecoder(): Promise<FrameDecoder> {
  const detector = await createNativeDetector(["qr_code"]);
  const { default: decodeQr } = await import("jsqr");

  return async (video, canvas) => {
    if (detector) {
      const value = await detectNative(detector, video);
      if (value) return value;
    }

    // A analise roda numa copia reduzida: getImageData + jsQR sobre um
    // quadro 1080p a cada frame trava celular intermediario, e o QR de
    // uma etiqueta continua legivel nessa escala.
    const imageData = drawFrame(video, canvas, MAX_QR_SCAN_WIDTH);
    if (!imageData) return undefined;
    return decodeQr(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" })?.data;
  };
}

async function createBarcodeDecoder(): Promise<FrameDecoder> {
  const detector = await createNativeDetector(BARCODE_DETECTOR_FORMATS);
  if (detector) return (video) => detectNative(detector, video);

  // Sem BarcodeDetector (Chrome desktop no Windows, Safari, Firefox) o zxing
  // decodifica o quadro em JS. Carregado sob demanda: so quem abre a camera paga.
  const zxing = await import("@zxing/library");
  // Sem TRY_HARDER de proposito: ele multiplica por 10 o custo de cada quadro
  // (~200ms contra ~20ms num 1280x720) e a rotacao que ele promete nem funciona
  // com RGBLuminanceSource. Sem ele, o zxing varre as linhas do meio do quadro
  // para fora e ja le o codigo de cabeca para baixo; a linha-guia na tela leva
  // o usuario a centralizar o codigo.
  const hints = new Map<any, any>([
    [
      zxing.DecodeHintType.POSSIBLE_FORMATS,
      [
        zxing.BarcodeFormat.EAN_13,
        zxing.BarcodeFormat.EAN_8,
        zxing.BarcodeFormat.UPC_A,
        zxing.BarcodeFormat.ITF,
        zxing.BarcodeFormat.CODE_128,
      ],
    ],
  ]);
  // O leitor 1D direto, e nao o MultiFormatReader: este, na 0.23, nao reconhece
  // o proprio NotFoundException e faz um console.warn a cada quadro sem codigo.
  const reader = new zxing.MultiFormatOneDReader(hints);
  // Uma tentativa sim, outra nao, o quadro vai girado 90 graus: assim tambem le
  // quem segura o produto em pe, sem dobrar o custo de cada tentativa.
  let rotate = false;

  return async (video, canvas) => {
    const imageData = drawFrame(video, canvas, MAX_BARCODE_SCAN_WIDTH);
    if (!imageData) return undefined;

    const { data, width, height } = imageData;
    const luminances = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < luminances.length; i += 1, p += 4) {
      luminances[i] = (data[p] + 2 * data[p + 1] + data[p + 2]) >> 2;
    }

    rotate = !rotate;
    const source = rotate
      ? new zxing.RGBLuminanceSource(rotateClockwise(luminances, width, height), height, width)
      : new zxing.RGBLuminanceSource(luminances, width, height);

    try {
      return reader.decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(source)), hints).getText();
    } catch {
      // NotFoundException a cada quadro sem codigo: e o caso normal.
      return undefined;
    }
  };
}

export function CameraScannerDialog({ open, onOpenChange, kind, title, description, onDetected }: Props) {
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Os callbacks chegam como arrow inline dos pais, ou seja, com identidade nova
  // a cada render deles. Lidos por ref, eles ficam fora das dependencias do
  // efeito abaixo — senao qualquer render do pai derrubaria a camera no meio da
  // leitura e pediria um getUserMedia novo.
  const onDetectedRef = useRef(onDetected);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onDetectedRef.current = onDetected;
    onOpenChangeRef.current = onOpenChange;
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
          video:
            kind === "barcode"
              ? { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
              : { facingMode: { ideal: "environment" } },
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

        const decode = kind === "barcode" ? await createBarcodeDecoder() : await createQrDecoder();
        const interval = kind === "barcode" ? BARCODE_SCAN_INTERVAL_MS : 0;
        let lastAttempt = 0;
        // Codigo de barras so vale depois de lido duas vezes, sem leitura diferente
        // no meio: o ITF e o Code 128 aceitam fragmentos de barra como codigo valido.
        let pendingBarcode: string | null = null;

        const scan = async (now: number) => {
          if (!active || !videoRef.current) return;

          if (now - lastAttempt < interval) {
            rafRef.current = window.requestAnimationFrame(scan);
            return;
          }
          lastAttempt = now;

          let value = await decode(videoRef.current, canvasRef.current);
          if (!active) return;

          if (value && kind === "barcode") {
            const digits = value.trim();
            if (!GTIN_PATTERN.test(digits)) {
              value = undefined;
            } else if (pendingBarcode !== digits) {
              pendingBarcode = digits;
              value = undefined;
            } else {
              value = digits;
            }
          }

          if (value) {
            onDetectedRef.current(value);
            onOpenChangeRef.current(false);
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
  }, [open, kind]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg border bg-muted">
            <video
              ref={videoRef}
              className={kind === "barcode" ? "aspect-video w-full object-cover" : "aspect-square w-full object-cover"}
              autoPlay
              muted
              playsInline
            />
            {kind === "barcode" ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              />
            ) : null}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <p className="text-xs text-muted-foreground">
            Se a camera nao abrir, confira as permissoes do navegador ou digite o codigo manualmente.
          </p>
          <Button type="button" variant="outline" className="w-full gap-2" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            Fechar camera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
