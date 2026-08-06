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
import { toBlob } from "html-to-image";

type PrintShareMenuProps = {
  documentId: number | string;
  filenamePrefix: string;
  targetSelector?: string;
  fixedHeight?: number;
};

const EXPORT_PIXEL_RATIO = 3;
const DEFAULT_EXPORT_WIDTH = 794;
const DEFAULT_TARGET_SELECTOR = "[data-print-export-target]";

function detectMobile() {
  return (
    window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
    window.matchMedia("(max-width: 768px)").matches
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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
      alert("Nao foi possivel localizar o documento para exportar.");
      return;
    }

    setIsExporting(true);

    try {
      await document.fonts?.ready;

      const width = DEFAULT_EXPORT_WIDTH;
      const height =
        fixedHeight ??
        Math.max(
          1123,
          Math.ceil(target.scrollHeight || target.getBoundingClientRect().height),
        );

      const blob = await toBlob(target, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: EXPORT_PIXEL_RATIO,
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
        },
      });

      if (!blob) {
        throw new Error("Falha ao gerar a imagem.");
      }

      const filename = `${filenamePrefix}-${documentId}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const canShareFile =
        typeof navigator !== "undefined" &&
        "canShare" in navigator &&
        navigator.canShare?.({ files: [file] });

      if (isMobile && canShareFile) {
        await navigator.share({ files: [file] });
        return;
      }

      downloadBlob(blob, filename);
    } catch (error) {
      console.error("Erro ao exportar documento como imagem:", error);
      alert("Nao foi possivel exportar a imagem do documento.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
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
  );
}
