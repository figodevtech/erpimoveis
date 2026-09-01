"use client";

import { useEffect, useRef } from "react";

import { PRINT_FONT_SCALE_ATTRIBUTE } from "@/lib/print/fontScale";

const ROOT_SELECTOR = "[data-print-pagination-root]";
const SOURCE_SELECTOR = "[data-print-pagination-source]";
const SOURCE_HOLDER_SELECTOR = "[data-print-pagination-source-holder]";
const ITEMS_SELECTOR = "[data-print-items-table]";
const FINAL_SELECTOR = "[data-print-final-block]";
const READY_ATTRIBUTE = "data-print-pagination-ready";
const PRINT_ATTRIBUTE = "data-print-paginating-for-print";

function removeIds(element: Element) {
  element.removeAttribute("id");
  element.querySelectorAll("[id]").forEach((child) => child.removeAttribute("id"));
}

function waitForImages(root: Element) {
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

/**
 * Divide uma tabela longa em folhas A4 reais antes da impressao.
 *
 * O navegador nao recalcula `margin-top:auto` no ultimo fragmento de um flex
 * container. Medindo as linhas e criando folhas explicitas, o bloco comercial
 * final pode continuar ancorado na base da ultima pagina.
 */
export function PrintA4Paginator() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const marker = markerRef.current;
    const root = marker?.closest<HTMLElement>(ROOT_SELECTOR);
    const source = root?.querySelector<HTMLElement>(SOURCE_SELECTOR);
    const sourceHolder = root?.querySelector<HTMLElement>(SOURCE_HOLDER_SELECTOR);

    if (!root || !source || !sourceHolder) return;

    let disposed = false;
    let frame = 0;
    let generated: HTMLElement | null = null;

    const paginate = () => {
      if (disposed) return;

      root.removeAttribute(READY_ATTRIBUTE);
      generated?.remove();

      const sourceContent = source.querySelector<HTMLElement>(":scope > .conteudo");
      const sourceHeader = source.querySelector<HTMLElement>(":scope > .header-os");
      const repeatHeader = root.hasAttribute("data-print-pagination-repeat-header");
      const numberedPages = root.hasAttribute("data-print-pagination-number-pages");
      const items = sourceContent?.querySelector<HTMLElement>(`:scope > ${ITEMS_SELECTOR}`);
      const finalBlock = sourceContent?.querySelector<HTMLElement>(`:scope > ${FINAL_SELECTOR}`);

      if (!sourceContent || !finalBlock) return;

      const sourceRows = items
        ? Array.from(items.querySelectorAll<HTMLTableRowElement>("tbody > tr"))
        : [];
      const regularBlocks = Array.from(sourceContent.children).filter(
        (child) => child !== items && child !== finalBlock,
      );

      generated = document.createElement("div");
      generated.className = "print-pagination-generated";
      generated.setAttribute("data-print-pagination-generated", "");
      generated.style.position = "absolute";
      generated.style.left = "-100000px";
      generated.style.top = "0";
      generated.style.visibility = "hidden";
      generated.style.display = "flex";
      generated.style.flexDirection = "column";
      root.appendChild(generated);

      type Page = {
        holder: HTMLElement;
        sheet: HTMLElement;
        content: HTMLElement;
        tbody: HTMLTableSectionElement | null;
      };

      const pages: Page[] = [];

      const createPage = (firstPage: boolean, withTable: boolean): Page => {
        const holder = sourceHolder.cloneNode(false) as HTMLElement;
        holder.removeAttribute("data-print-pagination-source-holder");
        holder.classList.add("print-generated-holder");

        const sheet = source.cloneNode(false) as HTMLElement;
        sheet.removeAttribute("data-print-pagination-source");
        sheet.removeAttribute("data-print-export-target");
        sheet.classList.add("print-generated-page");

        if ((firstPage || repeatHeader) && sourceHeader) {
          const header = sourceHeader.cloneNode(true) as HTMLElement;
          removeIds(header);
          sheet.appendChild(header);
        }

        const content = sourceContent.cloneNode(false) as HTMLElement;
        removeIds(content);

        if (firstPage) {
          regularBlocks.forEach((block) => {
            const clone = block.cloneNode(true) as HTMLElement;
            removeIds(clone);
            content.appendChild(clone);
          });
        }

        let tbody: HTMLTableSectionElement | null = null;
        if (withTable && items) {
          const tableClone = items.cloneNode(true) as HTMLElement;
          removeIds(tableClone);
          tbody = tableClone.querySelector<HTMLTableSectionElement>("tbody");
          tbody?.replaceChildren();
          content.appendChild(tableClone);
        }

        sheet.appendChild(content);
        holder.appendChild(sheet);
        generated?.appendChild(holder);

        const page = { holder, sheet, content, tbody };
        pages.push(page);
        return page;
      };

      const fits = (page: Page) =>
        page.sheet.scrollHeight <= page.sheet.clientHeight + 1 &&
        page.content.scrollHeight <= page.content.clientHeight + 1;

      const addFinalBlock = (page: Page) => {
        const clone = finalBlock.cloneNode(true) as HTMLElement;
        removeIds(clone);
        page.content.appendChild(clone);
        return clone;
      };

      let current = createPage(true, sourceRows.length > 0);

      sourceRows.forEach((row, index) => {
        if (!current.tbody) current = createPage(false, true);

        const rowClone = row.cloneNode(true) as HTMLTableRowElement;
        removeIds(rowClone);
        current.tbody?.appendChild(rowClone);

        // Alguns cabeçalhos precisam permanecer com a primeira linha de
        // conteúdo seguinte. As linhas necessárias entram apenas como sondas
        // de medição e serão adicionadas definitivamente nas próximas iterações.
        let fitsWithRequiredNext = fits(current);
        const requiredNextRows: HTMLTableRowElement[] = [];
        if (row.hasAttribute("data-print-row-keep-with-next")) {
          for (let probeIndex = index + 1; probeIndex < sourceRows.length; probeIndex += 1) {
            const nextRow = sourceRows[probeIndex];
            requiredNextRows.push(nextRow);
            if (!nextRow.hasAttribute("data-print-row-keep-with-next")) break;
          }
        }
        if (fitsWithRequiredNext && requiredNextRows.length && current.tbody) {
          const probes = requiredNextRows.map((requiredNextRow) => {
            const probe = requiredNextRow.cloneNode(true) as HTMLTableRowElement;
            removeIds(probe);
            probe.setAttribute("data-print-pagination-probe", "");
            current.tbody?.appendChild(probe);
            return probe;
          });
          fitsWithRequiredNext = fits(current);
          probes.forEach((probe) => probe.remove());
        }

        if (!fitsWithRequiredNext) {
          rowClone.remove();
          current = createPage(false, true);
          current.tbody?.appendChild(rowClone);
        }

        if (index === sourceRows.length - 1) {
          const footer = addFinalBlock(current);

          if (!fits(current)) {
            footer.remove();
            rowClone.remove();

            const lastPage = createPage(false, true);
            lastPage.tbody?.appendChild(rowClone);
            const lastFooter = addFinalBlock(lastPage);

            if (!fits(lastPage)) {
              lastFooter.remove();
              rowClone.remove();
              lastPage.holder.remove();
              pages.pop();
              current.tbody?.appendChild(rowClone);

              const footerPage = createPage(false, false);
              addFinalBlock(footerPage);
            }
          }
        }
      });

      if (sourceRows.length === 0) {
        const footer = addFinalBlock(current);
        if (!fits(current)) {
          footer.remove();
          const footerPage = createPage(false, false);
          addFinalBlock(footerPage);
        }
      }

      if (numberedPages) {
        pages.forEach((page, index) => {
          const footer = document.createElement("div");
          footer.className = "print-generated-page-number";
          footer.textContent = `Página ${index + 1} de ${pages.length}`;
          page.sheet.appendChild(footer);
        });
      }

      generated.style.removeProperty("position");
      generated.style.removeProperty("left");
      generated.style.removeProperty("top");
      generated.style.removeProperty("visibility");
      generated.style.removeProperty("display");
      generated.style.removeProperty("flex-direction");
      root.setAttribute(READY_ATTRIBUTE, "");
    };

    const schedulePagination = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(paginate);
    };

    const prepare = async () => {
      await document.fonts?.ready;
      await waitForImages(source);
      schedulePagination();
    };

    const observer = new MutationObserver(schedulePagination);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-os-observacoes",
        "data-print-ocultar-cliente",
        "data-print-ocultar-valores",
        PRINT_FONT_SCALE_ATTRIBUTE,
      ],
    });

    const beforePrint = () => {
      document.documentElement.setAttribute(PRINT_ATTRIBUTE, "");
      paginate();
    };
    const afterPrint = () => {
      document.documentElement.removeAttribute(PRINT_ATTRIBUTE);
      schedulePagination();
    };

    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    window.addEventListener("resize", schedulePagination, { passive: true });
    void prepare();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      window.removeEventListener("resize", schedulePagination);
      document.documentElement.removeAttribute(PRINT_ATTRIBUTE);
      root.removeAttribute(READY_ATTRIBUTE);
      generated?.remove();
    };
  }, []);

  return (
    <>
      <style>{PRINT_A4_PAGINATION_CSS}</style>
      <span ref={markerRef} hidden aria-hidden="true" />
    </>
  );
}

const PRINT_A4_PAGINATION_CSS = `
  [data-print-pagination-root]{
    width:fit-content;
    max-width:100%;
    margin:0 auto;
  }

  [data-print-pagination-generated]{ display:none; }

  [data-print-pagination-root][data-print-pagination-ready]
    > [data-print-pagination-source-holder]{ display:none; }

  [data-print-pagination-root][data-print-pagination-ready]
    > [data-print-pagination-generated]{
      display:flex;
      flex-direction:column;
      gap:16px;
    }

  .print-generated-page{
    display:flex !important;
    flex-direction:column !important;
    height:var(--a4h) !important;
    min-height:var(--a4h) !important;
    max-height:var(--a4h) !important;
    overflow:hidden !important;
    position:relative !important;
  }

  .print-generated-page-number{
    position:absolute;
    right:12mm;
    bottom:6mm;
    color:#64748b;
    font-size:8px;
    font-variant-numeric:tabular-nums;
  }

  .print-generated-page > .conteudo{
    display:flex !important;
    flex:1 1 auto !important;
    flex-direction:column !important;
    height:auto !important;
    min-height:0 !important;
    overflow:hidden !important;
  }

  .print-generated-page .tabela-container{
    flex:none !important;
    min-height:auto !important;
    overflow:visible !important;
  }

  [data-print-final-block]{
    margin-top:auto;
    break-inside:avoid;
    page-break-inside:avoid;
  }

  @media print{
    [data-print-pagination-root]{
      width:210mm !important;
      max-width:none !important;
      margin:0 !important;
    }

    [data-print-pagination-root][data-print-pagination-ready]
      > [data-print-pagination-generated]{ gap:0 !important; }

    .print-generated-holder{
      width:210mm !important;
      height:297mm !important;
      min-height:297mm !important;
      margin:0 !important;
      break-after:page;
      page-break-after:always;
    }

    .print-generated-holder:last-child{
      break-after:auto;
      page-break-after:auto;
    }

    .print-generated-page{
      width:210mm !important;
      height:297mm !important;
      min-height:297mm !important;
      max-height:297mm !important;
      margin:0 !important;
      transform:none !important;
      zoom:1 !important;
    }
  }
`;
