"use client";

import { Button } from "@/components/ui/button";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, FileDown, ImageDown, Loader2, Printer, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toCanvas } from "html-to-image";

type PrintShareMenuProps = {
  documentId: number | string;
  filenamePrefix: string;
  targetSelector?: string;
  fixedHeight?: number;
};

type ExportacaoEmCurso = "imagem" | "pdf" | null;

const DEFAULT_EXPORT_WIDTH = 794;
const DEFAULT_EXPORT_HEIGHT = 1123;
const DEFAULT_TARGET_SELECTOR = "[data-print-export-target]";
/** Folhas que o PrintA4Paginator monta: cada uma vira uma página do PDF. */
const GENERATED_PAGE_SELECTOR = ".print-generated-page";

function detectMobile() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
    window.matchMedia("(max-width: 768px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

/**
 * O WebKit rasteriza o SVG do html-to-image antes de decodificar as imagens
 * aninhadas nele — inclusive data URLs, que nem rede precisam. Na primeira
 * exportação a logo fica de fora; da segunda em diante ela já está decodificada
 * e aparece. Como o SVG gerado é idêntico entre as chamadas, uma renderização
 * descartável antes da real serve só para aquecer esse cache.
 */
function precisaAquecerRender() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  const safari = /Safari/i.test(ua) && !/Chrome|Chromium|Android|Edg/i.test(ua);
  return iOS || safari;
}

/**
 * Resolução alvo. O documento é vetorial até o `drawImage`, então o ratio é o
 * único fator de nitidez do PNG: 3 rasteriza a folha A4 em ~2382x3369.
 */
const TARGET_PIXEL_RATIO = 3;
/** Ratio do aquecimento: só precisa passar pelo decode, não gerar imagem boa. */
const WARMUP_PIXEL_RATIO = 0.5;
/**
 * O PDF tem uma folha por página em vez de uma imagem única, então 2 já entrega
 * ~190 DPI em A4. Subir para 3 dobra o arquivo sem diferença no papel.
 */
const TARGET_PDF_PIXEL_RATIO = 2;

/** A4 em pontos PostScript, a unidade em que o pdf-lib mede a página. */
const A4_PT = { width: 595.28, height: 841.89 };
/** Sobra de arredondamento no fatiamento; abaixo disso a página sairia em branco. */
const MIN_SLICE_PX = 8;

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

/**
 * No celular o download costuma sumir na pasta de downloads; a folha de
 * compartilhamento nativa deixa mandar direto para o cliente. No desktop, e
 * quando o aparelho não aceita o arquivo, cai no download comum.
 */
async function entregarArquivo(blob: Blob, filename: string, mime: string, mobile: boolean) {
  const file = new File([blob], filename, { type: mime });

  const canShareFile =
    typeof navigator !== "undefined" &&
    "canShare" in navigator &&
    navigator.canShare?.({ files: [file] });

  if (mobile && canShareFile) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (shareErr: any) {
      if (shareErr?.name === "AbortError") return;
      console.warn("Compartilhamento nativo falhou, baixando arquivo:", shareErr);
    }
  }

  downloadBlob(blob, filename);
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

function alturaMedida(element: HTMLElement) {
  return Math.ceil(
    Math.max(
      element.scrollHeight,
      element.offsetHeight,
      element.getBoundingClientRect().height,
    ),
  );
}

/**
 * Corta um canvas em pedaços com a proporção da folha A4. Serve para os
 * documentos que não passam pelo paginador — a ficha do cliente cresce com o
 * conteúdo e viraria uma página só, desproporcional.
 */
function fatiarEmPaginasA4(canvas: HTMLCanvasElement) {
  const alturaFatia = Math.round(canvas.width * (A4_PT.height / A4_PT.width));
  if (canvas.height <= alturaFatia + MIN_SLICE_PX) return [canvas];

  const fatias: HTMLCanvasElement[] = [];

  for (let topo = 0; topo < canvas.height; topo += alturaFatia) {
    const altura = Math.min(alturaFatia, canvas.height - topo);
    if (altura < MIN_SLICE_PX) break;

    const fatia = document.createElement("canvas");
    fatia.width = canvas.width;
    // A fatia final quase nunca fecha a folha: o restante fica branco, como no papel.
    fatia.height = alturaFatia;

    const contexto = fatia.getContext("2d");
    if (!contexto) continue;

    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, fatia.width, fatia.height);
    contexto.drawImage(canvas, 0, topo, canvas.width, altura, 0, 0, canvas.width, altura);
    fatias.push(fatia);
  }

  return fatias.length > 0 ? fatias : [canvas];
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
  const [exportando, setExportando] = useState<ExportacaoEmCurso>(null);
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

  /**
   * Deixa o documento em escala 1 — o preview do mobile é escalado e entraria
   * encolhido na exportação —, espera fontes e imagens, roda o trabalho e
   * devolve a tela ao estado anterior. Imagem e PDF partem daqui.
   */
  async function comDocumentoPreparado<T>(
    target: HTMLElement,
    trabalho: (contexto: { mobile: boolean }) => Promise<T>,
  ) {
    const rootEl = document.documentElement;
    const prevOsScale = rootEl.style.getPropertyValue("--os-scale");
    const prevOrcScale = rootEl.style.getPropertyValue("--orc-scale");

    try {
      rootEl.setAttribute("data-print-exporting", "true");
      rootEl.style.setProperty("--os-scale", "1");
      rootEl.style.setProperty("--orc-scale", "1");

      await document.fonts?.ready;
      await waitForImages(target);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      return await trabalho({ mobile: detectMobile() });
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
    }
  }

  /**
   * Não passamos canvasWidth/canvasHeight: o html-to-image multiplica esses
   * valores pelo pixelRatio de novo, então mandá-los já multiplicados elevava o
   * canvas ao quadrado do ratio (794x1123 @2 virava 3176x4492). No desktop
   * passava; no iOS estourava o teto e devolvia canvas em branco.
   */
  function renderizarCanvas(
    element: HTMLElement,
    width: number,
    height: number,
    pixelRatio: number,
  ) {
    return toCanvas(element, {
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
  }

  function localizarDocumento() {
    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!target) {
      alert("Não foi possível localizar o documento para exportar.");
      return null;
    }
    return target;
  }

  async function exportImage() {
    if (exportando) return;

    const target = localizarDocumento();
    if (!target) return;

    setExportando("imagem");

    try {
      await comDocumentoPreparado(target, async ({ mobile }) => {
        const width = DEFAULT_EXPORT_WIDTH;
        const height = fixedHeight ?? Math.max(DEFAULT_EXPORT_HEIGHT, alturaMedida(target));

        const render = async (pixelRatio: number) =>
          canvasToPngBlob(await renderizarCanvas(target, width, height, pixelRatio));

        // Aquecimento: o resultado é jogado fora, só serve para o WebKit
        // decodificar as imagens embutidas antes da renderização que vale.
        if (precisaAquecerRender()) {
          await renderizarCanvas(target, width, height, WARMUP_PIXEL_RATIO);
        }

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

        await entregarArquivo(blob, `${filenamePrefix}-${documentId}.png`, "image/png", mobile);
      });
    } catch (error) {
      console.error("Erro ao exportar documento como imagem:", error);
      alert("Não foi possível exportar a imagem do documento.");
    } finally {
      setExportando(null);
    }
  }

  /**
   * O PDF sai das mesmas folhas que o navegador imprimiria: quando o
   * PrintA4Paginator já dividiu o documento, cada folha vira uma página; sem
   * ele, o documento inteiro é cortado na proporção A4. Assim o arquivo salvo
   * tem a mesma quebra de página do papel.
   */
  async function exportPdf() {
    if (exportando) return;

    const target = localizarDocumento();
    if (!target) return;

    setExportando("pdf");

    try {
      await comDocumentoPreparado(target, async ({ mobile }) => {
        // Carregado sob demanda: o pdf-lib só pesa no bundle de quem baixa PDF.
        const { PDFDocument } = await import("pdf-lib");

        // Enquanto o paginador não termina, as folhas existem no DOM mas dentro
        // de um container oculto — renderizá-las devolveria páginas em branco.
        const folhas = Array.from(
          target.querySelectorAll<HTMLElement>(GENERATED_PAGE_SELECTOR),
        ).filter((folha) => folha.getClientRects().length > 0);
        const paginasFonte = folhas.length > 0 ? folhas : [target];

        const width = DEFAULT_EXPORT_WIDTH;
        const ratioTeto = Math.min(
          TARGET_PDF_PIXEL_RATIO,
          safePixelRatio(width, DEFAULT_EXPORT_HEIGHT, mobile),
        );

        if (precisaAquecerRender()) {
          await renderizarCanvas(
            paginasFonte[0],
            width,
            DEFAULT_EXPORT_HEIGHT,
            WARMUP_PIXEL_RATIO,
          );
        }

        const pdf = await PDFDocument.create();

        for (const paginaFonte of paginasFonte) {
          const altura =
            paginasFonte.length > 1
              ? Math.max(DEFAULT_EXPORT_HEIGHT, alturaMedida(paginaFonte))
              : (fixedHeight ?? Math.max(DEFAULT_EXPORT_HEIGHT, alturaMedida(paginaFonte)));

          const ratio = Math.min(ratioTeto, safePixelRatio(width, altura, mobile));
          const canvas = await renderizarCanvas(paginaFonte, width, altura, ratio);

          for (const fatia of fatiarEmPaginasA4(canvas)) {
            const blob = await canvasToPngBlob(fatia);
            if (!blob || blob.size < MIN_VALID_PNG_BYTES) {
              throw new Error("Falha ao gerar a página do PDF.");
            }

            const png = await pdf.embedPng(await blob.arrayBuffer());
            const pagina = pdf.addPage([A4_PT.width, A4_PT.height]);
            pagina.drawImage(png, {
              x: 0,
              y: 0,
              width: A4_PT.width,
              height: A4_PT.height,
            });
          }
        }

        if (pdf.getPageCount() === 0) {
          throw new Error("Documento sem páginas para exportar.");
        }

        const bytes = await pdf.save();
        const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });

        await entregarArquivo(
          blob,
          `${filenamePrefix}-${documentId}.pdf`,
          "application/pdf",
          mobile,
        );
      });
    } catch (error) {
      console.error("Erro ao exportar documento como PDF:", error);
      alert("Não foi possível exportar o PDF do documento.");
    } finally {
      setExportando(null);
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
            className={`print:hidden ${PRINT_ACTION_BUTTON_CLASS}`}
          >
            <Share2 className="w-4 h-4 mr-2" />
            Compartilhar
            <ChevronDown className="w-4 h-4 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={exportando !== null}
            onSelect={(event) => {
              event.preventDefault();
              void exportImage();
            }}
            className="cursor-pointer"
          >
            {exportando === "imagem" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ImageDown className="w-4 h-4" />
            )}
            {exportando === "imagem"
              ? "Gerando..."
              : isMobile
                ? "Compartilhar imagem"
                : "Baixar imagem"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={exportando !== null}
            onSelect={(event) => {
              event.preventDefault();
              void exportPdf();
            }}
            className="cursor-pointer"
          >
            {exportando === "pdf" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4" />
            )}
            {exportando === "pdf"
              ? "Gerando..."
              : isMobile
                ? "Compartilhar PDF"
                : "Baixar PDF"}
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
