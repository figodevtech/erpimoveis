"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ImageDown, Loader2, Printer, Share2 } from "lucide-react";
import { useState } from "react";
import { toBlob } from "html-to-image";

type OSShareMenuProps = {
  osId: number;
};

const EXPORT_PIXEL_RATIO = 3;

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

export function OSShareMenu({ osId }: OSShareMenuProps) {
  const [isExporting, setIsExporting] = useState(false);

  async function exportImage() {
    if (isExporting) return;

    const folha = document.querySelector<HTMLElement>("[data-os-export-target]");
    if (!folha) {
      alert("Nao foi possivel localizar a ordem de servico para exportar.");
      return;
    }

    setIsExporting(true);

    try {
      await document.fonts?.ready;

      const blob = await toBlob(folha, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: EXPORT_PIXEL_RATIO,
        width: 794,
        height: 1123,
        style: {
          border: "0",
          boxShadow: "none",
          height: "1123px",
          position: "static",
          transform: "none",
          width: "794px",
        },
      });

      if (!blob) {
        throw new Error("Falha ao gerar a imagem.");
      }

      const filename = `ordem-servico-${osId}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const canShareFile =
        typeof navigator !== "undefined" &&
        "canShare" in navigator &&
        navigator.canShare?.({ files: [file] });

      if (canShareFile) {
        await navigator.share({
          files: [file],
          title: `Ordem de Servico #${osId}`,
          text: `Ordem de Servico #${osId}`,
        });
        return;
      }

      downloadBlob(blob, filename);
    } catch (error) {
      console.error("Erro ao exportar OS como imagem:", error);
      alert("Nao foi possivel exportar a imagem da ordem de servico.");
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
          className="print:hidden hover:cursor-pointer hover:text-black"
        >
          <Share2 className="w-4 h-4 mr-2" />
          Compartilhar
          <ChevronDown className="w-4 h-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
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
          {isExporting ? "Gerando..." : "Imagem"}
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
