import type { Page } from "@playwright/test";

export async function sanitizePageForCapture(page: Page) {
  const hideFinancialValues = process.env.CAPTURE_HIDE_FINANCIAL_VALUES === "true";

  await page.evaluate(({ hideFinancialValues }) => {
    const replacements: Array<[RegExp, string]> = [
      [/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "contato@example.invalid"],
      [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "000.000.000-00"],
      [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "00.000.000/0000-00"],
      [/\(\d{2}\)\s?\d{4,5}-\d{4}/g, "(00) 90000-0000"],
      [/\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/g, "DEM0A00"],
      [/\b\d{5}-\d{3}\b/g, "00000-000"],
    ];
    if (hideFinancialValues) {
      replacements.push([/R\$\s?[\d.]+,\d{2}/g, "R$ •••••"]);
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    for (const node of textNodes) {
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
      let value = node.nodeValue ?? "";
      for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
      node.nodeValue = value;
    }

    const sensitiveHeader = /cliente|propriet[aá]rio|usu[aá]rio|vendedor|respons[aá]vel|realizador|executor|cpf|cnpj|telefone|e-?mail|placa|chassi|endere[cç]o|pagador|solicitante/i;
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const headers = Array.from(table.querySelectorAll("thead th, thead td"));
      const sensitiveIndexes = headers
        .map((header, index) => sensitiveHeader.test(header.textContent ?? "") ? index : -1)
        .filter((index) => index >= 0);

      for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        const cells = Array.from(row.querySelectorAll(":scope > td, :scope > th"));
        for (const index of sensitiveIndexes) {
          const cell = cells[index];
          if (cell) cell.textContent = "DADO DEMONSTRAÇÃO";
        }
      }
    }

    const sensitiveLabel = /cpf|cnpj|telefone|e-?mail|placa|chassi|endere[cç]o/i;
    for (const label of Array.from(document.querySelectorAll("label, dt, .k"))) {
      if (!sensitiveLabel.test(label.textContent ?? "")) continue;
      const htmlFor = label instanceof HTMLLabelElement ? label.htmlFor : "";
      const target = htmlFor ? document.getElementById(htmlFor) : label.nextElementSibling;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = "DADO DEMONSTRAÇÃO";
      } else if (target) {
        target.textContent = "DADO DEMONSTRAÇÃO";
      }
    }

    for (const button of Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]'))) {
      const spans = Array.from(button.querySelectorAll("span"));
      if (!spans.some((span) => (span.textContent ?? "").includes("@"))) continue;
      if (spans[0]) spans[0].textContent = "USUÁRIO DEMONSTRAÇÃO";
    }

    if (window.location.pathname === "/acompanhamento-financeiro") {
      for (const customer of Array.from(document.querySelectorAll<HTMLElement>("p[title]"))) {
        if (!customer.title || customer.textContent?.trim() !== customer.title.trim()) continue;
        customer.textContent = "CLIENTE DEMONSTRAÇÃO";
        customer.title = "CLIENTE DEMONSTRAÇÃO";
      }
    }

    const userChartTitle = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, p, span"))
      .find((element) => element.textContent?.trim() === "Serviços por usuário");
    let userChart = userChartTitle?.parentElement ?? null;
    while (userChart && !userChart.querySelector("svg")) userChart = userChart.parentElement;
    for (const label of Array.from(userChart?.querySelectorAll<SVGTextElement>("svg text") ?? [])) {
      const value = label.textContent?.trim() ?? "";
      if (value && !/^\d+(?:[,.]\d+)?$/.test(value)) label.textContent = "Usuário";
    }
  }, { hideFinancialValues });
}

export const CAPTURE_STYLE = `
  [data-capture-hide],
  nextjs-portal,
  [data-next-badge-root],
  [data-sonner-toaster] {
    display: none !important;
  }

  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
`;
