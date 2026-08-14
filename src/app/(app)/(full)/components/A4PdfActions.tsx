"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { toJpeg } from "html-to-image";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

type PdfImage = { bytes: Uint8Array; width: number; height: number };

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

function dataUrlToBytes(dataUrl: string) {
  const binary = window.atob(dataUrl.split(",")[1] ?? "");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readImageSize(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Não foi possível ler a página do relatório."));
    image.src = dataUrl;
  });
}

function buildImagePdf(images: PdfImage[], landscape: boolean) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let offset = 0;
  const pageWidth = landscape ? 841.89 : 595.28;
  const pageHeight = landscape ? 595.28 : 841.89;

  const pushString = (value: string) => {
    const bytes = encoder.encode(value);
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const addObject = (number: number, parts: Array<string | Uint8Array>) => {
    offsets[number] = offset;
    pushString(`${number} 0 obj\n`);
    parts.forEach((part) => (typeof part === "string" ? pushString(part) : pushBytes(part)));
    pushString("\nendobj\n");
  };

  const pageObjects = images.map((_, index) => 3 + index * 3);
  pushString("%PDF-1.4\n");
  addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  addObject(2, [`<< /Type /Pages /Kids [${pageObjects.map((number) => `${number} 0 R`).join(" ")}] /Count ${images.length} >>`]);

  images.forEach((image, index) => {
    const pageObject = pageObjects[index];
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const imageName = `Im${index}`;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ`;
    addObject(pageObject, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`]);
    addObject(contentObject, [`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`]);
    addObject(imageObject, [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
      "\nendstream",
    ]);
  });

  const objectCount = 2 + images.length * 3;
  const xrefOffset = offset;
  pushString(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let number = 1; number <= objectCount; number += 1) {
    pushString(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  pushString(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const output = new Uint8Array(offset);
  let cursor = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, cursor);
    cursor += chunk.length;
  });
  return new Blob([output.buffer], { type: "application/pdf" });
}

export function A4PdfActions({
  filename,
  backHref,
  selector = ".report-sheet",
  landscape = false,
}: {
  filename: string;
  backHref: string;
  selector?: string;
  landscape?: boolean;
}) {
  const [generating, setGenerating] = useState(false);

  async function downloadPdf() {
    if (generating) return;
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(selector));
    if (!sheets.length) return toast.error("Não foi possível localizar o relatório.");
    setGenerating(true);
    try {
      await document.fonts?.ready;
      const images: PdfImage[] = [];
      for (const sheet of sheets) {
        const dataUrl = await toJpeg(sheet, {
          backgroundColor: "#ffffff",
          cacheBust: true,
          pixelRatio: 2,
          quality: 0.96,
        });
        images.push({ bytes: dataUrlToBytes(dataUrl), ...(await readImageSize(dataUrl)) });
      }
      downloadBlob(buildImagePdf(images, landscape), filename);
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      toast.error("Não foi possível gerar o PDF.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="print:hidden flex items-center gap-2">
      <Button asChild type="button" variant="outline" size="sm">
        <Link href={backHref}>Voltar</Link>
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={generating}>
        {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
        {generating ? "Gerando PDF..." : "Baixar PDF"}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="mr-2 h-4 w-4" />Imprimir
      </Button>
    </div>
  );
}
