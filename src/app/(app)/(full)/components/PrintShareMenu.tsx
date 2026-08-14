"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ImageDown, Loader2, Printer, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toCanvas } from "html-to-image";

type PrintShareMenuProps = {
  documentId: number | string;
  filenamePrefix: string;
  targetSelector?: string;
  fixedHeight?: number;
};

const DEFAULT_EXPORT_WIDTH = 794;
const DEFAULT_TARGET_SELECTOR = "[data-print-export-target]";

function detectMobile() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
    window.matchMedia("(max-width: 768px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

/**
 * Resolução alvo. O documento é vetorial até o `drawImage`, então o ratio é o
 * único fator de nitidez do PNG: 3 rasteriza a folha A4 em ~2382x3369.
 */
const TARGET_PIXEL_RATIO = 3;

/**
 * Tetos de canvas por plataforma. No iOS o Safari corta em 16.7M px de área e
 * em 4096 de lado nos aparelhos mais antigos; estourar não dá erro, devolve
 * canvas em branco. No desktop o limite prático é o lado de 16384 — acima
 * disso o próprio html-to-image reescala o canvas e distorce a folha.
 */
const CANVAS_LIMITS = {
  mobile: { side: 4_096, area: 12_000_000 },
  desktop: { side: 16_384, area: 100_000_000 },
};
/** PNG de canvas em branco comprime para poucos KB, independente do tamanho. */
const MIN_VALID_PNG_BYTES = 4_096;

function safePixelRatio(width: number, height: number, mobile: boolean) {
  const limites = mobile ? CANVAS_LIMITS.mobile : CANVAS_LIMITS.desktop;
  const porLado = Math.min(limites.side / width, limites.side / height);
  const porArea = Math.sqrt(limites.area / (width * height));
  // Abaixo de 0.5 a folha fica ilegível; nesse ponto o documento é longo demais
  // para virar uma imagem só e o caminho é imprimir.
  return Math.max(0.5, Math.min(TARGET_PIXEL_RATIO, porLado, porArea));
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 15_000);
}

async function waitForImages(root: Element) {
  const pending = Array.from(root.querySelectorAll("img"))
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    );

  return Promise.race([
    Promise.all(pending),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
  ]);
}

const PRINT_EXPORT_OVERRIDE_CSS = `
  html[data-print-exporting] {
    --os-scale: 1 !important;
    --orc-scale: 1 !important;
  }

  html[data-print-exporting] .folha-scaler {
    position: static !important;
    width: 794px !important;
    min-height: 1123px !important;
    height: auto !important;
    margin: 0 auto !important;
    transform: none !important;
    zoom: 1 !important;
  }

  html[data-print-exporting] .folha {
    position: static !important;
    width: 794px !important;
    min-height: 1123px !important;
    height: auto !important;
    transform: none !important;
    zoom: 1 !important;
    box-shadow: none !important;
    margin: 0 auto !important;
  }

  html[data-print-exporting] [data-print-pagination-root] {
    width: 794px !important;
    max-width: none !important;
    margin: 0 auto !important;
  }

  html[data-print-exporting] .print-generated-holder {
    position: static !important;
    width: 794px !important;
    min-height: 1123px !important;
    height: auto !important;
    margin: 0 auto !important;
    transform: none !important;
    zoom: 1 !important;
  }

  html[data-print-exporting] .print-generated-page {
    position: static !important;
    width: 794px !important;
    min-height: 1123px !important;
    height: 1123px !important;
    transform: none !important;
    zoom: 1 !important;
    box-shadow: none !important;
    margin: 0 auto !important;
  }

  html[data-print-exporting] [data-print-export-target] {
    width: 794px !important;
    max-width: none !important;
    margin: 0 auto !important;
    transform: none !important;
    zoom: 1 !important;
  }
`;

export function PrintShareMenu({
  documentId,
  filenamePrefix,
  targetSelector = DEFAULT_TARGET_SELECTOR,
  fixedHeight,
}: PrintShareMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const updateMobile = () => setIsMobile(detectMobile());

    updateMobile();
    window.addEventListener("resize", updateMobile);
    window.addEventListener("orientationchange", updateMobile);

    return () => {
      window.removeEventListener("resize", updateMobile);
      window.removeEventListener("orientationchange", updateMobile);
    };
  }, []);

  async function exportImage() {
    if (isExporting) return;

    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!target) {
      alert("Não foi possível localizar o documento para exportar.");
      return;
    }

    setIsExporting(true);

    const rootEl = document.documentElement;
    const prevOsScale = rootEl.style.getPropertyValue("--os-scale");
    const prevOrcScale = rootEl.style.getPropertyValue("--orc-scale");

    try {
      // 1. Temporarily prepare document at 100% scale for export
      rootEl.setAttribute("data-print-exporting", "true");
      rootEl.style.setProperty("--os-scale", "1");
      rootEl.style.setProperty("--orc-scale", "1");

      // 2. Wait for fonts, images and layout recalculation
      await document.fonts?.ready;
      await waitForImages(target);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      const width = DEFAULT_EXPORT_WIDTH;
      const measuredHeight = Math.ceil(
        Math.max(
          target.scrollHeight,
          target.offsetHeight,
          target.getBoundingClientRect().height,
        ),
      );
      const height = fixedHeight ?? Math.max(1123, measuredHeight);

      const mobile = detectMobile();

      // 3. Gerar o PNG.
      // Não passamos canvasWidth/canvasHeight: o html-to-image multiplica esses
      // valores pelo pixelRatio de novo, então mandá-los já multiplicados
      // elevava o canvas ao quadrado do ratio (794x1123 @2 virava 3176x4492).
      // No desktop passava; no iOS estourava o teto e devolvia canvas em branco.
      const render = async (pixelRatio: number) => {
        const canvas = await toCanvas(target, {
          backgroundColor: "#ffffff",
          cacheBust: true,
          pixelRatio,
          width,
          height,
          style: {
            border: "0",
            boxShadow: "none",
            height: `${height}px`,
            left: "0",
            margin: "0",
            minHeight: `${height}px`,
            overflow: "visible",
            position: "static",
            right: "auto",
            top: "0",
            transform: "none",
            width: `${width}px`,
            zoom: "1",
          },
        });

        return canvasToPngBlob(canvas);
      };

      const ratioInicial = safePixelRatio(width, height, mobile);
      let blob = await render(ratioInicial);

      // O iOS não avisa quando desiste do canvas: devolve um PNG válido, porém
      // vazio. Só o tamanho do arquivo denuncia — vale uma segunda tentativa
      // menor antes de desistir.
      if (!blob || blob.size < MIN_VALID_PNG_BYTES) {
        const ratioReduzido = Math.max(0.5, Math.min(1, ratioInicial * 0.6));
        blob = await render(ratioReduzido);
      }

      if (!blob || blob.size < MIN_VALID_PNG_BYTES) {
        throw new Error("Falha ao gerar a imagem.");
      }

      const filename = `${filenamePrefix}-${documentId}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      const canShareFile =
        typeof navigator !== "undefined" &&
        "canShare" in navigator &&
        navigator.canShare?.({ files: [file] });

      if (mobile && canShareFile) {
        try {
          await navigator.share({
            files: [file],
            title: filename,
          });
          return;
        } catch (shareErr: any) {
          if (shareErr?.name === "AbortError") {
            return;
          }
          console.warn("Compartilhamento nativo falhou, baixando imagem:", shareErr);
        }
      }

      downloadBlob(blob, filename);
    } catch (error) {
      console.error("Erro ao exportar documento como imagem:", error);
      alert("Não foi possível exportar a imagem do documento.");
    } finally {
      rootEl.removeAttribute("data-print-exporting");
      if (prevOsScale) {
        rootEl.style.setProperty("--os-scale", prevOsScale);
      } else {
        rootEl.style.removeProperty("--os-scale");
      }
      if (prevOrcScale) {
        rootEl.style.setProperty("--orc-scale", prevOrcScale);
      } else {
        rootEl.style.removeProperty("--orc-scale");
      }
      window.dispatchEvent(new Event("resize"));
      setIsExporting(false);
    }
  }

  return (
    <>
      <style>{PRINT_EXPORT_OVERRIDE_CSS}</style>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="print:hidden !border-slate-300 !bg-white !text-slate-900 hover:!bg-slate-100 hover:!text-slate-900 hover:cursor-pointer"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Compartilhar
            <ChevronDown className="w-4 h-4 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            disabled={isExporting}
            onSelect={(event) => {
              event.preventDefault();
              void exportImage();
            }}
            className="cursor-pointer"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ImageDown className="w-4 h-4" />
            )}
            {isExporting
              ? "Gerando..."
              : isMobile
                ? "Compartilhar imagem"
                : "Baixar imagem"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => window.print()}
            className="cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

