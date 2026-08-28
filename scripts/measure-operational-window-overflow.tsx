import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";

import { OperationalNodeWindow } from "../src/app/(app)/(full)/central-operacional/components/operational-node-window";

const css = fs.readFileSync(path.resolve("src/app/(app)/(full)/central-operacional/central-operacional.css"), "utf8");
const markup = renderToStaticMarkup(
  <OperationalNodeWindow
    node={{ modulo: "CONTAS_RECEBER", disponivel: true, estado: "ATENÇÃO", indicador: { tipo: "MOEDA", valor: 123456.78, sufixo: null }, detalhe: "12 vencidas · 28 a receber no período", alerta: true }}
    period="MENSAL"
    updatedAt="2026-08-28T15:30:00.000Z"
    lastEvent={null}
    hideValues={false}
    paused
    onClose={() => undefined}
  />,
);

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [390, 540, 600, 860, 900, 1180, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.setContent(`<style>${css}*{box-sizing:border-box}html,body{margin:0;background:#050810}.operational-map-panel{width:${width <= 860 ? "100%" : "calc(100% - 300px)"};height:670px}</style><main class="operational-screen"><section class="operational-map-panel">${markup}</section></main>`);
      const result = await page.locator(".operational-node-window").evaluate((dialog) => {
        const dialogRect = dialog.getBoundingClientRect();
        const offenders = Array.from(dialog.querySelectorAll<HTMLElement>("*"))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              selector: `${element.tagName.toLowerCase()}.${element.className || ""}`,
              ownDelta: element.scrollWidth - element.clientWidth,
              rightDelta: Math.round((rect.right - dialogRect.right) * 10) / 10,
              leftDelta: Math.round((dialogRect.left - rect.left) * 10) / 10,
            };
          })
          .filter((item) => item.ownDelta > 1 || item.rightDelta > 1 || item.leftDelta > 1)
          .sort((a, b) => Math.max(b.ownDelta, b.rightDelta, b.leftDelta) - Math.max(a.ownDelta, a.rightDelta, a.leftDelta))
          .slice(0, 8);
        return {
          clientWidth: dialog.clientWidth,
          scrollWidth: dialog.scrollWidth,
          delta: dialog.scrollWidth - dialog.clientWidth,
          overflowX: getComputedStyle(dialog).overflowX,
          offenders,
        };
      });
      console.log(width, JSON.stringify(result));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
